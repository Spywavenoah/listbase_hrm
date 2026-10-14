-- Expense Claim approval workflow + self-service profile-change workflow.
--
-- 1. `expense` workflow chain (Manager -> HR Admin) seeded and enabled, and an
--    insert trigger starts it for every new expense claim.
-- 2. `employee.change_request` workflow chain seeded and enabled, and an insert
--    trigger starts it for every submitted profile change request. On approval
--    the requested value is applied to the employee row.
-- 3. `apply_workflow_result_to_record` gains branches for both modules.
-- 4. `guard_expense_claim_status` trusts workflow-driven transitions via the
--    `app.workflow_approved` session flag set by the propagation trigger.
-- 5. Helper to resolve the pending instance for a record (used by the UI).

-- ============================================================
-- 1. Apply the requested change to the employee row (used on approval)
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_employee_change_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req employee_change_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM employee_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_req.field_name = 'date_of_birth' THEN
    EXECUTE format('UPDATE public.employees SET %I = $1::date, updated_at = now() WHERE id = $2',
                   v_req.field_name)
      USING v_req.new_value #>> '{}', v_req.employee_id;
  ELSE
    EXECUTE format('UPDATE public.employees SET %I = $1, updated_at = now() WHERE id = $2',
                   v_req.field_name)
      USING v_req.new_value #>> '{}', v_req.employee_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_employee_change_request(uuid) FROM PUBLIC;

-- Also expose the apply path for HR review (kept as an admin override).
CREATE OR REPLACE FUNCTION public.review_employee_change_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req employee_change_requests%ROWTYPE;
  v_reviewer uuid := public.current_employee_id();
BEGIN
  IF NOT public.has_privilege('employees.manage') THEN
    RAISE EXCEPTION 'You need employees.manage to review change requests';
  END IF;

  SELECT * INTO v_req FROM employee_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change request not found';
  END IF;
  IF v_req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'This request has already been reviewed';
  END IF;

  IF p_approve THEN
    PERFORM public.apply_employee_change_request(p_request_id);
  END IF;

  UPDATE employee_change_requests
     SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         review_note = p_note
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_employee_change_request(uuid, boolean, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.review_employee_change_request(uuid, boolean, text) FROM PUBLIC;

-- ============================================================
-- 2. Result propagation (adds expense + employee.change_request)
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_workflow_result_to_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('APPROVED', 'REJECTED') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM set_config('app.workflow_approved', NEW.record_id::text, true);

    IF NEW.module_key = 'leave' THEN
      UPDATE leave_requests
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'leave.encashment' THEN
      UPDATE leave_encashment_requests
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'expense' THEN
      UPDATE expense_claims
         SET status = NEW.status,
             approved_by = CASE WHEN NEW.status = 'APPROVED' THEN public.current_employee_id() ELSE approved_by END,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE approved_at END,
             rejected_by = CASE WHEN NEW.status = 'REJECTED' THEN public.current_employee_id() ELSE rejected_by END,
             rejected_at = CASE WHEN NEW.status = 'REJECTED' THEN now() ELSE rejected_at END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'employee.change_request' THEN
      IF NEW.status = 'APPROVED' THEN
        PERFORM public.apply_employee_change_request(NEW.record_id);
        UPDATE employee_change_requests
           SET status = 'APPROVED',
               reviewed_by = public.current_employee_id(),
               reviewed_at = now()
         WHERE id = NEW.record_id;
      ELSE
        UPDATE employee_change_requests
           SET status = 'REJECTED',
               reviewed_by = public.current_employee_id(),
               reviewed_at = now()
         WHERE id = NEW.record_id;
      END IF;
    ELSIF NEW.module_key = 'procurement.requisition' THEN
      UPDATE procurement_requisitions
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'procurement.purchase_order' THEN
      UPDATE purchase_orders
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'procurement.invoice' THEN
      UPDATE procurement_invoices
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'procurement.payment' THEN
      UPDATE procurement_payment_requests
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'recruitment.requisition' THEN
      UPDATE recruitment_requisitions
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Expense status guard trusts workflow-driven transitions
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_expense_claim_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
  v_workflow_flag text := current_setting('app.workflow_approved', true);
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN

    -- Workflow engine already validated the approver; trust its verdict.
    IF v_workflow_flag = NEW.id::text THEN
      IF NEW.status = 'RETIRED' THEN
        NEW.retirement_status := 'RETIRED';
        NEW.amount_difference := NEW.amount - COALESCE(NEW.actual_amount_spent, 0);
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.status IN ('APPROVED', 'REJECTED', 'RETIRED') AND v_actor = OLD.requested_by THEN
      RAISE EXCEPTION 'You cannot approve, reject or retire a claim you raised';
    END IF;

    IF NEW.status IN ('APPROVED', 'REJECTED') THEN
      IF NOT public.has_any_privilege(ARRAY['expense.manage', 'expense.approve']) THEN
        RAISE EXCEPTION 'You need expense.manage or expense.approve to approve or reject expense claims';
      END IF;
    END IF;

    IF NEW.status = 'RETIRED' THEN
      IF OLD.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Only approved claims can be retired';
      END IF;
      IF COALESCE(NEW.proof_path, '') = '' THEN
        RAISE EXCEPTION 'A proof / invoice attachment is required to retire an expense claim';
      END IF;
      IF NEW.actual_amount_spent IS NULL OR NEW.actual_amount_spent < 0 THEN
        RAISE EXCEPTION 'Enter the actual amount spent from the receipt';
      END IF;
      IF NOT public.has_any_privilege(ARRAY['expense.manage', 'expense.approve']) THEN
        RAISE EXCEPTION 'You need expense.manage or expense.approve to retire an expense claim';
      END IF;
      NEW.retirement_status := 'RETIRED';
      NEW.amount_difference := NEW.amount - NEW.actual_amount_spent;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_claim_status ON expense_claims;
CREATE TRIGGER trg_guard_expense_claim_status
BEFORE UPDATE ON expense_claims
FOR EACH ROW EXECUTE FUNCTION public.guard_expense_claim_status();

-- ============================================================
-- 4. Start workflows on insert
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_expense_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.maybe_start_workflow('expense', NEW.id, COALESCE(NEW.requested_by, public.current_employee_id()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_start_workflow_expense ON expense_claims;
CREATE TRIGGER trg_start_workflow_expense
AFTER INSERT ON expense_claims
FOR EACH ROW EXECUTE FUNCTION public.start_expense_workflow();

CREATE OR REPLACE FUNCTION public.start_change_request_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.maybe_start_workflow(
    'employee.change_request',
    NEW.id,
    COALESCE(NEW.requested_by, NEW.employee_id, public.current_employee_id())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_start_workflow_change_request ON employee_change_requests;
CREATE TRIGGER trg_start_workflow_change_request
AFTER INSERT ON employee_change_requests
FOR EACH ROW EXECUTE FUNCTION public.start_change_request_workflow();

REVOKE EXECUTE ON FUNCTION public.start_expense_workflow() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_change_request_workflow() FROM PUBLIC;

-- ============================================================
-- 5. Resolve the pending instance for a record (UI helper)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_pending_workflow_instance(
  p_module_key text,
  p_record_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM workflow_instances
   WHERE module_key = p_module_key
     AND record_id = p_record_id
     AND status = 'PENDING'
   ORDER BY initiated_at DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_workflow_instance(text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_workflow_instance(text, uuid) FROM PUBLIC;

-- ============================================================
-- 6. Seed + enable the chains
-- ============================================================
-- Expense Claim Approval (Manager -> HR Admin)
INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
VALUES (
  'Expense Claim Approval',
  'expense',
  'request.created',
  'Default expense claim approval chain (Manager then HR Admin). Manage in Settings > Workflows.',
  true
)
ON CONFLICT DO NOTHING;

INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
SELECT wd.id, 1, 'MANAGER'
  FROM workflow_definitions wd
 WHERE wd.module_key = 'expense'
   AND NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = wd.id);

INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
SELECT wd.id, 2, 'HR_ADMIN'
  FROM workflow_definitions wd
 WHERE wd.module_key = 'expense'
   AND (SELECT count(*) FROM workflow_steps ws WHERE ws.workflow_definition_id = wd.id) < 2;

INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
SELECT 'expense', true, wd.id
  FROM workflow_definitions wd
 WHERE wd.module_key = 'expense'
   AND NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'expense');

-- Profile change approval (Manager -> HR Admin)
INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
VALUES (
  'Profile Change Approval',
  'employee.change_request',
  'request.created',
  'Approval chain for self-service profile change requests (Manager then HR Admin).',
  true
)
ON CONFLICT DO NOTHING;

INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
SELECT wd.id, 1, 'MANAGER'
  FROM workflow_definitions wd
 WHERE wd.module_key = 'employee.change_request'
   AND NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = wd.id);

INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
SELECT wd.id, 2, 'HR_ADMIN'
  FROM workflow_definitions wd
 WHERE wd.module_key = 'employee.change_request'
   AND (SELECT count(*) FROM workflow_steps ws WHERE ws.workflow_definition_id = wd.id) < 2;

INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
SELECT 'employee.change_request', true, wd.id
  FROM workflow_definitions wd
 WHERE wd.module_key = 'employee.change_request'
   AND NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'employee.change_request');
