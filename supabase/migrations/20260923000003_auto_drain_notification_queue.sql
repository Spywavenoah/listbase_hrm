/*
# Automate Notification Queue Draining

Makes outgoing email delivery self-processing instead of only on-demand:

1. Schema
- Adds `max_attempts` (int, default 3) and `next_retry_at` (timestamptz)
  to `notification_queue` so retries apply exponential backoff.
- Index on (status, next_retry_at) to keep the drain query fast.

2. Configuration (system_settings, group `notifications`)
- `edge_function_url`       — full URL of the send-mail edge function
- `edge_function_secret`    — optional shared secret checked by that function
- `drain_enabled`           — whether the scheduled drain job is active (true)
- `drain_cron_schedule`     — pg_cron schedule expression (default every minute)
- `drain_max_attempts`      — delivery attempt cap (default 3)

3. Scheduling
- Enables `pg_cron` and `pg_net`.
- Registers job `drain-email-queue` that POSTs a `{ drain: true }` payload to
  the configured edge function whenever the queue holds due work. The POST is
  skipped when draining is disabled, the URL is empty, or nothing is pending.

4. Security
- Workflow-config reading happens in SECURITY DEFINER helpers (`search_path`
  pinned) so the cron role does not require table privileges.
- Callers authenticate to the edge function with the configured secret.
*/

-- 1. Queue schema
ALTER TABLE notification_queue
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_notification_queue_drain
  ON notification_queue(status, next_retry_at);

-- 2. Configuration seed
INSERT INTO system_settings (group_name, key, value) VALUES
  ('notifications', 'edge_function_url', '""'),
  ('notifications', 'edge_function_secret', '""'),
  ('notifications', 'drain_enabled', 'true'),
  ('notifications', 'drain_cron_schedule', '"*/1 * * * *"'),
  ('notifications', 'drain_max_attempts', '3')
ON CONFLICT (group_name, key) DO NOTHING;

-- 3. Read helpers (SECURITY DEFINER so the cron role can read settings)
CREATE OR REPLACE FUNCTION public.get_notification_setting(p_key text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(value #>> '{}', '')
  FROM system_settings
  WHERE group_name = 'notifications' AND key = p_key
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_notification_setting(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_setting(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_due_notifications()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM notification_queue
    WHERE status = 'PENDING'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
  );
$$;

REVOKE ALL ON FUNCTION public.has_due_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_due_notifications() TO authenticated;

-- 4. Extensions (best effort; must never fail the migration)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron extension not created: %', SQLERRM;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_net;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_net extension not created: %', SQLERRM;
    END;
  END IF;
END $$;

-- 5. Scheduled job (idempotent: unschedule pre-existing job first)
DO $$
DECLARE
  v_has_cron boolean;
  v_schedule text;
BEGIN
  v_has_cron := EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  );

  IF v_has_cron THEN
    BEGIN
      -- Drop the old job if it exists, then recreate with current schedule
      DELETE FROM cron.job WHERE jobname = 'drain-email-queue';

      SELECT COALESCE(NULLIF(public.get_notification_setting('drain_cron_schedule'), ''), '*/1 * * * *')
      INTO v_schedule;

      PERFORM cron.schedule(
        'drain-email-queue',
        v_schedule,
        $cron$
          SELECT CASE
            WHEN public.get_notification_setting('edge_function_url') = '' THEN NULL
            ELSE net.http_post(
              url := public.get_notification_setting('edge_function_url'),
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-webhook-secret', public.get_notification_setting('edge_function_secret')
              ),
              body := jsonb_build_object('drain', true, 'trigger', 'cron')::text
            )
          END
          WHERE public.get_notification_setting('drain_enabled') = 'true'
            AND public.has_due_notifications();
        $cron$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'drain-email-queue job not scheduled: %', SQLERRM;
    END;
  END IF;
END $$;