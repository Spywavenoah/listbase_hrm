/*
# Training video completion, certificates and renewal  (additive only)

Goals:
  1. Track genuine video watch-through (segment union, heartbeats, gaps, rate).
  2. Issue a certificate only on verified completion.
  3. Reset the renewal countdown by issuing a NEW next-cycle enrollment row
     instead of mutating the completed one (audit history preserved).
  4. Let the standing scheduler pick up `certificate_expires_at`.

Nothing existing is dropped or re-typed. The only constraint change is the
old `UNIQUE(course_id, employee_id)` which would make a second cycle impossible;
it is replaced by `UNIQUE(course_id, employee_id, cycle)` (still one row per cycle).
*/

-- ============================================================
-- 0. Allow generated certificate PDFs in the documents bucket
--    (bucket previously only accepted images for certification uploads).
-- ============================================================
UPDATE storage.buckets
SET allowed_mime_types = (
      SELECT array_agg(DISTINCT mime ORDER BY mime)
      FROM unnest(COALESCE(allowed_mime_types, ARRAY[]::text[]) || ARRAY['application/pdf']) AS mime
    )
WHERE id = 'certification-documents'
  AND NOT ('application/pdf' = ANY(COALESCE(allowed_mime_types, ARRAY[]::text[])));

-- ============================================================
-- 1. Courses: video + renewal + validation settings
-- ============================================================
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS video_url text;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS video_duration_seconds integer;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS renewal_months integer;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS pass_pct integer NOT NULL DEFAULT 95;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS completion_enforced boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN training_courses.video_url IS 'Direct mp4/HLS URL of the lesson video.';
COMMENT ON COLUMN training_courses.renewal_months IS 'NULL = certificate never renews. Otherwise issues a next cycle on completion.';
COMMENT ON COLUMN training_courses.pass_pct IS 'Min union coverage of duration to pass (default 95).';
COMMENT ON COLUMN training_courses.completion_enforced IS 'Only applies when global training.completion_enforcement = ENFORCED (incremental rollout).';

-- ============================================================
-- 2. Enrollments: certificate + cycle + explainable decision
-- ============================================================
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS certificate_id text;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS certificate_issued_at timestamptz;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS certificate_expires_at timestamptz;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS certificate_pdf_url text;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS cycle integer NOT NULL DEFAULT 1;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS parent_enrollment_id uuid REFERENCES training_enrollments(id) ON DELETE SET NULL;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS completion_state text NOT NULL DEFAULT 'IN_PROGRESS';
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS completion_decision jsonb;
ALTER TABLE training_enrollments ADD COLUMN IF NOT EXISTS validation_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN training_enrollments.cycle IS 'Renewal cycle number. 1 = first issuance. Next cycle is a NEW row.';
COMMENT ON COLUMN training_enrollments.completion_decision IS 'Full explainability payload: metrics + thresholds + reasons + mode (SHADOW/ENFORCED).';

-- allow one row per (course, employee, cycle) instead of one per (course, employee)
ALTER TABLE training_enrollments DROP CONSTRAINT IF EXISTS training_enrollments_course_id_employee_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_training_enrollments_cycle
  ON training_enrollments (course_id, employee_id, cycle);

-- ============================================================
-- 3. Watch tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS training_video_progress (
  enrollment_id uuid PRIMARY KEY REFERENCES training_enrollments(id) ON DELETE CASCADE,
  watched_segments jsonb NOT NULL DEFAULT '[]'::jsonb, -- merged union of [start,end] seconds
  last_position_seconds numeric(12,3) NOT NULL DEFAULT 0,
  last_heartbeat_at timestamptz,
  watch_duration_seconds numeric(12,3) NOT NULL DEFAULT 0, -- union coverage
  duration_seconds numeric(12,3),                          -- observed media duration
  heartbeat_count integer NOT NULL DEFAULT 0,
  expected_heartbeats integer NOT NULL DEFAULT 0,
  max_position_seconds numeric(12,3) NOT NULL DEFAULT 0,
  max_playback_rate numeric(6,3) NOT NULL DEFAULT 1,
  max_gap_ms integer NOT NULL DEFAULT 0,
  session_id text,
  device_fingerprint text,
  fingerprint_mismatch boolean NOT NULL DEFAULT false,
  completion_state text NOT NULL DEFAULT 'IN_PROGRESS',
  decision jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_video_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES training_enrollments(id) ON DELETE CASCADE,
  session_id text,
  device_fingerprint text,
  position_seconds numeric(12,3) NOT NULL,
  playback_rate numeric(6,3) NOT NULL DEFAULT 1,
  playing boolean NOT NULL DEFAULT false,
  interrupted boolean NOT NULL DEFAULT false, -- pause / tab-hidden since previous beat
  since_last_ms integer,
  client_ts timestamptz,
  server_ts timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_hb_enrollment ON training_video_heartbeats (enrollment_id, server_ts);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_cert_expires ON training_enrollments (certificate_expires_at);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_employee_status ON training_enrollments (employee_id, status);

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE training_video_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_video_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_video_progress" ON training_video_progress;
CREATE POLICY "select_video_progress" ON training_video_progress FOR SELECT TO authenticated
  USING (
    public.has_any_privilege(ARRAY['training.manage'])
    OR EXISTS (
      SELECT 1 FROM training_enrollments te
      WHERE te.id = enrollment_id AND te.employee_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "write_video_progress" ON training_video_progress;
CREATE POLICY "write_video_progress" ON training_video_progress FOR ALL TO authenticated
  USING (
    public.has_any_privilege(ARRAY['training.manage'])
    OR EXISTS (
      SELECT 1 FROM training_enrollments te
      WHERE te.id = enrollment_id AND te.employee_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_any_privilege(ARRAY['training.manage'])
    OR EXISTS (
      SELECT 1 FROM training_enrollments te
      WHERE te.id = enrollment_id AND te.employee_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "select_video_heartbeats" ON training_video_heartbeats;
CREATE POLICY "select_video_heartbeats" ON training_video_heartbeats FOR SELECT TO authenticated
  USING (
    public.has_any_privilege(ARRAY['training.manage'])
    OR EXISTS (
      SELECT 1 FROM training_enrollments te
      WHERE te.id = enrollment_id AND te.employee_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_video_heartbeats" ON training_video_heartbeats;
CREATE POLICY "insert_video_heartbeats" ON training_video_heartbeats FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_privilege(ARRAY['training.manage'])
    OR EXISTS (
      SELECT 1 FROM training_enrollments te
      WHERE te.id = enrollment_id AND te.employee_id = auth.uid()
    )
  );

-- ============================================================
-- 5. Server-side completion evaluation (explainable from stored data)
-- ============================================================
CREATE OR REPLACE FUNCTION public.training_completion_evaluation(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_en training_enrollments%ROWTYPE;
  v_course training_courses%ROWTYPE;
  v_p training_video_progress%ROWTYPE;
  v_dur numeric;
  v_pass integer;
  v_coverage numeric := 0;
  v_expected integer := 0;
  v_checks jsonb := '{}'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_eligible boolean := true;
  v_no_video boolean := false;
BEGIN
  SELECT * INTO v_en FROM training_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_course FROM training_courses WHERE id = v_en.course_id;
  SELECT * INTO v_p FROM training_video_progress WHERE enrollment_id = p_enrollment_id;

  -- no lesson video configured: nothing to verify against (manual completion still works)
  IF COALESCE(v_course.video_url, '') = '' OR COALESCE(v_course.video_duration_seconds, 0) <= 0 THEN
    v_no_video := true;
    v_dur := 0;
  ELSE
    v_dur := COALESCE(v_course.video_duration_seconds, 0);
  END IF;

  v_pass := GREATEST(0, LEAST(100, COALESCE(v_course.pass_pct, 95)));
  v_coverage := COALESCE(v_p.watch_duration_seconds, 0);
  v_expected := CASE WHEN v_dur > 0 THEN ceil(v_dur / 7.0)::integer ELSE 0 END;

  IF v_no_video THEN
    v_checks := jsonb_build_object(
      'not_applicable', true
    );
    v_eligible := true;
  ELSE
    -- 1. union of watched segments >= pass_pct% of duration
    v_checks := v_checks || jsonb_build_object(
      'coverage_pct',
      jsonb_build_object(
        'ok', (v_coverage / NULLIF(v_dur,0) * 100.0) >= v_pass,
        'actual', round((v_coverage / NULLIF(v_dur,0) * 100.0)::numeric, 2),
        'required', v_pass
      )
    );
    -- 2. max position reached the end (duration - 2s)
    v_checks := v_checks || jsonb_build_object(
      'reached_end',
      jsonb_build_object(
        'ok', COALESCE(v_p.max_position_seconds, 0) >= (v_dur - 2),
        'actual', COALESCE(v_p.max_position_seconds, 0),
        'required', round((v_dur - 2)::numeric, 2)
      )
    );
    -- 3. heartbeat count >= 90% of expected
    v_checks := v_checks || jsonb_build_object(
      'heartbeat_count',
      jsonb_build_object(
        'ok', COALESCE(v_p.heartbeat_count, 0) >= ceil(v_expected * 0.9),
        'actual', COALESCE(v_p.heartbeat_count, 0),
        'expected', v_expected
      )
    );
    -- 4. no heartbeat gap > 15s (buffering/pause gaps carry interrupted=true and are ignored)
    v_checks := v_checks || jsonb_build_object(
      'max_gap_ms',
      jsonb_build_object(
        'ok', COALESCE(v_p.max_gap_ms, 0) <= 15000,
        'actual', COALESCE(v_p.max_gap_ms, 0),
        'required', 15000
      )
    );
    -- 5. active watch time >= pass_pct% of duration
    v_checks := v_checks || jsonb_build_object(
      'active_watch',
      jsonb_build_object(
        'ok', (v_coverage / NULLIF(v_dur,0) * 100.0) >= v_pass,
        'actual', round((v_coverage / NULLIF(v_dur,0) * 100.0)::numeric, 2),
        'required', v_pass
      )
    );
    -- 6. playback rate <= 1.25 throughout
    v_checks := v_checks || jsonb_build_object(
      'playback_rate',
      jsonb_build_object(
        'ok', COALESCE(v_p.max_playback_rate, 1) <= 1.25,
        'actual', COALESCE(v_p.max_playback_rate, 1),
        'required', 1.25
      )
    );

    SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
      INTO v_reasons
    FROM (
      SELECT k
      FROM jsonb_each(v_checks) e(k, v)
      WHERE NOT COALESCE((v ->> 'ok')::boolean, false)
    ) t;

    IF jsonb_array_length(v_reasons) > 0 THEN
      v_eligible := false;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'has_video', NOT v_no_video,
    'duration_seconds', v_dur,
    'coverage_seconds', v_coverage,
    'active_watch_seconds', v_coverage,
    'max_position_seconds', COALESCE(v_p.max_position_seconds, 0),
    'heartbeat_count', COALESCE(v_p.heartbeat_count, 0),
    'expected_heartbeats', v_expected,
    'max_gap_ms', COALESCE(v_p.max_gap_ms, 0),
    'max_playback_rate', COALESCE(v_p.max_playback_rate, 1),
    'fingerprint_mismatch', COALESCE(v_p.fingerprint_mismatch, false),
    'pass_pct', v_pass,
    'checks', v_checks,
    'reasons', v_reasons,
    'eligible', v_eligible
  );
END $$;

-- ============================================================
-- 6. Certificate issuance + next-cycle enrollment + notification
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

  IF v_course.renewal_months IS NOT NULL THEN
    v_expires := v_issued + make_interval(months => v_course.renewal_months);
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

  -- next renewal cycle is a NEW row (history of this row is untouched)
  IF v_course.renewal_months IS NOT NULL THEN
    INSERT INTO training_enrollments
      (course_id, employee_id, status, enrolled_at, progress, cycle,
       parent_enrollment_id, completion_state, validation_enabled)
    SELECT v_en.course_id, v_en.employee_id, 'ENROLLED', now(), 0,
           v_en.cycle + 1, v_en.id, 'IN_PROGRESS', v_en.validation_enabled
    WHERE NOT EXISTS (
      SELECT 1 FROM training_enrollments x
      WHERE x.course_id = v_en.course_id
        AND x.employee_id = v_en.employee_id
        AND x.cycle = v_en.cycle + 1
    )
    RETURNING id INTO v_next_id;
  END IF;

  -- existing notification type (queued for the mail automation)
  INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
  SELECT
    'training.certificate_issued',
    e.email,
    e.first_name,
    'Certificate issued: ' || v_course.title,
    '<p>Hi ' || COALESCE(e.first_name, '') || ',</p>'
      || '<p>Congratulations — your certificate for <strong>' || v_course.title || '</strong> has been issued.</p>'
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
END $$;

GRANT EXECUTE ON FUNCTION public.training_completion_evaluation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_training_certificate(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.training_completion_evaluation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_training_certificate(uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.training_completion_evaluation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_training_certificate(uuid, boolean) FROM PUBLIC;

-- ============================================================
-- 7. Scheduler: pick up certificate_expires_at (renewal reminders)
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
BEGIN
  SELECT * INTO v_task FROM public.scheduled_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Task not found');
  END IF;

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

-- ============================================================
-- 8. Incremental rollout switch: start in SHADOW (log, do not block)
-- ============================================================
INSERT INTO system_settings (group_name, key, value)
VALUES ('training', 'completion_enforcement', '"SHADOW"'::jsonb)
ON CONFLICT (group_name, key) DO NOTHING;

-- ============================================================
-- 9. Default renewal job (picks up certificate_expires_at)
-- ============================================================
INSERT INTO scheduled_tasks (name, job_type, frequency, run_at, event_key, is_active, next_run_at)
SELECT 'Training certificate renewal', 'TRAINING_RENEWAL', 'WEEKLY', '09:00'::time,
       'training.renewal_upcoming', true, now()
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks
  WHERE job_type = 'TRAINING_RENEWAL' AND name = 'Training certificate renewal'
);
