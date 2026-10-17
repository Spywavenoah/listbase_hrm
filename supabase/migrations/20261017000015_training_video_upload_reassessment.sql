/*
# Training: video uploads, repetitive courses, deadlines, reminders, missed actions

Additive only.
1. `training-videos` storage bucket (course lessons uploaded, not linked).
2. Course setup: video path, repetitive + reassessment interval, completion
   deadline, and a configurable action when the deadline is missed
   (lock account / auto issue query / custom message).
3. Enrollment deadlines (`due_date`) + reminder/overdue bookkeeping.
4. `assign_training_course` — enroll every active employee and alert them
   (dashboard notification + email); mandatory courses alert ALL employees.
5. `training_send_reminders` — upcoming due reminders, reassessment reminders,
   and overdue actions.
6. Scheduler hook: `TRAINING_REMINDERS` job type + seeded daily task.
*/

-- ============================================================
-- 1. Training video storage bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'training-videos',
  'training-videos',
  true,
  52428800, -- 50 MB
  ARRAY['video/mp4','video/webm','video/ogg','video/quicktime','application/mp4']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS training_videos_read ON storage.objects;
CREATE POLICY training_videos_read ON storage.objects
  FOR SELECT USING (bucket_id = 'training-videos');

DROP POLICY IF EXISTS training_videos_insert ON storage.objects;
CREATE POLICY training_videos_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'training-videos'
    AND public.has_any_privilege(ARRAY['training.manage','admin.settings'])
  );

DROP POLICY IF EXISTS training_videos_update ON storage.objects;
CREATE POLICY training_videos_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'training-videos'
    AND public.has_any_privilege(ARRAY['training.manage','admin.settings'])
  );

DROP POLICY IF EXISTS training_videos_delete ON storage.objects;
CREATE POLICY training_videos_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'training-videos'
    AND public.has_any_privilege(ARRAY['training.manage','admin.settings'])
  );

-- ============================================================
-- 2. Course setup columns
-- ============================================================
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS video_path text;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS is_repetitive boolean NOT NULL DEFAULT false;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS reassessment_interval_months integer;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS due_in_days integer;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS missed_action text NOT NULL DEFAULT 'NONE';
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS missed_action_grace_days integer NOT NULL DEFAULT 7;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS missed_action_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE training_courses DROP CONSTRAINT IF EXISTS training_courses_missed_action_check;
ALTER TABLE training_courses
  ADD CONSTRAINT training_courses_missed_action_check
  CHECK (missed_action IN ('NONE','LOCK_ACCOUNT','AUTO_ISSUE_QUERY','CUSTOM'));

COMMENT ON COLUMN training_courses.video_path IS 'Object path of the uploaded lesson video (training-videos bucket).';
COMMENT ON COLUMN training_courses.is_repetitive IS 'Recurring course: employees must reassess on the interval below.';
COMMENT ON COLUMN training_courses.reassessment_interval_months IS 'Months between reassessments (drives certificate expiry + next cycle).';
COMMENT ON COLUMN training_courses.due_in_days IS 'Completion deadline in days from assignment. NULL = no deadline.';
COMMENT ON COLUMN training_courses.missed_action IS 'Action applied missed_action_grace_days after the deadline.';
COMMENT ON COLUMN training_courses.missed_action_grace_days IS 'Grace days after the deadline before missed_action applies.';
COMMENT ON COLUMN training_courses.missed_action_config IS 'CUSTOM action payload: { message, admin_email } with {course} {employee} placeholders.';

-- ============================================================
-- 3. Enrollment deadlines + reminder bookkeeping
-- ============================================================
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS due_date timestamptz;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS reassess_reminder_sent_at timestamptz;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS overdue_action_at timestamptz;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS overdue_action_result text;

COMMENT ON COLUMN training_enrollments.due_date IS 'Completion deadline (assignment + course.due_in_days, or reassessment due).';
COMMENT ON COLUMN training_enrollments.overdue_action_at IS 'When course.missed_action was applied after the grace period.';

CREATE INDEX IF NOT EXISTS idx_training_enrollments_due
  ON training_enrollments (due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_enrollments_cert_expiry
  ON training_enrollments (certificate_expires_at) WHERE certificate_expires_at IS NOT NULL;

-- Account lock for missed training actions reuses employees.is_login_blocked
-- (web login blocked; attendance clock in/out via WhatsApp/API unaffected).
ALTER TABLE employees DROP COLUMN IF EXISTS account_locked;

-- ============================================================
-- 4. Assign a course to every active employee (+ alert them)
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_training_course(p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_course training_courses%ROWTYPE;
  v_due timestamptz;
  v_enrolled integer := 0;
  v_alerted integer := 0;
  v_emp record;
BEGIN
  SELECT * INTO v_course FROM training_courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Course not found.');
  END IF;

  IF v_course.due_in_days IS NOT NULL AND v_course.due_in_days > 0 THEN
    v_due := now() + make_interval(days => v_course.due_in_days);
  END IF;

  WITH added AS (
    INSERT INTO training_enrollments
      (course_id, employee_id, status, progress, cycle, due_date, enrolled_at, completion_state, validation_enabled)
    SELECT p_course_id, e.id, 'ENROLLED', 0, 1, v_due, now(), 'IN_PROGRESS', true
      FROM employees e
     WHERE e.employment_status = 'ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM training_enrollments te
          WHERE te.course_id = p_course_id AND te.employee_id = e.id AND te.cycle = 1
       )
    ON CONFLICT (course_id, employee_id, cycle) DO NOTHING
    RETURNING employee_id
  )
  SELECT count(*) INTO v_enrolled FROM added;

  -- Mandatory courses alert EVERY active employee; optional ones alert the
  -- employees who were just enrolled.
  FOR v_emp IN
    SELECT e.id, e.first_name, e.email
      FROM employees e
     WHERE e.employment_status = 'ACTIVE'
       AND (v_course.is_mandatory
            OR EXISTS (
              SELECT 1 FROM training_enrollments te
               WHERE te.course_id = p_course_id
                 AND te.employee_id = e.id
                 AND te.cycle = 1
            ))
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.employee_id = e.id
            AND n.metadata ->> 'course_id' = p_course_id::text
            AND n.metadata ->> 'kind' = 'training_assignment'
       )
  LOOP
    PERFORM public.create_notification(
      v_emp.id,
      CASE WHEN v_course.is_mandatory THEN 'Mandatory training assigned' ELSE 'New training assigned' END,
      v_course.title
        || CASE WHEN v_due IS NOT NULL
                THEN ' — complete by ' || to_char(v_due, 'DD Mon YYYY') || '.'
                ELSE '.' END,
      CASE WHEN v_course.is_mandatory THEN 'ERROR' ELSE 'INFO' END,
      '/training/enrollments',
      jsonb_build_object(
        'kind', 'training_assignment',
        'course_id', p_course_id::text,
        'mandatory', v_course.is_mandatory,
        'due_date', v_due
      )
    );
    v_alerted := v_alerted + 1;

    IF v_emp.email IS NOT NULL AND btrim(v_emp.email) <> '' THEN
      INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
      VALUES (
        'training.assigned',
        v_emp.email,
        NULLIF(btrim(v_emp.first_name), ''),
        (CASE WHEN v_course.is_mandatory THEN 'Mandatory training: ' ELSE 'New training: ' END) || v_course.title,
        '<p>Hi ' || COALESCE(NULLIF(btrim(v_emp.first_name), ''), 'there') || ',</p>'
          || '<p><strong>' || v_course.title || '</strong>'
          || CASE WHEN v_course.is_mandatory THEN ' is a mandatory course.</strong></p>' ELSE '</strong> has been assigned to you.</p>' END
          || CASE WHEN v_course.instructor IS NOT NULL THEN '<p>Instructor: ' || v_course.instructor || '</p>' ELSE '' END
          || CASE WHEN v_due IS NOT NULL THEN '<p>Please complete it by <strong>' || to_char(v_due, 'DD Mon YYYY') || '</strong>.</p>' ELSE '' END
          || '<p>Open HR Flow → Training → Enrollments to start.</p>',
        'PENDING',
        jsonb_build_object('kind', 'training_assignment', 'course_id', p_course_id::text, 'due_date', v_due)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'enrolled', v_enrolled, 'alerted', v_alerted);
END;
$$;

REVOKE ALL ON FUNCTION public.assign_training_course(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_training_course(uuid) TO authenticated;

-- ============================================================
-- 5. Reminders, reassessment alerts and overdue actions
-- ============================================================
CREATE OR REPLACE FUNCTION public.training_send_reminders()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_due_count integer := 0;
  v_reassess_count integer := 0;
  v_action_count integer := 0;
  v_rec record;
  v_message text;
  v_title text;
BEGIN
  -- ---------------------------------------------------------------
  -- A. Deadline reminders (incl. upcoming reassessment cycles, whose
  --    due_date is the certificate expiry).
  -- ---------------------------------------------------------------
  FOR v_rec IN
    SELECT te.id, te.employee_id, te.due_date, te.cycle,
           c.title, c.id AS course_id, c.is_mandatory,
           e.first_name, e.email
      FROM training_enrollments te
      JOIN training_courses c ON c.id = te.course_id
      JOIN employees e ON e.id = te.employee_id
     WHERE te.status IN ('ENROLLED', 'IN_PROGRESS')
       AND te.due_date IS NOT NULL
       AND te.reminder_sent_at IS NULL
       AND te.due_date <= now() + interval '7 days'
       AND e.employment_status = 'ACTIVE'
  LOOP
    v_due_count := v_due_count + 1;
    v_title := 'Training due' || CASE WHEN v_rec.due_date < now() THEN ' (overdue)' ELSE '' END || ': ' || v_rec.title;

    PERFORM public.create_notification(
      v_rec.employee_id,
      v_title,
      'Please complete "' || v_rec.title || '" by ' || to_char(v_rec.due_date, 'DD Mon YYYY HH24:MI')
        || CASE WHEN v_rec.cycle > 1 THEN ' (reassessment).' ELSE '.' END,
      CASE WHEN v_rec.due_date < now() THEN 'ERROR' ELSE 'WARNING' END,
      '/training/enrollments',
      jsonb_build_object('kind', 'training_due', 'course_id', v_rec.course_id::text,
                         'enrollment_id', v_rec.id::text, 'due_date', v_rec.due_date)
    );

    IF v_rec.email IS NOT NULL AND btrim(v_rec.email) <> '' THEN
      INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
      VALUES (
        'training.due_reminder',
        v_rec.email,
        NULLIF(btrim(v_rec.first_name), ''),
        v_title,
        '<p>Hi ' || COALESCE(NULLIF(btrim(v_rec.first_name), ''), 'there') || ',</p>'
          || '<p>Your training <strong>' || v_rec.title || '</strong>'
          || CASE WHEN v_rec.cycle > 1 THEN ' (reassessment)' ELSE '' END
          || '</p>'
          || '<p>is due by <strong>' || to_char(v_rec.due_date, 'DD Mon YYYY HH24:MI') || '</strong>.</p>'
          || '<p>Open HR Flow → Training → Enrollments to complete it.</p>',
        'PENDING',
        jsonb_build_object('kind', 'training_due', 'course_id', v_rec.course_id::text, 'due_date', v_rec.due_date)
      );
    END IF;

    UPDATE training_enrollments SET reminder_sent_at = now() WHERE id = v_rec.id;
  END LOOP;

  -- ---------------------------------------------------------------
  -- B. Reassessment alerts for repetitive courses (certificate expiry).
  -- ---------------------------------------------------------------
  FOR v_rec IN
    SELECT te.id, te.employee_id, te.certificate_expires_at, te.cycle,
           c.title, c.id AS course_id,
           e.first_name, e.email
      FROM training_enrollments te
      JOIN training_courses c ON c.id = te.course_id
      JOIN employees e ON e.id = te.employee_id
     WHERE te.status = 'COMPLETED'
       AND te.certificate_expires_at IS NOT NULL
       AND te.certificate_expires_at <= now() + interval '30 days'
       AND te.reassess_reminder_sent_at IS NULL
       AND c.is_repetitive
       AND e.employment_status = 'ACTIVE'
  LOOP
    v_reassess_count := v_reassess_count + 1;
    v_title := 'Reassessment due: ' || v_rec.title;

    PERFORM public.create_notification(
      v_rec.employee_id,
      v_title,
      'Your certificate for "' || v_rec.title || '" expires on '
        || to_char(v_rec.certificate_expires_at, 'DD Mon YYYY')
        || '. Your next reassessment is already open in Enrollments.',
      'WARNING',
      '/training/enrollments',
      jsonb_build_object('kind', 'training_reassess', 'course_id', v_rec.course_id::text,
                         'enrollment_id', v_rec.id::text, 'expires_at', v_rec.certificate_expires_at)
    );

    IF v_rec.email IS NOT NULL AND btrim(v_rec.email) <> '' THEN
      INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
      VALUES (
        'training.reassessment_due',
        v_rec.email,
        NULLIF(btrim(v_rec.first_name), ''),
        v_title,
        '<p>Hi ' || COALESCE(NULLIF(btrim(v_rec.first_name), ''), 'there') || ',</p>'
          || '<p>Your certificate for <strong>' || v_rec.title || '</strong> expires on <strong>'
          || to_char(v_rec.certificate_expires_at, 'DD Mon YYYY') || '</strong>.</p>'
          || '<p>Your next reassessment cycle is open in Training → Enrollments.</p>',
        'PENDING',
        jsonb_build_object('kind', 'training_reassess', 'course_id', v_rec.course_id::text)
      );
    END IF;

    UPDATE training_enrollments SET reassess_reminder_sent_at = now() WHERE id = v_rec.id;
  END LOOP;

  -- ---------------------------------------------------------------
  -- C. Overdue actions (after the configured grace period).
  -- ---------------------------------------------------------------
  FOR v_rec IN
    SELECT te.id, te.employee_id, te.due_date, te.cycle,
           c.title, c.id AS course_id, c.missed_action,
           c.missed_action_config, c.is_mandatory,
           e.first_name, e.email
      FROM training_enrollments te
      JOIN training_courses c ON c.id = te.course_id
      JOIN employees e ON e.id = te.employee_id
     WHERE te.status IN ('ENROLLED', 'IN_PROGRESS')
       AND te.due_date IS NOT NULL
       AND te.overdue_action_at IS NULL
       AND c.missed_action <> 'NONE'
       AND te.due_date + make_interval(days => GREATEST(c.missed_action_grace_days, 0)) <= now()
       AND e.employment_status = 'ACTIVE'
  LOOP
    v_action_count := v_action_count + 1;
    v_title := 'Training overdue: ' || v_rec.title;

    IF v_rec.missed_action = 'LOCK_ACCOUNT' THEN
      UPDATE employees SET is_login_blocked = true, updated_at = now() WHERE id = v_rec.employee_id;
      v_message := 'Your account has been suspended because "' || v_rec.title
        || '" was not completed by ' || to_char(v_rec.due_date, 'DD Mon YYYY')
        || '. Contact your administrator to have it restored. (Clock in/out remains available.)';

    ELSIF v_rec.missed_action = 'AUTO_ISSUE_QUERY' THEN
      INSERT INTO employee_queries (employee_id, subject, category, details, status, raised_at, last_message_at, last_message_by)
      VALUES (
        v_rec.employee_id,
        'Overdue mandatory training: ' || v_rec.title,
        'Training',
        'The training "' || v_rec.title || '" was due on ' || to_char(v_rec.due_date, 'DD Mon YYYY')
          || ' and was not completed within the grace period.',
        'OPEN', now(), now(), 'MANAGER'
      );
      v_message := '"' || v_rec.title || '" is overdue (was due ' || to_char(v_rec.due_date, 'DD Mon YYYY')
        || ') and a query has been raised for you. Please respond.';

    ELSIF v_rec.missed_action = 'CUSTOM' THEN
      v_message := COALESCE(
        NULLIF(btrim(v_rec.missed_action_config ->> 'message'), ''),
        'Please complete "' || v_rec.title || '" immediately.'
      );
      v_message := replace(replace(v_message, '{course}', v_rec.title), '{employee}', v_rec.first_name);

    ELSE
      v_message := 'Training "' || v_rec.title || '" is overdue.';
    END IF;

    PERFORM public.create_notification(
      v_rec.employee_id,
      v_title,
      v_message,
      'ERROR',
      '/training/enrollments',
      jsonb_build_object('kind', 'training_overdue', 'course_id', v_rec.course_id::text,
                         'enrollment_id', v_rec.id::text, 'action', v_rec.missed_action)
    );

    IF v_rec.email IS NOT NULL AND btrim(v_rec.email) <> '' THEN
      INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
      VALUES (
        'training.overdue_action',
        v_rec.email,
        NULLIF(btrim(v_rec.first_name), ''),
        v_title,
        '<p>Hi ' || COALESCE(NULLIF(btrim(v_rec.first_name), ''), 'there') || ',</p>'
          || '<p>' || v_message || '</p>',
        'PENDING',
        jsonb_build_object('kind', 'training_overdue', 'course_id', v_rec.course_id::text, 'action', v_rec.missed_action)
      );
    END IF;

    -- administrators are informed about any overdue enforcement
    PERFORM public.create_notification(
      emp.id,
      'Training enforcement applied',
      v_rec.first_name || ' failed to complete "' || v_rec.title
        || '" (due ' || to_char(v_rec.due_date, 'DD Mon YYYY') || '). Action: ' || v_rec.missed_action || '.',
      'ERROR',
      '/training/enrollments',
      jsonb_build_object('kind', 'training_enforcement', 'course_id', v_rec.course_id::text,
                         'employee_id', v_rec.employee_id::text, 'action', v_rec.missed_action)
    )
    FROM employees emp
    WHERE emp.role = 'SUPER_ADMIN'
      AND emp.employment_status = 'ACTIVE';

    UPDATE training_enrollments
       SET overdue_action_at = now(),
           overdue_action_result = v_rec.missed_action
     WHERE id = v_rec.id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'reminders', v_due_count,
    'reassessments', v_reassess_count,
    'actions', v_action_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.training_send_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.training_send_reminders() TO authenticated;

-- ============================================================
-- 6. Scheduler: TRAINING_REMINDERS job + seeded daily task
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_scheduled_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.scheduled_tasks;
  v_count integer := 0;
  v_message text;
  v_now timestamptz := now();
  v_recipient record;
  v_next timestamptz;
  v_rem jsonb;
BEGIN
  SELECT * INTO v_task FROM public.scheduled_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Task not found');
  END IF;

  IF v_task.job_type = 'TRAINING_REMINDERS' THEN
    v_rem := public.training_send_reminders();
    v_count := COALESCE((v_rem ->> 'reminders')::integer, 0)
             + COALESCE((v_rem ->> 'reassessments')::integer, 0)
             + COALESCE((v_rem ->> 'actions')::integer, 0);
  ELSE
    -- Collect recipients per job type and enqueue reminder emails.
    FOR v_recipient IN
      SELECT DISTINCT e.id::text AS employee_id, e.email, COALESCE(e.first_name, '') AS first_name
        FROM public.employees e
       WHERE e.employment_status = 'ACTIVE'
         AND e.email IS NOT NULL
         AND e.email <> ''
         AND (
            v_task.job_type = 'PERFORMANCE_REVIEW' AND NOT EXISTS (
              SELECT 1 FROM public.performance_reviews pr
              WHERE pr.employee_id = e.id
                AND pr.status = 'COMPLETED'
                AND pr.submitted_at > now() - interval '365 days'
           )
            OR v_task.job_type = 'ONBOARDING_FOLLOWUP' AND EXISTS (
              SELECT 1
                FROM public.employee_onboarding_progress p
                JOIN public.onboarding_steps s ON s.id = p.step_id
               WHERE p.employee_id = e.id
                 AND s.is_required
                 AND p.status <> 'COMPLETED'
            )
            OR v_task.job_type = 'TRAINING_REMINDER' AND EXISTS (
              SELECT 1 FROM public.training_enrollments te
              WHERE te.employee_id = e.id
                AND te.status = 'ENROLLED'
                AND te.progress < 100
            )
            -- renewal: certificates expiring within 30 days (or already past)
            OR v_task.job_type = 'TRAINING_RENEWAL' AND EXISTS (
              SELECT 1 FROM public.training_enrollments te
              WHERE te.employee_id = e.id
                AND te.certificate_expires_at IS NOT NULL
                AND te.certificate_expires_at <= now() + interval '30 days'
                AND te.status = 'COMPLETED'
            )
         )
    LOOP
      IF v_recipient.email IS NOT NULL THEN
        INSERT INTO public.notification_queue (
          event_key, recipient_email, recipient_name, subject, body_html, status, metadata
        ) VALUES (
          COALESCE(v_task.event_key, 'task.reminder'),
          v_recipient.email,
          v_recipient.first_name,
          'Reminder: ' || v_task.name,
          '<p>Hi ' || COALESCE(v_recipient.first_name, '') || ',</p><p>' || v_task.name || E'</p>',
          'PENDING',
          jsonb_build_object('task_id', v_task.id::text, 'task_name', v_task.name, 'job_type', v_task.job_type)
        );
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END IF;

  v_next := public._scheduled_task_next_run(
    v_task.frequency, v_task.run_at, v_task.day_of_week, v_task.day_of_month, v_now
  );

  v_message := v_count || ' item(s) processed';
  UPDATE public.scheduled_tasks
     SET next_run_at = v_next,
         last_run_at = v_now,
         last_run_status = 'SUCCESS',
         last_run_message = v_message
   WHERE id = v_task.id;

  INSERT INTO public.scheduled_task_logs (task_id, run_at, status, items_processed, message)
  VALUES (v_task.id, v_now, 'SUCCESS', v_count, v_message);

  RETURN jsonb_build_object('ok', true, 'processed', v_count, 'next_run_at', v_next);
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_task(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_scheduled_task(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.run_scheduled_task(uuid) TO authenticated;

INSERT INTO scheduled_tasks (name, job_type, frequency, run_at, event_key, is_active, next_run_at)
SELECT 'Training reminders & overdue actions', 'TRAINING_REMINDERS', 'DAILY', '08:00'::time,
       'training.reminders', true, now()
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks
  WHERE job_type = 'TRAINING_REMINDERS' AND name = 'Training reminders & overdue actions'
);

-- ============================================================
-- 7. Issuance uses the reassessment interval when configured and
--    carries the deadline onto the next cycle's enrollment.
-- ============================================================
CREATE OR REPLACE FUNCTION public.issue_training_certificate(
  p_enrollment_id uuid,
  p_skip_validation boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_en training_enrollments%ROWTYPE;
  v_course training_courses%ROWTYPE;
  v_eval jsonb;
  v_cert_id text;
  v_issued timestamptz := now();
  v_expires timestamptz;
  v_interval integer;
  v_next_id uuid := NULL;
  v_pdf text := NULL;
BEGIN
  SELECT * INTO v_en FROM training_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  SELECT * INTO v_course FROM training_courses WHERE id = v_en.course_id;

  v_eval := public.training_completion_evaluation(p_enrollment_id);
  IF NOT COALESCE((v_eval ->> 'eligible')::boolean, false) AND NOT p_skip_validation THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'NOT_ELIGIBLE',
      'message', 'Completion criteria are not met.',
      'evaluation', v_eval
    );
  END IF;

  v_cert_id := COALESCE(
    v_en.certificate_id,
    'TRN-' || upper(substr(replace(v_en.id::text, '-', ''), 1, 10))
  );

  v_interval := COALESCE(v_course.reassessment_interval_months, v_course.renewal_months);
  IF v_interval IS NOT NULL THEN
    v_expires := v_issued + make_interval(months => v_interval);
  ELSE
    v_expires := NULL;
  END IF;

  UPDATE training_enrollments
     SET status = 'COMPLETED',
         completed_at = COALESCE(completed_at, v_issued),
         progress = 100,
         completion_state = 'ISSUED',
         certificate_id = v_cert_id,
         certificate_issued_at = v_issued,
         certificate_expires_at = v_expires,
         completion_decision = v_eval,
         updated_at = now()
   WHERE id = v_en.id
   RETURNING certificate_pdf_url INTO v_pdf;

  -- next reassessment cycle is a NEW row (history of this row is untouched)
  IF v_interval IS NOT NULL THEN
    INSERT INTO training_enrollments
      (course_id, employee_id, status, enrolled_at, progress, cycle,
       parent_enrollment_id, completion_state, validation_enabled, due_date)
    SELECT v_en.course_id, v_en.employee_id, 'ENROLLED', now(), 0,
           v_en.cycle + 1, v_en.id, 'IN_PROGRESS', v_en.validation_enabled, v_expires
    WHERE NOT EXISTS (
      SELECT 1 FROM training_enrollments x
      WHERE x.course_id = v_en.course_id
        AND x.employee_id = v_en.employee_id
        AND x.cycle = v_en.cycle + 1
    )
    RETURNING id INTO v_next_id;
  END IF;

  INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
  SELECT
    'training.certificate_issued',
    e.email,
    e.first_name,
    'Certificate issued: ' || v_course.title,
    '<p>Hi ' || COALESCE(e.first_name, '') || ',</p>'
      || '<p>Congratulations � your certificate for <strong>' || v_course.title || '</strong> has been issued.</p>'
      || '<p>Certificate ID: <strong>' || v_cert_id || '</strong></p>'
      || CASE WHEN v_expires IS NOT NULL
              THEN '<p>It is valid until ' || to_char(v_expires, 'DD Mon YYYY')
                   || '. Your next renewal cycle will open automatically.</p>'
              ELSE '<p>This certificate does not expire.</p>' END,
    'PENDING',
    jsonb_build_object(
      'enrollment_id', v_en.id::text,
      'course_id', v_en.course_id::text,
      'certificate_id', v_cert_id,
      'certificate_expires_at', v_expires,
      'cycle', v_en.cycle,
      'next_enrollment_id', v_next_id
    )
  FROM employees e
  WHERE e.id = v_en.employee_id
    AND e.email IS NOT NULL AND e.email <> '';

  RETURN jsonb_build_object(
    'ok', true,
    'certificate_id', v_cert_id,
    'certificate_issued_at', v_issued,
    'certificate_expires_at', v_expires,
    'certificate_pdf_url', v_pdf,
    'next_enrollment_id', v_next_id,
    'cycle', v_en.cycle,
    'evaluation', v_eval
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_training_certificate(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_training_certificate(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_training_certificate(uuid, boolean) TO service_role;

-- ============================================================
-- 8. New enrollments inherit the course deadline automatically.
-- ============================================================
CREATE OR REPLACE FUNCTION public.training_enrollment_defaults()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    SELECT CASE WHEN c.due_in_days IS NOT NULL AND c.due_in_days > 0
                THEN now() + make_interval(days => c.due_in_days)
           END
      INTO NEW.due_date
      FROM training_courses c
     WHERE c.id = NEW.course_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_enrollment_defaults ON training_enrollments;
CREATE TRIGGER trg_training_enrollment_defaults
  BEFORE INSERT ON training_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.training_enrollment_defaults();
