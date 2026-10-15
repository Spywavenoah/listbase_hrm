-- Employee query threads (chat), reply deadlines and notifications.
--
-- Employees can no longer raise queries themselves: HR creates a query against
-- an employee (optionally with a reply deadline) and the conversation happens
-- as a message thread. Notifications:
--   * employee is notified when HR opens a query
--   * employee is reminded as the reply deadline approaches
--   * HR (the query creator) is notified when the employee replies

-- ============================================================
-- 1. Query deadline / threading columns
-- ============================================================
ALTER TABLE employee_queries
  ADD COLUMN IF NOT EXISTS reply_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_by text;

-- ============================================================
-- 2. Message thread
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_query_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id uuid NOT NULL REFERENCES employee_queries(id) ON DELETE CASCADE,
  author_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  author_type text NOT NULL DEFAULT 'HR' CHECK (author_type IN ('EMPLOYEE', 'HR')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_messages_query
  ON employee_query_messages (query_id, created_at);

ALTER TABLE employee_query_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_query_messages" ON employee_query_messages;
DROP POLICY IF EXISTS "insert_query_messages" ON employee_query_messages;
DROP POLICY IF EXISTS "update_query_messages" ON employee_query_messages;
DROP POLICY IF EXISTS "delete_query_messages" ON employee_query_messages;

CREATE POLICY "select_query_messages" ON employee_query_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employee_queries q
     WHERE q.id = query_id
       AND (q.employee_id = public.current_employee_id()
            OR public.has_any_privilege(ARRAY['employees.view_all', 'employees.manage', 'admin.settings']))
  ));

-- The owning employee may reply; HR (manage/admin) may post too.
CREATE POLICY "insert_query_messages" ON employee_query_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM employee_queries q
     WHERE q.id = query_id
       AND (q.employee_id = public.current_employee_id()
            OR public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']))
  ));

CREATE POLICY "update_query_messages" ON employee_query_messages FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']));

CREATE POLICY "delete_query_messages" ON employee_query_messages FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'employee_query_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE employee_query_messages;
  END IF;
END;
$$;

-- ============================================================
-- 3. Author stamping (BEFORE INSERT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_query_message_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query_employee uuid;
BEGIN
  NEW.author_id := COALESCE(NEW.author_id, public.current_employee_id());
  SELECT employee_id INTO v_query_employee FROM employee_queries WHERE id = NEW.query_id;
  NEW.author_type := CASE
    WHEN NEW.author_id IS NOT NULL AND NEW.author_id = v_query_employee THEN 'EMPLOYEE'
    ELSE 'HR'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_query_message_author ON employee_query_messages;
CREATE TRIGGER trg_query_message_author
BEFORE INSERT ON employee_query_messages
FOR EACH ROW EXECUTE FUNCTION public.set_query_message_author();

-- ============================================================
-- 4. Message posted -> update thread state + notify the other side
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_query_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query employee_queries%ROWTYPE;
  v_recipient uuid;
  v_recipient_email text;
  v_recipient_name text;
  v_preview text;
  v_link text;
  v_employee_name text;
  v_new_status text;
BEGIN
  SELECT * INTO v_query FROM employee_queries WHERE id = NEW.query_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_new_status := CASE WHEN NEW.author_type = 'EMPLOYEE' THEN 'RESPONDED' ELSE 'OPEN' END;

  UPDATE employee_queries
     SET last_message_at = NEW.created_at,
         last_message_by = NEW.author_type,
         deadline_notified_at = NULL,
         status = CASE WHEN status = 'CLOSED' THEN status ELSE v_new_status END,
         updated_at = now()
   WHERE id = NEW.query_id;

  v_preview := left(regexp_replace(COALESCE(NEW.body, ''), '\s+', ' ', 'g'), 140);
  SELECT trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_employee_name
    FROM employees WHERE id = v_query.employee_id;

  IF NEW.author_type = 'EMPLOYEE' THEN
    v_recipient := v_query.raised_by;
    IF v_recipient IS NULL THEN
      RETURN NEW;
    END IF;
    PERFORM public.create_notification(
      v_recipient,
      'Query reply received',
      COALESCE(v_employee_name, 'An employee') || ' replied to "' || v_query.subject || '".',
      'INFO',
      '/queries',
      jsonb_build_object('query_id', v_query.id::text, 'employee_id', v_query.employee_id::text)
    );

    SELECT email, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
      INTO v_recipient_email, v_recipient_name
      FROM employees WHERE id = v_recipient;
  ELSE
    v_recipient := v_query.employee_id;
    PERFORM public.create_notification(
      v_recipient,
      'New message about your query',
      'HR replied to "' || v_query.subject || '".',
      'INFO',
      '/employees/' || v_query.employee_id::text || '/queries',
      jsonb_build_object('query_id', v_query.id::text)
    );

    SELECT email, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
      INTO v_recipient_email, v_recipient_name
      FROM employees WHERE id = v_recipient;
  END IF;

  IF v_recipient_email IS NOT NULL AND btrim(v_recipient_email) <> '' THEN
    INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
    VALUES (
      CASE WHEN NEW.author_type = 'EMPLOYEE' THEN 'query.reply.employee' ELSE 'query.reply.hr' END,
      v_recipient_email,
      NULLIF(btrim(v_recipient_name), ''),
      CASE WHEN NEW.author_type = 'EMPLOYEE'
        THEN 'New reply on "' || v_query.subject || '"'
        ELSE 'New message about your query: ' || v_query.subject END,
      '<p>Hi ' || COALESCE(NULLIF(btrim(v_recipient_name), ''), 'there') || ',</p>' ||
      '<p>' || COALESCE(v_employee_name, 'An employee') || ' replied:</p>' ||
      '<blockquote>' || v_preview || '</blockquote>' ||
      '<p>Open HR Flow to continue the conversation.</p>',
      'PENDING',
      jsonb_build_object('query_id', v_query.id::text, 'employee_id', v_query.employee_id::text)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_query_message ON employee_query_messages;
CREATE TRIGGER trg_notify_query_message
AFTER INSERT ON employee_query_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_query_message();

-- ============================================================
-- 5. Query opened by HR -> notify the employee (in-app + email)
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_query_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name text;
  v_deadline_text text;
BEGIN
  IF NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_deadline_text := CASE
    WHEN NEW.reply_deadline IS NOT NULL
      THEN ' Please reply by ' || to_char(NEW.reply_deadline, 'Mon DD, YYYY HH24:MI') || '.'
    ELSE ''
  END;

  PERFORM public.create_notification(
    NEW.employee_id,
    'New query from HR',
    'A query was raised against your account: "' || NEW.subject || '".' || v_deadline_text,
    'INFO',
    '/employees/' || NEW.employee_id::text || '/queries',
    jsonb_build_object('query_id', NEW.id::text, 'reply_deadline', NEW.reply_deadline)
  );

  SELECT email, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_email, v_name
    FROM employees WHERE id = NEW.employee_id;

  IF v_email IS NOT NULL AND btrim(v_email) <> '' THEN
    INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
    VALUES (
      'query.created',
      v_email,
      NULLIF(btrim(v_name), ''),
      'New query: ' || NEW.subject,
      '<p>Hi ' || COALESCE(NULLIF(btrim(v_name), ''), 'there') || ',</p>' ||
      '<p>HR has raised a query against your account:</p>' ||
      '<p><strong>' || NEW.subject || '</strong></p>' ||
      COALESCE('<p>' || NEW.details || '</p>', '') ||
      CASE WHEN v_deadline_text <> '' THEN '<p>' || v_deadline_text || '</p>' ELSE '' END ||
      '<p>Please open HR Flow to view and reply.</p>',
      'PENDING',
      jsonb_build_object('query_id', NEW.id::text, 'reply_deadline', NEW.reply_deadline)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_query_created ON employee_queries;
CREATE TRIGGER trg_notify_query_created
AFTER INSERT ON employee_queries
FOR EACH ROW EXECUTE FUNCTION public.notify_query_created();

-- ============================================================
-- 6. Deadline reminders (scan; run by pg_cron / on demand)
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_query_deadlines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_count integer := 0;
BEGIN
  FOR v_rec IN
    SELECT q.id, q.employee_id, q.subject, q.reply_deadline, e.email,
           trim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS emp_name
      FROM employee_queries q
      JOIN employees e ON e.id = q.employee_id
     WHERE q.status <> 'CLOSED'
       AND q.reply_deadline IS NOT NULL
       AND q.deadline_notified_at IS NULL
       AND q.reply_deadline > now()
       AND q.reply_deadline <= now() + interval '1 day'
       AND (q.last_message_by IS DISTINCT FROM 'EMPLOYEE')
  LOOP
    v_count := v_count + 1;

    PERFORM public.create_notification(
      v_rec.employee_id,
      'Query reply deadline approaching',
      'Your reply to "' || v_rec.subject || '" is due ' || to_char(v_rec.reply_deadline, 'Mon DD, YYYY HH24:MI') || '.',
      'WARNING',
      '/employees/' || v_rec.employee_id::text || '/queries',
      jsonb_build_object('query_id', v_rec.id::text, 'reply_deadline', v_rec.reply_deadline)
    );

    IF v_rec.email IS NOT NULL AND btrim(v_rec.email) <> '' THEN
      INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
      VALUES (
        'query.deadline',
        v_rec.email,
        NULLIF(btrim(v_rec.emp_name), ''),
        'Reply deadline approaching: ' || v_rec.subject,
        '<p>Hi ' || COALESCE(NULLIF(btrim(v_rec.emp_name), ''), 'there') || ',</p>' ||
        '<p>Your reply to the query <strong>' || v_rec.subject || '</strong> is due on <strong>' ||
        to_char(v_rec.reply_deadline, 'Mon DD, YYYY HH24:MI') || '</strong>.</p>' ||
        '<p>Please open HR Flow to respond.</p>',
        'PENDING',
        jsonb_build_object('query_id', v_rec.id::text, 'reply_deadline', v_rec.reply_deadline)
      );
    END IF;

    UPDATE employee_queries SET deadline_notified_at = now() WHERE id = v_rec.id;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_query_deadlines() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_query_deadlines() TO authenticated;

-- Schedule the deadline sweep (best effort; never fails the migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      DELETE FROM cron.job WHERE jobname = 'notify-query-deadlines';
      PERFORM cron.schedule(
        'notify-query-deadlines',
        '*/15 * * * *',
        $cron$ SELECT public.notify_query_deadlines(); $cron$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'notify-query-deadlines job not scheduled: %', SQLERRM;
    END;
  END IF;
END $$;
