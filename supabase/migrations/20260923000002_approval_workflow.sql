/*
# Generic Approval Workflow Engine

Executes the existing `workflow_definitions` / `workflow_steps` / `workflow_instances`
/ `workflow_actions` tables (which were previously only data, never executed).

1. **`maybe_start_workflow(module, record_id, initiator)`** — if the module has a
   workflow enabled in `module_workflow_config`, creates a `workflow_instances` row
   pointing at the first step (`sort_order`).
2. **Triggers** — a leave trigger starts a workflow on `leave_requests` insert; a
   completion trigger copies APPROVED/REJECTED back onto the source record.
3. **`approve_workflow_step` / `reject_workflow_step`** — advance/reject the current
   step (guarded: only the step's approver or an admin may act).
4. **`pending_approvals()`** — inbox feed for the current user (their pending
   steps, or all pending for admins).

Out of the box a default Leave Approval chain (HR_ADMIN) is seeded and enabled so
the engine is functional immediately; admins can manage chains in Settings → Workflows.
*/

-- ============================================================
-- 1. Start workflow on demand
-- ============================================================
CREATE OR REPLACE FUNCTION public.maybe_start_workflow(
  p_module_key text,
  p_record_id uuid,
  p_initiator_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg module_workflow_config;
  v_def workflow_definitions;
  v_first_step_id uuid;
  v_instance_id uuid;
BEGIN
  SELECT * INTO v_cfg
    FROM module_workflow_config
   WHERE module_key = p_module_key;

  IF v_cfg.id IS NULL OR NOT v_cfg.is_enabled OR v_cfg.workflow_definition_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_def
    FROM workflow_definitions
   WHERE id = v_cfg.workflow_definition_id AND is_active;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_first_step_id
    FROM workflow_steps
   WHERE workflow_definition_id = v_def.id
   ORDER BY sort_order ASC, created_at ASC
   LIMIT 1;
  IF v_first_step_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO workflow_instances (
    workflow_definition_id, module_key, record_id, status, current_step_id, initiated_by
  ) VALUES (
    v_def.id, p_module_key, p_record_id, 'PENDING', v_first_step_id, p_initiator_id
  )
  RETURNING id INTO v_instance_id;

  RETURN v_instance_id;
END;
$$;

-- Leave: start workflow when a request is created
CREATE OR REPLACE FUNCTION public.tri_start_workflow_on_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.maybe_start_workflow('leave', NEW.id, COALESCE(NEW.employee_id, public.current_employee_id()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_start_workflow_leave ON leave_requests;
CREATE TRIGGER trg_start_workflow_leave
AFTER INSERT ON leave_requests
FOR EACH ROW EXECUTE FUNCTION public.tri_start_workflow_on_leave();

-- ============================================================
-- 2. Approve / Reject the current step
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_workflow_step(
  p_instance_id uuid,
  p_comment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance workflow_instances%ROWTYPE;
  v_caller_id uuid := public.current_employee_id();
  v_caller_role text;
  v_step workflow_steps%ROWTYPE;
  v_next_step_id uuid;
BEGIN
  SELECT * INTO v_instance FROM workflow_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow instance not found'; END IF;
  IF v_instance.status <> 'PENDING' THEN RAISE EXCEPTION 'This workflow has already been completed'; END IF;
  IF v_instance.current_step_id IS NULL THEN RAISE EXCEPTION 'Workflow has no pending step'; END IF;

  SELECT * INTO v_step FROM workflow_steps WHERE id = v_instance.current_step_id;
  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;

  IF NOT (
       public.has_privilege('admin.settings')
    OR (v_step.approver_user_id IS NOT NULL AND v_step.approver_user_id = v_caller_id)
    OR (v_step.approver_role IS NOT NULL AND v_step.approver_role = v_caller_role)
  ) THEN
    RAISE EXCEPTION 'You are not an approver for this step';
  END IF;

  INSERT INTO workflow_actions (workflow_instance_id, step_id, action, actor_id, comment)
  VALUES (v_instance.id, v_step.id, 'APPROVE', v_caller_id, p_comment);

  SELECT ws.id INTO v_next_step_id
    FROM workflow_steps ws
   WHERE ws.workflow_definition_id = v_instance.workflow_definition_id
     AND ws.sort_order > v_step.sort_order
   ORDER BY ws.sort_order ASC, ws.created_at ASC
   LIMIT 1;

  IF v_next_step_id IS NULL THEN
    UPDATE workflow_instances
       SET status = 'APPROVED', current_step_id = NULL, completed_at = now(), updated_at = now()
     WHERE id = v_instance.id;
  ELSE
    UPDATE workflow_instances
       SET current_step_id = v_next_step_id, updated_at = now()
     WHERE id = v_instance.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_workflow_step(
  p_instance_id uuid,
  p_comment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance workflow_instances%ROWTYPE;
  v_caller_id uuid := public.current_employee_id();
  v_caller_role text;
  v_step workflow_steps%ROWTYPE;
BEGIN
  SELECT * INTO v_instance FROM workflow_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow instance not found'; END IF;
  IF v_instance.status <> 'PENDING' THEN RAISE EXCEPTION 'This workflow has already been completed'; END IF;
  IF v_instance.current_step_id IS NULL THEN RAISE EXCEPTION 'Workflow has no pending step'; END IF;

  SELECT * INTO v_step FROM workflow_steps WHERE id = v_instance.current_step_id;
  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;

  IF NOT (
       public.has_privilege('admin.settings')
    OR (v_step.approver_user_id IS NOT NULL AND v_step.approver_user_id = v_caller_id)
    OR (v_step.approver_role IS NOT NULL AND v_step.approver_role = v_caller_role)
  ) THEN
    RAISE EXCEPTION 'You are not an approver for this step';
  END IF;

  INSERT INTO workflow_actions (workflow_instance_id, step_id, action, actor_id, comment)
  VALUES (v_instance.id, v_step.id, 'REJECT', v_caller_id, p_comment);

  UPDATE workflow_instances
     SET status = 'REJECTED', current_step_id = NULL, completed_at = now(), updated_at = now()
   WHERE id = v_instance.id;
END;
$$;

-- ============================================================
-- 3. Propagate the final verdict to the source record
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_workflow_result_to_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('APPROVED', 'REJECTED') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NEW.module_key = 'leave' THEN
      UPDATE leave_requests
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_workflow_result ON workflow_instances;
CREATE TRIGGER trg_apply_workflow_result
AFTER UPDATE ON workflow_instances
FOR EACH ROW EXECUTE FUNCTION public.apply_workflow_result_to_record();

-- ============================================================
-- 4. Approvals inbox for the current user
-- ============================================================
CREATE OR REPLACE FUNCTION public.pending_approvals()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := public.current_employee_id();
  v_caller_role text;
  v_rows jsonb := '[]'::jsonb;
  v_instance RECORD;
  v_requester_name text;
  v_step_title text;
  v_step_ord integer;
  v_def_name text;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;
  v_caller_role := COALESCE(v_caller_role, '');

  FOR v_instance IN
    SELECT wi.id, wi.module_key, wi.record_id, wi.status, wi.initiated_by, wi.initiated_at,
           wi.workflow_definition_id, wi.current_step_id
      FROM workflow_instances wi
     WHERE wi.status = 'PENDING'
       AND (
            public.has_privilege('admin.settings')
         OR EXISTS (
               SELECT 1 FROM workflow_steps ws
                WHERE ws.id = wi.current_step_id
                  AND (ws.approver_user_id = v_caller_id
                       OR ws.approver_role = v_caller_role)
             )
           )
     ORDER BY wi.initiated_at ASC
  LOOP
    SELECT COALESCE(e.first_name || ' ' || e.last_name, '') INTO v_requester_name
      FROM employees e WHERE e.id = v_instance.initiated_by;

    SELECT ws.title, ws.sort_order INTO v_step_title, v_step_ord
      FROM workflow_steps ws WHERE ws.id = v_instance.current_step_id;
    v_step_title := COALESCE(v_step_title, '');

    SELECT name INTO v_def_name FROM workflow_definitions WHERE id = v_instance.workflow_definition_id;
    v_def_name := COALESCE(v_def_name, v_instance.module_key);

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'instance_id',       v_instance.id,
      'module_key',        v_instance.module_key,
      'record_id',         v_instance.record_id,
      'status',            v_instance.status,
      'initiated_by',      v_instance.initiated_by,
      'requester_name',    v_requester_name,
      'initiated_at',      to_char(v_instance.initiated_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'workflow_name',     v_def_name,
      'step_title',        v_step_title,
      'step_order',        v_step_ord
    ));
  END LOOP;

  RETURN v_rows;
END;
$$;

-- ============================================================
-- 5. Seed a default Leave Approval chain and enable it
-- ============================================================
INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
VALUES (
  'Leave Approval',
  'leave',
  'request.created',
  'Default leave request approval chain (HR Admin approves). Manage in Settings > Workflows.',
  true
)
ON CONFLICT DO NOTHING;

INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
SELECT wd.id, 1, 'HR_ADMIN'
  FROM workflow_definitions wd
 WHERE wd.module_key = 'leave'
   AND NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = wd.id);

INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
SELECT 'leave', true, wd.id
  FROM workflow_definitions wd
 WHERE wd.module_key = 'leave'
   AND NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'leave');

-- ============================================================
-- 6. Grants
-- ============================================================
GRANT EXECUTE ON FUNCTION public.maybe_start_workflow(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_workflow_step(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_workflow_step(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_approvals() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.maybe_start_workflow(text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_workflow_step(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_workflow_step(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pending_approvals() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tri_start_workflow_on_leave() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_workflow_result_to_record() FROM PUBLIC;