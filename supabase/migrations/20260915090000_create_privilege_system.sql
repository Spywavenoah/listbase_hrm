/*
# Privilege System — Row-Level Access Control

Implements a checkbox-based privilege system:

1. **Own-data by default** — employees can only read/write their own records on
   every HR module (employees, documents, leave, attendance, payslips, goals,
   enrollments, audit trail, etc.) plus read-only reference data (departments,
   positions, leave types, courses, holidays...).
2. **Explicit privileges** — admins grant additional access per employee via
   `employee_privileges` (assigned through the "Privileges & Access" screen,
   backed by the `set_employee_access` RPC).
3. **Implicit super admin** — `SUPER_ADMIN` always has every privilege.

## Schema changes
- `employees.user_id` (links a Supabase auth user to the employee record; backfilled by email)
- `privilege_definitions` — catalog of assignable privileges (drives the admin checkbox UI)
- `employee_privileges` — per-employee granted keys (employee_id, privilege_key)
- `employee_employment`, `employee_guarantors`, `employee_medical`,
  `employee_qualifications` — created IF NOT EXISTS (referenced by the app)

## Helpers
- `current_employee_id()` — id of the employee belonging to the current auth user
- `has_privilege(key)` — true for SUPER_ADMIN or when an explicit grant exists
- `has_any_privilege(keys)` — helper used by write policies
- `find_employee_for_setup(email)` — safe public path for the setup link screen
- `complete_employee_setup(employee_id)` — links auth user + moves employee to ONBOARDING
- `set_employee_access(employee_id, role, privileges[])` — admin RPC to grant privileges

## Security
All existing wide-open `USING (true)` policies are replaced with row-level,
privilege-aware policies referencing the helpers above.
*/

-- ============================================================
-- 1. Auth user linkage
-- ============================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE employees e
   SET user_id = u.id
  FROM auth.users u
 WHERE u.email = e.email
   AND e.user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id);

-- ============================================================
-- 2. Employee sub-records (created only if missing; app already references them)
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_employment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id uuid,
  position_id uuid,
  hire_date date,
  employment_type text,
  compensation_grade text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_employment_employee ON employee_employment(employee_id);

CREATE TABLE IF NOT EXISTS employee_guarantors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name text,
  relationship text,
  phone text,
  email text,
  address text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_guarantors_employee ON employee_guarantors(employee_id);

CREATE TABLE IF NOT EXISTS employee_medical (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  blood_group text,
  allergies jsonb,
  conditions jsonb,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_medical_employee ON employee_medical(employee_id);

CREATE TABLE IF NOT EXISTS employee_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text,
  institution text,
  year integer,
  document_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_qualifications_employee ON employee_qualifications(employee_id);

-- ============================================================
-- 3. Privilege catalog + assignments
-- ============================================================
CREATE TABLE IF NOT EXISTS privilege_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  category text NOT NULL,
  label text NOT NULL,
  description text,
  sort_order integer DEFAULT 0
);

ALTER TABLE privilege_definitions ENABLE ROW LEVEL SECURITY;

INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('employees.view_all', 'Employees', 'View all employees', 'Read contact, job and personal details of every employee', 10),
  ('employees.manage',   'Employees', 'Manage employees', 'Create, edit and delete any employee record', 20),
  ('employees.invite',   'Employees', 'Invite employees', 'Add employees and send account invitations', 30),
  ('organization.manage','Organization', 'Manage organization', 'Create and edit departments and positions', 40),
  ('recruitment.manage', 'Recruitment', 'Manage recruitment', 'Manage job postings and candidates', 50),
  ('attendance.manage',  'Attendance', 'Manage attendance', 'View and edit every employee attendance and timesheets', 60),
  ('leave.manage',       'Leave', 'Manage leave requests', 'View, approve and edit all leave requests', 70),
  ('leave.settings',     'Leave', 'Manage leave settings', 'Configure leave types and holiday calendar', 80),
  ('payroll.manage',     'Payroll', 'Manage payroll', 'Create payroll runs and generate payslips', 90),
  ('payroll.settings',   'Payroll', 'Manage pay components', 'Configure earnings and deduction components', 100),
  ('performance.manage', 'Performance', 'Manage performance', 'View and manage all reviews and goals', 110),
  ('training.manage',    'Training', 'Manage training', 'Manage courses and enrollments', 120),
  ('assets.manage',      'Assets', 'Manage assets', 'Manage the asset catalog and assignments', 130),
  ('admin.settings',     'Admin & System', 'System settings', 'Company profile, branding, email, payments, workflows and field builder', 140),
  ('admin.audit',        'Admin & System', 'View audit log', 'Read the full audit trail and employee timelines', 150),
  ('admin.reports',      'Admin & System', 'Report builder', 'Build custom reports across modules', 160),
  ('admin.privileges',   'Admin & System', 'Manage access', 'Assign privileges and roles to employees', 170)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS employee_privileges (
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  privilege_key text NOT NULL REFERENCES privilege_definitions(key) ON DELETE CASCADE,
  granted_by uuid,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (employee_id, privilege_key)
);

ALTER TABLE employee_privileges ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_employee_privileges_emp ON employee_privileges(employee_id);

-- ============================================================
-- 4. Helper functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
    FROM employees e
   WHERE e.user_id = auth.uid()
      OR (auth.jwt() ->> 'email' IS NOT NULL AND e.email = auth.jwt() ->> 'email')
   ORDER BY CASE WHEN e.user_id = auth.uid() THEN 0 ELSE 1 END
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_privilege(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM employees e
     WHERE (e.user_id = auth.uid()
            OR (auth.jwt() ->> 'email' IS NOT NULL AND e.email = auth.jwt() ->> 'email'))
       AND (e.role = 'SUPER_ADMIN'
            OR EXISTS (
                  SELECT 1 FROM employee_privileges ep
                   WHERE ep.employee_id = e.id AND ep.privilege_key = p_key
                ))
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_privilege(p_keys text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM employees e
     WHERE (e.user_id = auth.uid()
            OR (auth.jwt() ->> 'email' IS NOT NULL AND e.email = auth.jwt() ->> 'email'))
       AND (e.role = 'SUPER_ADMIN'
            OR EXISTS (
                  SELECT 1 FROM employee_privileges ep
                   WHERE ep.employee_id = e.id AND ep.privilege_key = ANY(p_keys)
                ))
  );
$$;

-- Safe lookup for the public setup-link screen (no PII beyond basics,
-- only PENDING_VERIFICATION / ONBOARDING employees are exposed).
CREATE OR REPLACE FUNCTION public.find_employee_for_setup(p_email text)
RETURNS TABLE (id uuid, first_name text, last_name text, email text, employment_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.first_name, e.last_name, e.email, e.employment_status
    FROM employees e
   WHERE e.email = p_email
     AND e.employment_status IN ('PENDING_VERIFICATION', 'ONBOARDING')
   LIMIT 1;
$$;

-- Called after sign-up on the setup screen. Links the auth user to the employee
-- and advances their status. Only the person whose email matches their own auth
-- session can complete setup for a record that is still pending/onboarding.
CREATE OR REPLACE FUNCTION public.complete_employee_setup(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_email text;
BEGIN
  v_email := auth.jwt() ->> 'email';
  IF v_email IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to complete setup';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employees e
     WHERE e.id = p_employee_id
       AND e.email = v_email
       AND e.employment_status IN ('PENDING_VERIFICATION', 'ONBOARDING')
  ) THEN
    RAISE EXCEPTION 'This setup link is no longer valid for your account';
  END IF;

  UPDATE employees
     SET employment_status = 'ONBOARDING',
         user_id = auth.uid(),
         updated_at = now()
   WHERE id = p_employee_id;
END;
$$;

-- Admin RPC: replace an employee's role and privilege set atomically.
-- Only callers holding the admin.privileges grant (or SUPER_ADMIN) may use it.
CREATE OR REPLACE FUNCTION public.set_employee_access(
  p_employee_id uuid,
  p_role text DEFAULT 'EMPLOYEE',
  p_privileges text[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := public.current_employee_id();
  v_caller_role text;
  v_target_role text;
  v_valid_roles text[] := ARRAY['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'];
  v_super_admin_count integer;
BEGIN
  IF NOT public.has_privilege('admin.privileges') THEN
    RAISE EXCEPTION 'You do not have permission to manage access';
  END IF;

  IF p_role IS NULL OR NOT (p_role = ANY(v_valid_roles)) THEN
    RAISE EXCEPTION 'Invalid role provided';
  END IF;

  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;
  SELECT role INTO v_target_role FROM employees WHERE id = p_employee_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Only a SUPER_ADMIN can change a SUPER_ADMIN account
  IF v_target_role = 'SUPER_ADMIN' AND COALESCE(v_caller_role, '') <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Only a SUPER_ADMIN can modify another SUPER_ADMIN';
  END IF;

  -- Only a SUPER_ADMIN can create SUPER_ADMINs
  IF p_role = 'SUPER_ADMIN' AND COALESCE(v_caller_role, '') <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Only a SUPER_ADMIN can grant the SUPER_ADMIN role';
  END IF;

  -- Never demote / revoke access from the last remaining SUPER_ADMIN
  IF v_target_role = 'SUPER_ADMIN' AND p_role <> 'SUPER_ADMIN' THEN
    SELECT count(*) INTO v_super_admin_count FROM employees WHERE role = 'SUPER_ADMIN';
    IF v_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last SUPER_ADMIN';
    END IF;
  END IF;

  UPDATE employees SET role = p_role, updated_at = now() WHERE id = p_employee_id;

  DELETE FROM employee_privileges WHERE employee_id = p_employee_id;

  IF p_privileges IS NOT NULL AND cardinality(p_privileges) > 0 THEN
    INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
    SELECT p_employee_id, pk, v_caller_id
      FROM unnest(p_privileges) AS pk
     WHERE EXISTS (SELECT 1 FROM privilege_definitions pd WHERE pd.key = pk);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_employee_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_privilege(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_privilege(text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_employee_for_setup(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_employee_setup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_access(uuid, text, text[]) TO authenticated;

-- Defense in depth: the access-manager and setup RPCs must not be callable by
-- anonymous users (they are still guarded inside, but revoke PUBLIC execution).
REVOKE EXECUTE ON FUNCTION public.complete_employee_setup(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_employee_access(uuid, text, text[]) FROM PUBLIC;

-- ============================================================
-- 5. Policy helpers (shortcuts used below)
--     own <records>        -> employee_id = current_employee_id()
--     have <key>           -> has_privilege('<key>')
--     admin                -> has_privilege('admin.settings')
-- ============================================================

-- ------------------------------------------------------------
-- system_settings
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_system_settings" ON system_settings;
DROP POLICY IF EXISTS "insert_system_settings" ON system_settings;
DROP POLICY IF EXISTS "update_system_settings" ON system_settings;
DROP POLICY IF EXISTS "delete_system_settings" ON system_settings;
CREATE POLICY "select_system_settings" ON system_settings FOR SELECT TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "insert_system_settings" ON system_settings FOR INSERT TO authenticated WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_system_settings" ON system_settings FOR UPDATE TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "delete_system_settings" ON system_settings FOR DELETE TO authenticated USING (public.has_privilege('admin.settings'));

-- ------------------------------------------------------------
-- mail_templates
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_mail_templates" ON mail_templates;
DROP POLICY IF EXISTS "insert_mail_templates" ON mail_templates;
DROP POLICY IF EXISTS "update_mail_templates" ON mail_templates;
DROP POLICY IF EXISTS "delete_mail_templates" ON mail_templates;
CREATE POLICY "select_mail_templates" ON mail_templates FOR SELECT TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "insert_mail_templates" ON mail_templates FOR INSERT TO authenticated WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_mail_templates" ON mail_templates FOR UPDATE TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "delete_mail_templates" ON mail_templates FOR DELETE TO authenticated USING (public.has_privilege('admin.settings'));

-- ------------------------------------------------------------
-- field_definitions (readable by all auth users: drives forms)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_field_definitions" ON field_definitions;
DROP POLICY IF EXISTS "insert_field_definitions" ON field_definitions;
DROP POLICY IF EXISTS "update_field_definitions" ON field_definitions;
DROP POLICY IF EXISTS "delete_field_definitions" ON field_definitions;
CREATE POLICY "select_field_definitions" ON field_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_field_definitions" ON field_definitions FOR INSERT TO authenticated WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_field_definitions" ON field_definitions FOR UPDATE TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "delete_field_definitions" ON field_definitions FOR DELETE TO authenticated USING (public.has_privilege('admin.settings'));

-- ------------------------------------------------------------
-- field_values
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_field_values" ON field_values;
DROP POLICY IF EXISTS "insert_field_values" ON field_values;
DROP POLICY IF EXISTS "update_field_values" ON field_values;
DROP POLICY IF EXISTS "delete_field_values" ON field_values;
CREATE POLICY "select_field_values" ON field_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_field_values" ON field_values FOR INSERT TO authenticated WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_field_values" ON field_values FOR UPDATE TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "delete_field_values" ON field_values FOR DELETE TO authenticated USING (public.has_privilege('admin.settings'));

-- ------------------------------------------------------------
-- departments
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_departments" ON departments;
DROP POLICY IF EXISTS "insert_departments" ON departments;
DROP POLICY IF EXISTS "update_departments" ON departments;
DROP POLICY IF EXISTS "delete_departments" ON departments;
CREATE POLICY "select_departments" ON departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_departments" ON departments FOR INSERT TO authenticated WITH CHECK (public.has_privilege('organization.manage'));
CREATE POLICY "update_departments" ON departments FOR UPDATE TO authenticated USING (public.has_privilege('organization.manage'));
CREATE POLICY "delete_departments" ON departments FOR DELETE TO authenticated USING (public.has_privilege('organization.manage'));

-- ------------------------------------------------------------
-- positions
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_positions" ON positions;
DROP POLICY IF EXISTS "insert_positions" ON positions;
DROP POLICY IF EXISTS "update_positions" ON positions;
DROP POLICY IF EXISTS "delete_positions" ON positions;
CREATE POLICY "select_positions" ON positions FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_positions" ON positions FOR INSERT TO authenticated WITH CHECK (public.has_privilege('organization.manage'));
CREATE POLICY "update_positions" ON positions FOR UPDATE TO authenticated USING (public.has_privilege('organization.manage'));
CREATE POLICY "delete_positions" ON positions FOR DELETE TO authenticated USING (public.has_privilege('organization.manage'));

-- ------------------------------------------------------------
-- employees
--   select: own row OR employees.view_all/manage/invite
--   insert: employees.manage OR employees.invite
--   update: own row (role cannot change) OR employees.manage
--   delete: employees.manage
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_employees" ON employees;
DROP POLICY IF EXISTS "insert_employees" ON employees;
DROP POLICY IF EXISTS "update_employees" ON employees;
DROP POLICY IF EXISTS "delete_employees" ON employees;
CREATE POLICY "select_employees" ON employees FOR SELECT TO authenticated
  USING (id = public.current_employee_id()
         OR public.has_any_privilege(ARRAY['employees.view_all', 'employees.manage', 'employees.invite', 'admin.privileges']));
CREATE POLICY "insert_employees" ON employees FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['employees.manage', 'employees.invite']));
CREATE POLICY "update_employees" ON employees FOR UPDATE TO authenticated
  USING (id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (public.has_privilege('employees.manage')
              OR (id = public.current_employee_id()
                  AND role = (SELECT e.role FROM employees e WHERE e.id = public.current_employee_id())));
CREATE POLICY "delete_employees" ON employees FOR DELETE TO authenticated
  USING (public.has_privilege('employees.manage'));

-- ------------------------------------------------------------
-- employee sub-records (own OR employees.manage)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_employee_documents" ON employee_documents;
DROP POLICY IF EXISTS "insert_employee_documents" ON employee_documents;
DROP POLICY IF EXISTS "update_employee_documents" ON employee_documents;
DROP POLICY IF EXISTS "delete_employee_documents" ON employee_documents;
CREATE POLICY "select_employee_documents" ON employee_documents FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.view_all'));
CREATE POLICY "insert_employee_documents" ON employee_documents FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "update_employee_documents" ON employee_documents FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "delete_employee_documents" ON employee_documents FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

DROP POLICY IF EXISTS "select_employee_employment" ON employee_employment;
DROP POLICY IF EXISTS "insert_employee_employment" ON employee_employment;
DROP POLICY IF EXISTS "update_employee_employment" ON employee_employment;
DROP POLICY IF EXISTS "delete_employee_employment" ON employee_employment;
CREATE POLICY "select_employee_employment" ON employee_employment FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.view_all'));
CREATE POLICY "insert_employee_employment" ON employee_employment FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "update_employee_employment" ON employee_employment FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "delete_employee_employment" ON employee_employment FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

DROP POLICY IF EXISTS "select_employee_guarantors" ON employee_guarantors;
DROP POLICY IF EXISTS "insert_employee_guarantors" ON employee_guarantors;
DROP POLICY IF EXISTS "update_employee_guarantors" ON employee_guarantors;
DROP POLICY IF EXISTS "delete_employee_guarantors" ON employee_guarantors;
CREATE POLICY "select_employee_guarantors" ON employee_guarantors FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.view_all'));
CREATE POLICY "insert_employee_guarantors" ON employee_guarantors FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "update_employee_guarantors" ON employee_guarantors FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "delete_employee_guarantors" ON employee_guarantors FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

DROP POLICY IF EXISTS "select_employee_medical" ON employee_medical;
DROP POLICY IF EXISTS "insert_employee_medical" ON employee_medical;
DROP POLICY IF EXISTS "update_employee_medical" ON employee_medical;
DROP POLICY IF EXISTS "delete_employee_medical" ON employee_medical;
CREATE POLICY "select_employee_medical" ON employee_medical FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.view_all'));
CREATE POLICY "insert_employee_medical" ON employee_medical FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "update_employee_medical" ON employee_medical FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "delete_employee_medical" ON employee_medical FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

DROP POLICY IF EXISTS "select_employee_qualifications" ON employee_qualifications;
DROP POLICY IF EXISTS "insert_employee_qualifications" ON employee_qualifications;
DROP POLICY IF EXISTS "update_employee_qualifications" ON employee_qualifications;
DROP POLICY IF EXISTS "delete_employee_qualifications" ON employee_qualifications;
CREATE POLICY "select_employee_qualifications" ON employee_qualifications FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.view_all'));
CREATE POLICY "insert_employee_qualifications" ON employee_qualifications FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "update_employee_qualifications" ON employee_qualifications FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "delete_employee_qualifications" ON employee_qualifications FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

-- ------------------------------------------------------------
-- onboarding_templates / onboarding_steps
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_onboarding_templates" ON onboarding_templates;
DROP POLICY IF EXISTS "insert_onboarding_templates" ON onboarding_templates;
DROP POLICY IF EXISTS "update_onboarding_templates" ON onboarding_templates;
DROP POLICY IF EXISTS "delete_onboarding_templates" ON onboarding_templates;
CREATE POLICY "select_onboarding_templates" ON onboarding_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_onboarding_templates" ON onboarding_templates FOR INSERT TO authenticated WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_onboarding_templates" ON onboarding_templates FOR UPDATE TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "delete_onboarding_templates" ON onboarding_templates FOR DELETE TO authenticated USING (public.has_privilege('admin.settings'));

DROP POLICY IF EXISTS "select_onboarding_steps" ON onboarding_steps;
DROP POLICY IF EXISTS "insert_onboarding_steps" ON onboarding_steps;
DROP POLICY IF EXISTS "update_onboarding_steps" ON onboarding_steps;
DROP POLICY IF EXISTS "delete_onboarding_steps" ON onboarding_steps;
CREATE POLICY "select_onboarding_steps" ON onboarding_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_onboarding_steps" ON onboarding_steps FOR INSERT TO authenticated WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_onboarding_steps" ON onboarding_steps FOR UPDATE TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "delete_onboarding_steps" ON onboarding_steps FOR DELETE TO authenticated USING (public.has_privilege('admin.settings'));

-- ------------------------------------------------------------
-- employee_onboarding_progress
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_onboarding_progress" ON employee_onboarding_progress;
DROP POLICY IF EXISTS "insert_onboarding_progress" ON employee_onboarding_progress;
DROP POLICY IF EXISTS "update_onboarding_progress" ON employee_onboarding_progress;
DROP POLICY IF EXISTS "delete_onboarding_progress" ON employee_onboarding_progress;
CREATE POLICY "select_onboarding_progress" ON employee_onboarding_progress FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "insert_onboarding_progress" ON employee_onboarding_progress FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "update_onboarding_progress" ON employee_onboarding_progress FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));
CREATE POLICY "delete_onboarding_progress" ON employee_onboarding_progress FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

-- ------------------------------------------------------------
-- workflow_* / module_workflow_config
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_workflow_definitions" ON workflow_definitions;
DROP POLICY IF EXISTS "insert_workflow_definitions" ON workflow_definitions;
DROP POLICY IF EXISTS "update_workflow_definitions" ON workflow_definitions;
DROP POLICY IF EXISTS "delete_workflow_definitions" ON workflow_definitions;
CREATE POLICY "select_workflow_definitions" ON workflow_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_workflow_definitions" ON workflow_definitions FOR INSERT TO authenticated WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_workflow_definitions" ON workflow_definitions FOR UPDATE TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "delete_workflow_definitions" ON workflow_definitions FOR DELETE TO authenticated USING (public.has_privilege('admin.settings'));

DROP POLICY IF EXISTS "select_workflow_steps" ON workflow_steps;
DROP POLICY IF EXISTS "insert_workflow_steps" ON workflow_steps;
DROP POLICY IF EXISTS "update_workflow_steps" ON workflow_steps;
DROP POLICY IF EXISTS "delete_workflow_steps" ON workflow_steps;
CREATE POLICY "select_workflow_steps" ON workflow_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_workflow_steps" ON workflow_steps FOR INSERT TO authenticated WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_workflow_steps" ON workflow_steps FOR UPDATE TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "delete_workflow_steps" ON workflow_steps FOR DELETE TO authenticated USING (public.has_privilege('admin.settings'));

DROP POLICY IF EXISTS "select_workflow_instances" ON workflow_instances;
DROP POLICY IF EXISTS "insert_workflow_instances" ON workflow_instances;
DROP POLICY IF EXISTS "update_workflow_instances" ON workflow_instances;
DROP POLICY IF EXISTS "delete_workflow_instances" ON workflow_instances;
CREATE POLICY "select_workflow_instances" ON workflow_instances FOR SELECT TO authenticated
  USING (initiated_by = public.current_employee_id() OR public.has_privilege('admin.settings'));
CREATE POLICY "insert_workflow_instances" ON workflow_instances FOR INSERT TO authenticated
  WITH CHECK (initiated_by = public.current_employee_id() OR public.has_privilege('admin.settings'));
CREATE POLICY "update_workflow_instances" ON workflow_instances FOR UPDATE TO authenticated
  USING (initiated_by = public.current_employee_id() OR public.has_privilege('admin.settings'))
  WITH CHECK (initiated_by = public.current_employee_id() OR public.has_privilege('admin.settings'));
CREATE POLICY "delete_workflow_instances" ON workflow_instances FOR DELETE TO authenticated
  USING (public.has_privilege('admin.settings'));

DROP POLICY IF EXISTS "select_workflow_actions" ON workflow_actions;
DROP POLICY IF EXISTS "insert_workflow_actions" ON workflow_actions;
DROP POLICY IF EXISTS "update_workflow_actions" ON workflow_actions;
DROP POLICY IF EXISTS "delete_workflow_actions" ON workflow_actions;
CREATE POLICY "select_workflow_actions" ON workflow_actions FOR SELECT TO authenticated
  USING (actor_id = public.current_employee_id() OR public.has_privilege('admin.settings'));
CREATE POLICY "insert_workflow_actions" ON workflow_actions FOR INSERT TO authenticated
  WITH CHECK (actor_id = public.current_employee_id() OR public.has_privilege('admin.settings'));
CREATE POLICY "update_workflow_actions" ON workflow_actions FOR UPDATE TO authenticated
  USING (actor_id = public.current_employee_id() OR public.has_privilege('admin.settings'));
CREATE POLICY "delete_workflow_actions" ON workflow_actions FOR DELETE TO authenticated
  USING (public.has_privilege('admin.settings'));

DROP POLICY IF EXISTS "select_module_workflow_config" ON module_workflow_config;
DROP POLICY IF EXISTS "insert_module_workflow_config" ON module_workflow_config;
DROP POLICY IF EXISTS "update_module_workflow_config" ON module_workflow_config;
DROP POLICY IF EXISTS "delete_module_workflow_config" ON module_workflow_config;
CREATE POLICY "select_module_workflow_config" ON module_workflow_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_module_workflow_config" ON module_workflow_config FOR INSERT TO authenticated WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_module_workflow_config" ON module_workflow_config FOR UPDATE TO authenticated USING (public.has_privilege('admin.settings'));
CREATE POLICY "delete_module_workflow_config" ON module_workflow_config FOR DELETE TO authenticated USING (public.has_privilege('admin.settings'));

-- ------------------------------------------------------------
-- audit_log (select: own activity / own record / admin.audit)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_audit_log" ON audit_log;
DROP POLICY IF EXISTS "insert_audit_log" ON audit_log;
CREATE POLICY "select_audit_log" ON audit_log FOR SELECT TO authenticated
  USING (actor_id = public.current_employee_id()
         OR (module_key = 'employee' AND record_id = public.current_employee_id())
         OR public.has_privilege('admin.audit'));
CREATE POLICY "insert_audit_log" ON audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- ------------------------------------------------------------
-- leave_types / leave_requests / holidays
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_leave_types" ON leave_types;
DROP POLICY IF EXISTS "insert_leave_types" ON leave_types;
DROP POLICY IF EXISTS "update_leave_types" ON leave_types;
DROP POLICY IF EXISTS "delete_leave_types" ON leave_types;
CREATE POLICY "select_leave_types" ON leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_leave_types" ON leave_types FOR INSERT TO authenticated WITH CHECK (public.has_privilege('leave.settings'));
CREATE POLICY "update_leave_types" ON leave_types FOR UPDATE TO authenticated USING (public.has_privilege('leave.settings'));
CREATE POLICY "delete_leave_types" ON leave_types FOR DELETE TO authenticated USING (public.has_privilege('leave.settings'));

DROP POLICY IF EXISTS "select_leave_requests" ON leave_requests;
DROP POLICY IF EXISTS "insert_leave_requests" ON leave_requests;
DROP POLICY IF EXISTS "update_leave_requests" ON leave_requests;
DROP POLICY IF EXISTS "delete_leave_requests" ON leave_requests;
CREATE POLICY "select_leave_requests" ON leave_requests FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'));
CREATE POLICY "insert_leave_requests" ON leave_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'));
CREATE POLICY "update_leave_requests" ON leave_requests FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'));
CREATE POLICY "delete_leave_requests" ON leave_requests FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'));

DROP POLICY IF EXISTS "select_holidays" ON holidays;
DROP POLICY IF EXISTS "insert_holidays" ON holidays;
DROP POLICY IF EXISTS "update_holidays" ON holidays;
DROP POLICY IF EXISTS "delete_holidays" ON holidays;
CREATE POLICY "select_holidays" ON holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_holidays" ON holidays FOR INSERT TO authenticated WITH CHECK (public.has_privilege('leave.settings'));
CREATE POLICY "update_holidays" ON holidays FOR UPDATE TO authenticated USING (public.has_privilege('leave.settings'));
CREATE POLICY "delete_holidays" ON holidays FOR DELETE TO authenticated USING (public.has_privilege('leave.settings'));

-- ------------------------------------------------------------
-- attendance
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_attendance" ON attendance;
DROP POLICY IF EXISTS "insert_attendance" ON attendance;
DROP POLICY IF EXISTS "update_attendance" ON attendance;
DROP POLICY IF EXISTS "delete_attendance" ON attendance;
CREATE POLICY "select_attendance" ON attendance FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('attendance.manage'));
CREATE POLICY "insert_attendance" ON attendance FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('attendance.manage'));
CREATE POLICY "update_attendance" ON attendance FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('attendance.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('attendance.manage'));
CREATE POLICY "delete_attendance" ON attendance FOR DELETE TO authenticated
  USING (public.has_privilege('attendance.manage'));

-- ------------------------------------------------------------
-- assets
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_assets" ON assets;
DROP POLICY IF EXISTS "insert_assets" ON assets;
DROP POLICY IF EXISTS "update_assets" ON assets;
DROP POLICY IF EXISTS "delete_assets" ON assets;
CREATE POLICY "select_assets" ON assets FOR SELECT TO authenticated
  USING (assigned_to = public.current_employee_id() OR public.has_privilege('assets.manage'));
CREATE POLICY "insert_assets" ON assets FOR INSERT TO authenticated WITH CHECK (public.has_privilege('assets.manage'));
CREATE POLICY "update_assets" ON assets FOR UPDATE TO authenticated USING (public.has_privilege('assets.manage'));
CREATE POLICY "delete_assets" ON assets FOR DELETE TO authenticated USING (public.has_privilege('assets.manage'));

-- ------------------------------------------------------------
-- pay_components / payroll_runs / payslips
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_pay_components" ON pay_components;
DROP POLICY IF EXISTS "insert_pay_components" ON pay_components;
DROP POLICY IF EXISTS "update_pay_components" ON pay_components;
DROP POLICY IF EXISTS "delete_pay_components" ON pay_components;
CREATE POLICY "select_pay_components" ON pay_components FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_pay_components" ON pay_components FOR INSERT TO authenticated WITH CHECK (public.has_privilege('payroll.settings'));
CREATE POLICY "update_pay_components" ON pay_components FOR UPDATE TO authenticated USING (public.has_privilege('payroll.settings'));
CREATE POLICY "delete_pay_components" ON pay_components FOR DELETE TO authenticated USING (public.has_privilege('payroll.settings'));

DROP POLICY IF EXISTS "select_payroll_runs" ON payroll_runs;
DROP POLICY IF EXISTS "insert_payroll_runs" ON payroll_runs;
DROP POLICY IF EXISTS "update_payroll_runs" ON payroll_runs;
DROP POLICY IF EXISTS "delete_payroll_runs" ON payroll_runs;
CREATE POLICY "select_payroll_runs" ON payroll_runs FOR SELECT TO authenticated USING (public.has_privilege('payroll.manage'));
CREATE POLICY "insert_payroll_runs" ON payroll_runs FOR INSERT TO authenticated WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "update_payroll_runs" ON payroll_runs FOR UPDATE TO authenticated USING (public.has_privilege('payroll.manage'));
CREATE POLICY "delete_payroll_runs" ON payroll_runs FOR DELETE TO authenticated USING (public.has_privilege('payroll.manage'));

DROP POLICY IF EXISTS "select_payslips" ON payslips;
DROP POLICY IF EXISTS "insert_payslips" ON payslips;
DROP POLICY IF EXISTS "update_payslips" ON payslips;
DROP POLICY IF EXISTS "delete_payslips" ON payslips;
CREATE POLICY "select_payslips" ON payslips FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('payroll.manage'));
CREATE POLICY "insert_payslips" ON payslips FOR INSERT TO authenticated WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "update_payslips" ON payslips FOR UPDATE TO authenticated USING (public.has_privilege('payroll.manage'));
CREATE POLICY "delete_payslips" ON payslips FOR DELETE TO authenticated USING (public.has_privilege('payroll.manage'));

-- ------------------------------------------------------------
-- recruitment_jobs / candidates
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_recruitment_jobs" ON recruitment_jobs;
DROP POLICY IF EXISTS "insert_recruitment_jobs" ON recruitment_jobs;
DROP POLICY IF EXISTS "update_recruitment_jobs" ON recruitment_jobs;
DROP POLICY IF EXISTS "delete_recruitment_jobs" ON recruitment_jobs;
CREATE POLICY "select_recruitment_jobs" ON recruitment_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_recruitment_jobs" ON recruitment_jobs FOR INSERT TO authenticated WITH CHECK (public.has_privilege('recruitment.manage'));
CREATE POLICY "update_recruitment_jobs" ON recruitment_jobs FOR UPDATE TO authenticated USING (public.has_privilege('recruitment.manage'));
CREATE POLICY "delete_recruitment_jobs" ON recruitment_jobs FOR DELETE TO authenticated USING (public.has_privilege('recruitment.manage'));

DROP POLICY IF EXISTS "select_candidates" ON candidates;
DROP POLICY IF EXISTS "insert_candidates" ON candidates;
DROP POLICY IF EXISTS "update_candidates" ON candidates;
DROP POLICY IF EXISTS "delete_candidates" ON candidates;
CREATE POLICY "select_candidates" ON candidates FOR SELECT TO authenticated USING (public.has_privilege('recruitment.manage'));
CREATE POLICY "insert_candidates" ON candidates FOR INSERT TO authenticated WITH CHECK (public.has_privilege('recruitment.manage'));
CREATE POLICY "update_candidates" ON candidates FOR UPDATE TO authenticated USING (public.has_privilege('recruitment.manage'));
CREATE POLICY "delete_candidates" ON candidates FOR DELETE TO authenticated USING (public.has_privilege('recruitment.manage'));

-- ------------------------------------------------------------
-- performance_reviews / performance_goals
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_performance_reviews" ON performance_reviews;
DROP POLICY IF EXISTS "insert_performance_reviews" ON performance_reviews;
DROP POLICY IF EXISTS "update_performance_reviews" ON performance_reviews;
DROP POLICY IF EXISTS "delete_performance_reviews" ON performance_reviews;
CREATE POLICY "select_performance_reviews" ON performance_reviews FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('performance.manage'));
CREATE POLICY "insert_performance_reviews" ON performance_reviews FOR INSERT TO authenticated WITH CHECK (public.has_privilege('performance.manage'));
CREATE POLICY "update_performance_reviews" ON performance_reviews FOR UPDATE TO authenticated USING (public.has_privilege('performance.manage'));
CREATE POLICY "delete_performance_reviews" ON performance_reviews FOR DELETE TO authenticated USING (public.has_privilege('performance.manage'));

DROP POLICY IF EXISTS "select_performance_goals" ON performance_goals;
DROP POLICY IF EXISTS "insert_performance_goals" ON performance_goals;
DROP POLICY IF EXISTS "update_performance_goals" ON performance_goals;
DROP POLICY IF EXISTS "delete_performance_goals" ON performance_goals;
CREATE POLICY "select_performance_goals" ON performance_goals FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('performance.manage'));
CREATE POLICY "insert_performance_goals" ON performance_goals FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('performance.manage'));
CREATE POLICY "update_performance_goals" ON performance_goals FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('performance.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('performance.manage'));
CREATE POLICY "delete_performance_goals" ON performance_goals FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('performance.manage'));

-- ------------------------------------------------------------
-- training_courses / training_enrollments
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_training_courses" ON training_courses;
DROP POLICY IF EXISTS "insert_training_courses" ON training_courses;
DROP POLICY IF EXISTS "update_training_courses" ON training_courses;
DROP POLICY IF EXISTS "delete_training_courses" ON training_courses;
CREATE POLICY "select_training_courses" ON training_courses FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_training_courses" ON training_courses FOR INSERT TO authenticated WITH CHECK (public.has_privilege('training.manage'));
CREATE POLICY "update_training_courses" ON training_courses FOR UPDATE TO authenticated USING (public.has_privilege('training.manage'));
CREATE POLICY "delete_training_courses" ON training_courses FOR DELETE TO authenticated USING (public.has_privilege('training.manage'));

DROP POLICY IF EXISTS "select_training_enrollments" ON training_enrollments;
DROP POLICY IF EXISTS "insert_training_enrollments" ON training_enrollments;
DROP POLICY IF EXISTS "update_training_enrollments" ON training_enrollments;
DROP POLICY IF EXISTS "delete_training_enrollments" ON training_enrollments;
CREATE POLICY "select_training_enrollments" ON training_enrollments FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('training.manage'));
CREATE POLICY "insert_training_enrollments" ON training_enrollments FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('training.manage'));
CREATE POLICY "update_training_enrollments" ON training_enrollments FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('training.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('training.manage'));
CREATE POLICY "delete_training_enrollments" ON training_enrollments FOR DELETE TO authenticated
  USING (public.has_privilege('training.manage'));

-- ------------------------------------------------------------
-- notification_queue (SELECT: own email or admin; INSERT: any auth user)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_notification_queue" ON notification_queue;
DROP POLICY IF EXISTS "insert_notification_queue" ON notification_queue;
DROP POLICY IF EXISTS "update_notification_queue" ON notification_queue;
DROP POLICY IF EXISTS "delete_notification_queue" ON notification_queue;
CREATE POLICY "select_notification_queue" ON notification_queue FOR SELECT TO authenticated
  USING (recipient_email = (auth.jwt() ->> 'email') OR public.has_privilege('admin.settings'));
CREATE POLICY "insert_notification_queue" ON notification_queue FOR INSERT TO authenticated WITH CHECK (true);

-- ------------------------------------------------------------
-- privilege_definitions (readable by all auth users so the access UI can render)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_privilege_definitions" ON privilege_definitions;
CREATE POLICY "select_privilege_definitions" ON privilege_definitions FOR SELECT TO authenticated USING (true);

-- ------------------------------------------------------------
-- employee_privileges (SELECT: own grants or admin.privileges; writes only via RPC)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_employee_privileges" ON employee_privileges;
CREATE POLICY "select_employee_privileges" ON employee_privileges FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('admin.privileges'));

-- ============================================================
-- 6. RLS enable on newly created tables
-- ============================================================
ALTER TABLE employee_employment     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_guarantors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_medical        ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_qualifications ENABLE ROW LEVEL SECURITY;