/*
# Trial Periods (30/60/90)

1. `trial_milestones()` — per active employee, computes days employed and the
   next 30/60/90-day trial milestone (day, date, days until it) plus their hire
   date. Used by the Reports "Trial Periods" panel.

2. Scheduler integration — `run_scheduled_task` learns a new
   `TRIAL_MILESTONE` job type: when run, it queues a reminder email to every
   active employee whose next trial milestone falls within the next 14 days.
*/

-- ============================================================
-- 1. Trial milestone computations
-- ============================================================
CREATE OR REPLACE FUNCTION public.trial_milestones()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_emp record;
  v_days integer;
  v_next_day integer;
  v_next_date date;
  v_name text;
BEGIN
  FOR v_emp IN
    SELECT e.id AS employee_id,
           COALESCE(e.first_name, '') AS first_name,
           COALESCE(e.last_name, '') AS last_name,
           e.email,
           e.hire_date,
           e.employment_status
      FROM public.employees e
     WHERE e.employment_status = 'ACTIVE'
  LOOP
    v_name := NULLIF(trim(v_emp.first_name || ' ' || v_emp.last_name), '');

    IF v_emp.hire_date IS NULL THEN
      RETURN NEXT jsonb_build_object(
        'employee_id', v_emp.employee_id,
        'name', v_name,
        'email', v_emp.email,
        'hire_date', NULL,
        'days_employed', NULL,
        'next_milestone_day', NULL,
        'next_milestone_date', NULL,
        'days_until_next', NULL
      );
      CONTINUE;
    END IF;

    v_days := (CURRENT_DATE - v_emp.hire_date);

    IF v_days >= 90 THEN
      v_next_day := NULL;
      v_next_date := NULL;
    ELSIF v_days >= 60 THEN
      v_next_day := 90;
      v_next_date := v_emp.hire_date + 90;
    ELSIF v_days >= 30 THEN
      v_next_day := 60;
      v_next_date := v_emp.hire_date + 60;
    ELSE
      v_next_day := 30;
      v_next_date := v_emp.hire_date + 30;
    END IF;

    RETURN NEXT jsonb_build_object(
      'employee_id', v_emp.employee_id,
      'name', v_name,
      'email', v_emp.email,
      'hire_date', v_emp.hire_date,
      'days_employed', v_days,
      'next_milestone_day', v_next_day,
      'next_milestone_date', v_next_date,
      'days_until_next', CASE WHEN v_next_date IS NOT NULL THEN (v_next_date - CURRENT_DATE) ELSE NULL END,
      'trial_complete', v_days >= 90
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.trial_milestones() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trial_milestones() FROM anon;
REVOKE ALL ON FUNCTION public.trial_milestones() FROM authenticated;

-- ============================================================
-- 2. Scheduler: TRIAL_MILESTONE reminder job
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
  v_days_left integer;
BEGIN
  SELECT * INTO v_task FROM public.scheduled_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Task not found');
  END IF;

  IF v_task.job_type = 'TRIAL_MILESTONE' THEN
    FOR v_recipient IN
      SELECT tm.employee_id, tm.name, tm.email, tm.next_milestone_day, tm.days_until_next
        FROM public.trial_milestones() tm
       WHERE tm.employee_id IS NOT NULL
         AND tm.email IS NOT NULL
         AND tm.email <> ''
         AND tm.next_milestone_day IS NOT NULL
         AND tm.days_until_next >= 0
         AND tm.days_until_next <= 14
    LOOP
      v_days_left := COALESCE(v_recipient.days_until_next, 0);
      INSERT INTO public.notification_queue (
        event_key, recipient_email, recipient_name, subject, body_html, status, metadata
      ) VALUES (
        COALESCE(v_task.event_key, 'trial.milestone'),
        v_recipient.email,
        v_recipient.name,
        'Trial milestone approaching: Day ' || v_recipient.next_milestone_day,
        '<p>Hi ' || COALESCE(v_recipient.name, '') || ',</p><p>Your day ' ||
        v_recipient.next_milestone_day || ' trial milestone is in ' || v_days_left ||
        E' day(s).</p>',
        'PENDING',
        jsonb_build_object(
          'task_id', v_task.id::text,
          'task_name', v_task.name,
          'job_type', v_task.job_type,
          'milestone_day', v_recipient.next_milestone_day
        )
      );
      v_count := v_count + 1;
    END LOOP;
  ELSE
    -- Existing job types: collect recipients per job type and enqueue reminders.
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

  v_message := v_count || ' reminder(s) queued';
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