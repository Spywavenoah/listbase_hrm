-- Workflow authorizer/approver selection + reporting-manager-only appeals.
--
-- 1. A requester can choose the specific employee who AUTHORIZES (first step)
--    and the employee who APPROVES (final step). Choices are stored per
--    workflow instance and enforced by the step guards / inbox / email.
-- 2. Only the employee the requester reports to (employees.reporting_manager_id)
--    may appeal an approved workflow; admins may only appeal when the requester
--    has no reporting manager recorded.

-- ============================================================
-- 1. Store the chosen actors on the instance
-- ============================================================
ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS authorizer_user_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_user_id uuid REFERENCES employees(id) ON DELETE SET NULL;

-- Integrity: a selected actor must be an active employee with a role above
-- Employee, and must not be the requester. Enforced on every write path.
CREATE OR REPLACE FUNCTION public.validate_workflow_instance_actors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.authorizer_user_id IS DISTINCT FROM OLD.authorizer_user_id THEN
    IF NEW.authorizer_user_id IS NOT NULL THEN
      IF NEW.authorizer_user_id = NEW.initiated_by THEN
        RAISE EXCEPTION 'The requester cannot also be the authorizer';
      END IF;
      SELECT role INTO v_role FROM employees
       WHERE id = NEW.authorizer_user_id AND COALESCE(employment_status, '') <> 'TERMINATED';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected authorizer not found';
      END IF;
      IF v_role = 'EMPLOYEE' THEN
        RAISE EXCEPTION 'The authorizer must have a role above Employee';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.approver_user_id IS DISTINCT FROM OLD.approver_user_id THEN
    IF NEW.approver_user_id IS NOT NULL THEN
      IF NEW.approver_user_id = NEW.initiated_by THEN
        RAISE EXCEPTION 'The requester cannot also be the approver';
      END IF;
      SELECT role INTO v_role FROM employees
       WHERE id = NEW.approver_user_id AND COALESCE(employment_status, '') <> 'TERMINATED';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected approver not found';
      END IF;
      IF v_role = 'EMPLOYEE' THEN
        RAISE EXCEPTION 'The approver must have a role above Employee';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_workflow_instance_actors ON workflow_instances;
CREATE TRIGGER trg_validate_workflow_instance_actors
BEFORE INSERT OR UPDATE ON workflow_instances
FOR EACH ROW EXECUTE FUNCTION public.validate_workflow_instance_actors();

-- ============================================================
-- 2. Candidate list for the requester's pickers
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_workflow_actor_candidates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := public.current_employee_id();
  v_rows jsonb := '[]'::jsonb;
  v_emp RECORD;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_emp IN
    SELECT e.id, e.first_name, e.last_name, e.role, d.name AS department_name
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.role <> 'EMPLOYEE'
       AND COALESCE(e.employment_status, '') <> 'TERMINATED'
       AND e.id <> v_caller_id
     ORDER BY e.first_name, e.last_name
  LOOP
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id',              v_emp.id,
      'name',            trim(v_emp.first_name || ' ' || v_emp.last_name),
      'role',            v_emp.role,
      'department_name', v_emp.department_name
    ));
  END LOOP;

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_workflow_actor_candidates() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_workflow_actor_candidates() FROM PUBLIC;

-- ============================================================
-- 3. Email to the effective actor for an instance's current step
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

  -- Idempotency: one "submitted" mail per instance.
  IF EXISTS (
    SELECT 1 FROM notification_queue
     WHERE metadata @> jsonb_build_object('workflow_instance_id', p_instance_id::text)
  ) THEN
    RETURN;
  END IF;

  SELECT email, trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_email, v_name
    FROM employees WHERE id = v_actor;

  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RETURN;
  END IF;

  SELECT trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_requester_name
    FROM employees WHERE id = v_instance.initiated_by;

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

-- Keep the instance-insert trigger behaviour, routed through the helper.
CREATE OR REPLACE FUNCTION public.enqueue_request_submitted_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_workflow_step_email(NEW.id);
  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Requester selects the authorizer / approver
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_workflow_actors(
  p_module_key text,
  p_record_id uuid,
  p_authorizer_id uuid,
  p_approver_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := public.current_employee_id();
  v_instance workflow_instances%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;

  SELECT * INTO v_instance
    FROM workflow_instances
   WHERE module_key = p_module_key
     AND record_id = p_record_id
     AND status = 'PENDING'
   ORDER BY initiated_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending workflow found for this record';
  END IF;

  IF NOT (v_instance.initiated_by = v_caller_id OR public.has_privilege('admin.settings')) THEN
    RAISE EXCEPTION 'Only the requester can choose the authorizer and approver';
  END IF;

  IF p_authorizer_id IS NOT NULL AND p_approver_id IS NOT NULL
     AND p_authorizer_id = p_approver_id THEN
    RAISE EXCEPTION 'Choose a different employee for authorization and approval';
  END IF;

  UPDATE workflow_instances
     SET authorizer_user_id = p_authorizer_id,
         approver_user_id = p_approver_id,
         updated_at = now()
   WHERE id = v_instance.id;

  PERFORM public.enqueue_workflow_step_email(v_instance.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_workflow_actors(text, uuid, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_workflow_actors(text, uuid, uuid, uuid) FROM PUBLIC;

-- ============================================================
-- 5. Step guards honour the chosen actors
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
  v_expected uuid;
  v_has_next boolean;
BEGIN
  SELECT * INTO v_instance FROM workflow_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow instance not found'; END IF;
  IF v_instance.status <> 'PENDING' THEN RAISE EXCEPTION 'This workflow has already been completed'; END IF;
  IF v_instance.current_step_id IS NULL THEN RAISE EXCEPTION 'Workflow has no pending step'; END IF;

  IF v_caller_id IS NOT NULL AND v_instance.initiated_by = v_caller_id THEN
    RAISE EXCEPTION 'You cannot approve a request you initiated';
  END IF;

  SELECT * INTO v_step FROM workflow_steps WHERE id = v_instance.current_step_id;
  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;

  SELECT EXISTS (
    SELECT 1 FROM workflow_steps ws2
     WHERE ws2.workflow_definition_id = v_instance.workflow_definition_id
       AND ws2.sort_order > v_step.sort_order
  ) INTO v_has_next;

  v_expected := CASE
    WHEN v_has_next THEN v_instance.authorizer_user_id
    ELSE COALESCE(v_instance.approver_user_id, v_instance.authorizer_user_id)
  END;

  IF NOT (
       public.has_privilege('admin.settings')
    OR (v_expected IS NOT NULL AND v_expected = v_caller_id)
    OR (v_expected IS NULL AND (
          (v_step.approver_user_id IS NOT NULL AND v_step.approver_user_id = v_caller_id)
       OR (v_step.approver_role IS NOT NULL AND v_step.approver_role = v_caller_role)
       ))
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
    PERFORM public.enqueue_workflow_step_email(v_instance.id);
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
  v_expected uuid;
  v_has_next boolean;
BEGIN
  SELECT * INTO v_instance FROM workflow_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow instance not found'; END IF;
  IF v_instance.status <> 'PENDING' THEN RAISE EXCEPTION 'This workflow has already been completed'; END IF;
  IF v_instance.current_step_id IS NULL THEN RAISE EXCEPTION 'Workflow has no pending step'; END IF;

  IF v_caller_id IS NOT NULL AND v_instance.initiated_by = v_caller_id THEN
    RAISE EXCEPTION 'You cannot reject a request you initiated';
  END IF;

  SELECT * INTO v_step FROM workflow_steps WHERE id = v_instance.current_step_id;
  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;

  SELECT EXISTS (
    SELECT 1 FROM workflow_steps ws2
     WHERE ws2.workflow_definition_id = v_instance.workflow_definition_id
       AND ws2.sort_order > v_step.sort_order
  ) INTO v_has_next;

  v_expected := CASE
    WHEN v_has_next THEN v_instance.authorizer_user_id
    ELSE COALESCE(v_instance.approver_user_id, v_instance.authorizer_user_id)
  END;

  IF NOT (
       public.has_privilege('admin.settings')
    OR (v_expected IS NOT NULL AND v_expected = v_caller_id)
    OR (v_expected IS NULL AND (
          (v_step.approver_user_id IS NOT NULL AND v_step.approver_user_id = v_caller_id)
       OR (v_step.approver_role IS NOT NULL AND v_step.approver_role = v_caller_role)
       ))
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
-- 6. Approvals inbox honours the chosen actors
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
       AND wi.initiated_by IS DISTINCT FROM v_caller_id
       AND (
            public.has_privilege('admin.settings')
         OR EXISTS (
              SELECT 1 FROM workflow_steps ws
               WHERE ws.id = wi.current_step_id
                 AND (
                   (
                     (wi.authorizer_user_id IS NOT NULL OR wi.approver_user_id IS NOT NULL)
                     AND CASE
                           WHEN EXISTS (SELECT 1 FROM workflow_steps ws2
                                         WHERE ws2.workflow_definition_id = wi.workflow_definition_id
                                           AND ws2.sort_order > ws.sort_order)
                             THEN wi.authorizer_user_id = v_caller_id
                           ELSE COALESCE(wi.approver_user_id, wi.authorizer_user_id) = v_caller_id
                         END
                   )
                   OR (
                     wi.authorizer_user_id IS NULL AND wi.approver_user_id IS NULL
                     AND (ws.approver_user_id = v_caller_id OR ws.approver_role = v_caller_role)
                   )
                 )
            )
       )
     ORDER BY wi.initiated_at ASC
  LOOP
    SELECT COALESCE(e.first_name || ' ' || e.last_name, '') INTO v_requester_name
      FROM employees e WHERE e.id = v_instance.initiated_by;

    SELECT ws.sort_order INTO v_step_ord
      FROM workflow_steps ws WHERE ws.id = v_instance.current_step_id;

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
      'step_title',        'Step ' || COALESCE(v_step_ord::text, ''),
      'step_order',        v_step_ord
    ));
  END LOOP;

  RETURN v_rows;
END;
$$;

-- ============================================================
-- 7. Only the requester's reporting manager may appeal
-- ============================================================
CREATE OR REPLACE FUNCTION public.appeal_workflow_step(
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
  v_is_manager boolean;
  v_has_manager boolean;
  v_first_step uuid;
BEGIN
  SELECT * INTO v_instance FROM workflow_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow instance not found';
  END IF;
  IF v_instance.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only approved workflows can be appealed';
  END IF;

  SELECT (e.reporting_manager_id = v_caller_id), (e.reporting_manager_id IS NOT NULL)
    INTO v_is_manager, v_has_manager
    FROM employees e WHERE e.id = v_instance.initiated_by;

  IF NOT (COALESCE(v_is_manager, false)
          OR (NOT COALESCE(v_has_manager, false) AND public.has_privilege('admin.settings'))) THEN
    RAISE EXCEPTION 'Only the manager this request reports to can appeal it';
  END IF;

  SELECT id INTO v_first_step
    FROM workflow_steps
   WHERE workflow_definition_id = v_instance.workflow_definition_id
   ORDER BY sort_order ASC, created_at ASC
   LIMIT 1;
  IF v_first_step IS NULL THEN
    RAISE EXCEPTION 'Workflow has no steps to rerun';
  END IF;

  INSERT INTO workflow_actions (workflow_instance_id, step_id, action, actor_id, comment)
  VALUES (v_instance.id, v_instance.current_step_id, 'APPEAL', v_caller_id, p_comment);

  UPDATE workflow_instances
     SET status = 'PENDING',
         current_step_id = v_first_step,
         completed_at = NULL,
         updated_at = now()
   WHERE id = v_instance.id;

  PERFORM public.enqueue_workflow_step_email(v_instance.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.appeal_workflow_step(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.appeal_workflow_step(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.appealable_workflows()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := public.current_employee_id();
  v_rows jsonb := '[]'::jsonb;
  v_r record;
  v_requester text;
  v_def_name text;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_r IN
    SELECT wi.id, wi.module_key, wi.record_id, wi.initiated_by, wi.initiated_at,
           wi.workflow_definition_id, wi.updated_at
      FROM workflow_instances wi
      LEFT JOIN employees e ON e.id = wi.initiated_by
     WHERE wi.status = 'APPROVED'
       AND (
         e.reporting_manager_id = v_caller_id
         OR (e.reporting_manager_id IS NULL AND public.has_privilege('admin.settings'))
       )
     ORDER BY wi.updated_at DESC
  LOOP
    SELECT COALESCE(e.first_name || ' ' || e.last_name, '') INTO v_requester
      FROM employees e WHERE e.id = v_r.initiated_by;

    SELECT COALESCE(name, '') INTO v_def_name FROM workflow_definitions WHERE id = v_r.workflow_definition_id;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'instance_id',     v_r.id,
      'module_key',      v_r.module_key,
      'record_id',       v_r.record_id,
      'requester_name',  v_requester,
      'workflow_name',   COALESCE(v_def_name, v_r.module_key),
      'initiated_at',    to_char(v_r.initiated_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'approved_at',     to_char(v_r.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS')
    ));
  END LOOP;

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.appealable_workflows() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.appealable_workflows() FROM PUBLIC;