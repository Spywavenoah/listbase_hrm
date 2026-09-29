/*
# Standing-Jobs Scheduler

Consolidates recurring default-job reminders in one place: performance-review
due reminders, onboarding follow-ups, training reminders, plus custom standalone
jobs. Each task runs on a schedule and enqueues reminder emails into
`notification_queue` (drained by the existing mail automation).

1. `scheduled_tasks` — the standing jobs.
2. `scheduled_task_logs` — run history per task.
3. RPCs
   - `scheduled_tasks_due()` — active tasks whose `next_run_at` has passed.
   - `run_scheduled_task(p_task_id)` — collects recipients for the task's
     job type, enqueues reminder emails, logs the run and reschedules.

Managed through the Settings → Scheduler page (gated `admin.settings`).
*/

-- ============================================================
-- 1. Scheduled tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  job_type text NOT NULL DEFAULT 'CUSTOM', -- PERFORMANCE_REVIEW | ONBOARDING_FOLLOWUP | TRAINING_REMINDER | CUSTOM
  frequency text NOT NULL DEFAULT 'MONTHLY', -- DAILY | WEEKLY | MONTHLY | QUARTERLY | YEARLY
  run_at time NOT NULL DEFAULT '09:00',
  day_of_week integer,
  day_of_month integer,
  event_key text,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_status text,
  last_run_message text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE scheduled_tasks ADD CONSTRAINT scheduled_tasks_frequency_check
    CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "insert_scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "update_scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "delete_scheduled_tasks" ON scheduled_tasks;

CREATE POLICY "select_scheduled_tasks" ON scheduled_tasks FOR SELECT TO authenticated
  USING (public.has_privilege('admin.settings'));
CREATE POLICY "insert_scheduled_tasks" ON scheduled_tasks FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_scheduled_tasks" ON scheduled_tasks FOR UPDATE TO authenticated
  USING (public.has_privilege('admin.settings'))
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "delete_scheduled_tasks" ON scheduled_tasks FOR DELETE TO authenticated
  USING (public.has_privilege('admin.settings'));

-- ============================================================
-- 2. Run history
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_task_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  items_processed integer NOT NULL DEFAULT 0,
  message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE scheduled_task_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_scheduled_task_logs_task ON scheduled_task_logs(task_id, run_at DESC);

DROP POLICY IF EXISTS "select_scheduled_task_logs" ON scheduled_task_logs;
DROP POLICY IF EXISTS "insert_scheduled_task_logs" ON scheduled_task_logs;
DROP POLICY IF EXISTS "update_scheduled_task_logs" ON scheduled_task_logs;
DROP POLICY IF EXISTS "delete_scheduled_task_logs" ON scheduled_task_logs;

CREATE POLICY "select_scheduled_task_logs" ON scheduled_task_logs FOR SELECT TO authenticated
  USING (public.has_privilege('admin.settings'));
CREATE POLICY "insert_scheduled_task_logs" ON scheduled_task_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_scheduled_task_logs" ON scheduled_task_logs FOR UPDATE TO authenticated
  USING (public.has_privilege('admin.settings'))
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "delete_scheduled_task_logs" ON scheduled_task_logs FOR DELETE TO authenticated
  USING (public.has_privilege('admin.settings'));

-- ============================================================
-- 3. Helpers
-- ============================================================

-- Compute the next run timestamp for a schedule, stepping forward from a
-- reference point until strictly after now().
CREATE OR REPLACE FUNCTION public._scheduled_task_next_run(
  p_frequency text,
  p_run_at time,
  p_day_of_week integer,
  p_day_of_month integer,
  p_from timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_candidate timestamptz := p_from;
  v_day integer;
BEGIN
  IF v_candidate IS NULL THEN
    v_candidate := now();
  END IF;

  LOOP
    EXIT WHEN v_candidate > now();

    v_candidate := date_trunc('day', v_candidate) + p_run_at;

    CASE p_frequency
      WHEN 'DAILY' THEN
        v_candidate := v_candidate + interval '1 day';
      WHEN 'WEEKLY' THEN
        v_candidate := v_candidate + interval '7 days';
        IF p_day_of_week IS NOT NULL THEN
          WHILE (extract(isodow FROM v_candidate)::int - 1) IS DISTINCT FROM p_day_of_week LOOP
            v_candidate := v_candidate + interval '1 day';
          END LOOP;
        END IF;
      WHEN 'MONTHLY' THEN
        v_day := COALESCE(p_day_of_month, 1);
        v_candidate := v_candidate + interval '1 month';
        v_candidate := date_trunc('month', v_candidate)
          + (LEAST(v_day, extract(day FROM (v_candidate + interval '1 month - 1 day'))::int) - 1) * interval '1 day'
          + p_run_at;
      WHEN 'QUARTERLY' THEN
        v_day := COALESCE(p_day_of_month, 1);
        v_candidate := v_candidate + interval '3 months';
        v_candidate := date_trunc('month', v_candidate)
          + (LEAST(v_day, extract(day FROM (v_candidate + interval '1 month - 1 day'))::int) - 1) * interval '1 day'
          + p_run_at;
      WHEN 'YEARLY' THEN
        v_day := COALESCE(p_day_of_month, 1);
        v_candidate := v_candidate + interval '1 year';
        v_candidate := date_trunc('month', v_candidate)
          + (LEAST(v_day, extract(day FROM (v_candidate + interval '1 month - 1 day'))::int) - 1) * interval '1 day'
          + p_run_at;
      ELSE
        v_candidate := v_candidate + interval '1 month';
    END CASE;

    v_candidate := date_trunc('day', v_candidate) + p_run_at;
  END LOOP;

  RETURN v_candidate;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._scheduled_task_next_run(text, time, integer, integer, timestamptz) FROM PUBLIC;

-- Active tasks whose next run has come due (TZ-safe booked in local server time).
CREATE OR REPLACE FUNCTION public.scheduled_tasks_due()
RETURNS SETOF public.scheduled_tasks
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT * FROM public.scheduled_tasks
   WHERE is_active
     AND next_run_at <= now()
   ORDER BY next_run_at;
$$;

REVOKE ALL ON FUNCTION public.scheduled_tasks_due() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scheduled_tasks_due() FROM anon;
REVOKE ALL ON FUNCTION public.scheduled_tasks_due() FROM authenticated;

-- ============================================================
-- 4. Runner
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