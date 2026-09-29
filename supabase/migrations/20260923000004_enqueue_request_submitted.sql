/*
# Enqueue "request submitted" Notification on Workflow Start

When a workflow-backed record is created (`workflow_instances` insert), the
system now enqueues an email to the current step's approver automatically at
the database level, instead of relying on the frontend to call
`enqueueAndProcess`.

1. `enqueue_request_submitted_email()`
- Trigger function (AFTER INSERT on `workflow_instances`).
- Resolves the current step's approver from `workflow_steps.approver_user_id`.
- Skips enqueuing when the approver is role-only (no user), has no email, or
  the instance already has an enqueued notification for it (idempotency).
- Renders the `request.submitted` mail template when present (via the existing
  `send-mail` processor), otherwise falls back to inline subject/body.

2. Security
- SECURITY DEFINER so the row-inserting client does not need broad privileges,
  with `search_path` pinned.
- Revokes PUBLIC execute; grants to authenticated only.
*/

CREATE OR REPLACE FUNCTION public.enqueue_request_submitted_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_approver uuid;
  v_approver_email text;
  v_approver_name text;
  v_requester_name text;
  v_module_label text;
  v_subject text;
  v_body_html text;
  v_already_sent boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'PENDING' THEN
    RETURN NEW;
  END IF;

  -- Only bother when a concrete approver (user assignment) exists
  SELECT approver_user_id INTO v_step_approver
    FROM workflow_steps
   WHERE id = NEW.current_step_id;

  IF v_step_approver IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if we already enqueued for this instance
  SELECT EXISTS (
    SELECT 1 FROM notification_queue
     WHERE metadata @> jsonb_build_object('workflow_instance_id', NEW.id::text)
  ) INTO v_already_sent;

  IF v_already_sent THEN
    RETURN NEW;
  END IF;

  -- Approver email + display name
  SELECT email, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_approver_email, v_approver_name
    FROM employees
   WHERE id = v_step_approver;

  -- Skip recipients for whom we have no email address
  IF v_approver_email IS NULL OR btrim(v_approver_email) = '' THEN
    RETURN NEW;
  END IF;

  SELECT trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_requester_name
    FROM employees
   WHERE id = NEW.initiated_by;

  v_module_label := CASE NEW.module_key
    WHEN 'leave' THEN 'Leave Request'
    WHEN 'expense' THEN 'Expense Request'
    WHEN 'travel' THEN 'Travel Request'
    WHEN 'offboarding' THEN 'Offboarding'
    WHEN 'employee' THEN 'Record Change'
    ELSE initcap(replace(NEW.module_key, '_', ' '))
  END;

  v_subject := v_module_label || ' awaiting your approval';
  v_body_html :=
    '<p>Hi ' || COALESCE(v_approver_name, 'there') || ',</p>' ||
    '<p><strong>' || COALESCE(v_requester_name, 'An employee') || '</strong> submitted a <strong>' || v_module_label || '</strong> that requires your approval.</p>' ||
    '<p>Please review it in the HR Flow approvals inbox.</p>';

  INSERT INTO notification_queue (
    event_key, recipient_email, recipient_name, subject, body_html, status, metadata
  ) VALUES (
    'request.submitted',
    v_approver_email,
    NULLIF(btrim(v_approver_name), ''),
    v_subject,
    v_body_html,
    'PENDING',
    jsonb_build_object(
      'workflow_instance_id', NEW.id::text,
      'module_key', NEW.module_key,
      'record_id', NEW.record_id::text,
      'requester_name', v_requester_name,
      'module_label', v_module_label
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_request_submitted_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_request_submitted_email() TO authenticated;

DROP TRIGGER IF EXISTS trg_enqueue_request_submitted ON workflow_instances;
CREATE TRIGGER trg_enqueue_request_submitted
AFTER INSERT ON workflow_instances
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_request_submitted_email();

-- Seed a default template; admins can edit it in Settings > Mail Templates.
-- The `send-mail` processor interpolates `{{variable}}` tokens from metadata.
INSERT INTO mail_templates (event_key, subject, body_html, variables, is_active)
VALUES (
  'request.submitted',
  '{{module_label}} awaiting your approval',
  '<p>Hi,</p><p><strong>{{requester_name}}</strong> submitted a <strong>{{module_label}}</strong> that requires your approval.</p><p>Please review it in the HR Flow approvals inbox.</p>',
  '["requester_name", "module_label"]'::jsonb,
  true
)
ON CONFLICT (event_key) DO NOTHING;