-- ============================================================
-- Source: 20261014000001_self_approval_guards_and_expense_module.sql
-- ============================================================
--
-- # Impress spending (Expense Claim / Retirement) + governance hardening
--
-- 1. **Self-approval guards (leave + workflow)**
--    - Nobody may approve/reject/retire a request they raised. Enforced at
--      the DB level so it holds regardless of the client.
--      * `approve_workflow_step` / `reject_workflow_step` raise when the
--        caller initiated the workflow.
--      * `pending_approvals` stops surfacing your own requests in the inbox.
--      * `leave_requests` gets a BEFORE UPDATE trigger blocking an owner from
--        flipping their own request to APPROVED/REJECTED (the manager / HR
--        approval path and the workflow engine are unaffected).
-- 2. **Employee-only data visibility (field_values)**
--    - Generic comp-record rows previously exposed every non-medical
--      `field_values` row to any signed-in user. The SELECT policy now
--      requires ownership of the parent record (via `employee_owns_field_value`)
--      or the relevant privilege (`employees.view_all`, `employees.manage`,
--      `admin.settings`; `employee_medical` keeps its dedicated `employees.medical`
--      gate).
-- 3. **Expense Claim + Expense Retirement module**
--    - `expense_categories`: seeded reference list of spending categories.
--    - `expense_claims`: single table for both kinds (`CLAIM` for expenses
--      to be reimbursed, `RETIREMENT` for retiring impress cash advances).
--      Every claim tracks proof/invoice attachment metadata; a claim cannot be
--      RETIRED without an attached proof and only from APPROVED.
--    - Status flow: PENDING -> APPROVED -> RETIRED (REJECTED / CANCELLED
--      terminal). Employees may cancel their own PENDING rows and attach proof;
--      only `expense.manage` / `expense.approve` holders may approve/reject/
--      retire, and never their own claims.
--    - `approve_expense_claim(id, action, note)` RPC for approvers (validates
--      privilege, self-approval, status and proof requirements).
--    - `expense-proofs` private storage bucket; uploads land in
--      `<claim_id>/<file>`, readable/writable by the claimant and approvers.
-- 4. **Privilege catalog** -> new `Expenses` category (manage / approve).

-- ============================================================
-- 1. Self-approval guards
-- ============================================================

-- 1a. Workflow steps: nobody acts on their own request.
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

  IF v_caller_id IS NOT NULL AND v_instance.initiated_by = v_caller_id THEN
    RAISE EXCEPTION 'You cannot approve a request you initiated';
  END IF;

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

  IF v_caller_id IS NOT NULL AND v_instance.initiated_by = v_caller_id THEN
    RAISE EXCEPTION 'You cannot reject a request you initiated';
  END IF;

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

-- 1b. Approvals inbox: never surface your own requests.
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
                  AND (ws.approver_user_id = v_caller_id
                       OR ws.approver_role = v_caller_role)
             )
           )
     ORDER BY wi.initiated_at ASC
  LOOP
    SELECT COALESCE(e.first_name || ' ' || e.last_name, '') INTO v_requester_name
      FROM employees e WHERE e.id = v_instance.initiated_by;

    SELECT ws.sort_order INTO v_step_ord
      FROM workflow_steps ws WHERE ws.id = v_instance.current_step_id;
    v_step_title := COALESCE(v_step_ord::text, '');
    v_step_title := 'Step ' || v_step_title;

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

-- 1c. Leave: owners cannot push their own request to APPROVED / REJECTED.
CREATE OR REPLACE FUNCTION public.guard_self_leave_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
BEGIN
  IF NEW.status IN ('APPROVED', 'REJECTED')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND v_actor = OLD.employee_id THEN
    RAISE EXCEPTION 'You cannot approve or reject your own leave request';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_self_leave_approval ON leave_requests;
CREATE TRIGGER trg_guard_self_leave_approval
BEFORE UPDATE ON leave_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_self_leave_approval();

-- ============================================================
-- 2. field_values: employees only see records they own
-- ============================================================

-- Resolves which employee the polymorphic record belongs to so the SELECT
-- policy can gate non-privileged readers to their own data.
CREATE OR REPLACE FUNCTION public.employee_owns_field_value(
  p_module_key text,
  p_record_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    WHERE p_module_key = 'employee'
      AND p_record_id = public.current_employee_id()
      OR p_module_key = 'employee_documents'
      AND EXISTS (SELECT 1 FROM public.employee_documents d
                   WHERE d.id = p_record_id AND d.employee_id = public.current_employee_id())
      OR p_module_key = 'employee_guarantor'
      AND EXISTS (SELECT 1 FROM public.employee_guarantors g
                   WHERE g.id = p_record_id AND g.employee_id = public.current_employee_id())
      OR p_module_key = 'employee_qualifications'
      AND EXISTS (SELECT 1 FROM public.employee_qualifications q
                   WHERE q.id = p_record_id AND q.employee_id = public.current_employee_id())
      OR p_module_key = 'employee_emergency_contacts'
      AND EXISTS (SELECT 1 FROM public.employee_emergency_contacts c
                   WHERE c.id = p_record_id AND c.employee_id = public.current_employee_id())
      OR p_module_key = 'employee_medical'
      AND EXISTS (SELECT 1 FROM public.employee_medical m
                   WHERE m.id = p_record_id AND m.employee_id = public.current_employee_id())
      OR p_module_key = 'expense_claim'
      AND EXISTS (SELECT 1 FROM public.expense_claims ec
                   WHERE ec.id = p_record_id AND ec.requested_by = public.current_employee_id())
  );
$$;

DROP POLICY IF EXISTS "select_field_values" ON field_values;
CREATE POLICY "select_field_values" ON field_values FOR SELECT TO authenticated
  USING (
    (
      module_key <> 'employee_medical'
      AND (
        public.has_privilege('admin.settings')
        OR public.has_privilege('employees.view_all')
        OR public.has_privilege('employees.manage')
        OR public.employee_owns_field_value(module_key, record_id)
      )
    )
    OR
    (
      module_key = 'employee_medical'
      AND (
        record_id = public.current_employee_id()
        OR public.has_privilege('employees.medical')
      )
    )
  );

-- Writers may persist custom values for records they personally own (or are
-- allowed to manage). The medical module keeps its dedicated gate.
DROP POLICY IF EXISTS "insert_field_values" ON field_values;
CREATE POLICY "insert_field_values" ON field_values FOR INSERT TO authenticated
  WITH CHECK (
    public.has_privilege('admin.settings')
    OR public.employee_owns_field_value(module_key, record_id)
    OR (
      module_key = 'employee_medical'
      AND (record_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
    )
  );

DROP POLICY IF EXISTS "update_field_values" ON field_values;
CREATE POLICY "update_field_values" ON field_values FOR UPDATE TO authenticated
  USING (
    public.has_privilege('admin.settings')
    OR public.employee_owns_field_value(module_key, record_id)
    OR (
      module_key = 'employee_medical'
      AND (record_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
    )
  )
  WITH CHECK (
    public.has_privilege('admin.settings')
    OR public.employee_owns_field_value(module_key, record_id)
    OR (
      module_key = 'employee_medical'
      AND (record_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
    )
  );

DROP POLICY IF EXISTS "delete_field_values" ON field_values;
CREATE POLICY "delete_field_values" ON field_values FOR DELETE TO authenticated
  USING (
    public.has_privilege('admin.settings')
    OR public.employee_owns_field_value(module_key, record_id)
    OR (
      module_key = 'employee_medical'
      AND (record_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
    )
  );

-- ============================================================
-- 3. Expense module (Impress: Claims + Retirements)
-- ============================================================

-- 3a. Privilege catalog additions (Expenses category).
INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('expense.manage',  'Expenses', 'Manage expenses', 'Approve, reject and retire expense claims and retirements', 10),
  ('expense.approve', 'Expenses', 'Approve expenses', 'Approve and retire expense claims and retirements', 20)
ON CONFLICT (key) DO NOTHING;

-- 3b. Expense categories (reference data).
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_expense_categories" ON expense_categories;
DROP POLICY IF EXISTS "insert_expense_categories" ON expense_categories;
DROP POLICY IF EXISTS "update_expense_categories" ON expense_categories;
DROP POLICY IF EXISTS "delete_expense_categories" ON expense_categories;
CREATE POLICY "select_expense_categories" ON expense_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_expense_categories" ON expense_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('expense.manage') OR public.has_privilege('admin.settings'));
CREATE POLICY "update_expense_categories" ON expense_categories FOR UPDATE TO authenticated
  USING (public.has_privilege('expense.manage') OR public.has_privilege('admin.settings'))
  WITH CHECK (public.has_privilege('expense.manage') OR public.has_privilege('admin.settings'));
CREATE POLICY "delete_expense_categories" ON expense_categories FOR DELETE TO authenticated
  USING (public.has_privilege('expense.manage') OR public.has_privilege('admin.settings'));

INSERT INTO expense_categories (name, description) VALUES
  ('Transportation', 'Fuel, cab fares, public transport, flight tickets'),
  ('Meals & Entertainment', 'Meals, refreshments and official entertainment'),
  ('Accommodation', 'Hotel and lodging during official trips'),
  ('Office Supplies', 'Stationery, printing and general office consumables'),
  ('Medical', 'Approved medical and pharmacy expenses'),
  ('Training & Development', 'Courses, examinations and professional development'),
  ('Client / Vendor Gifts', 'Gifts and hospitality for clients or vendors'),
  ('Other', 'Any other business expense approved by the manager')
ON CONFLICT (name) DO NOTHING;

-- 3c. Expense claims / retirements.
CREATE TABLE IF NOT EXISTS expense_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number text NOT NULL UNIQUE
    DEFAULT ('EXP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  kind text NOT NULL DEFAULT 'CLAIM'
    CHECK (kind IN ('CLAIM', 'RETIREMENT')),
  requested_by uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'NGN',
  expense_date date,
  description text,
  notes text,
  proof_path text,
  proof_name text,
  proof_type text,
  proof_size bigint,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'RETIRED', 'CANCELLED')),
  requested_at timestamptz DEFAULT now(),
  approved_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  retired_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  retired_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE expense_claims ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_expense_claims_requester ON expense_claims(requested_by);
CREATE INDEX IF NOT EXISTS idx_expense_claims_status ON expense_claims(status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_kind ON expense_claims(kind);

DROP POLICY IF EXISTS "select_expense_claims" ON expense_claims;
DROP POLICY IF EXISTS "insert_expense_claims" ON expense_claims;
DROP POLICY IF EXISTS "update_expense_claims" ON expense_claims;
DROP POLICY IF EXISTS "delete_expense_claims" ON expense_claims;
CREATE POLICY "select_expense_claims" ON expense_claims FOR SELECT TO authenticated
  USING (
    requested_by = public.current_employee_id()
    OR public.has_any_privilege(ARRAY['expense.manage', 'expense.approve'])
    OR public.has_privilege('admin.settings')
  );
CREATE POLICY "insert_expense_claims" ON expense_claims FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = public.current_employee_id()
    OR public.has_privilege('expense.manage')
  );
CREATE POLICY "update_expense_claims" ON expense_claims FOR UPDATE TO authenticated
  USING (
    requested_by = public.current_employee_id()
    OR public.has_any_privilege(ARRAY['expense.manage', 'expense.approve'])
    OR public.has_privilege('admin.settings')
  )
  WITH CHECK (
    requested_by = public.current_employee_id()
    OR public.has_any_privilege(ARRAY['expense.manage', 'expense.approve'])
    OR public.has_privilege('admin.settings')
  );
CREATE POLICY "delete_expense_claims" ON expense_claims FOR DELETE TO authenticated
  USING (public.has_privilege('expense.manage') OR public.has_privilege('admin.settings'));

-- 3d. Status / self-approval guard for expense claims.
CREATE OR REPLACE FUNCTION public.guard_expense_claim_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('APPROVED', 'REJECTED', 'RETIRED') AND v_actor = OLD.requested_by THEN
      RAISE EXCEPTION 'You cannot approve, reject or retire a claim you raised';
    END IF;

    IF NEW.status IN ('APPROVED', 'REJECTED') THEN
      IF NOT public.has_any_privilege(ARRAY['expense.manage', 'expense.approve']) THEN
        RAISE EXCEPTION 'You need expense.manage or expense.approve to approve or reject expense claims';
      END IF;
    END IF;

    IF NEW.status = 'RETIRED' THEN
      IF old.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Only approved claims can be retired';
      END IF;
      IF COALESCE(NEW.proof_path, '') = '' THEN
        RAISE EXCEPTION 'A proof / invoice attachment is required to retire an expense claim';
      END IF;
      IF NOT public.has_any_privilege(ARRAY['expense.manage', 'expense.approve']) THEN
        RAISE EXCEPTION 'You need expense.manage or expense.approve to retire an expense claim';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_claim_status ON expense_claims;
CREATE TRIGGER trg_guard_expense_claim_status
BEFORE UPDATE ON expense_claims
FOR EACH ROW EXECUTE FUNCTION public.guard_expense_claim_status();

-- 3e. Approver/retirer RPC (validates everything server-side too).
CREATE OR REPLACE FUNCTION public.approve_expense_claim(
  p_claim_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
  v_claim expense_claims%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;

  IF p_action NOT IN ('APPROVE', 'REJECT', 'RETIRE') THEN
    RAISE EXCEPTION 'Invalid action (APPROVE, REJECT or RETIRE expected)';
  END IF;

  IF NOT (public.has_privilege('expense.manage') OR public.has_privilege('expense.approve')) THEN
    RAISE EXCEPTION 'You need expense.manage or expense.approve to act on expense claims';
  END IF;

  SELECT * INTO v_claim FROM expense_claims WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense claim not found';
  END IF;

  IF v_actor = v_claim.requested_by THEN
    RAISE EXCEPTION 'You cannot approve, reject or retire a claim you raised';
  END IF;

  IF p_action = 'RETIRE' THEN
    IF v_claim.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Only approved claims can be retired';
    END IF;
    IF COALESCE(v_claim.proof_path, '') = '' THEN
      RAISE EXCEPTION 'A proof / invoice attachment is required to retire an expense claim';
    END IF;
    UPDATE expense_claims
       SET status = 'RETIRED', retired_by = v_actor, retired_at = now(),
           notes = COALESCE(p_note, notes), updated_at = now()
     WHERE id = v_claim.id;
  ELSIF p_action = 'APPROVE' THEN
    IF v_claim.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Only pending claims can be approved';
    END IF;
    UPDATE expense_claims
       SET status = 'APPROVED', approved_by = v_actor, approved_at = now(),
           notes = COALESCE(p_note, notes), updated_at = now()
     WHERE id = v_claim.id;
  ELSE
    IF v_claim.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Only pending claims can be rejected';
    END IF;
    UPDATE expense_claims
       SET status = 'REJECTED', rejected_by = v_actor, rejected_at = now(),
           notes = COALESCE(p_note, notes), updated_at = now()
     WHERE id = v_claim.id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_expense_claim(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_expense_claim(uuid, text, text) FROM PUBLIC;

-- 3f. Proof/invoice storage bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-proofs',
  'expense-proofs',
  false,
  15728640, -- 15 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- SELECT: the claimant, or anyone with expense approval/management rights.
DROP POLICY IF EXISTS expense_proofs_select ON storage.objects;
CREATE POLICY expense_proofs_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'expense-proofs'
    AND (
      owner = auth.uid()
      OR public.has_privilege('expense.manage')
      OR public.has_privilege('expense.approve')
      OR public.has_privilege('admin.settings')
      OR EXISTS (
            SELECT 1 FROM public.expense_claims ec
             WHERE ec.id = (storage.foldername(name))[1]::uuid
               AND ec.requested_by = public.current_employee_id()
          )
    )
  );

-- INSERT: the claimant into their own claim folder, or approvers anywhere.
DROP POLICY IF EXISTS expense_proofs_insert ON storage.objects;
CREATE POLICY expense_proofs_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'expense-proofs'
    AND (
      public.has_privilege('expense.manage')
      OR public.has_privilege('expense.approve')
      OR public.has_privilege('admin.settings')
      OR EXISTS (
            SELECT 1 FROM public.expense_claims ec
             WHERE ec.id = (storage.foldername(name))[1]::uuid
               AND ec.requested_by = public.current_employee_id()
          )
    )
  );

-- DELETE: the claimant or approvers.
DROP POLICY IF EXISTS expense_proofs_delete ON storage.objects;
CREATE POLICY expense_proofs_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'expense-proofs'
    AND (
      owner = auth.uid()
      OR public.has_privilege('expense.manage')
    )
  );