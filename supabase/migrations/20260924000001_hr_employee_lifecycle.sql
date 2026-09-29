-- ===========================================================================
-- HR Employee Lifecycle Management System - COMPLETE migration (merged)
-- Combines the former 20260924000001 - 20260924000009 migration files.
-- Safe to re-run: all DDL is IF NOT EXISTS / CREATE OR REPLACE,
-- all seeds are ON CONFLICT-guarded or WHERE NOT EXISTS.
-- ===========================================================================

-- ===========================================================================
-- Source: 20260924000001_hr_employee_lifecycle.sql
-- ===========================================================================

/*
# HR Employee Lifecycle — Phase 2 (Employee Master + Organization)

Adds what the Employee Lifecycle spec needs at the master-record level:

1. `grade_levels` — structured, configurable grade/band ladder (seeded GL 01–17).
2. `employees` — new personal & employment columns:
   - personal: marital status, nationality, state of origin, LGA, residential vs
     permanent address, blood group / genotype, disability info.
   - employment: staff category, `grade_level_id` (structured grade), confirmation
     date, contract type + expiry, retirement date.
3. `employee_emergency_contacts` — multiple emergency contacts (replaces the two
   legacy single-contact columns without migrating/dropping them).
4. `employee_history` — append-only employment history (hire, promotions,
   transfers, salary changes, status & contract changes). Populated
   automatically by triggers on `employees` insert/update, so every career
   change is versioned even when the client updates the record directly.
5. RLS mirrors the employee-detail pattern: select = self or
   `employees.view_all`; write = `employees.manage` only.
6. Extends the self-service compensation guard to the new structured grade.

Security:
- `employee_history` / `employee_emergency_contacts`: RLS self-or-manage read,
  `employees.manage` write.
- `grade_levels`: organization-manage write, authenticated read.
- The existing `prevent_self_service_salary_change` trigger now also blocks
  `grade_level_id` changes without `employees.manage`.
*/

-- ============================================================
-- 1. Grade levels (structured ladder)
-- ============================================================
CREATE TABLE IF NOT EXISTS grade_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  level integer NOT NULL UNIQUE,
  description text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE grade_levels ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.seed_grade_levels()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  FOR i IN 1..17 LOOP
    INSERT INTO grade_levels (name, level, sort_order)
    VALUES (format('GL %s', lpad(i::text, 2, '0')), i, i)
    ON CONFLICT (level) DO UPDATE
      SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;
  END LOOP;
END;
$$;
SELECT public.seed_grade_levels();

DROP POLICY IF EXISTS "select_grade_levels" ON grade_levels;
DROP POLICY IF EXISTS "insert_grade_levels" ON grade_levels;
DROP POLICY IF EXISTS "update_grade_levels" ON grade_levels;
DROP POLICY IF EXISTS "delete_grade_levels" ON grade_levels;
CREATE POLICY "select_grade_levels" ON grade_levels FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_grade_levels" ON grade_levels FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('organization.manage'));
CREATE POLICY "update_grade_levels" ON grade_levels FOR UPDATE TO authenticated
  USING (public.has_privilege('organization.manage'))
  WITH CHECK (public.has_privilege('organization.manage'));
CREATE POLICY "delete_grade_levels" ON grade_levels FOR DELETE TO authenticated
  USING (public.has_privilege('organization.manage'));

-- ============================================================
-- 2. Employees — new personal & employment columns
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS state_of_origin text,
  ADD COLUMN IF NOT EXISTS lga text,
  ADD COLUMN IF NOT EXISTS residential_address text,
  ADD COLUMN IF NOT EXISTS permanent_address text,
  ADD COLUMN IF NOT EXISTS blood_group text,
  ADD COLUMN IF NOT EXISTS genotype text,
  ADD COLUMN IF NOT EXISTS disability_status text,          -- 'NONE' | 'DISABLED'
  ADD COLUMN IF NOT EXISTS disability_details text,
  ADD COLUMN IF NOT EXISTS staff_category text,             -- EXECUTIVE | MANAGEMENT | SENIOR_STAFF | JUNIOR_STAFF | CONTRACT | INTERN | ADVISOR
  ADD COLUMN IF NOT EXISTS grade_level_id uuid REFERENCES grade_levels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmation_date date,
  ADD COLUMN IF NOT EXISTS contract_type text,              -- PERMANENT | CONTRACT | PROBATION | CASUAL | INTERN
  ADD COLUMN IF NOT EXISTS contract_expiry_date date,
  ADD COLUMN IF NOT EXISTS retirement_date date;

CREATE INDEX IF NOT EXISTS idx_employees_grade_level ON employees(grade_level_id);

-- ============================================================
-- 3. Multiple emergency contacts
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text,
  phone text,
  email text,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE employee_emergency_contacts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_emp_emergency_contacts_employee ON employee_emergency_contacts(employee_id);

DROP POLICY IF EXISTS "select_employee_emergency_contacts" ON employee_emergency_contacts;
DROP POLICY IF EXISTS "insert_employee_emergency_contacts" ON employee_emergency_contacts;
DROP POLICY IF EXISTS "update_employee_emergency_contacts" ON employee_emergency_contacts;
DROP POLICY IF EXISTS "delete_employee_emergency_contacts" ON employee_emergency_contacts;
CREATE POLICY "select_employee_emergency_contacts" ON employee_emergency_contacts FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id()
         OR public.has_privilege('employees.view_all')
         OR public.has_privilege('employees.manage'));
CREATE POLICY "insert_employee_emergency_contacts" ON employee_emergency_contacts FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('employees.manage'));
CREATE POLICY "update_employee_emergency_contacts" ON employee_emergency_contacts FOR UPDATE TO authenticated
  USING (public.has_privilege('employees.manage'))
  WITH CHECK (public.has_privilege('employees.manage'));
CREATE POLICY "delete_employee_emergency_contacts" ON employee_emergency_contacts FOR DELETE TO authenticated
  USING (public.has_privilege('employees.manage'));

-- ============================================================
-- 4. Employment history (append-only, trigger-fed)
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type text NOT NULL,   -- HIRE | PROMOTION | TRANSFER | SALARY_CHANGE | STATUS_CHANGE | CONTRACT_CHANGE | OTHER
  title text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  effective_date date,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE employee_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_employee_history_employee ON employee_history(employee_id, created_at);

DROP POLICY IF EXISTS "select_employee_history" ON employee_history;
DROP POLICY IF EXISTS "insert_employee_history" ON employee_history;
DROP POLICY IF EXISTS "update_employee_history" ON employee_history;
DROP POLICY IF EXISTS "delete_employee_history" ON employee_history;
CREATE POLICY "select_employee_history" ON employee_history FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id()
         OR public.has_privilege('employees.view_all')
         OR public.has_privilege('employees.manage'));
CREATE POLICY "insert_employee_history" ON employee_history FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('employees.manage'));
CREATE POLICY "update_employee_history" ON employee_history FOR UPDATE TO authenticated
  USING (public.has_privilege('employees.manage'))
  WITH CHECK (public.has_privilege('employees.manage'));
CREATE POLICY "delete_employee_history" ON employee_history FOR DELETE TO authenticated
  USING (public.has_privilege('employees.manage'));

-- ============================================================
-- 5. Trigger: log career changes automatically
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_employee_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.employee_history
      (employee_id, event_type, title, effective_date, created_by)
    VALUES
      (NEW.id, 'HIRE', 'Employee record created',
       COALESCE(NEW.hire_date, CURRENT_DATE), v_actor);
    RETURN NEW;
  END IF;

  IF NEW.employment_status IS DISTINCT FROM OLD.employment_status THEN
    INSERT INTO public.employee_history
      (employee_id, event_type, title, description, metadata, effective_date, created_by)
    VALUES
      (NEW.id, 'STATUS_CHANGE',
       'Employment status changed',
       format('Changed from %s to %s', COALESCE(OLD.employment_status, '—'), COALESCE(NEW.employment_status, '—')),
       jsonb_build_object('old', OLD.employment_status, 'new', NEW.employment_status),
       CURRENT_DATE, v_actor);
  END IF;

  IF NEW.employment_type IS DISTINCT FROM OLD.employment_type
     OR NEW.contract_type IS DISTINCT FROM OLD.contract_type
     OR NEW.contract_expiry_date IS DISTINCT FROM OLD.contract_expiry_date THEN
    INSERT INTO public.employee_history
      (employee_id, event_type, title, description, metadata, effective_date, created_by)
    VALUES
      (NEW.id, 'CONTRACT_CHANGE',
       'Employment contract updated',
       format('Type: %s → %s | Contract: %s → %s',
              COALESCE(OLD.employment_type, '—'), COALESCE(NEW.employment_type, '—'),
              COALESCE(OLD.contract_type, '—'), COALESCE(NEW.contract_type, '—')),
       jsonb_build_object(
         'old', jsonb_build_object('employment_type', OLD.employment_type, 'contract_type', OLD.contract_type, 'expiry', OLD.contract_expiry_date),
         'new', jsonb_build_object('employment_type', NEW.employment_type, 'contract_type', NEW.contract_type, 'expiry', NEW.contract_expiry_date)),
       COALESCE(NEW.contract_expiry_date, CURRENT_DATE), v_actor);
  END IF;

  IF NEW.position_id IS DISTINCT FROM OLD.position_id
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.grade_level_id IS DISTINCT FROM OLD.grade_level_id
     OR NEW.compensation_grade IS DISTINCT FROM OLD.compensation_grade THEN
    INSERT INTO public.employee_history
      (employee_id, event_type, title, description, metadata, effective_date, created_by)
    VALUES
      (NEW.id,
       CASE WHEN NEW.department_id IS DISTINCT FROM OLD.department_id THEN 'TRANSFER' ELSE 'PROMOTION' END,
       CASE WHEN NEW.department_id IS DISTINCT FROM OLD.department_id THEN 'Department transfer' ELSE 'Position / grade change' END,
       format('Department: %s → %s | Position: %s → %s | Grade: %s → %s',
              COALESCE(OLD.department_id::text, '—'), COALESCE(NEW.department_id::text, '—'),
              COALESCE(OLD.position_id::text, '—'), COALESCE(NEW.position_id::text, '—'),
              COALESCE(OLD.compensation_grade, '—'), COALESCE(NEW.compensation_grade, '—')),
       jsonb_build_object(
         'old', jsonb_build_object('department_id', OLD.department_id, 'position_id', OLD.position_id, 'grade_level_id', OLD.grade_level_id, 'grade', OLD.compensation_grade),
         'new', jsonb_build_object('department_id', NEW.department_id, 'position_id', NEW.position_id, 'grade_level_id', NEW.grade_level_id, 'grade', NEW.compensation_grade)),
       CURRENT_DATE, v_actor);
  END IF;

  IF NEW.monthly_salary IS DISTINCT FROM OLD.monthly_salary THEN
    INSERT INTO public.employee_history
      (employee_id, event_type, title, description, metadata, effective_date, created_by)
    VALUES
      (NEW.id, 'SALARY_CHANGE',
       'Salary updated',
       format('Monthly salary changed from %s to %s',
              COALESCE(OLD.monthly_salary::text, '—'), COALESCE(NEW.monthly_salary::text, '—')),
       jsonb_build_object('old', OLD.monthly_salary, 'new', NEW.monthly_salary),
       CURRENT_DATE, v_actor);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_employee_history ON employees;
CREATE TRIGGER trg_log_employee_history
  AFTER INSERT OR UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION public.log_employee_history();

-- ============================================================
-- 6. Extend self-service compensation guard to structured grade
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_self_service_salary_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
       NEW.monthly_salary IS DISTINCT FROM OLD.monthly_salary
    OR NEW.compensation_grade IS DISTINCT FROM OLD.compensation_grade
    OR NEW.grade_level_id IS DISTINCT FROM OLD.grade_level_id
    OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
    OR NEW.bank_routing_number IS DISTINCT FROM OLD.bank_routing_number
  ) AND NOT public.has_privilege('employees.manage') THEN
    RAISE EXCEPTION 'Only payroll administrators can change compensation and banking details';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_service_salary_change ON employees;
CREATE TRIGGER trg_prevent_self_service_salary_change
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION public.prevent_self_service_salary_change();

-- ============================================================
-- 7. RPC to manually append a history entry (e.g. exit, retirement)
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_employee_history(
  p_employee_id uuid,
  p_event_type text,
  p_title text,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_effective_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_privilege('employees.manage') THEN
    RAISE EXCEPTION 'Insufficient privileges: employees.manage required';
  END IF;
  INSERT INTO public.employee_history
    (employee_id, event_type, title, description, metadata, effective_date, created_by)
  VALUES
    (p_employee_id, p_event_type, p_title, p_description, p_metadata, p_effective_date, public.current_employee_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_employee_history(uuid, text, text, text, jsonb, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_grade_levels() TO authenticated;

-- ===========================================================================
-- Source: 20260924000002_hr_recruitment.sql
-- ===========================================================================

/*
# HR Recruitment — Phase 3 (Workforce Planning + Full Pipeline)

Builds the complete hiring pipeline on top of the existing `recruitment_jobs` /
`candidates` tables:

1. `recruitment_requisitions` — internal headcount requests (requisition →
   approved → job posting). Drives Workforce Planning. Approval chain runs on
   the existing workflow engine under module key `recruitment.requisition`.
2. `recruitment_jobs` — gains a link to the requisition that spawned it.
3. `interviews` — scheduled interview rounds with a panel and feedback.
4. `candidate_assessments` — scored assessments per candidate.
5. `job_offers` — offer management (salary, validity, accept/decline/withdraw).
6. `hire_candidate(...)` — SECURITY DEFINER RPC that atomically converts a
   HIRED candidate into an `employees` row and seeds onboarding progress from
   a template. This is the only path that creates employees from candidates.
7. Workflow integration: `apply_workflow_result_to_record` now also mirrors
   REQUISITION APPROVED/REJECTED onto `recruitment_requisitions.status`.

Security:
- All new tables gated by `recruitment.manage` (mirrors candidates).
- `hire_candidate` requires `recruitment.manage` AND is the exclusive writer of
  `employee_onboarding_progress` seeding for hires.
*/

-- ============================================================
-- 1. Recruitment requisitions (workforce planning inflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS recruitment_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  position_id uuid REFERENCES positions(id) ON DELETE SET NULL,
  headcount integer NOT NULL DEFAULT 1,
  employment_type text DEFAULT 'FULL_TIME',
  budget_min numeric,
  budget_max numeric,
  justification text,
  requested_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  status text DEFAULT 'DRAFT',          -- DRAFT | SUBMITTED | APPROVED | REJECTED | CANCELLED
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE recruitment_requisitions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rec_reqs_dept ON recruitment_requisitions(department_id);
CREATE INDEX IF NOT EXISTS idx_rec_reqs_status ON recruitment_requisitions(status);

DROP POLICY IF EXISTS "select_recruitment_requisitions" ON recruitment_requisitions;
DROP POLICY IF EXISTS "insert_recruitment_requisitions" ON recruitment_requisitions;
DROP POLICY IF EXISTS "update_recruitment_requisitions" ON recruitment_requisitions;
DROP POLICY IF EXISTS "delete_recruitment_requisitions" ON recruitment_requisitions;
CREATE POLICY "select_recruitment_requisitions" ON recruitment_requisitions FOR SELECT TO authenticated
  USING (requested_by = public.current_employee_id() OR public.has_privilege('recruitment.manage'));
CREATE POLICY "insert_recruitment_requisitions" ON recruitment_requisitions FOR INSERT TO authenticated
  WITH CHECK (requested_by = public.current_employee_id() OR public.has_privilege('recruitment.manage'));
CREATE POLICY "update_recruitment_requisitions" ON recruitment_requisitions FOR UPDATE TO authenticated
  USING (requested_by = public.current_employee_id() OR public.has_privilege('recruitment.manage'))
  WITH CHECK (public.has_privilege('recruitment.manage')
              OR (requested_by = public.current_employee_id() AND status = 'DRAFT'));
CREATE POLICY "delete_recruitment_requisitions" ON recruitment_requisitions FOR DELETE TO authenticated
  USING (requested_by = public.current_employee_id() OR public.has_privilege('recruitment.manage'));

-- ============================================================
-- 2. recruitment_jobs — link to requisition
-- ============================================================
ALTER TABLE recruitment_jobs
  ADD COLUMN IF NOT EXISTS requisition_id uuid REFERENCES recruitment_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employment_type text DEFAULT 'FULL_TIME';
CREATE INDEX IF NOT EXISTS idx_recruit_jobs_requisition ON recruitment_jobs(requisition_id);

-- ============================================================
-- 3. Interviews
-- ============================================================
CREATE TABLE IF NOT EXISTS interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  round text NOT NULL DEFAULT 'FIRST',   -- FIRST | SECOND | TECHNICAL | PANEL | FINAL | HR | OFFER
  scheduled_at timestamptz NOT NULL,
  mode text DEFAULT 'IN_PERSON',          -- IN_PERSON | VIDEO | PHONE
  interviewers jsonb DEFAULT '[]'::jsonb, -- [{ employee_id, name }]
  status text DEFAULT 'SCHEDULED',        -- SCHEDULED | COMPLETED | CANCELLED | NO_SHOW
  feedback text,
  rating integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews(candidate_id);

DROP POLICY IF EXISTS "select_interviews" ON interviews;
DROP POLICY IF EXISTS "insert_interviews" ON interviews;
DROP POLICY IF EXISTS "update_interviews" ON interviews;
DROP POLICY IF EXISTS "delete_interviews" ON interviews;
CREATE POLICY "select_interviews" ON interviews FOR SELECT TO authenticated
  USING (public.has_privilege('recruitment.manage'));
CREATE POLICY "insert_interviews" ON interviews FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('recruitment.manage'));
CREATE POLICY "update_interviews" ON interviews FOR UPDATE TO authenticated
  USING (public.has_privilege('recruitment.manage'))
  WITH CHECK (public.has_privilege('recruitment.manage'));
CREATE POLICY "delete_interviews" ON interviews FOR DELETE TO authenticated
  USING (public.has_privilege('recruitment.manage'));

-- ============================================================
-- 4. Candidate assessments
-- ============================================================
CREATE TABLE IF NOT EXISTS candidate_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  type text NOT NULL,                     -- TECHNICAL | APTITUDE | BEHAVIORAL | CODING | WRITTEN | OTHER
  score numeric,
  max_score numeric,
  notes text,
  taken_at date DEFAULT CURRENT_DATE,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE candidate_assessments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_candidate_assessments_candidate ON candidate_assessments(candidate_id);

DROP POLICY IF EXISTS "select_candidate_assessments" ON candidate_assessments;
DROP POLICY IF EXISTS "insert_candidate_assessments" ON candidate_assessments;
DROP POLICY IF EXISTS "update_candidate_assessments" ON candidate_assessments;
DROP POLICY IF EXISTS "delete_candidate_assessments" ON candidate_assessments;
CREATE POLICY "select_candidate_assessments" ON candidate_assessments FOR SELECT TO authenticated
  USING (public.has_privilege('recruitment.manage'));
CREATE POLICY "insert_candidate_assessments" ON candidate_assessments FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('recruitment.manage'));
CREATE POLICY "update_candidate_assessments" ON candidate_assessments FOR UPDATE TO authenticated
  USING (public.has_privilege('recruitment.manage'))
  WITH CHECK (public.has_privilege('recruitment.manage'));
CREATE POLICY "delete_candidate_assessments" ON candidate_assessments FOR DELETE TO authenticated
  USING (public.has_privilege('recruitment.manage'));

-- ============================================================
-- 5. Job offers
-- ============================================================
CREATE TABLE IF NOT EXISTS job_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id uuid REFERENCES recruitment_jobs(id) ON DELETE SET NULL,
  offered_salary numeric,
  offered_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  offer_date date DEFAULT CURRENT_DATE,
  expiry_date date,
  status text DEFAULT 'PENDING',          -- PENDING | ACCEPTED | DECLINED | WITHDRAWN | EXPIRED
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE job_offers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_job_offers_candidate ON job_offers(candidate_id);

DROP POLICY IF EXISTS "select_job_offers" ON job_offers;
DROP POLICY IF EXISTS "insert_job_offers" ON job_offers;
DROP POLICY IF EXISTS "update_job_offers" ON job_offers;
DROP POLICY IF EXISTS "delete_job_offers" ON job_offers;
CREATE POLICY "select_job_offers" ON job_offers FOR SELECT TO authenticated
  USING (public.has_privilege('recruitment.manage'));
CREATE POLICY "insert_job_offers" ON job_offers FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('recruitment.manage'));
CREATE POLICY "update_job_offers" ON job_offers FOR UPDATE TO authenticated
  USING (public.has_privilege('recruitment.manage'))
  WITH CHECK (public.has_privilege('recruitment.manage'));
CREATE POLICY "delete_job_offers" ON job_offers FOR DELETE TO authenticated
  USING (public.has_privilege('recruitment.manage'));

-- ============================================================
-- 6. Hire candidate → employee (atomic, managed RPC)
-- ============================================================
CREATE OR REPLACE FUNCTION public.hire_candidate(
  p_candidate_id uuid,
  p_onboarding_template_id uuid DEFAULT NULL,
  p_employee_id_text text DEFAULT NULL,
  p_hire_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate candidates%ROWTYPE;
  v_job recruitment_jobs%ROWTYPE;
  v_employee_id uuid;
  v_template_id uuid;
  v_step RECORD;
BEGIN
  IF NOT public.has_privilege('recruitment.manage') THEN
    RAISE EXCEPTION 'Insufficient privileges: recruitment.manage required';
  END IF;

  SELECT * INTO v_candidate FROM candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found'; END IF;
  IF v_candidate.current_stage = 'HIRED' THEN
    RAISE EXCEPTION 'Candidate has already been hired';
  END IF;

  SELECT * INTO v_job FROM recruitment_jobs WHERE id = v_candidate.job_id;

  IF EXISTS (SELECT 1 FROM employees WHERE email = v_candidate.email) THEN
    RAISE EXCEPTION 'An employee with email % already exists', v_candidate.email;
  END IF;

  INSERT INTO employees (
    employee_id, first_name, last_name, email, phone,
    employment_type, employment_status, hire_date,
    position_id, department_id
  ) VALUES (
    NULLIF(p_employee_id_text, ''),
    v_candidate.first_name, v_candidate.last_name, v_candidate.email, v_candidate.phone,
    COALESCE(v_job.employment_type, 'FULL_TIME'),
    'ONBOARDING',
    p_hire_date,
    v_job.position_id, v_job.department_id
  )
  RETURNING id INTO v_employee_id;

  UPDATE candidates
     SET current_stage = 'HIRED', updated_at = now()
   WHERE id = p_candidate_id;

  v_template_id := COALESCE(
    p_onboarding_template_id,
    (SELECT t.id FROM onboarding_templates t
      WHERE t.department_id = v_job.department_id AND t.is_active
      ORDER BY t.created_at DESC LIMIT 1),
    (SELECT t.id FROM onboarding_templates t
      WHERE t.is_active
      ORDER BY (t.department_id IS NOT NULL), t.created_at DESC LIMIT 1)
  );
  IF v_template_id IS NOT NULL THEN
    FOR v_step IN
      SELECT * FROM onboarding_steps
       WHERE template_id = v_template_id
       ORDER BY sort_order, created_at
    LOOP
      INSERT INTO employee_onboarding_progress (employee_id, template_id, step_id, status)
      VALUES (v_employee_id, v_template_id, v_step.id, 'PENDING')
      ON CONFLICT (employee_id, step_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_employee_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hire_candidate(uuid, uuid, text, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hire_candidate(uuid, uuid, text, date) FROM PUBLIC;

-- ============================================================
-- 7. Workflow integration for requisition approval
-- ============================================================
DROP TRIGGER IF EXISTS trg_apply_workflow_result ON workflow_instances;
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

-- Start the approval chain when a requisition is submitted
CREATE OR REPLACE FUNCTION public.tri_start_workflow_on_requisition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'SUBMITTED' AND OLD.status IS DISTINCT FROM 'SUBMITTED' THEN
    PERFORM public.maybe_start_workflow('recruitment.requisition', NEW.id, COALESCE(NEW.requested_by, public.current_employee_id()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_start_workflow_requisition ON recruitment_requisitions;
CREATE TRIGGER trg_start_workflow_requisition
AFTER INSERT OR UPDATE ON recruitment_requisitions
FOR EACH ROW EXECUTE FUNCTION public.tri_start_workflow_on_requisition();

-- Default requisition approval chain (Manager → HR Admin), enabled by default.
DO $$
DECLARE v_def uuid;
BEGIN
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Requisition Approval', 'recruitment.requisition', 'requisition.submitted',
    'Default recruitment requisition approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'recruitment.requisition' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'recruitment.requisition', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'recruitment.requisition');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tri_start_workflow_on_requisition() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_workflow_result_to_record() FROM PUBLIC;

-- ===========================================================================
-- Source: 20260924000003_hr_onboarding_enforce.sql
-- ===========================================================================

/*
# HR Onboarding — Phase 4 (Required-step enforcement)

Closes the gap where onboarding completion was enforced only in the client:
- `onboarding_ready(p_employee_id)` — server-side truth for whether an employee
  has completed personal required fields AND all required checklist steps.
- Trigger on `employees` — blocks `ONBOARDING`/`PENDING_VERIFICATION` →
  `ACTIVE` status flips unless `onboarding_ready()` passes OR the caller holds
  `employees.manage` (admins may force-activate), OR the flip originates from
  `complete_onboarding()` (session flag).
- `complete_onboarding(p_employee_id)` — SECURITY DEFINER RPC: validates
  required steps, flips status to `ACTIVE`, marks remaining checklist items
  completed, and records an `employee_history` row. The single sanctioned path.

Notes:
- Required personal fields mirror the self-service onboarding page
  (phone, date_of_birth, gender, address, city, emergency contact).
- Required checklist steps come from `onboarding_steps.is_required` joined by
  `employee_onboarding_progress`. Employees with no assigned checklist are
  considered ready (base personal + employment checks still apply).
*/

-- ============================================================
-- 1. Required-step validation function
-- ============================================================
CREATE OR REPLACE FUNCTION public.onboarding_ready(p_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_open integer;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_emp.phone IS NULL OR v_emp.date_of_birth IS NULL OR v_emp.gender IS NULL
     OR v_emp.address IS NULL OR v_emp.city IS NULL OR v_emp.emergency_contact_name IS NULL THEN
    RETURN false;
  END IF;

  SELECT COUNT(*) INTO v_open
    FROM employee_onboarding_progress p
    JOIN onboarding_steps s ON s.id = p.step_id
   WHERE p.employee_id = p_employee_id
     AND s.is_required
     AND p.status IN ('PENDING', 'IN_PROGRESS');

  RETURN v_open = 0;
END;
$$;

-- ============================================================
-- 2. Trigger: block premature activation
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_early_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.employment_status = 'ACTIVE'
     AND OLD.employment_status IN ('ONBOARDING', 'PENDING_VERIFICATION')
     AND NEW.employment_status IS DISTINCT FROM OLD.employment_status THEN
    IF current_setting('app.complete_onboarding', true) IS DISTINCT FROM 'true'
       AND NOT public.has_privilege('employees.manage')
       AND NOT public.onboarding_ready(NEW.id) THEN
      RAISE EXCEPTION 'Onboarding is incomplete: required personal details or checklist steps are missing. Complete onboarding before activating the employee.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_early_activation ON employees;
CREATE TRIGGER trg_prevent_early_activation
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION public.prevent_early_activation();

-- ============================================================
-- 3. Complete onboarding RPC (sanctioned activation path)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_onboarding(p_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call_ok boolean;
  v_incomplete text[];
BEGIN
  IF NOT public.has_privilege('employees.manage')
     AND p_employee_id IS DISTINCT FROM public.current_employee_id() THEN
    RAISE EXCEPTION 'You can only complete onboarding for yourself';
  END IF;

  IF NOT public.onboarding_ready(p_employee_id) THEN
    SELECT ARRAY_AGG(t.title ORDER BY s.sort_order) INTO v_incomplete
      FROM employee_onboarding_progress p
      JOIN onboarding_steps s ON s.id = p.step_id
      LEFT JOIN onboarding_templates t ON t.id = p.template_id
     WHERE p.employee_id = p_employee_id
       AND s.is_required
       AND p.status IN ('PENDING', 'IN_PROGRESS');
    RAISE EXCEPTION 'Onboarding is incomplete: %', COALESCE(array_to_string(v_incomplete, ', '), 'required personal details missing');
  END IF;

  PERFORM set_config('app.complete_onboarding', 'true', true);

  UPDATE employees
     SET employment_status = 'ACTIVE',
         updated_at = now()
   WHERE id = p_employee_id;

  UPDATE employee_onboarding_progress
     SET status = 'COMPLETED',
         completed_at = COALESCE(completed_at, now()),
         updated_at = now()
   WHERE employee_id = p_employee_id
     AND status IN ('PENDING', 'IN_PROGRESS');

  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.complete_onboarding', 'false', true);
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_onboarding(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_ready(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_onboarding(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.onboarding_ready(uuid) FROM PUBLIC;

-- Reset any dangling session flag between transactions is automatic (local).

-- ===========================================================================
-- Source: 20260924000004_hr_leave_encashment.sql
-- ===========================================================================

/*
# HR Leave — Phase 4 (Encashment policy & approvals)

Adds configurable leave encashment on top of the existing leave engine:
- `leave_types.encashable` + `leave_types.encashment_rate_per_day` — policy
  driven from settings (admin configures, no hardcoded rates). Existing
  `carry_forward_limit` already holds carry-forward caps.
- `leave_encashment_requests` — request unused days to be paid out; routed
  through the workflow engine under module key `leave.encashment`.
- Result propagation in `apply_workflow_result_to_record` + default approval
  chain (Manager → HR Admin), matching the procurement pattern.

Balance model is unchanged: `annual_allocation - used days` with optional
`leave_balances.opening_balance` catch-ups. Encashment consumes days from the
balance so double-counting is impossible.
*/

-- ============================================================
-- 1. Leave type encashment policy columns
-- ============================================================
ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS encashable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS encashment_rate_per_day numeric DEFAULT 0;

-- ============================================================
-- 2. Encashment requests
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_encashment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  days numeric NOT NULL CHECK (days > 0),
  rate_per_day numeric NOT NULL DEFAULT 0,
  estimated_amount numeric GENERATED ALWAYS AS (days * rate_per_day) STORED,
  reason text,
  requested_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  status text DEFAULT 'SUBMITTED',       -- SUBMITTED | APPROVED | REJECTED | CANCELLED
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE leave_encashment_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_leave_encash_emp ON leave_encashment_requests(employee_id, created_at);

DROP POLICY IF EXISTS "select_leave_encashment_requests" ON leave_encashment_requests;
DROP POLICY IF EXISTS "insert_leave_encashment_requests" ON leave_encashment_requests;
DROP POLICY IF EXISTS "update_leave_encashment_requests" ON leave_encashment_requests;
DROP POLICY IF EXISTS "delete_leave_encashment_requests" ON leave_encashment_requests;
CREATE POLICY "select_leave_encashment_requests" ON leave_encashment_requests FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'));
CREATE POLICY "insert_leave_encashment_requests" ON leave_encashment_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'));
CREATE POLICY "update_leave_encashment_requests" ON leave_encashment_requests FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'))
  WITH CHECK (public.has_privilege('leave.manage')
              OR (employee_id = public.current_employee_id() AND status = 'SUBMITTED'));
CREATE POLICY "delete_leave_encashment_requests" ON leave_encashment_requests FOR DELETE TO authenticated
  USING (public.has_privilege('leave.manage'));

-- ============================================================
-- 3. Workflow: approve encashment, start on submit
-- ============================================================
CREATE OR REPLACE FUNCTION public.tri_start_workflow_on_encashment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'SUBMITTED' AND OLD.status IS DISTINCT FROM 'SUBMITTED' THEN
    PERFORM public.maybe_start_workflow('leave.encashment', NEW.id, COALESCE(NEW.requested_by, public.current_employee_id()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_start_workflow_encashment ON leave_encashment_requests;
CREATE TRIGGER trg_start_workflow_encashment
AFTER INSERT OR UPDATE ON leave_encashment_requests
FOR EACH ROW EXECUTE FUNCTION public.tri_start_workflow_on_encashment();

-- Propagate verdict into encashment requests.
DROP TRIGGER IF EXISTS trg_apply_workflow_result ON workflow_instances;
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

-- Default approval chain (Manager → HR Admin), enabled by default.
DO $$
DECLARE v_def uuid;
BEGIN
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Leave Encashment Approval', 'leave.encashment', 'encashment.submitted',
    'Default leave encashment approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'leave.encashment' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'leave.encashment', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'leave.encashment');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tri_start_workflow_on_encashment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_workflow_result_to_record() FROM PUBLIC;

-- ===========================================================================
-- Source: 20260924000005_hr_performance_scale.sql
-- ===========================================================================

/*
# HR Performance — Phase 5 (Configurable rating scale)

Replaces the hardcoded `/5` rating display with settings-driven scale:

- `system_settings` group `performance`:
  - `rating_scale_max` — numeric top of the scale (default `5`).
  - `rating_scale_labels` — array of labels per level, e.g.
    `["Needs Improvement","Below Expectation","Meets Expectation","Exceeds","Outstanding"]`.
- `get_performance_scale()` (SECURITY DEFINER) — lets any authenticated reader
  obtain the active scale without exposing `system_settings` (which is
  `admin.settings`-gated). Returns `{ max, labels }`.
- UI reads the scale via this RPC and renders `rating/max` with the matching
  label instead of a fixed `/5`.

No hardcoded rates/labels live in code; admins configure values in Settings →
Performance (group `performance`).
*/

INSERT INTO system_settings (group_name, key, value) VALUES
  ('performance', 'rating_scale_max', '5'),
  ('performance', 'rating_scale_labels', '["Needs Improvement","Below Expectation","Meets Expectation","Exceeds","Outstanding"]')
ON CONFLICT (group_name, key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_performance_scale()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max integer := 5;
  v_labels jsonb := '["Needs Improvement","Below Expectation","Meets Expectation","Exceeds","Outstanding"]'::jsonb;
BEGIN
  SELECT COALESCE((value::text)::integer, 5) INTO v_max
    FROM system_settings WHERE group_name = 'performance' AND key = 'rating_scale_max';
  SELECT COALESCE(value, v_labels) INTO v_labels
    FROM system_settings WHERE group_name = 'performance' AND key = 'rating_scale_labels';
  RETURN jsonb_build_object('max', v_max, 'labels', v_labels);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_performance_scale() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_performance_scale() FROM PUBLIC;

-- ===========================================================================
-- Source: 20260924000006_hr_training_certifications.sql
-- ===========================================================================

/*
# HR Training — Phase 5 (Certifications, expiry & competencies)

Extends the training module beyond "courses + enrollments":
- `employee_certifications` — awarded certificates with issuance/expiry dates,
  issuing body and reference. Expired/near-expiry tracked at the UI level via
  `certificate_status()`.
- `competencies` + `employee_competencies` — a library of skill competencies and
  per-employee proficiency levels (1..5), so training outcomes are measurable.
- Backfill trigger: when an enrollment completes (progress = 100), nothing is
  invented here — admins award a certification explicitly (no fake data rule);
  the completion simply becomes the "recommended" issuance date.

RLS:
- `employee_certifications` / `employee_competencies`: self-or-manage read,
  `training.manage` write (mirrors enrollments).
- `competencies`: readable by all, writable by `training.manage`.
- `certificate_status(date)` helper: ACTIVE / EXPIRING_SOON (≤30 days) /
  EXPIRED / NO_EXPIRY.
*/

-- ============================================================
-- 1. Employee certifications
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  issuing_body text,
  reference_no text,
  issued_at date,
  expiry_date date,
  document_url text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE employee_certifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_certs_employee ON employee_certifications(employee_id, expiry_date);

DROP POLICY IF EXISTS "select_employee_certifications" ON employee_certifications;
DROP POLICY IF EXISTS "insert_employee_certifications" ON employee_certifications;
DROP POLICY IF EXISTS "update_employee_certifications" ON employee_certifications;
DROP POLICY IF EXISTS "delete_employee_certifications" ON employee_certifications;
CREATE POLICY "select_employee_certifications" ON employee_certifications FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('training.manage'));
CREATE POLICY "insert_employee_certifications" ON employee_certifications FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('training.manage'));
CREATE POLICY "update_employee_certifications" ON employee_certifications FOR UPDATE TO authenticated
  USING (public.has_privilege('training.manage'))
  WITH CHECK (public.has_privilege('training.manage'));
CREATE POLICY "delete_employee_certifications" ON employee_certifications FOR DELETE TO authenticated
  USING (public.has_privilege('training.manage'));

-- ============================================================
-- 2. Competency catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE competencies ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS uq_competencies_name ON competencies(lower(name));

DROP POLICY IF EXISTS "select_competencies" ON competencies;
DROP POLICY IF EXISTS "insert_competencies" ON competencies;
DROP POLICY IF EXISTS "update_competencies" ON competencies;
DROP POLICY IF EXISTS "delete_competencies" ON competencies;
CREATE POLICY "select_competencies" ON competencies FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_competencies" ON competencies FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('training.manage'));
CREATE POLICY "update_competencies" ON competencies FOR UPDATE TO authenticated
  USING (public.has_privilege('training.manage'))
  WITH CHECK (public.has_privilege('training.manage'));
CREATE POLICY "delete_competencies" ON competencies FOR DELETE TO authenticated
  USING (public.has_privilege('training.manage'));

-- ============================================================
-- 3. Employee competencies (proficiency levels)
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  proficiency integer NOT NULL DEFAULT 1 CHECK (proficiency BETWEEN 1 AND 5),
  assessed_at date DEFAULT CURRENT_DATE,
  assessed_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT employee_competencies_unique UNIQUE (employee_id, competency_id)
);
ALTER TABLE employee_competencies ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_emp_comp_employee ON employee_competencies(employee_id);

DROP POLICY IF EXISTS "select_employee_competencies" ON employee_competencies;
DROP POLICY IF EXISTS "insert_employee_competencies" ON employee_competencies;
DROP POLICY IF EXISTS "update_employee_competencies" ON employee_competencies;
DROP POLICY IF EXISTS "delete_employee_competencies" ON employee_competencies;
CREATE POLICY "select_employee_competencies" ON employee_competencies FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('training.manage'));
CREATE POLICY "insert_employee_competencies" ON employee_competencies FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('training.manage'));
CREATE POLICY "update_employee_competencies" ON employee_competencies FOR UPDATE TO authenticated
  USING (public.has_privilege('training.manage'))
  WITH CHECK (public.has_privilege('training.manage'));
CREATE POLICY "delete_employee_competencies" ON employee_competencies FOR DELETE TO authenticated
  USING (public.has_privilege('training.manage'));

-- ============================================================
-- 4. Certificate expiry helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.certificate_status(p_expiry_date date)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_expiry_date IS NULL THEN 'NO_EXPIRY'
    WHEN p_expiry_date < CURRENT_DATE THEN 'EXPIRED'
    WHEN p_expiry_date <= CURRENT_DATE + 30 THEN 'EXPIRING_SOON'
    ELSE 'ACTIVE'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.certificate_status(date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.certificate_status(date) FROM PUBLIC;

-- ===========================================================================
-- Source: 20260924000007_hr_medical_privilege.sql
-- ===========================================================================

/*
# Phase 6 — Distinct Medical Privilege

Medical data (blood group, allergies, conditions, health metrics) was readable
by anyone with `employees.view_all` and writable by anyone with
`employees.manage`. Health data now requires its own dedicated privilege:

- New privilege `employees.medical` — "View & manage medical records".
- `employee_medical` / `employee_health_metrics` RLS tightened:
  read/write = own row OR `employees.medical` (was view_all / manage).
- `field_values` rows for module `employee_medical` (the Medical tab's
  field-engine store) get the same gating; other modules are unchanged.
- Employees always keep full access to their OWN medical data.
*/

-- ============================================================
-- 1. Seed the privilege
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order)
VALUES (
  'employees.medical',
  'Employees',
  'View & manage medical records',
  'Access employee medical records, health metrics and vitals',
  35
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. Tighten employee_medical
-- ============================================================
DROP POLICY IF EXISTS "select_employee_medical" ON employee_medical;
DROP POLICY IF EXISTS "insert_employee_medical" ON employee_medical;
DROP POLICY IF EXISTS "update_employee_medical" ON employee_medical;
DROP POLICY IF EXISTS "delete_employee_medical" ON employee_medical;

CREATE POLICY "select_employee_medical" ON employee_medical FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'));
CREATE POLICY "insert_employee_medical" ON employee_medical FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'));
CREATE POLICY "update_employee_medical" ON employee_medical FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'));
CREATE POLICY "delete_employee_medical" ON employee_medical FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'));

-- ============================================================
-- 3. Tighten employee_health_metrics
-- ============================================================
DROP POLICY IF EXISTS "select_employee_health_metrics" ON employee_health_metrics;
DROP POLICY IF EXISTS "insert_employee_health_metrics" ON employee_health_metrics;
DROP POLICY IF EXISTS "update_employee_health_metrics" ON employee_health_metrics;
DROP POLICY IF EXISTS "delete_employee_health_metrics" ON employee_health_metrics;

CREATE POLICY "select_employee_health_metrics" ON employee_health_metrics FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'));
CREATE POLICY "insert_employee_health_metrics" ON employee_health_metrics FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'));
CREATE POLICY "update_employee_health_metrics" ON employee_health_metrics FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'));
CREATE POLICY "delete_employee_health_metrics" ON employee_health_metrics FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.medical'));

-- ============================================================
-- 4. field_values: gate the medical module rows
--    (other module rows keep their existing behaviour)
-- ============================================================
DROP POLICY IF EXISTS "select_field_values" ON field_values;
CREATE POLICY "select_field_values" ON field_values FOR SELECT TO authenticated
  USING (
    module_key <> 'employee_medical'
    OR record_id = public.current_employee_id()
    OR public.has_privilege('employees.medical')
  );

DROP POLICY IF EXISTS "insert_field_values" ON field_values;
CREATE POLICY "insert_field_values" ON field_values FOR INSERT TO authenticated
  WITH CHECK (
    public.has_privilege('admin.settings')
    OR (
      module_key = 'employee_medical'
      AND (record_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
    )
  );

DROP POLICY IF EXISTS "update_field_values" ON field_values;
CREATE POLICY "update_field_values" ON field_values FOR UPDATE TO authenticated
  USING (
    public.has_privilege('admin.settings')
    OR (
      module_key = 'employee_medical'
      AND (record_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
    )
  )
  WITH CHECK (
    public.has_privilege('admin.settings')
    OR (
      module_key = 'employee_medical'
      AND (record_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
    )
  );

DROP POLICY IF EXISTS "delete_field_values" ON field_values;
CREATE POLICY "delete_field_values" ON field_values FOR DELETE TO authenticated
  USING (
    public.has_privilege('admin.settings')
    OR (
      module_key = 'employee_medical'
      AND (record_id = public.current_employee_id() OR public.has_privilege('employees.medical'))
    )
  );

-- ===========================================================================
-- Source: 20260924000008_hr_security_settings.sql
-- ===========================================================================

/*
# Phase 6 — Real Security Controls

Makes the Security settings page functional instead of decorative:

1. **Configurable password policy** (settings, not code)
   - Seeds `system_settings` group `security`: `password_min_length`,
     `password_require_upper`, `password_require_number`,
     `password_require_symbol`, `password_expiry_days` (0 = never).
   - `get_password_policy()` — SECURITY DEFINER read for non-admin clients
     (system_settings is admin-gated), used by the change-password screen.
   - `password_policy_compliant(p_password)` reimplemented to read the
     settings (defaults match the previous hardcoded behaviour: 8 chars,
     uppercase, number).
   - `password_policy_message()` builds the rejection message from settings;
     `set_employee_password` / `change_my_password` / `complete_password_setup`
     now use it instead of the hardcoded sentence.
   - `authenticate_employee` enforces expiry: when `password_expiry_days` > 0
     and the password is older than that, the employee is flagged
     `must_change_password` on login.

2. **API keys** (`api_keys`)
   - Admin-managed integration credentials: created once (full key shown a
     single time), stored as SHA-256 hashes with prefix, revocable.
   - `verify_api_key(p_key)` — anon-callable verifier that bumps
     `last_used_at` (mirrors `authenticate_employee`'s design).
   - `api_v1_employees(p_key)` — SECURITY DEFINER endpoint data source for
     `GET /api/v1/employees` (returns active employee basics).
   - RLS: all operations require `admin.settings`.
*/

-- ============================================================
-- 1. Password policy settings
-- ============================================================
INSERT INTO system_settings (group_name, key, value) VALUES
  ('security', 'password_min_length', '8'),
  ('security', 'password_require_upper', 'true'),
  ('security', 'password_require_number', 'true'),
  ('security', 'password_require_symbol', 'false'),
  ('security', 'password_expiry_days', '0')
ON CONFLICT (group_name, key) DO NOTHING;

-- ============================================================
-- 2. Password policy functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_password_policy()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'min_length', COALESCE(
      (SELECT max((value #>> '{}')::int)
         FROM system_settings
        WHERE group_name = 'security' AND key = 'password_min_length'), 8),
    'require_upper', COALESCE(
      (SELECT bool_or((value #>> '{}')::boolean)
         FROM system_settings
        WHERE group_name = 'security' AND key = 'password_require_upper'), true),
    'require_number', COALESCE(
      (SELECT bool_or((value #>> '{}')::boolean)
         FROM system_settings
        WHERE group_name = 'security' AND key = 'password_require_number'), true),
    'require_symbol', COALESCE(
      (SELECT bool_or((value #>> '{}')::boolean)
         FROM system_settings
        WHERE group_name = 'security' AND key = 'password_require_symbol'), false),
    'expiry_days', COALESCE(
      (SELECT max((value #>> '{}')::int)
         FROM system_settings
        WHERE group_name = 'security' AND key = 'password_expiry_days'), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.get_password_policy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_password_policy() TO authenticated;

CREATE OR REPLACE FUNCTION public.password_policy_compliant(p_password text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy jsonb;
BEGIN
  v_policy := public.get_password_policy();

  RETURN p_password IS NOT NULL
     AND length(p_password) >= (v_policy ->> 'min_length')::int
     AND (NOT (v_policy ->> 'require_upper')::boolean OR p_password ~ '[A-Z]')
     AND (NOT (v_policy ->> 'require_number')::boolean OR p_password ~ '\d')
     AND (NOT (v_policy ->> 'require_symbol')::boolean OR p_password ~ '[^A-Za-z0-9]');
END;
$$;

REVOKE ALL ON FUNCTION public.password_policy_compliant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_policy_compliant(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.password_policy_message()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy jsonb;
  v_msg text;
BEGIN
  v_policy := public.get_password_policy();

  v_msg := 'Passwords must be at least ' || (v_policy ->> 'min_length')::int || ' characters long';
  IF (v_policy ->> 'require_upper')::boolean AND (v_policy ->> 'require_number')::boolean THEN
    v_msg := v_msg || ', with one uppercase letter and one number';
  ELSIF (v_policy ->> 'require_upper')::boolean THEN
    v_msg := v_msg || ', with one uppercase letter';
  ELSIF (v_policy ->> 'require_number')::boolean THEN
    v_msg := v_msg || ', with one number';
  END IF;
  IF (v_policy ->> 'require_symbol')::boolean THEN
    v_msg := v_msg || ' and one symbol';
  END IF;

  RETURN v_msg || '.';
END;
$$;

REVOKE ALL ON FUNCTION public.password_policy_message() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_policy_message() TO anon, authenticated;

-- ============================================================
-- 3. Use the configurable message in every password path
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_employee_password(p_employee_id uuid, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_privilege('employees.manage') OR public.has_privilege('admin.privileges')) THEN
    RAISE EXCEPTION 'You do not have permission to set employee passwords';
  END IF;

  IF NOT public.password_policy_compliant(p_password) THEN
    RAISE EXCEPTION '%', public.password_policy_message();
  END IF;

  UPDATE employees
     SET password_hash        = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         password_updated_at  = now(),
         must_change_password = true,
         updated_at           = now()
   WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_my_password(p_current_password text, p_new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
BEGIN
  SELECT * INTO v_emp
    FROM employees e
   WHERE e.user_id = auth.uid()
      OR (auth.jwt() ->> 'email' IS NOT NULL AND e.email = auth.jwt() ->> 'email')
   ORDER BY CASE WHEN e.user_id = auth.uid() THEN 0 ELSE 1 END
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid session is required to change your password';
  END IF;

  IF v_emp.password_hash IS NULL OR NOT (v_emp.password_hash = extensions.crypt(p_current_password, v_emp.password_hash)) THEN
    RAISE EXCEPTION 'Current password is incorrect';
  END IF;

  IF NOT public.password_policy_compliant(p_new_password) THEN
    RAISE EXCEPTION '%', public.password_policy_message();
  END IF;

  IF p_new_password = p_current_password THEN
    RAISE EXCEPTION 'New password must be different from the current password';
  END IF;

  UPDATE employees
     SET password_hash        = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         password_updated_at  = now(),
         must_change_password = false,
         updated_at           = now()
   WHERE id = v_emp.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_password_setup(p_token text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_setup_tokens%ROWTYPE;
  v_emp public.employees%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TOKEN');
  END IF;

  SELECT * INTO v_row
    FROM public.employee_setup_tokens t
   WHERE t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   ORDER BY t.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TOKEN');
  END IF;

  IF v_row.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_USED');
  END IF;

  IF v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EXPIRED');
  END IF;

  IF NOT public.password_policy_compliant(p_password) THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'WEAK_PASSWORD',
      'message', public.password_policy_message());
  END IF;

  SELECT * INTO v_emp FROM public.employees e WHERE e.id = v_row.employee_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TOKEN');
  END IF;
  IF v_emp.password_hash IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_USED');
  END IF;

  UPDATE public.employees
     SET password_hash        = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         password_updated_at  = now(),
         must_change_password = false,
         user_id              = id,
         updated_at           = now()
   WHERE id = v_emp.id;

  UPDATE public.employee_setup_tokens
     SET used_at = now()
   WHERE id = v_row.id;

  DELETE FROM public.employee_setup_tokens WHERE employee_id = v_emp.id AND id <> v_row.id;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'email', v_emp.email,
    'first_name', v_emp.first_name,
    'employment_status', v_emp.employment_status
  );
END;
$$;

-- ============================================================
-- 4. Password expiry enforced at login
-- ============================================================
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

  IF v_emp.is_login_blocked THEN
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

-- ============================================================
-- 5. API keys
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

DROP POLICY IF EXISTS "select_api_keys" ON api_keys;
DROP POLICY IF EXISTS "insert_api_keys" ON api_keys;
DROP POLICY IF EXISTS "update_api_keys" ON api_keys;
DROP POLICY IF EXISTS "delete_api_keys" ON api_keys;

CREATE POLICY "select_api_keys" ON api_keys FOR SELECT TO authenticated
  USING (public.has_privilege('admin.settings'));
CREATE POLICY "insert_api_keys" ON api_keys FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_api_keys" ON api_keys FOR UPDATE TO authenticated
  USING (public.has_privilege('admin.settings'))
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "delete_api_keys" ON api_keys FOR DELETE TO authenticated
  USING (public.has_privilege('admin.settings'));

-- ============================================================
-- 6. API key verification + endpoint data source
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_api_key(p_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_key IS NULL OR length(p_key) < 8 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
    FROM api_keys
   WHERE key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
     AND revoked_at IS NULL;

  IF v_id IS NOT NULL THEN
    UPDATE api_keys SET last_used_at = now() WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_api_key(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.api_v1_employees(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.verify_api_key(p_key) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employees', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id,
               'employee_id', e.employee_id,
               'first_name', e.first_name,
               'last_name', e.last_name,
               'email', e.email,
               'employment_status', e.employment_status,
               'department_id', e.department_id,
               'position_id', e.position_id,
               'hire_date', e.hire_date
             ) ORDER BY e.employee_id), '[]'::jsonb)
        FROM employees e
       WHERE e.employment_status IN ('ACTIVE', 'ONBOARDING')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.api_v1_employees(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_v1_employees(text) TO anon, authenticated;

-- ===========================================================================
-- Source: 20260924000009_hr_tab_system_fields.sql
-- ===========================================================================

/*
  # HR: system-field persistence for employee profile tabs

  The Guarantor / Medical / Qualifications tabs render `systemFieldDefs`
  through DynamicForm but several keys had no real column to persist to,
  and the pages passed no save handler — so nothing was ever stored and
  the onboarding checklist (which probes these tables for row existence)
  could never tick those steps.

  Additive changes only:
  1. employee_guarantors: + occupation, employer
  2. employee_qualifications: + field_of_study, grade_class
  3. employee_medical: + emergency_medical_contact
  4. update_employee_qualifications RLS aligned with its sibling
     sub-record tables (own row OR employees.manage) — it was the only
     one that blocked self-service correction during onboarding.
*/

ALTER TABLE employee_guarantors ADD COLUMN IF NOT EXISTS occupation text;
ALTER TABLE employee_guarantors ADD COLUMN IF NOT EXISTS employer text;

ALTER TABLE employee_qualifications ADD COLUMN IF NOT EXISTS field_of_study text;
ALTER TABLE employee_qualifications ADD COLUMN IF NOT EXISTS grade_class text;

ALTER TABLE employee_medical ADD COLUMN IF NOT EXISTS emergency_medical_contact text;

DROP POLICY IF EXISTS "update_employee_qualifications" ON employee_qualifications;
CREATE POLICY "update_employee_qualifications" ON employee_qualifications FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

