-- In-app (live) notifications + email hooks.
--
-- Adds a `notifications` table for per-employee in-app notifications, published
-- over Supabase Realtime. Triggers populate it (and enqueue email where useful)
-- for:
--   * workflow status changes  -> notify the requester
--   * a workflow step becoming actionable -> notify the pending approver
--   * a task being assigned    -> notify the assignee

-- ============================================================
-- 1. Table
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text,
  type text NOT NULL DEFAULT 'INFO',      -- INFO | SUCCESS | WARNING | ERROR
  link text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_employee
  ON notifications (employee_id, is_read, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_notifications" ON notifications;
DROP POLICY IF EXISTS "update_notifications" ON notifications;
DROP POLICY IF EXISTS "delete_notifications" ON notifications;

CREATE POLICY "select_notifications" ON notifications FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id());

CREATE POLICY "update_notifications" ON notifications FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id())
  WITH CHECK (employee_id = public.current_employee_id());

CREATE POLICY "delete_notifications" ON notifications FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('admin.settings'));

-- Publish for live updates (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END;
$$;

-- ============================================================
-- 2. Helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_notification(
  p_employee_id uuid,
  p_title text,
  p_message text DEFAULT NULL,
  p_type text DEFAULT 'INFO',
  p_link text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_employee_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO notifications (employee_id, title, message, type, link, metadata)
  VALUES (p_employee_id, p_title, p_message, COALESCE(p_type, 'INFO'), p_link, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE notifications SET is_read = true
   WHERE id = p_id AND employee_id = public.current_employee_id();
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE notifications SET is_read = true
   WHERE employee_id = public.current_employee_id() AND is_read = false;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC;

-- ============================================================
-- 3. Workflow status change -> notify requester (in-app + email)
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_workflow_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module_label text;
  v_requester uuid;
  v_email text;
  v_name text;
  v_status_label text;
  v_title text;
  v_message text;
  v_link text;
BEGIN
  IF NEW.status NOT IN ('APPROVED', 'REJECTED')
     OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_requester := NEW.initiated_by;
  IF v_requester IS NULL THEN
    RETURN NEW;
  END IF;

  v_module_label := CASE NEW.module_key
    WHEN 'leave' THEN 'Leave Request'
    WHEN 'leave.encashment' THEN 'Leave Encashment'
    WHEN 'expense' THEN 'Expense Request'
    WHEN 'travel' THEN 'Travel Request'
    WHEN 'offboarding' THEN 'Offboarding'
    WHEN 'employee' THEN 'Record Change'
    WHEN 'employee.change_request' THEN 'Profile Change Request'
    WHEN 'procurement.requisition' THEN 'Requisition'
    WHEN 'procurement.purchase_order' THEN 'Purchase Order'
    WHEN 'procurement.invoice' THEN 'Invoice'
    WHEN 'procurement.payment' THEN 'Payment Request'
    WHEN 'recruitment.requisition' THEN 'Recruitment Requisition'
    ELSE initcap(replace(NEW.module_key, '_', ' '))
  END;

  v_status_label := CASE NEW.status WHEN 'APPROVED' THEN 'approved' ELSE 'rejected' END;
  v_title := v_module_label || ' ' || v_status_label;
  v_message := 'Your ' || lower(v_module_label) || ' has been ' || v_status_label || '.';

  v_link := CASE
    WHEN NEW.module_key = 'leave' THEN '/leave'
    WHEN NEW.module_key = 'leave.encashment' THEN '/leave/encashments'
    WHEN NEW.module_key = 'expense' THEN '/expenses'
    WHEN NEW.module_key IN ('employee', 'employee.change_request')
      THEN '/employees/' || COALESCE(NEW.initiated_by::text, '') || '/personal'
    WHEN NEW.module_key = 'procurement.requisition' THEN '/procurement/requisitions'
    WHEN NEW.module_key = 'procurement.purchase_order' THEN '/procurement/purchase-orders'
    ELSE '/dashboard'
  END;

  PERFORM public.create_notification(
    v_requester,
    v_title,
    v_message,
    CASE NEW.status WHEN 'APPROVED' THEN 'SUCCESS' ELSE 'WARNING' END,
    v_link,
    jsonb_build_object('workflow_instance_id', NEW.id::text, 'module_key', NEW.module_key,
                       'record_id', NEW.record_id::text, 'status', NEW.status)
  );

  SELECT email, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_email, v_name
    FROM employees WHERE id = v_requester;

  IF v_email IS NOT NULL AND btrim(v_email) <> '' THEN
    INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
    VALUES (
      'request.' || v_status_label,
      v_email,
      NULLIF(btrim(v_name), ''),
      v_title,
      '<p>Hi ' || COALESCE(v_name, 'there') || ',</p>' ||
      '<p>Your <strong>' || v_module_label || '</strong> has been <strong>' || v_status_label || '</strong>.</p>' ||
      '<p>Open HR Flow to view the details.</p>',
      'PENDING',
      jsonb_build_object('workflow_instance_id', NEW.id::text, 'module_key', NEW.module_key,
                         'record_id', NEW.record_id::text, 'status', NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_workflow_result ON workflow_instances;
CREATE TRIGGER trg_notify_workflow_result
AFTER UPDATE ON workflow_instances
FOR EACH ROW EXECUTE FUNCTION public.notify_workflow_result();

-- ============================================================
-- 4. Task assignment -> notify assignee (in-app + email)
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_task_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name text;
  v_assigner text;
BEGIN
  IF NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_assigner
    FROM employees WHERE id = NEW.assigned_by;

  PERFORM public.create_notification(
    NEW.employee_id,
    'New task assigned',
    COALESCE(v_assigner || ' assigned you a task: ', 'A task was assigned to you: ') || NEW.title,
    'INFO',
    '/employees/' || NEW.employee_id::text || '/tasks',
    jsonb_build_object('task_id', NEW.id::text, 'priority', NEW.priority)
  );

  SELECT email, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_email, v_name
    FROM employees WHERE id = NEW.employee_id;

  IF v_email IS NOT NULL AND btrim(v_email) <> '' THEN
    INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
    VALUES (
      'task.assigned',
      v_email,
      NULLIF(btrim(v_name), ''),
      'New task assigned: ' || NEW.title,
      '<p>Hi ' || COALESCE(v_name, 'there') || ',</p>' ||
      '<p>' || COALESCE(v_assigner || ' has', 'You have been') || ' assigned you a task:</p>' ||
      '<p><strong>' || NEW.title || '</strong></p>' ||
      COALESCE('<p>' || NEW.description || '</p>', '') ||
      '<p>Priority: ' || NEW.priority || CASE WHEN NEW.due_date IS NOT NULL THEN ' • Due: ' || NEW.due_date::text ELSE '' END || '</p>',
      'PENDING',
      jsonb_build_object('task_id', NEW.id::text, 'priority', NEW.priority)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_assigned ON employee_tasks;
CREATE TRIGGER trg_notify_task_assigned
AFTER INSERT ON employee_tasks
FOR EACH ROW EXECUTE FUNCTION public.notify_task_assigned();

-- ============================================================
-- 5. Workflow step actionable -> in-app notification for approver
--    (enqueue_workflow_step_email already sends the email; add in-app too)
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_workflow_step_email(p_instance_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance workflow_instances%ROWTYPE;
  v_step workflow_steps%ROWTYPE;
  v_has_next boolean;
  v_actor uuid;
  v_email text;
  v_name text;
  v_requester_name text;
  v_module_label text;
  v_already_mailed boolean;
BEGIN
  SELECT * INTO v_instance FROM workflow_instances WHERE id = p_instance_id;
  IF NOT FOUND OR v_instance.status <> 'PENDING' THEN
    RETURN;
  END IF;

  SELECT * INTO v_step FROM workflow_steps WHERE id = v_instance.current_step_id;
  IF v_step.id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM workflow_steps ws2
     WHERE ws2.workflow_definition_id = v_instance.workflow_definition_id
       AND ws2.sort_order > v_step.sort_order
  ) INTO v_has_next;

  v_actor := CASE
    WHEN v_has_next THEN v_instance.authorizer_user_id
    ELSE COALESCE(v_instance.approver_user_id, v_instance.authorizer_user_id)
  END;
  IF v_actor IS NULL THEN
    v_actor := v_step.approver_user_id;
  END IF;
  IF v_actor IS NULL THEN
    RETURN;
  END IF;

  v_module_label := CASE v_instance.module_key
    WHEN 'leave' THEN 'Leave Request'
    WHEN 'leave.encashment' THEN 'Leave Encashment'
    WHEN 'expense' THEN 'Expense Request'
    WHEN 'travel' THEN 'Travel Request'
    WHEN 'offboarding' THEN 'Offboarding'
    WHEN 'employee' THEN 'Record Change'
    WHEN 'procurement.requisition' THEN 'Requisition'
    WHEN 'procurement.purchase_order' THEN 'Purchase Order'
    WHEN 'procurement.invoice' THEN 'Invoice'
    WHEN 'procurement.payment' THEN 'Payment Request'
    WHEN 'recruitment.requisition' THEN 'Recruitment Requisition'
    ELSE initcap(replace(v_instance.module_key, '_', ' '))
  END;

  SELECT trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_requester_name
    FROM employees WHERE id = v_instance.initiated_by;

  -- In-app notification for the pending approver (once per instance).
  IF NOT EXISTS (
    SELECT 1 FROM notifications
     WHERE employee_id = v_actor
       AND metadata @> jsonb_build_object('workflow_instance_id', p_instance_id::text)
  ) THEN
    PERFORM public.create_notification(
      v_actor,
      v_module_label || ' awaiting your approval',
      COALESCE(v_requester_name, 'An employee') || ' submitted a ' || v_module_label || ' for your review.',
      'INFO',
      '/approvals',
      jsonb_build_object('workflow_instance_id', p_instance_id::text,
                         'module_key', v_instance.module_key, 'record_id', v_instance.record_id::text)
    );
  END IF;

  -- Email (once per instance).
  SELECT EXISTS (
    SELECT 1 FROM notification_queue
     WHERE metadata @> jsonb_build_object('workflow_instance_id', p_instance_id::text)
       AND event_key = 'request.submitted'
  ) INTO v_already_mailed;
  IF v_already_mailed THEN
    RETURN;
  END IF;

  SELECT email, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_email, v_name
    FROM employees WHERE id = v_actor;

  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RETURN;
  END IF;

  INSERT INTO notification_queue (
    event_key, recipient_email, recipient_name, subject, body_html, status, metadata
  ) VALUES (
    'request.submitted',
    v_email,
    NULLIF(btrim(v_name), ''),
    v_module_label || ' awaiting your approval',
    '<p>Hi ' || COALESCE(v_name, 'there') || ',</p>' ||
    '<p><strong>' || COALESCE(v_requester_name, 'An employee') || '</strong> submitted a <strong>' ||
    v_module_label || '</strong> that requires your approval.</p>' ||
    '<p>Please review it in the HR Flow approvals inbox.</p>',
    'PENDING',
    jsonb_build_object(
      'workflow_instance_id', p_instance_id::text,
      'module_key', v_instance.module_key,
      'record_id', v_instance.record_id::text,
      'requester_name', v_requester_name,
      'module_label', v_module_label
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_workflow_step_email(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_workflow_step_email(uuid) FROM PUBLIC;
