-- ===========================================================================
-- HR Employee Lifecycle — Feature Set (2026-10-12)
--
-- Implements the 7 requested life-cycle features:
--
-- 1. Onboarding gate (already client-enforced in AppShell / route-guards).
-- 2. Profile lock: once an employee is ACTIVE they can no longer edit their
--    own profile directly. They submit *change requests* that HR reviews and
--    applies. Enforced in RLS (`update_employees`) + a BEFORE trigger on the
--    per-employee sub-record tables.
-- 3. Approved workflow records become immutable; a MANAGER (or HR_ADMIN /
--    SUPER_ADMIN / admin.settings holder) can submit an *appeal* which reopens
--    the same workflow instance for a fresh approval round (status -> PENDING,
--    docked to the first step). Only the workflow-propagation writer
--    (apply_workflow_result_to_record) and SUPER_ADMIN bypass the lock.
-- 4. (UI) HR "Add employee" wizard reusing the employee-detail steps.
-- 5. `reset_employee_password(employee_id)` — admin RPC that clears the
--    employee's password (old password invalid), issues a fresh setup token and
--    returns the raw token so the UI can send the `password.reset` email with a
--    /setup-account?token=... link. Reuses the existing setup-token flow.
-- 6. `employment_status = 'DISABLED'`: Disabling blocks login (is_login_blocked
--    true) and stores the previous status so re-enabling restores it. Payroll
--    generation / preview exclude DISABLED employees.
-- 7. (UI) Email-template preview.
--
-- Safe to re-run: all DDL is IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF
-- EXISTS. No production data is renamed or deleted.
-- ===========================================================================

-- ===========================================================================
-- 6. DISABLED employment status
-- ===========================================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS employment_status_before_disable text;

-- Extend the existing disable/enable RPC so it also toggles the DISABLED status
-- while preserving the previous non-departed status for restore on re-enable.
CREATE OR REPLACE FUNCTION public.set_employee_disabled(
  p_employee_id uuid,
  p_disabled boolean DEFAULT true,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.has_privilege('employees.manage') THEN
    RAISE EXCEPTION 'You do not have permission to disable employees';
  END IF;

  SELECT employment_status INTO v_status FROM public.employees WHERE id = p_employee_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF p_disabled THEN
    IF v_status = 'DISABLED' THEN
      RETURN;
    END IF;
    UPDATE public.employees
       SET is_login_blocked = true,
           employment_status_before_disable =
             CASE WHEN v_status = ANY (ARRAY['TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED', 'DISABLED'])
                  THEN NULL ELSE v_status END,
           disabled_reason = NULLIF(p_reason, ''),
           employment_status = 'DISABLED',
           updated_at = now()
     WHERE id = p_employee_id;
  ELSE
    UPDATE public.employees
       SET is_login_blocked = false,
           employment_status = COALESCE(employment_status_before_disable, 'ACTIVE'),
           employment_status_before_disable = NULL,
           disabled_reason = NULL,
           updated_at = now()
     WHERE id = p_employee_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_employee_disabled(uuid, boolean, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_employee_disabled(uuid, boolean, text) FROM PUBLIC;

-- Block login for DISABLED employees (kept in sync with is_login_blocked).
CREATE OR REPLACE FUNCTION public.authenticate_employee(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_expiry_days int;
BEGIN
  IF p_email IS NULL OR p_password IS NULL OR p_password = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;

  SELECT * INTO v_emp
    FROM employees e
   WHERE lower(e.email) = lower(p_email)
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;

  IF v_emp.is_login_blocked OR v_emp.employment_status = 'DISABLED' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'LOCKED');
  END IF;

  IF v_emp.password_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_PASSWORD',
                              'employee_id', v_emp.id, 'email', v_emp.email);
  END IF;

  IF NOT (v_emp.password_hash = extensions.crypt(p_password, v_emp.password_hash)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;

  IF v_emp.user_id IS DISTINCT FROM v_emp.id THEN
    UPDATE employees SET user_id = id WHERE id = v_emp.id;
  END IF;

  -- Enforce configurable password expiry: flag the account for a change.
  IF NOT v_emp.must_change_password THEN
    SELECT COALESCE(max((value #>> '{}')::int), 0)
      INTO v_expiry_days
      FROM system_settings
     WHERE group_name = 'security' AND key = 'password_expiry_days';

    IF v_expiry_days > 0
       AND v_emp.password_updated_at IS NOT NULL
       AND v_emp.password_updated_at < now() - make_interval(days => v_expiry_days) THEN
      UPDATE employees
         SET must_change_password = true,
             updated_at           = now()
       WHERE id = v_emp.id;
      SELECT * INTO v_emp FROM employees WHERE id = v_emp.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'email', v_emp.email,
    'role', v_emp.role,
    'first_name', v_emp.first_name,
    'last_name', v_emp.last_name,
    'employment_status', v_emp.employment_status,
    'must_change_password', v_emp.must_change_password
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.authenticate_employee(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authenticate_employee(text, text) TO anon, authenticated;

-- Exclude DISABLED employees from payroll preview + generation.
CREATE OR REPLACE FUNCTION public.payroll_preview(
  p_period_start date,
  p_period_end date,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tax_rate numeric;
  v_emp_id uuid;
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_privilege('payroll.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage payroll';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Invalid pay period';
  END IF;

  v_tax_rate := COALESCE(
    (SELECT value::numeric FROM system_settings WHERE group_name = 'payroll' AND key = 'tax_rate_pct'),
    10
  );

  FOR v_emp_id IN
    SELECT e.id
      FROM employees e
     WHERE e.employment_status NOT IN ('TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED', 'DISABLED')
       AND (p_employee_ids IS NULL OR e.id = ANY (p_employee_ids))
     ORDER BY e.first_name, e.last_name
  LOOP
    v_row := public._payroll_calc_for(v_emp_id, p_period_start, p_period_end, v_tax_rate);
    v_rows := v_rows || jsonb_build_array(v_row);
  END LOOP;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_payroll_run(
  p_name text,
  p_period_start date,
  p_period_end date,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_tax_rate numeric;
  v_emp_id uuid;
  v_row jsonb;
  v_tot_gross numeric := 0;
  v_tot_deductions numeric := 0;
  v_tot_net numeric := 0;
  v_created_count integer := 0;
  v_dup uuid;
BEGIN
  IF NOT public.has_privilege('payroll.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage payroll';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Invalid pay period';
  END IF;

  SELECT id INTO v_dup
    FROM payroll_runs
   WHERE pay_period_start = p_period_start AND pay_period_end = p_period_end
     AND status <> 'VOID'
   LIMIT 1;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'A payroll run already exists for this period';
  END IF;

  v_tax_rate := COALESCE(
    (SELECT value::numeric FROM system_settings WHERE group_name = 'payroll' AND key = 'tax_rate_pct'),
    10
  );

  INSERT INTO payroll_runs (name, pay_period_start, pay_period_end, status, total_gross, total_deductions, total_net)
  VALUES (
    COALESCE(NULLIF(p_name, ''), 'Payroll ' || to_char(p_period_start, 'Mon YYYY')),
    p_period_start,
    p_period_end,
    'DRAFT',
    0, 0, 0
  )
  RETURNING id INTO v_run_id;

  FOR v_emp_id IN
    SELECT e.id
      FROM employees e
     WHERE e.employment_status NOT IN ('TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED', 'DISABLED')
       AND (p_employee_ids IS NULL OR e.id = ANY (p_employee_ids))
     ORDER BY e.first_name, e.last_name
  LOOP
    v_row := public._payroll_calc_for(v_emp_id, p_period_start, p_period_end, v_tax_rate);

    INSERT INTO payslips (
      payroll_run_id, employee_id, gross_pay, total_deductions, net_pay,
      earnings, deductions, status, generated_at
    ) VALUES (
      v_run_id,
      v_emp_id,
      (v_row->>'gross')::numeric,
      (v_row->>'deductions_total')::numeric,
      (v_row->>'net')::numeric,
      COALESCE(v_row->'earnings', '[]'::jsonb),
      COALESCE(v_row->'deductions', '[]'::jsonb),
      'GENERATED',
      now()
    );

    v_tot_gross      := v_tot_gross + (v_row->>'gross')::numeric;
    v_tot_deductions := v_tot_deductions + (v_row->>'deductions_total')::numeric;
    v_tot_net        := v_tot_net + (v_row->>'net')::numeric;
    v_created_count  := v_created_count + 1;
  END LOOP;

  IF v_created_count = 0 THEN
    DELETE FROM payroll_runs WHERE id = v_run_id;
    RAISE EXCEPTION 'No eligible employees for the selected period';
  END IF;

  UPDATE payroll_runs
     SET total_gross      = round(v_tot_gross, 2),
         total_deductions = round(v_tot_deductions, 2),
         total_net        = round(v_tot_net, 2)
   WHERE id = v_run_id;

  RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_preview(date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payroll_run(text, date, date, uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.payroll_preview(date, date, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_payroll_run(text, date, date, uuid[]) FROM PUBLIC;

-- ===========================================================================
-- 5. Reset employee login password (admin) -> invalidates old password and
--    issues a fresh setup token. The UI sends the `password.reset` template
--    with a /setup-account?token=... link built from the returned raw token.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.reset_employee_password(p_employee_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
BEGIN
  IF NOT (public.has_privilege('employees.manage') OR public.has_privilege('admin.privileges')) THEN
    RAISE EXCEPTION 'You do not have permission to reset passwords';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Old password stops working until the employee picks a new one via the link.
  UPDATE public.employees
     SET password_hash       = NULL,
         password_updated_at = NULL,
         must_change_password = false,
         updated_at          = now()
   WHERE id = p_employee_id;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');

  DELETE FROM public.employee_setup_tokens WHERE employee_id = p_employee_id;

  INSERT INTO public.employee_setup_tokens (employee_id, token_hash, expires_at, created_by)
  VALUES (p_employee_id,
          encode(extensions.digest(v_raw, 'sha256'), 'hex'),
          now() + interval '72 hours',
          public.current_employee_id());

  RETURN v_raw;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_employee_password(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_employee_password(uuid) FROM PUBLIC;

-- ===========================================================================
-- 3. Approved workflows = immutable; managers can appeal to reopen.
-- ===========================================================================

-- Reopen an APPROVED workflow instance for a fresh approval round.
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
  v_caller_role text;
  v_first_step uuid;
BEGIN
  SELECT * INTO v_instance FROM workflow_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow instance not found';
  END IF;
  IF v_instance.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only approved workflows can be appealed';
  END IF;

  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;
  IF NOT (public.has_privilege('admin.settings')
          OR COALESCE(v_caller_role, '') IN ('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Only managers or administrators can appeal an approved workflow';
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.appeal_workflow_step(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.appeal_workflow_step(uuid, text) FROM PUBLIC;

-- Feed for the Approvals page: APPROVED workflow instances the caller may appeal.
CREATE OR REPLACE FUNCTION public.appealable_workflows()
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
  v_r record;
  v_requester text;
  v_def_name text;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;
  IF NOT (public.has_privilege('admin.settings')
          OR COALESCE(v_caller_role, '') IN ('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN')) THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_r IN
    SELECT wi.id, wi.module_key, wi.record_id, wi.initiated_by, wi.initiated_at,
           wi.workflow_definition_id, wi.updated_at
      FROM workflow_instances wi
     WHERE wi.status = 'APPROVED'
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

-- Lock trigger: an approved workflow instance makes the source record immutable.
-- The workflow-propagation writer sets app.workflow_approved = <record_id> to
-- authorise its own write. SUPER_ADMIN may always edit.
CREATE OR REPLACE FUNCTION public.prevent_edit_of_approved_workflow_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
  v_role text;
  v_locked boolean;
BEGIN
  IF current_setting('app.workflow_approved', true) = OLD.id::text THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT role INTO v_role FROM public.employees WHERE id = v_actor;
  IF COALESCE(v_role, '') = 'SUPER_ADMIN' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
      SELECT 1 FROM public.workflow_instances wi
       WHERE wi.module_key = TG_ARGV[0]
         AND wi.record_id = OLD.id
         AND wi.status = 'APPROVED'
  ) AND NOT EXISTS (
      SELECT 1 FROM public.workflow_instances wi2
       WHERE wi2.module_key = TG_ARGV[0]
         AND wi2.record_id = OLD.id
         AND wi2.status = 'PENDING'
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'This record is locked because it has an approved workflow. Submit an appeal to reopen it for approval.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_edit_of_approved_workflow_records() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_lock_approved_wf ON leave_requests;
CREATE TRIGGER trg_lock_approved_wf
  BEFORE UPDATE OR DELETE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_edit_of_approved_workflow_records('leave');

DROP TRIGGER IF EXISTS trg_lock_approved_wf ON leave_encashment_requests;
CREATE TRIGGER trg_lock_approved_wf
  BEFORE UPDATE OR DELETE ON leave_encashment_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_edit_of_approved_workflow_records('leave.encashment');

DROP TRIGGER IF EXISTS trg_lock_approved_wf ON recruitment_requisitions;
CREATE TRIGGER trg_lock_approved_wf
  BEFORE UPDATE OR DELETE ON recruitment_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_edit_of_approved_workflow_records('recruitment.requisition');

DROP TRIGGER IF EXISTS trg_lock_approved_wf ON procurement_requisitions;
CREATE TRIGGER trg_lock_approved_wf
  BEFORE UPDATE OR DELETE ON procurement_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_edit_of_approved_workflow_records('procurement.requisition');

DROP TRIGGER IF EXISTS trg_lock_approved_wf ON purchase_orders;
CREATE TRIGGER trg_lock_approved_wf
  BEFORE UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.prevent_edit_of_approved_workflow_records('procurement.purchase_order');

DROP TRIGGER IF EXISTS trg_lock_approved_wf ON procurement_invoices;
CREATE TRIGGER trg_lock_approved_wf
  BEFORE UPDATE OR DELETE ON procurement_invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_edit_of_approved_workflow_records('procurement.invoice');

DROP TRIGGER IF EXISTS trg_lock_approved_wf ON procurement_payment_requests;
CREATE TRIGGER trg_lock_approved_wf
  BEFORE UPDATE OR DELETE ON procurement_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_edit_of_approved_workflow_records('procurement.payment');

-- Definitive workflow-result propagator: includes every module branch AND sets
-- the per-record override so the source-table lock trigger accepts the verdict.
DROP TRIGGER IF EXISTS trg_apply_workflow_result ON workflow_instances;
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

CREATE TRIGGER trg_apply_workflow_result
  AFTER UPDATE ON workflow_instances
  FOR EACH ROW EXECUTE FUNCTION public.apply_workflow_result_to_record();

REVOKE EXECUTE ON FUNCTION public.apply_workflow_result_to_record() FROM PUBLIC;

-- ===========================================================================
-- 2. Profile lock at ACTIVE + employee change requests
-- ===========================================================================

-- Change-request ledger (self-service edits once the profile is locked).
CREATE TABLE IF NOT EXISTS employee_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  section text NOT NULL DEFAULT 'OTHER',
  field_name text NOT NULL,
  old_value jsonb,
  new_value jsonb NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'PENDING',   -- PENDING | APPROVED | REJECTED
  requested_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  requested_at timestamptz DEFAULT now(),
  reviewed_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text
);
ALTER TABLE employee_change_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_emp_change_requests_emp
  ON employee_change_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_emp_change_requests_status
  ON employee_change_requests(status, requested_at);

DROP POLICY IF EXISTS "select_employee_change_requests" ON employee_change_requests;
DROP POLICY IF EXISTS "insert_employee_change_requests" ON employee_change_requests;
DROP POLICY IF EXISTS "update_employee_change_requests" ON employee_change_requests;
DROP POLICY IF EXISTS "delete_employee_change_requests" ON employee_change_requests;
CREATE POLICY "select_employee_change_requests" ON employee_change_requests FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id()
         OR public.has_any_privilege(ARRAY['employees.view_all', 'employees.manage']));
CREATE POLICY "insert_employee_change_requests" ON employee_change_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "update_employee_change_requests" ON employee_change_requests FOR UPDATE TO authenticated
  USING (public.has_privilege('employees.manage'))
  WITH CHECK (public.has_privilege('employees.manage'));
CREATE POLICY "delete_employee_change_requests" ON employee_change_requests FOR DELETE TO authenticated
  USING (public.has_privilege('employees.manage'));

-- Fields an ACTIVE employee may request changes for. Compensation, banking
-- numbers that are payroll-controlled and role/access fields are excluded
-- (they are handled by HR directly).
CREATE OR REPLACE FUNCTION public.submit_employee_change_request(
  p_field_name text,
  p_new_value text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id uuid := public.current_employee_id();
  v_status text;
  v_field text;
  v_section text;
  v_old jsonb;
  v_id uuid;
BEGIN
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to request a change';
  END IF;

  SELECT employment_status INTO v_status FROM public.employees WHERE id = v_emp_id;
  IF COALESCE(v_status, '') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Change requests are only available for active employees';
  END IF;

  v_field := lower(p_field_name);
  IF NOT (v_field = ANY (ARRAY[
    'first_name', 'last_name', 'gender', 'date_of_birth', 'marital_status',
    'nationality', 'state_of_origin', 'lga', 'blood_group', 'genotype',
    'disability_status', 'disability_details',
    'phone', 'email', 'address', 'city', 'state', 'country', 'postal_code',
    'residential_address', 'permanent_address',
    'emergency_contact_name', 'emergency_contact_phone',
    'bank_name', 'bank_account_number', 'bank_routing_number'
  ])) THEN
    RAISE EXCEPTION 'This field cannot be changed via a self-service request';
  END IF;

  v_section := CASE
    WHEN v_field IN ('bank_name', 'bank_account_number', 'bank_routing_number') THEN 'BANK'
    WHEN v_field IN ('emergency_contact_name', 'emergency_contact_phone') THEN 'EMERGENCY'
    WHEN v_field IN ('phone', 'email', 'address', 'city', 'state', 'country',
                     'postal_code', 'residential_address', 'permanent_address') THEN 'CONTACT'
    ELSE 'PERSONAL'
  END;

  EXECUTE format('SELECT to_jsonb(%I) FROM public.employees WHERE id = $1', v_field)
    INTO v_old
    USING v_emp_id;

  INSERT INTO public.employee_change_requests
    (employee_id, section, field_name, old_value, new_value, reason, requested_by)
  VALUES
    (v_emp_id, v_section, v_field, v_old, to_jsonb(p_new_value), p_reason, v_emp_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_employee_change_request(text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_employee_change_request(text, text, text) FROM PUBLIC;

-- HR review: approve applies the requested value to the employee row.
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
    IF NOT (v_req.field_name = ANY (ARRAY[
      'first_name', 'last_name', 'gender', 'date_of_birth', 'marital_status',
      'nationality', 'state_of_origin', 'lga', 'blood_group', 'genotype',
      'disability_status', 'disability_details',
      'phone', 'email', 'address', 'city', 'state', 'country', 'postal_code',
      'residential_address', 'permanent_address',
      'emergency_contact_name', 'emergency_contact_phone',
      'bank_name', 'bank_account_number', 'bank_routing_number'
    ])) THEN
      RAISE EXCEPTION 'This field cannot be changed via a change request';
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

-- Restrict SELF-service edits on the employees table to the onboarding phase.
DROP POLICY IF EXISTS "update_employees" ON employees;
CREATE POLICY "update_employees" ON employees FOR UPDATE TO authenticated
  USING (id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (
    public.has_privilege('employees.manage')
    OR (
      id = public.current_employee_id()
      AND role = (SELECT e.role FROM employees e WHERE e.id = public.current_employee_id())
      AND (SELECT e.employment_status FROM employees e WHERE e.id = public.current_employee_id())
          IN ('ONBOARDING', 'PENDING_VERIFICATION')
      AND COALESCE(password_hash,
          (SELECT e.password_hash FROM employees e WHERE e.id = public.current_employee_id()))
          = (SELECT e.password_hash FROM employees e WHERE e.id = public.current_employee_id())
      AND COALESCE(password_updated_at,
          (SELECT e.password_updated_at FROM employees e WHERE e.id = public.current_employee_id()))
          = (SELECT e.password_updated_at FROM employees e WHERE e.id = public.current_employee_id())
    )
  );

-- Per-employee sub-records: same lock applied via a single BEFORE trigger.
CREATE OR REPLACE FUNCTION public.restrict_profile_edits_when_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
  v_emp uuid;
  v_status text;
BEGIN
  IF v_actor IS NULL OR public.has_privilege('employees.manage') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_emp := CASE WHEN TG_OP = 'DELETE' THEN OLD.employee_id ELSE NEW.employee_id END;
  SELECT employment_status INTO v_status FROM public.employees WHERE id = v_emp;
  IF v_status = 'ACTIVE' THEN
    RAISE EXCEPTION 'Your profile is locked. Submit a change request for HR review instead.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restrict_profile_edits_when_active() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_lock_profile_active ON employee_employment;
CREATE TRIGGER trg_lock_profile_active
  BEFORE INSERT OR UPDATE OR DELETE ON employee_employment
  FOR EACH ROW EXECUTE FUNCTION public.restrict_profile_edits_when_active();

DROP TRIGGER IF EXISTS trg_lock_profile_active ON employee_guarantors;
CREATE TRIGGER trg_lock_profile_active
  BEFORE INSERT OR UPDATE OR DELETE ON employee_guarantors
  FOR EACH ROW EXECUTE FUNCTION public.restrict_profile_edits_when_active();

DROP TRIGGER IF EXISTS trg_lock_profile_active ON employee_medical;
CREATE TRIGGER trg_lock_profile_active
  BEFORE INSERT OR UPDATE OR DELETE ON employee_medical
  FOR EACH ROW EXECUTE FUNCTION public.restrict_profile_edits_when_active();

DROP TRIGGER IF EXISTS trg_lock_profile_active ON employee_qualifications;
CREATE TRIGGER trg_lock_profile_active
  BEFORE INSERT OR UPDATE OR DELETE ON employee_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.restrict_profile_edits_when_active();

DROP TRIGGER IF EXISTS trg_lock_profile_active ON employee_documents;
CREATE TRIGGER trg_lock_profile_active
  BEFORE INSERT OR UPDATE OR DELETE ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION public.restrict_profile_edits_when_active();

DROP TRIGGER IF EXISTS trg_lock_profile_active ON employee_emergency_contacts;
CREATE TRIGGER trg_lock_profile_active
  BEFORE INSERT OR UPDATE OR DELETE ON employee_emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.restrict_profile_edits_when_active();

DROP TRIGGER IF EXISTS trg_lock_profile_active ON employee_certifications;
CREATE TRIGGER trg_lock_profile_active
  BEFORE INSERT OR UPDATE OR DELETE ON employee_certifications
  FOR EACH ROW EXECUTE FUNCTION public.restrict_profile_edits_when_active();

DROP TRIGGER IF EXISTS trg_lock_profile_active ON employee_competencies;
CREATE TRIGGER trg_lock_profile_active
  BEFORE INSERT OR UPDATE OR DELETE ON employee_competencies
  FOR EACH ROW EXECUTE FUNCTION public.restrict_profile_edits_when_active();

DROP TRIGGER IF EXISTS trg_lock_profile_active ON employee_health_metrics;
CREATE TRIGGER trg_lock_profile_active
  BEFORE INSERT OR UPDATE OR DELETE ON employee_health_metrics
  FOR EACH ROW EXECUTE FUNCTION public.restrict_profile_edits_when_active();