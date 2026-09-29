/*
# Create Notification Queue Table

This migration creates a `notification_queue` table that stores outgoing emails
to be processed by the `send-mail` edge function. The frontend enqueues notifications
by inserting rows; the edge function picks up PENDING rows, sends them via SMTP,
and marks them SENT or FAILED.

1. New Tables
- `notification_queue`
  - id (uuid, primary key)
  - event_key (text) — maps to mail_templates.event_key
  - recipient_email (text, not null)
  - recipient_name (text)
  - subject (text)
  - body_html (text)
  - status (text, default 'PENDING') — PENDING, SENT, FAILED
  - error_message (text)
  - attempts (integer, default 0)
  - sent_at (timestamptz)
  - metadata (jsonb) — template variables and context
  - created_at, updated_at

2. Security
- RLS enabled, TO anon, authenticated (single-tenant, no-auth app)
*/

CREATE TABLE IF NOT EXISTS notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text,
  recipient_email text NOT NULL,
  recipient_name text,
  subject text NOT NULL,
  body_html text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notification_queue_status ON notification_queue(status, created_at);

DROP POLICY IF EXISTS "select_notification_queue" ON notification_queue;
CREATE POLICY "select_notification_queue" ON notification_queue FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_notification_queue" ON notification_queue;
CREATE POLICY "insert_notification_queue" ON notification_queue FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_notification_queue" ON notification_queue;
CREATE POLICY "update_notification_queue" ON notification_queue FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_notification_queue" ON notification_queue;
CREATE POLICY "delete_notification_queue" ON notification_queue FOR DELETE TO anon, authenticated USING (true);