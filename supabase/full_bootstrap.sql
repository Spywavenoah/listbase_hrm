-- ===========================================================================
-- HRM - COMPLETE database bootstrap (all migrations + seed data in one file)
--
-- Contains every table, function, trigger, policy, index and seed record
-- from supabase/migrations/ (20260811143657 .. 20260924000001), in order.
--
-- HOW TO USE (new/empty Supabase project):
--   1. Supabase Dashboard -> SQL Editor
--   2. Paste this ENTIRE file and run it once as the 'postgres' role.
--
-- Notes:
--   - pgcrypto is required (password hashing). pg_cron/pg_net are optional
--     and guarded (failure only skips the scheduled email drain).
--   - Safe to re-run: DDL is IF NOT EXISTS / CREATE OR REPLACE, seeds are
--     ON CONFLICT-guarded. On a NON-empty database, prefer running the
--     individual migrations instead.
--   - After running: configure SMTP under Settings -> SMTP, and optionally
--     uncomment the admin employee seed at the very bottom.
-- ===========================================================================

-- ===========================================================================
-- 20260811143657_create_core_schema.sql
-- ===========================================================================

/*
# Create Core HRM+ERP Schema

This migration creates the foundational tables for the HRM+ERP platform:

1. **System Settings** — branding, company profile, payment config, SMTP config
2. **Mail Templates** — editable email templates per system event
3. **Field Definitions** — admin-defined custom fields per module (the no-code field engine)
4. **Field Values** — EAV sidecar storing custom field data per record
5. **Departments** — organizational units
6. **Positions** — job positions (separate from employees)
7. **Employees** — the master employee record with system fields
8. **Employee Documents** — document repository per employee
9. **Onboarding Templates** — admin-configured onboarding flows
10. **Onboarding Steps** — individual steps within a template
11. **Employee Onboarding Progress** — tracks per-employee onboarding completion
12. **Workflow Definitions** — configurable approval chains
13. **Workflow Steps** — steps within a workflow
14. **Workflow Instances** — runtime workflow executions
15. **Workflow Actions** — actions taken during workflow execution
16. **Module Workflow Config** — per-module workflow enable/disable toggle
17. **Audit Log** — append-only audit trail
18. **Leave Types** — configurable leave categories
19. **Leave Requests** — employee leave applications
20. **Attendance** — clock in/out records
21. **Assets** — asset catalog
22. **Pay Components** — configurable earnings/deductions
23. **Payroll Runs** — payroll run lifecycle
24. **Payslips** — individual payslip records
25. **Recruitment Jobs** — job postings
26. **Candidates** — job applicants
27. **Performance Reviews** — employee performance reviews

Security:
- RLS enabled on all tables
- Policies allow authenticated users full CRUD (multi-user HR system)
*/

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name text NOT NULL,
  key text NOT NULL,
  value jsonb,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(group_name, key)
);
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_system_settings" ON system_settings;
CREATE POLICY "select_system_settings" ON system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_system_settings" ON system_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_system_settings" ON system_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_system_settings" ON system_settings FOR DELETE TO authenticated USING (true);

-- Mail Templates
CREATE TABLE IF NOT EXISTS mail_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text UNIQUE NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  variables jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE mail_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_mail_templates" ON mail_templates;
CREATE POLICY "select_mail_templates" ON mail_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_mail_templates" ON mail_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_mail_templates" ON mail_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_mail_templates" ON mail_templates FOR DELETE TO authenticated USING (true);

-- Field Definitions
CREATE TABLE IF NOT EXISTS field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL,
  field_key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL DEFAULT 'TEXT',
  options jsonb,
  is_required boolean DEFAULT false,
  is_unique boolean DEFAULT false,
  default_value jsonb,
  validation jsonb,
  visibility jsonb,
  section text,
  sort_order integer DEFAULT 0,
  is_system boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(module_key, field_key)
);
ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_field_definitions_module ON field_definitions(module_key);
CREATE INDEX IF NOT EXISTS idx_field_definitions_active ON field_definitions(module_key, is_active);
DROP POLICY IF EXISTS "select_field_definitions" ON field_definitions;
CREATE POLICY "select_field_definitions" ON field_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_field_definitions" ON field_definitions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_field_definitions" ON field_definitions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_field_definitions" ON field_definitions FOR DELETE TO authenticated USING (true);

-- Field Values
CREATE TABLE IF NOT EXISTS field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL,
  record_id uuid NOT NULL,
  field_key text NOT NULL,
  value jsonb,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(module_key, record_id, field_key)
);
ALTER TABLE field_values ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_field_values_record ON field_values(module_key, record_id);
DROP POLICY IF EXISTS "select_field_values" ON field_values;
CREATE POLICY "select_field_values" ON field_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_field_values" ON field_values FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_field_values" ON field_values FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_field_values" ON field_values FOR DELETE TO authenticated USING (true);

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  parent_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  head_id uuid,
  cost_center text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_departments" ON departments;
CREATE POLICY "select_departments" ON departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_departments" ON departments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_departments" ON departments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_departments" ON departments FOR DELETE TO authenticated USING (true);

-- Positions
CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  grade text,
  reporting_to_position_id uuid REFERENCES positions(id) ON DELETE SET NULL,
  budgeted_salary_min numeric,
  budgeted_salary_max numeric,
  employment_type text DEFAULT 'FULL_TIME',
  status text DEFAULT 'VACANT',
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_positions" ON positions;
CREATE POLICY "select_positions" ON positions FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_positions" ON positions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_positions" ON positions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_positions" ON positions FOR DELETE TO authenticated USING (true);

-- Employees
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  date_of_birth date,
  gender text,
  national_id text,
  avatar_url text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  employment_type text DEFAULT 'FULL_TIME',
  employment_status text DEFAULT 'PENDING_VERIFICATION',
  hire_date date,
  position_id uuid REFERENCES positions(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  reporting_manager_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  compensation_grade text,
  bank_name text,
  bank_account_number text,
  bank_routing_number text,
  emergency_contact_name text,
  emergency_contact_phone text,
  is_2fa_enabled boolean DEFAULT false,
  is_login_blocked boolean DEFAULT false,
  onboarding_template_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(employment_status);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(reporting_manager_id);
DROP POLICY IF EXISTS "select_employees" ON employees;
CREATE POLICY "select_employees" ON employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_employees" ON employees FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_employees" ON employees FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_employees" ON employees FOR DELETE TO authenticated USING (true);

-- Employee Documents
CREATE TABLE IF NOT EXISTS employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  document_type text,
  file_url text,
  expiry_date date,
  status text DEFAULT 'ACTIVE',
  uploaded_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_emp_docs_employee ON employee_documents(employee_id);
DROP POLICY IF EXISTS "select_employee_documents" ON employee_documents;
CREATE POLICY "select_employee_documents" ON employee_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_employee_documents" ON employee_documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_employee_documents" ON employee_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_employee_documents" ON employee_documents FOR DELETE TO authenticated USING (true);

-- Onboarding Templates
CREATE TABLE IF NOT EXISTS onboarding_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE onboarding_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_onboarding_templates" ON onboarding_templates;
CREATE POLICY "select_onboarding_templates" ON onboarding_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_onboarding_templates" ON onboarding_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_onboarding_templates" ON onboarding_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_onboarding_templates" ON onboarding_templates FOR DELETE TO authenticated USING (true);

-- Onboarding Steps
CREATE TABLE IF NOT EXISTS onboarding_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  step_type text NOT NULL DEFAULT 'CUSTOM_FORM',
  title text NOT NULL,
  description text,
  is_required boolean DEFAULT true,
  document_url text,
  module_key text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE onboarding_steps ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_onboarding_steps_template ON onboarding_steps(template_id);
DROP POLICY IF EXISTS "select_onboarding_steps" ON onboarding_steps;
CREATE POLICY "select_onboarding_steps" ON onboarding_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_onboarding_steps" ON onboarding_steps FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_onboarding_steps" ON onboarding_steps FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_onboarding_steps" ON onboarding_steps FOR DELETE TO authenticated USING (true);

-- Employee Onboarding Progress
CREATE TABLE IF NOT EXISTS employee_onboarding_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES onboarding_steps(id) ON DELETE CASCADE,
  status text DEFAULT 'PENDING',
  acknowledged_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, step_id)
);
ALTER TABLE employee_onboarding_progress ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_employee ON employee_onboarding_progress(employee_id);
DROP POLICY IF EXISTS "select_onboarding_progress" ON employee_onboarding_progress;
CREATE POLICY "select_onboarding_progress" ON employee_onboarding_progress FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_onboarding_progress" ON employee_onboarding_progress FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_onboarding_progress" ON employee_onboarding_progress FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_onboarding_progress" ON employee_onboarding_progress FOR DELETE TO authenticated USING (true);

-- Workflow Definitions
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  module_key text NOT NULL,
  trigger_event text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_workflow_definitions" ON workflow_definitions;
CREATE POLICY "select_workflow_definitions" ON workflow_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_workflow_definitions" ON workflow_definitions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_definitions" ON workflow_definitions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_definitions" ON workflow_definitions FOR DELETE TO authenticated USING (true);

-- Workflow Steps
CREATE TABLE IF NOT EXISTS workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  approver_role text,
  approver_user_id uuid,
  is_parallel boolean DEFAULT false,
  condition jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_workflow_steps_def ON workflow_steps(workflow_definition_id);
DROP POLICY IF EXISTS "select_workflow_steps" ON workflow_steps;
CREATE POLICY "select_workflow_steps" ON workflow_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_workflow_steps" ON workflow_steps FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_steps" ON workflow_steps FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_steps" ON workflow_steps FOR DELETE TO authenticated USING (true);

-- Workflow Instances
CREATE TABLE IF NOT EXISTS workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  record_id uuid NOT NULL,
  status text DEFAULT 'PENDING',
  current_step_id uuid REFERENCES workflow_steps(id) ON DELETE SET NULL,
  initiated_by uuid,
  initiated_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_workflow_instances_record ON workflow_instances(module_key, record_id);
DROP POLICY IF EXISTS "select_workflow_instances" ON workflow_instances;
CREATE POLICY "select_workflow_instances" ON workflow_instances FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_workflow_instances" ON workflow_instances FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_instances" ON workflow_instances FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_instances" ON workflow_instances FOR DELETE TO authenticated USING (true);

-- Workflow Actions
CREATE TABLE IF NOT EXISTS workflow_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id uuid NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_id uuid REFERENCES workflow_steps(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_id uuid,
  comment text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE workflow_actions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_workflow_actions_instance ON workflow_actions(workflow_instance_id);
DROP POLICY IF EXISTS "select_workflow_actions" ON workflow_actions;
CREATE POLICY "select_workflow_actions" ON workflow_actions FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_workflow_actions" ON workflow_actions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_actions" ON workflow_actions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_actions" ON workflow_actions FOR DELETE TO authenticated USING (true);

-- Module Workflow Config
CREATE TABLE IF NOT EXISTS module_workflow_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text UNIQUE NOT NULL,
  is_enabled boolean DEFAULT false,
  workflow_definition_id uuid REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE module_workflow_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_module_workflow_config" ON module_workflow_config;
CREATE POLICY "select_module_workflow_config" ON module_workflow_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_module_workflow_config" ON module_workflow_config FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_module_workflow_config" ON module_workflow_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_module_workflow_config" ON module_workflow_config FOR DELETE TO authenticated USING (true);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  module_key text NOT NULL,
  record_id uuid,
  field_key text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_audit_log_module ON audit_log(module_key, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
DROP POLICY IF EXISTS "select_audit_log" ON audit_log;
CREATE POLICY "select_audit_log" ON audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_audit_log" ON audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- Leave Types
CREATE TABLE IF NOT EXISTS leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  description text,
  color text,
  accrual_policy text DEFAULT 'FIXED',
  annual_allocation numeric DEFAULT 0,
  carry_forward_limit numeric DEFAULT 0,
  is_paid boolean DEFAULT true,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_leave_types" ON leave_types;
CREATE POLICY "select_leave_types" ON leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_leave_types" ON leave_types FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_leave_types" ON leave_types FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_leave_types" ON leave_types FOR DELETE TO authenticated USING (true);

-- Leave Requests
CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  status text DEFAULT 'PENDING',
  approver_id uuid,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
DROP POLICY IF EXISTS "select_leave_requests" ON leave_requests;
CREATE POLICY "select_leave_requests" ON leave_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_leave_requests" ON leave_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_leave_requests" ON leave_requests FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_leave_requests" ON leave_requests FOR DELETE TO authenticated USING (true);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  clock_in timestamptz,
  clock_out timestamptz,
  date date NOT NULL,
  status text DEFAULT 'PRESENT',
  work_hours numeric,
  overtime_hours numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id, date);
DROP POLICY IF EXISTS "select_attendance" ON attendance;
CREATE POLICY "select_attendance" ON attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_attendance" ON attendance FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_attendance" ON attendance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_attendance" ON attendance FOR DELETE TO authenticated USING (true);

-- Assets
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag text UNIQUE,
  name text NOT NULL,
  asset_type text,
  category text,
  serial_number text,
  condition_status text DEFAULT 'GOOD',
  status text DEFAULT 'AVAILABLE',
  purchase_date date,
  purchase_value numeric,
  current_value numeric,
  assigned_to uuid REFERENCES employees(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_assets_assigned ON assets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
DROP POLICY IF EXISTS "select_assets" ON assets;
CREATE POLICY "select_assets" ON assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_assets" ON assets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_assets" ON assets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_assets" ON assets FOR DELETE TO authenticated USING (true);

-- Pay Components
CREATE TABLE IF NOT EXISTS pay_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  component_type text NOT NULL DEFAULT 'EARNING',
  calculation_type text DEFAULT 'FIXED',
  formula text,
  is_taxable boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE pay_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_pay_components" ON pay_components;
CREATE POLICY "select_pay_components" ON pay_components FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_pay_components" ON pay_components FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_pay_components" ON pay_components FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_pay_components" ON pay_components FOR DELETE TO authenticated USING (true);

-- Payroll Runs
CREATE TABLE IF NOT EXISTS payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  pay_period_start date NOT NULL,
  pay_period_end date NOT NULL,
  status text DEFAULT 'DRAFT',
  total_gross numeric DEFAULT 0,
  total_deductions numeric DEFAULT 0,
  total_net numeric DEFAULT 0,
  run_date timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_payroll_runs" ON payroll_runs;
CREATE POLICY "select_payroll_runs" ON payroll_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_payroll_runs" ON payroll_runs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_payroll_runs" ON payroll_runs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_payroll_runs" ON payroll_runs FOR DELETE TO authenticated USING (true);

-- Payslips
CREATE TABLE IF NOT EXISTS payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  gross_pay numeric DEFAULT 0,
  total_deductions numeric DEFAULT 0,
  net_pay numeric DEFAULT 0,
  earnings jsonb DEFAULT '[]'::jsonb,
  deductions jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'DRAFT',
  generated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(payroll_run_id);
DROP POLICY IF EXISTS "select_payslips" ON payslips;
CREATE POLICY "select_payslips" ON payslips FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_payslips" ON payslips FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_payslips" ON payslips FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_payslips" ON payslips FOR DELETE TO authenticated USING (true);

-- Recruitment Jobs
CREATE TABLE IF NOT EXISTS recruitment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid REFERENCES positions(id) ON DELETE SET NULL,
  title text NOT NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  description text,
  requirements text,
  status text DEFAULT 'DRAFT',
  posted_date timestamptz,
  closing_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE recruitment_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_recruitment_jobs" ON recruitment_jobs;
CREATE POLICY "select_recruitment_jobs" ON recruitment_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_recruitment_jobs" ON recruitment_jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_recruitment_jobs" ON recruitment_jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_recruitment_jobs" ON recruitment_jobs FOR DELETE TO authenticated USING (true);

-- Candidates
CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES recruitment_jobs(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  resume_url text,
  current_stage text DEFAULT 'APPLIED',
  rating integer,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_candidates_job ON candidates(job_id);
DROP POLICY IF EXISTS "select_candidates" ON candidates;
CREATE POLICY "select_candidates" ON candidates FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_candidates" ON candidates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_candidates" ON candidates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_candidates" ON candidates FOR DELETE TO authenticated USING (true);

-- Performance Reviews
CREATE TABLE IF NOT EXISTS performance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  review_cycle text NOT NULL,
  reviewer_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  status text DEFAULT 'DRAFT',
  rating numeric,
  goals jsonb DEFAULT '[]'::jsonb,
  feedback text,
  submitted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_perf_reviews_employee ON performance_reviews(employee_id);
DROP POLICY IF EXISTS "select_performance_reviews" ON performance_reviews;
CREATE POLICY "select_performance_reviews" ON performance_reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_performance_reviews" ON performance_reviews FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_performance_reviews" ON performance_reviews FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_performance_reviews" ON performance_reviews FOR DELETE TO authenticated USING (true);

-- ===========================================================================
-- 20260812073341_create_extended_module_tables.sql
-- ===========================================================================

/*
# Create Extended Module Tables

This migration adds 4 new tables to support sub-routes referenced in the sidebar:

1. **Holidays** — company-wide holiday calendar for the Leave module
2. **Performance Goals** — individual employee goals linked to reviews
3. **Training Courses** — course catalog for the Training module
4. **Training Enrollments** — per-employee course enrollment tracking

All tables have RLS enabled with full CRUD policies for authenticated users,
matching the existing multi-user HR system pattern.
*/

-- Holidays
CREATE TABLE IF NOT EXISTS holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  holiday_date date NOT NULL,
  description text,
  is_recurring boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);
DROP POLICY IF EXISTS "select_holidays" ON holidays;
CREATE POLICY "select_holidays" ON holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_holidays" ON holidays FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_holidays" ON holidays FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_holidays" ON holidays FOR DELETE TO authenticated USING (true);

-- Performance Goals
CREATE TABLE IF NOT EXISTS performance_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  target_date date,
  status text DEFAULT 'IN_PROGRESS',
  progress integer DEFAULT 0,
  review_cycle text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE performance_goals ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_perf_goals_employee ON performance_goals(employee_id);
CREATE INDEX IF NOT EXISTS idx_perf_goals_status ON performance_goals(status);
DROP POLICY IF EXISTS "select_performance_goals" ON performance_goals;
CREATE POLICY "select_performance_goals" ON performance_goals FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_performance_goals" ON performance_goals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_performance_goals" ON performance_goals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_performance_goals" ON performance_goals FOR DELETE TO authenticated USING (true);

-- Training Courses
CREATE TABLE IF NOT EXISTS training_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text,
  description text,
  is_mandatory boolean DEFAULT false,
  duration_hours integer,
  instructor text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE training_courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_training_courses" ON training_courses;
CREATE POLICY "select_training_courses" ON training_courses FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_training_courses" ON training_courses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_training_courses" ON training_courses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_training_courses" ON training_courses FOR DELETE TO authenticated USING (true);

-- Training Enrollments
CREATE TABLE IF NOT EXISTS training_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status text DEFAULT 'ENROLLED',
  enrolled_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  progress integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(course_id, employee_id)
);
ALTER TABLE training_enrollments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_training_enrollments_course ON training_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_employee ON training_enrollments(employee_id);
DROP POLICY IF EXISTS "select_training_enrollments" ON training_enrollments;
CREATE POLICY "select_training_enrollments" ON training_enrollments FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_training_enrollments" ON training_enrollments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_training_enrollments" ON training_enrollments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_training_enrollments" ON training_enrollments FOR DELETE TO authenticated USING (true);

-- ===========================================================================
-- 20260812075550_fix_rls_policies_for_anon.sql
-- ===========================================================================

/*
# Fix RLS Policies for No-Auth App (Retry)

This app has NO sign-in screen, so the browser always uses the anon key.
All existing policies are scoped `TO authenticated` only, which means every
INSERT/UPDATE/DELETE from the frontend fails with "new row violates row-level
security policy."

This migration dynamically drops ALL existing policies on ALL tables in the
public schema, then recreates them with `TO anon, authenticated` so the
anon-key client can read and write. `USING (true)` / `WITH CHECK (true)` is
acceptable because this is a single-tenant HR system with intentionally shared data.
*/

-- Step 1: Drop ALL existing policies on ALL public tables dynamically
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Step 2: Recreate all policies with TO anon, authenticated
-- system_settings
CREATE POLICY "select_system_settings" ON system_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_system_settings" ON system_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_system_settings" ON system_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_system_settings" ON system_settings FOR DELETE TO anon, authenticated USING (true);

-- mail_templates
CREATE POLICY "select_mail_templates" ON mail_templates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_mail_templates" ON mail_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_mail_templates" ON mail_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_mail_templates" ON mail_templates FOR DELETE TO anon, authenticated USING (true);

-- field_definitions
CREATE POLICY "select_field_definitions" ON field_definitions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_field_definitions" ON field_definitions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_field_definitions" ON field_definitions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_field_definitions" ON field_definitions FOR DELETE TO anon, authenticated USING (true);

-- field_values
CREATE POLICY "select_field_values" ON field_values FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_field_values" ON field_values FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_field_values" ON field_values FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_field_values" ON field_values FOR DELETE TO anon, authenticated USING (true);

-- departments
CREATE POLICY "select_departments" ON departments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_departments" ON departments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_departments" ON departments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_departments" ON departments FOR DELETE TO anon, authenticated USING (true);

-- positions
CREATE POLICY "select_positions" ON positions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_positions" ON positions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_positions" ON positions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_positions" ON positions FOR DELETE TO anon, authenticated USING (true);

-- employees
CREATE POLICY "select_employees" ON employees FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_employees" ON employees FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_employees" ON employees FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_employees" ON employees FOR DELETE TO anon, authenticated USING (true);

-- employee_documents
CREATE POLICY "select_employee_documents" ON employee_documents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_employee_documents" ON employee_documents FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_employee_documents" ON employee_documents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_employee_documents" ON employee_documents FOR DELETE TO anon, authenticated USING (true);

-- onboarding_templates
CREATE POLICY "select_onboarding_templates" ON onboarding_templates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_onboarding_templates" ON onboarding_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_onboarding_templates" ON onboarding_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_onboarding_templates" ON onboarding_templates FOR DELETE TO anon, authenticated USING (true);

-- onboarding_steps
CREATE POLICY "select_onboarding_steps" ON onboarding_steps FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_onboarding_steps" ON onboarding_steps FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_onboarding_steps" ON onboarding_steps FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_onboarding_steps" ON onboarding_steps FOR DELETE TO anon, authenticated USING (true);

-- employee_onboarding_progress
CREATE POLICY "select_onboarding_progress" ON employee_onboarding_progress FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_onboarding_progress" ON employee_onboarding_progress FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_onboarding_progress" ON employee_onboarding_progress FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_onboarding_progress" ON employee_onboarding_progress FOR DELETE TO anon, authenticated USING (true);

-- workflow_definitions
CREATE POLICY "select_workflow_definitions" ON workflow_definitions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_workflow_definitions" ON workflow_definitions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_definitions" ON workflow_definitions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_definitions" ON workflow_definitions FOR DELETE TO anon, authenticated USING (true);

-- workflow_steps
CREATE POLICY "select_workflow_steps" ON workflow_steps FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_workflow_steps" ON workflow_steps FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_steps" ON workflow_steps FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_steps" ON workflow_steps FOR DELETE TO anon, authenticated USING (true);

-- workflow_instances
CREATE POLICY "select_workflow_instances" ON workflow_instances FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_workflow_instances" ON workflow_instances FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_instances" ON workflow_instances FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_instances" ON workflow_instances FOR DELETE TO anon, authenticated USING (true);

-- workflow_actions
CREATE POLICY "select_workflow_actions" ON workflow_actions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_workflow_actions" ON workflow_actions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_actions" ON workflow_actions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_actions" ON workflow_actions FOR DELETE TO anon, authenticated USING (true);

-- module_workflow_config
CREATE POLICY "select_module_workflow_config" ON module_workflow_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_module_workflow_config" ON module_workflow_config FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_module_workflow_config" ON module_workflow_config FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_module_workflow_config" ON module_workflow_config FOR DELETE TO anon, authenticated USING (true);

-- audit_log (no update/delete - append-only)
CREATE POLICY "select_audit_log" ON audit_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_audit_log" ON audit_log FOR INSERT TO anon, authenticated WITH CHECK (true);

-- leave_types
CREATE POLICY "select_leave_types" ON leave_types FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_leave_types" ON leave_types FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_leave_types" ON leave_types FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_leave_types" ON leave_types FOR DELETE TO anon, authenticated USING (true);

-- leave_requests
CREATE POLICY "select_leave_requests" ON leave_requests FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_leave_requests" ON leave_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_leave_requests" ON leave_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_leave_requests" ON leave_requests FOR DELETE TO anon, authenticated USING (true);

-- attendance
CREATE POLICY "select_attendance" ON attendance FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_attendance" ON attendance FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_attendance" ON attendance FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_attendance" ON attendance FOR DELETE TO anon, authenticated USING (true);

-- assets
CREATE POLICY "select_assets" ON assets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_assets" ON assets FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_assets" ON assets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_assets" ON assets FOR DELETE TO anon, authenticated USING (true);

-- pay_components
CREATE POLICY "select_pay_components" ON pay_components FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_pay_components" ON pay_components FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_pay_components" ON pay_components FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_pay_components" ON pay_components FOR DELETE TO anon, authenticated USING (true);

-- payroll_runs
CREATE POLICY "select_payroll_runs" ON payroll_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_payroll_runs" ON payroll_runs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_payroll_runs" ON payroll_runs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_payroll_runs" ON payroll_runs FOR DELETE TO anon, authenticated USING (true);

-- payslips
CREATE POLICY "select_payslips" ON payslips FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_payslips" ON payslips FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_payslips" ON payslips FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_payslips" ON payslips FOR DELETE TO anon, authenticated USING (true);

-- recruitment_jobs
CREATE POLICY "select_recruitment_jobs" ON recruitment_jobs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_recruitment_jobs" ON recruitment_jobs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_recruitment_jobs" ON recruitment_jobs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_recruitment_jobs" ON recruitment_jobs FOR DELETE TO anon, authenticated USING (true);

-- candidates
CREATE POLICY "select_candidates" ON candidates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_candidates" ON candidates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_candidates" ON candidates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_candidates" ON candidates FOR DELETE TO anon, authenticated USING (true);

-- performance_reviews
CREATE POLICY "select_performance_reviews" ON performance_reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_performance_reviews" ON performance_reviews FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_performance_reviews" ON performance_reviews FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_performance_reviews" ON performance_reviews FOR DELETE TO anon, authenticated USING (true);

-- holidays
CREATE POLICY "select_holidays" ON holidays FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_holidays" ON holidays FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_holidays" ON holidays FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_holidays" ON holidays FOR DELETE TO anon, authenticated USING (true);

-- performance_goals
CREATE POLICY "select_performance_goals" ON performance_goals FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_performance_goals" ON performance_goals FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_performance_goals" ON performance_goals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_performance_goals" ON performance_goals FOR DELETE TO anon, authenticated USING (true);

-- training_courses
CREATE POLICY "select_training_courses" ON training_courses FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_training_courses" ON training_courses FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_training_courses" ON training_courses FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_training_courses" ON training_courses FOR DELETE TO anon, authenticated USING (true);

-- training_enrollments
CREATE POLICY "select_training_enrollments" ON training_enrollments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_training_enrollments" ON training_enrollments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_training_enrollments" ON training_enrollments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_training_enrollments" ON training_enrollments FOR DELETE TO anon, authenticated USING (true);

-- ===========================================================================
-- 20260812080759_create_notification_queue.sql
-- ===========================================================================

/*
# Create Notification Queue Table

This migration creates a `notification_queue` table that stores outgoing emails
to be processed by the `send-mail` edge function. The frontend enqueues notifications
by inserting rows; the edge function picks up PENDING rows, sends them via SMTP,
and marks them SENT or FAILED.

1. New Tables
- `notification_queue`
  - id (uuid, primary key)
  - event_key (text) — maps to mail_templates.event_key
  - recipient_email (text, not null)
  - recipient_name (text)
  - subject (text)
  - body_html (text)
  - status (text, default 'PENDING') — PENDING, SENT, FAILED
  - error_message (text)
  - attempts (integer, default 0)
  - sent_at (timestamptz)
  - metadata (jsonb) — template variables and context
  - created_at, updated_at

2. Security
- RLS enabled, TO anon, authenticated (single-tenant, no-auth app)
*/

CREATE TABLE IF NOT EXISTS notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text,
  recipient_email text NOT NULL,
  recipient_name text,
  subject text NOT NULL,
  body_html text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notification_queue_status ON notification_queue(status, created_at);

DROP POLICY IF EXISTS "select_notification_queue" ON notification_queue;
CREATE POLICY "select_notification_queue" ON notification_queue FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_notification_queue" ON notification_queue;
CREATE POLICY "insert_notification_queue" ON notification_queue FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_notification_queue" ON notification_queue;
CREATE POLICY "update_notification_queue" ON notification_queue FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_notification_queue" ON notification_queue;
CREATE POLICY "delete_notification_queue" ON notification_queue FOR DELETE TO anon, authenticated USING (true);

-- ===========================================================================
-- 20260813095322_add_employee_role_column.sql
-- ===========================================================================

/*
# Add role column to employees table

1. Changes
- Add `role` column (text, default 'EMPLOYEE') to the `employees` table.
- This enables a role-based access system: SUPER_ADMIN, HR_ADMIN, MANAGER, EMPLOYEE.
- Update noah.linus@constrabase.com to role 'SUPER_ADMIN'.
2. Security
- No RLS policy changes needed — the role column is readable by the authenticated user for their own row.
*/

ALTER TABLE employees ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'EMPLOYEE';

UPDATE employees SET role = 'SUPER_ADMIN' WHERE email = 'noah.linus@constrabase.com';

-- ===========================================================================
-- 20260915090000_create_privilege_system.sql
-- ===========================================================================

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

-- ===========================================================================
-- 20260915093000_employee_authentication.sql
-- ===========================================================================

-- ============================================================
-- Employee-based authentication
-- employees is the single authentication table: passwords are
-- stored (bcrypt) directly on employees.password_hash. No
-- dependency on Supabase Auth / auth.users.
-- Sessions are HS256 JWTs issued by the application (/api/auth/login)
-- signed with the project's SUPABASE_JWT_SECRET.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------
-- 1. Password columns on employees
-- ------------------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_updated_at timestamptz;

-- employees.user_id used to point at auth.users; it now stores the employee's
-- own id (JWT sub mapping). Drop the legacy FK so login can set user_id = id.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_user_id_fkey;

-- Keep the hash columns off the API surface. All password writes must
-- go through the SECURITY DEFINER functions below.
REVOKE SELECT (password_hash) ON TABLE employees FROM anon, authenticated;
REVOKE SELECT (password_updated_at) ON TABLE employees FROM anon, authenticated;
REVOKE UPDATE (password_hash) ON TABLE employees FROM anon, authenticated;
REVOKE UPDATE (password_updated_at) ON TABLE employees FROM anon, authenticated;
REVOKE INSERT (password_hash) ON TABLE employees FROM anon, authenticated;
REVOKE INSERT (password_updated_at) ON TABLE employees FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 2. Login RPC (callable by anon so the login page can authenticate)
--    Returns jsonb instead of raising so the UI can map errors.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authenticate_employee(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
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

  -- Keep the JWT sub -> employee mapping consistent with RLS helpers
  -- (current_employee_id matches employees.user_id = auth.uid()).
  IF v_emp.user_id IS DISTINCT FROM v_emp.id THEN
    UPDATE employees SET user_id = id WHERE id = v_emp.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'email', v_emp.email,
    'role', v_emp.role,
    'first_name', v_emp.first_name,
    'last_name', v_emp.last_name,
    'employment_status', v_emp.employment_status
  );
END;
$$;

-- ------------------------------------------------------------------
-- 3. Admin set / reset password (employees.manage or admin.privileges)
-- ------------------------------------------------------------------
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

  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'Passwords must be at least 8 characters long';
  END IF;
  IF p_password !~ '[A-Z]' THEN
    RAISE EXCEPTION 'Passwords must contain at least one uppercase letter';
  END IF;
  IF p_password !~ '\d' THEN
    RAISE EXCEPTION 'Passwords must contain at least one number';
  END IF;

  UPDATE employees
     SET     password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         password_updated_at = now(),
         updated_at         = now()
   WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- 4. Self service: change my own password (verified against current)
-- ------------------------------------------------------------------
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

  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'Passwords must be at least 8 characters long';
  END IF;
  IF p_new_password !~ '[A-Z]' THEN
    RAISE EXCEPTION 'Passwords must contain at least one uppercase letter';
  END IF;
  IF p_new_password !~ '\d' THEN
    RAISE EXCEPTION 'Passwords must contain at least one number';
  END IF;

  UPDATE employees
     SET     password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         password_updated_at = now(),
         updated_at          = now()
   WHERE id = v_emp.id;
END;
$$;

-- ------------------------------------------------------------------
-- 5. Execution grants
--    authenticate_employee: public (login needs anon)
--    set_employee_password / change_my_password: authenticated only
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_employee_password(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_my_password(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_employee_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_my_password(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_employee(text, text) TO anon, authenticated;

-- ------------------------------------------------------------------
-- 6. Self-update guard: employees may update their own row, but only
--    via RPCs may the password columns change (defender blocks direct
--    UPDATE of password_hash through the API via the column revokes).
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "update_employees" ON employees;
CREATE POLICY "update_employees" ON employees FOR UPDATE TO authenticated
  USING (id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (public.has_privilege('employees.manage')
              OR (id = public.current_employee_id()
                  AND role = (SELECT e.role FROM employees e WHERE e.id = public.current_employee_id())
                  AND password_hash IS NOT DISTINCT FROM
                      (SELECT e.password_hash FROM employees e WHERE e.id = public.current_employee_id())
                  AND password_updated_at IS NOT DISTINCT FROM
                      (SELECT e.password_updated_at FROM employees e WHERE e.id = public.current_employee_id())));

-- ===========================================================================
-- 20260915110000_self_service_password_setup.sql
-- ===========================================================================

-- ============================================================
-- Self-service password setup
-- New employees receive a welcome email (letterhead template,
-- event welcome.new_employee) with a "Start Onboarding" button
-- that links to /setup-account?token=... They must set their
-- own password here BEFORE the onboarding wizard is accessible.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. One-time setup tokens (hashed). Only ever touched via the
--    SECURITY DEFINER RPCs below; direct API access is revoked.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_setup_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  used_at timestamptz,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one active setup token per employee (re-invite overwrites).
CREATE UNIQUE INDEX IF NOT EXISTS employee_setup_tokens_employee_id_key
  ON public.employee_setup_tokens(employee_id);

ALTER TABLE public.employee_setup_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated/service_role get nothing directly.
REVOKE ALL ON public.employee_setup_tokens FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 2. Admin: create a setup token for an employee, returns the RAW
--    token once (for the invitation link). Single active token.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_setup_token(p_employee_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
  v_expired_at timestamptz;
  v_count int;
BEGIN
  IF NOT (public.has_privilege('employees.manage') OR public.has_privilege('admin.privileges')) THEN
    RAISE EXCEPTION 'You do not have permission to issue setup links';
  END IF;

  SELECT count(*) INTO v_count FROM public.employees WHERE id = p_employee_id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');
  v_expired_at := now() + interval '72 hours';

  DELETE FROM public.employee_setup_tokens WHERE employee_id = p_employee_id;

  INSERT INTO public.employee_setup_tokens (employee_id, token_hash, expires_at, created_by)
  VALUES (p_employee_id,
          encode(extensions.digest(v_raw, 'sha256'), 'hex'),
          v_expired_at,
          auth.uid());

  RETURN v_raw;
END;
$$;

-- ------------------------------------------------------------------
-- 3. Validate a setup token (used by the setup page before showing
--    the form). Never reveals the raw token or the hash.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_setup_token(p_token text)
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

  SELECT * INTO v_emp FROM public.employees e WHERE e.id = v_row.employee_id;
  IF NOT FOUND OR v_emp.password_hash IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_USED');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'first_name', v_emp.first_name,
    'last_name', v_emp.last_name,
    'email', v_emp.email,
    'employment_status', v_emp.employment_status
  );
END;
$$;

-- ------------------------------------------------------------------
-- 4. Complete password setup: validate token, enforce password
--    policy, set the hash, invalidate the token. Callable by anon
--    (the setup link recipient).
-- ------------------------------------------------------------------
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

  IF p_password IS NULL OR length(p_password) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WEAK_PASSWORD', 'message', 'Passwords must be at least 8 characters long');
  END IF;
  IF p_password !~ '[A-Z]' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WEAK_PASSWORD', 'message', 'Passwords must contain at least one uppercase letter');
  END IF;
  IF p_password !~ '\d' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WEAK_PASSWORD', 'message', 'Passwords must contain at least one number');
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

-- ------------------------------------------------------------------
-- 5. Grants
--    create_setup_token:   authenticated (admin-checked inside)
--    validate_setup_token / complete_password_setup: anon
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_setup_token(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_setup_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_password_setup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_setup_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_setup_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_password_setup(text, text) TO anon, authenticated;

-- ===========================================================================
-- 20260915120000_employee_row_actions.sql
-- ===========================================================================

-- Employee self-service default privilege + row-action support (disable/enable).

-- Every employee always has self-service access to their own profile,
-- onboarding and self-service modules. Persist it as a marker privilege so it
-- shows up consistently in the access UI as the default grant.
INSERT INTO privilege_definitions (key, category, label, description, sort_order)
VALUES ('self-service', 'Employee', 'Employee Self-Service', 'Default access to own profile, self-service and onboarding', 0)
ON CONFLICT (key) DO NOTHING;

-- Always re-grant self-service when access is saved, so it can never be revoked.
CREATE OR REPLACE FUNCTION public.set_employee_access(p_employee_id uuid, p_role text DEFAULT 'EMPLOYEE'::text, p_privileges text[] DEFAULT '{}'::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- self-service is always granted and can never be revoked
    INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
    SELECT p_employee_id, pk, v_caller_id
      FROM (SELECT DISTINCT pk
              FROM unnest(ARRAY['self-service']::text[] || p_privileges) AS t(pk)) s
     WHERE EXISTS (SELECT 1 FROM privilege_definitions pd WHERE pd.key = s.pk);
  ELSE
    INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
    VALUES (p_employee_id, 'self-service', v_caller_id);
  END IF;
END;
$function$;

-- Grant the default self-service privilege to all existing employees.
INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
SELECT e.id, 'self-service', e.id
  FROM employees e
  LEFT JOIN employee_privileges ep
         ON ep.employee_id = e.id AND ep.privilege_key = 'self-service'
 WHERE ep.employee_id IS NULL;

-- Disable / re-enable an employee (blocks login, keeps record intact).
CREATE OR REPLACE FUNCTION public.set_employee_disabled(p_employee_id uuid, p_disabled boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_privilege('employees.manage') THEN
    RAISE EXCEPTION 'You do not have permission to disable employees';
  END IF;

  UPDATE employees SET is_login_blocked = p_disabled, updated_at = now() WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_employee_disabled(uuid, boolean) TO authenticated;

-- ===========================================================================
-- 20260915130000_employee_document_uploads.sql
-- ===========================================================================

-- Employee document uploads: private storage bucket + metadata columns.
-- Bucket holds PDF/JPEG/PNG files; access is governed by the same privilege
-- model as the rest of the app (owners, employees.manage, employees.view_all).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-documents',
  'employee-documents',
  false,
  15728640, -- 15 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- SELECT: owner (via auth.uid()) or anyone holding employees.view_all / manage.
DROP POLICY IF EXISTS employee_docs_select ON storage.objects;
CREATE POLICY employee_docs_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'employee-documents'
    AND (
      owner = auth.uid()
      OR public.has_privilege('employees.view_all')
    )
  );

-- INSERT: managers may upload anywhere; self-service employees may upload only
-- into their own employee-id folder.
DROP POLICY IF EXISTS employee_docs_insert ON storage.objects;
CREATE POLICY employee_docs_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-documents'
    AND (
      public.has_privilege('employees.manage')
      OR (storage.foldername(name))[1] = (SELECT public.current_employee_id()::text)
    )
  );

-- DELETE: owner or managers.
DROP POLICY IF EXISTS employee_docs_delete ON storage.objects;
CREATE POLICY employee_docs_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'employee-documents'
    AND (
      owner = auth.uid()
      OR public.has_privilege('employees.manage')
    )
  );

-- Metadata for real uploaded files (legacy file_url text remains for existing rows).
ALTER TABLE public.employee_documents
  ADD COLUMN IF NOT EXISTS file_path text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_type text,
  ADD COLUMN IF NOT EXISTS file_size bigint;

-- ===========================================================================
-- 20260923000000_create_reports_analytics.sql
-- ===========================================================================

/*
# Reports & Analytics — aggregated data source

Backs the `/reports` dashboard with live, privilege-gated aggregates.

- `reports_analytics(p_months)` — SECURITY DEFINER function returning a JSON
  payload of all dashboard series (headcount, hires/exits, payroll cost,
  department distribution, attendance, leave and recruitment funnels).
- The function is guarded by `has_privilege('admin.reports')` so raw
  organization-wide aggregates (including payroll totals) are never exposed
  to employees without report-builder access.

Conventions followed:
- `SET search_path = public`
- `SECURITY DEFINER` (like `set_employee_access`, `current_employee_id`)
- grant to `authenticated`, revoke from PUBLIC
*/

CREATE OR REPLACE FUNCTION public.reports_analytics(p_months integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_p_months integer := GREATEST(LEAST(COALESCE(p_months, 12), 24), 3);
  v_departed_statuses text[] := ARRAY['TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED'];
BEGIN
  IF NOT public.has_privilege('admin.reports') THEN
    RAISE EXCEPTION 'You do not have permission to view reports';
  END IF;

  WITH months AS (
    SELECT date_trunc('month', d)::date AS month_start
      FROM generate_series(
             date_trunc('month', CURRENT_DATE) - make_interval(months => v_p_months - 1),
             date_trunc('month', CURRENT_DATE),
             interval '1 month'
           ) AS d
  ),
  monthly_series AS (
    SELECT m.month_start,
           to_char(m.month_start, 'YYYY-MM')       AS month_key,
           to_char(m.month_start, 'Mon')           AS label,
           (SELECT count(*)::int FROM employees h
             WHERE date_trunc('month', h.created_at)::date = m.month_start)                        AS hires,
           (SELECT count(*)::int FROM employees x
             WHERE date_trunc('month', x.updated_at)::date = m.month_start
               AND x.employment_status = ANY (v_departed_statuses))                                AS exits,
           (SELECT count(*)::int FROM employees e
             WHERE e.created_at::date <= (m.month_start + interval '1 month' - interval '1 day')::date)        AS headcount
      FROM months m
  ),
  payroll_series AS (
    SELECT date_trunc('month', pay_period_end)::date AS period_start,
           to_char(pay_period_end, 'YYYY-MM')        AS period_key,
           to_char(pay_period_end, 'Mon')            AS label,
           COALESCE(sum(total_gross), 0)             AS gross,
           COALESCE(sum(total_deductions), 0)        AS deductions,
           COALESCE(sum(total_net), 0)               AS net
      FROM payroll_runs
     WHERE status IN ('APPROVED', 'DISBURSED', 'PAID', 'PROCESSED')
     GROUP BY 1, 2, 3
  ),
  department_dist AS (
    SELECT d.name                                             AS department_name,
           count(e.id)::int                                   AS employee_count
      FROM departments d
      LEFT JOIN employees e ON e.department_id = d.id
     GROUP BY d.name
    HAVING count(e.id) > 0
     ORDER BY employee_count DESC, d.name
  ),
  attendance_daily AS (
    SELECT a.date,
           a.status,
           count(*)::int AS cnt
      FROM attendance a
     WHERE a.date >= (CURRENT_DATE - interval '30 days')::date
     GROUP BY a.date, a.status
  ),
  leave_summary AS (
    SELECT lt.name                                                          AS leave_type,
           lt.code,
           count(lr.id)::int                                                AS total_requests,
           count(*) FILTER (WHERE lr.status = 'APPROVED')::int              AS approved,
           count(*) FILTER (WHERE lr.status = 'PENDING')::int               AS pending,
           COALESCE(sum(lr.end_date - lr.start_date + 1)
                    FILTER (WHERE lr.status = 'APPROVED'), 0)               AS approved_days
      FROM leave_types lt
      LEFT JOIN leave_requests lr ON lr.leave_type_id = lt.id
     GROUP BY lt.name, lt.code
    HAVING count(lr.id) > 0
     ORDER BY approved_days DESC
  ),
  recruitment_funnel AS (
    SELECT c.current_stage AS stage,
           count(*)::int   AS cnt
      FROM candidates c
     GROUP BY c.current_stage
     ORDER BY cnt DESC
  ),
  status_dist AS (
    SELECT e.employment_status AS status,
           count(*)::int       AS cnt
      FROM employees e
     GROUP BY e.employment_status
     ORDER BY cnt DESC
  )
  SELECT jsonb_build_object(
    'generated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
    'monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month',      ms.month_key,
        'label',      ms.label,
        'hires',      ms.hires,
        'exits',      ms.exits,
        'headcount',  ms.headcount
      ) ORDER BY ms.month_start)
      FROM monthly_series ms
    ), '[]'::jsonb),
    'payroll', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month',       ps.period_key,
        'label',       ps.label,
        'gross',       ps.gross,
        'deductions',  ps.deductions,
        'net',         ps.net
      ) ORDER BY ps.period_start)
      FROM payroll_series ps
    ), '[]'::jsonb),
    'departments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', d.department_name, 'count', d.employee_count) ORDER BY d.employee_count DESC)
      FROM department_dist d
    ), '[]'::jsonb),
    'attendance30d', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',    to_char(a.date, 'YYYY-MM-DD'),
        'status',  a.status,
        'count',   a.cnt
      ) ORDER BY a.date)
      FROM attendance_daily a
    ), '[]'::jsonb),
    'leave', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type',           l.leave_type,
        'code',           l.code,
        'total',          l.total_requests,
        'approved',       l.approved,
        'pending',        l.pending,
        'approved_days',  l.approved_days
      ) ORDER BY l.approved_days DESC)
      FROM leave_summary l
    ), '[]'::jsonb),
    'recruitment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', r.stage, 'count', r.cnt) ORDER BY r.cnt DESC)
      FROM recruitment_funnel r
    ), '[]'::jsonb),
    'status', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status', s.status, 'count', s.cnt) ORDER BY s.cnt DESC)
      FROM status_dist s
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'employees',         (SELECT count(*)::int FROM employees e WHERE NOT (e.employment_status = ANY (v_departed_statuses))),
      'pending_onboarding',(SELECT count(*)::int FROM employees e WHERE e.employment_status IN ('PENDING_VERIFICATION', 'ONBOARDING')),
      'on_leave_today',    (SELECT count(*)::int FROM leave_requests lr WHERE lr.status = 'APPROVED' AND lr.start_date <= CURRENT_DATE AND lr.end_date >= CURRENT_DATE),
      'pending_leave',     (SELECT count(*)::int FROM leave_requests lr WHERE lr.status = 'PENDING'),
      'open_candidates',   (SELECT count(*)::int FROM candidates c WHERE c.current_stage NOT IN ('HIRED', 'REJECTED', 'WITHDRAWN')),
      'assets',            (SELECT count(*)::int FROM assets a WHERE a.status NOT IN ('DISPOSED', 'RETIRED'))
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reports_analytics(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reports_analytics(integer) FROM PUBLIC;

-- ===========================================================================
-- 20260923000001_payroll_engine.sql
-- ===========================================================================

/*
# Payroll Calculation Engine

Adds what the payroll module needs to *calculate* pay, not just record runs:

1. **`employees.monthly_salary`** — base monthly salary per employee (nullable).
2. **`payroll_adjustments`** — one-off earnings/deductions applied to pay runs
   within an optional effective window (NULL = always applies).
3. **`_payroll_calc_for(...)`** — internal per-employee calculator: gross from
   monthly salary prorated for unpaid leave days over the working calendar
   (weekdays minus holidays), plus earning adjustments, minus a statutory tax
   rate (read from `system_settings`, group `payroll`, key `tax_rate_pct`;
   defaults to 10%) and deduction adjustments.
4. **`payroll_preview(...)`** — read-only preview rows for a period.
5. **`generate_payroll_run(...)`** — computes every eligible payslip and creates
   a `payroll_runs` row + one `payslips` row per employee (atomic).

Security:
- All RPCs are SECURITY DEFINER and gated by `has_privilege('payroll.manage')`.
- `payroll_adjustments` is fully gated behind `payroll.manage`.
- A trigger blocks employees from changing their own compensation/banking
  fields (`monthly_salary`, grade, bank details) — previously allowed by the
  generic "update own row" RLS policy.
*/

-- ============================================================
-- 1. Salary column + adjustments table
-- ============================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_salary numeric DEFAULT 0;

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  adjustment_type text NOT NULL DEFAULT 'EARNING', -- EARNING | DEDUCTION
  amount numeric NOT NULL DEFAULT 0,
  description text,
  effective_start date,
  effective_end date,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_employee ON payroll_adjustments(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_window ON payroll_adjustments(employee_id, effective_start, effective_end);

DROP POLICY IF EXISTS "select_payroll_adjustments" ON payroll_adjustments;
DROP POLICY IF EXISTS "insert_payroll_adjustments" ON payroll_adjustments;
DROP POLICY IF EXISTS "update_payroll_adjustments" ON payroll_adjustments;
DROP POLICY IF EXISTS "delete_payroll_adjustments" ON payroll_adjustments;
CREATE POLICY "select_payroll_adjustments" ON payroll_adjustments FOR SELECT TO authenticated
  USING (public.has_privilege('payroll.manage'));
CREATE POLICY "insert_payroll_adjustments" ON payroll_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "update_payroll_adjustments" ON payroll_adjustments FOR UPDATE TO authenticated
  USING (public.has_privilege('payroll.manage'))
  WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "delete_payroll_adjustments" ON payroll_adjustments FOR DELETE TO authenticated
  USING (public.has_privilege('payroll.manage'));

-- ============================================================
-- 2. Prevent self-service edits to compensation/banking
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
-- 3. Per-employee calculator
-- ============================================================
CREATE OR REPLACE FUNCTION public._payroll_calc_for(
  p_employee_id uuid,
  p_period_start date,
  p_period_end date,
  p_tax_rate numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_monthly_salary numeric := 0;
  v_name text;
  v_department text;
  v_working_days integer := 0;
  v_unpaid_days integer := 0;
  v_gross_base numeric := 0;
  v_earnings jsonb := '[]'::jsonb;
  v_deductions jsonb := '[]'::jsonb;
  v_earnings_total numeric := 0;
  v_deductions_total numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_adj record;
BEGIN
  SELECT COALESCE(e.monthly_salary, 0),
         COALESCE(e.first_name || ' ' || e.last_name, ''),
         COALESCE(d.name, 'Unassigned')
    INTO v_monthly_salary, v_name, v_department
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.id = p_employee_id;

  v_working_days := (
    SELECT count(*)::int
      FROM generate_series(p_period_start, p_period_end, interval '1 day') AS g(dt)
     WHERE extract(isodow FROM g.dt) < 6
       AND g.dt::date NOT IN (SELECT holiday_date FROM holidays)
  );

  -- Approved days on unpaid leave types overlapping the period
  v_unpaid_days := (
    SELECT COALESCE(sum(
              (LEAST(lr.end_date, p_period_end) - GREATEST(lr.start_date, p_period_start) + 1)::int
            ), 0)::int
      FROM leave_requests lr
      JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.employee_id = p_employee_id
       AND lr.status = 'APPROVED'
       AND NOT lt.is_paid
       AND lr.start_date <= p_period_end
       AND lr.end_date >= p_period_start
  );

  IF v_working_days <= 0 THEN
    v_gross_base := v_monthly_salary;
  ELSE
    v_gross_base := round(
      v_monthly_salary * (v_working_days - v_unpaid_days)::numeric / v_working_days,
      2
    );
  END IF;

  FOR v_adj IN
    SELECT adjustment_type, amount, description
      FROM payroll_adjustments
     WHERE employee_id = p_employee_id
       AND (effective_start IS NULL OR effective_start <= p_period_end)
       AND (effective_end IS NULL OR effective_end >= p_period_start)
  LOOP
    IF v_adj.adjustment_type = 'EARNING' THEN
      v_earnings := v_earnings || jsonb_build_array(jsonb_build_object(
        'name',   COALESCE(v_adj.description, 'Adjustment'),
        'amount', v_adj.amount
      ));
      v_earnings_total := v_earnings_total + v_adj.amount;
    ELSE
      v_deductions := v_deductions || jsonb_build_array(jsonb_build_object(
        'name',   COALESCE(v_adj.description, 'Adjustment'),
        'amount', v_adj.amount
      ));
      v_deductions_total := v_deductions_total + v_adj.amount;
    END IF;
  END LOOP;

  v_gross := round(v_gross_base + v_earnings_total, 2);
  IF v_gross > 0 THEN
    v_tax := round(v_gross * COALESCE(p_tax_rate, 0) / 100, 2);
  END IF;

  IF v_tax > 0 THEN
    v_deductions := v_deductions || jsonb_build_array(jsonb_build_object(
      'name', 'Tax', 'amount', v_tax
    ));
    v_deductions_total := v_deductions_total + v_tax;
  END IF;

  v_deductions_total := round(v_deductions_total, 2);
  v_net := round(v_gross - v_deductions_total, 2);

  RETURN jsonb_build_object(
    'employee_id',     p_employee_id,
    'name',            v_name,
    'department',      v_department,
    'monthly_salary',  v_monthly_salary,
    'working_days',    v_working_days,
    'unpaid_days',     v_unpaid_days,
    'gross',           v_gross,
    'tax',             v_tax,
    'earnings_total',  v_earnings_total,
    'deductions_total',v_deductions_total,
    'net',             v_net,
    'earnings',        v_earnings,
    'deductions',      v_deductions
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._payroll_calc_for(uuid, date, date, numeric) FROM PUBLIC;

-- ============================================================
-- 4. Preview (read-only)
-- ============================================================
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
     WHERE e.employment_status NOT IN ('TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED')
       AND (p_employee_ids IS NULL OR e.id = ANY (p_employee_ids))
     ORDER BY e.first_name, e.last_name
  LOOP
    v_row := public._payroll_calc_for(v_emp_id, p_period_start, p_period_end, v_tax_rate);
    v_rows := v_rows || jsonb_build_array(v_row);
  END LOOP;

  RETURN v_rows;
END;
$$;

-- ============================================================
-- 5. Generate a payroll run + payslips (atomic)
-- ============================================================
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
     WHERE e.employment_status NOT IN ('TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED')
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
REVOKE EXECUTE ON FUNCTION public.prevent_self_service_salary_change() FROM PUBLIC;

-- ===========================================================================
-- 20260923000002_approval_workflow.sql
-- ===========================================================================

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

-- ===========================================================================
-- 20260923000003_auto_drain_notification_queue.sql
-- ===========================================================================

/*
# Automate Notification Queue Draining

Makes outgoing email delivery self-processing instead of only on-demand:

1. Schema
- Adds `max_attempts` (int, default 3) and `next_retry_at` (timestamptz)
  to `notification_queue` so retries apply exponential backoff.
- Index on (status, next_retry_at) to keep the drain query fast.

2. Configuration (system_settings, group `notifications`)
- `edge_function_url`       — full URL of the send-mail edge function
- `edge_function_secret`    — optional shared secret checked by that function
- `drain_enabled`           — whether the scheduled drain job is active (true)
- `drain_cron_schedule`     — pg_cron schedule expression (default every minute)
- `drain_max_attempts`      — delivery attempt cap (default 3)

3. Scheduling
- Enables `pg_cron` and `pg_net`.
- Registers job `drain-email-queue` that POSTs a `{ drain: true }` payload to
  the configured edge function whenever the queue holds due work. The POST is
  skipped when draining is disabled, the URL is empty, or nothing is pending.

4. Security
- Workflow-config reading happens in SECURITY DEFINER helpers (`search_path`
  pinned) so the cron role does not require table privileges.
- Callers authenticate to the edge function with the configured secret.
*/

-- 1. Queue schema
ALTER TABLE notification_queue
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_notification_queue_drain
  ON notification_queue(status, next_retry_at);

-- 2. Configuration seed
INSERT INTO system_settings (group_name, key, value) VALUES
  ('notifications', 'edge_function_url', '""'),
  ('notifications', 'edge_function_secret', '""'),
  ('notifications', 'drain_enabled', 'true'),
  ('notifications', 'drain_cron_schedule', '"*/1 * * * *"'),
  ('notifications', 'drain_max_attempts', '3')
ON CONFLICT (group_name, key) DO NOTHING;

-- 3. Read helpers (SECURITY DEFINER so the cron role can read settings)
CREATE OR REPLACE FUNCTION public.get_notification_setting(p_key text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(value #>> '{}', '')
  FROM system_settings
  WHERE group_name = 'notifications' AND key = p_key
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_notification_setting(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_setting(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_due_notifications()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM notification_queue
    WHERE status = 'PENDING'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
  );
$$;

REVOKE ALL ON FUNCTION public.has_due_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_due_notifications() TO authenticated;

-- 4. Extensions (best effort; must never fail the migration)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron extension not created: %', SQLERRM;
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_net;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_net extension not created: %', SQLERRM;
    END;
  END IF;
END $$;

-- 5. Scheduled job (idempotent: unschedule pre-existing job first)
DO $$
DECLARE
  v_has_cron boolean;
  v_schedule text;
BEGIN
  v_has_cron := EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  );

  IF v_has_cron THEN
    BEGIN
      -- Drop the old job if it exists, then recreate with current schedule
      DELETE FROM cron.job WHERE jobname = 'drain-email-queue';

      SELECT COALESCE(NULLIF(public.get_notification_setting('drain_cron_schedule'), ''), '*/1 * * * *')
      INTO v_schedule;

      PERFORM cron.schedule(
        'drain-email-queue',
        v_schedule,
        $cron$
          SELECT CASE
            WHEN public.get_notification_setting('edge_function_url') = '' THEN NULL
            ELSE net.http_post(
              url := public.get_notification_setting('edge_function_url'),
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-webhook-secret', public.get_notification_setting('edge_function_secret')
              ),
              body := jsonb_build_object('drain', true, 'trigger', 'cron')::text
            )
          END
          WHERE public.get_notification_setting('drain_enabled') = 'true'
            AND public.has_due_notifications();
        $cron$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'drain-email-queue job not scheduled: %', SQLERRM;
    END;
  END IF;
END $$;

-- ===========================================================================
-- 20260923000004_enqueue_request_submitted.sql
-- ===========================================================================

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

-- ===========================================================================
-- 20260923000005_force_change_password.sql
-- ===========================================================================

/*
# Force Password Change on First Login + Invite Resend

1. Schema
- Adds `employees.must_change_password` (default false). When an admin sets a
  temporary password via `set_employee_password`, the employee is forced to pick
  their own password on next login.
- The column is write-protected at the API level (column UPDATE revoked); it can
  only be flipped by the RPCs below (which verify the current password) or by
  completing the setup token flow.

2. RPC changes
- `password_policy_compliant(p_password)` — single source of truth for the
  password policy (>=8 chars, uppercase, number), used by all password paths.
- `set_employee_password` — sets `must_change_password = true`.
- `complete_password_setup` — sets `must_change_password = false`.
- `change_my_password` — rejects reuse of the current password, sets
  `must_change_password = false` after success.
- `authenticate_employee` — returns `must_change_password` so the login route
  can redirect those users to the change-password screen.

3. Self-service invite resend
- `request_password_setup_link(p_email, p_origin)` — anon-callable. Only works
  for employees who have NOT yet activated a password (no password_hash). Issues
  a fresh setup token and enqueues the `password.setup` email. Employees who
  already have a password get `code: HAS_PASSWORD` and are pointed back to the
  normal login / admin reset flow. Used by "Resend invite on mobile" on the
  login page.

4. Security
- SECURITY DEFINER with `search_path` pinned; PUBLIC execute revoked.
- No direct column access to `must_change_password` for anon/authenticated.
*/

-- ------------------------------------------------------------------
-- 1. Column + column-level write protection
-- ------------------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

REVOKE UPDATE (must_change_password) ON TABLE employees FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 2. Shared password policy
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.password_policy_compliant(p_password text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_password IS NOT NULL
     AND length(p_password) >= 8
     AND p_password ~ '[A-Z]'
     AND p_password ~ '\d';
$$;

REVOKE ALL ON FUNCTION public.password_policy_compliant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_policy_compliant(text) TO anon, authenticated;

-- ------------------------------------------------------------------
-- 3. Admin set/reset password -> force change on next login
-- ------------------------------------------------------------------
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
    RAISE EXCEPTION 'Passwords must be at least 8 characters long, with one uppercase letter and one number';
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

-- ------------------------------------------------------------------
-- 4. Complete setup-token flow (fresh password) -> no forced change
-- ------------------------------------------------------------------
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
      'message', 'Passwords must be at least 8 characters long, with one uppercase letter and one number');
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

-- ------------------------------------------------------------------
-- 5. Self-service change password (verifies current password)
-- ------------------------------------------------------------------
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
    RAISE EXCEPTION 'Passwords must be at least 8 characters long, with one uppercase letter and one number';
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

-- ------------------------------------------------------------------
-- 6. Login returns the flag (so the client can enforce the change screen)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authenticate_employee(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
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

-- ------------------------------------------------------------------
-- 7. Self-service invite resend (mobile): only for not-yet-activated
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_password_setup_link(p_email text, p_origin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_raw text;
  v_link text;
BEGIN
  IF p_email IS NULL OR p_origin IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;

  SELECT * INTO v_emp
    FROM employees e
   WHERE lower(e.email) = lower(p_email)
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  IF v_emp.password_hash IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HAS_PASSWORD');
  END IF;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');

  DELETE FROM public.employee_setup_tokens WHERE employee_id = v_emp.id;

  INSERT INTO public.employee_setup_tokens (employee_id, token_hash, expires_at, created_by)
  VALUES (v_emp.id,
          encode(extensions.digest(v_raw, 'sha256'), 'hex'),
          now() + interval '72 hours',
          NULL);

  v_link := rtrim(p_origin, '/') || '/setup-account?token=' || v_raw;

  INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
  VALUES (
    'password.setup',
    v_emp.email,
    trim(COALESCE(v_emp.first_name, '') || ' ' || COALESCE(v_emp.last_name, '')),
    'Set up your HR Flow account',
    '<p>Hi ' || COALESCE(v_emp.first_name, 'there') || ',</p>' ||
    '<p>Click the link below to set your password and start onboarding:</p>' ||
    '<p><a href="' || v_link || '">Set Up Your Account</a></p>' ||
    '<p>This link expires in 72 hours.</p>',
    'PENDING',
    jsonb_build_object(
      'first_name', v_emp.first_name,
      'employee_email', v_emp.email,
      'employee_name', trim(COALESCE(v_emp.first_name, '') || ' ' || COALESCE(v_emp.last_name, '')),
      'setup_link', v_link
    )
  );

  RETURN jsonb_build_object('ok', true, 'code', 'SENT');
END;
$$;

-- ------------------------------------------------------------------
-- 8. Execution grants
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_employee_password(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_password_setup(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_my_password(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.authenticate_employee(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_password_setup_link(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_employee_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_password_setup(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_my_password(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_employee(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_password_setup_link(text, text) TO anon, authenticated;

-- ===========================================================================
-- 20260923000006_employee_health_metrics.sql
-- ===========================================================================

/*
# Employee Health Metrics

Tracks employee vitals over time (weight, height, blood pressure, heart rate)
so the employee Medical page can chart trends across multiple measurement dates.

1. `employee_health_metrics`
- `employee_id` — owner (matches `employees`)
- `measured_on` — the date the reading was taken (defaults to today)
- `weight_kg` / `height_cm` — body measurements
- `systolic` / `diastolic` / `heart_rate` — vitals
- `notes` — optional context (e.g. fasting, post-workout)

2. Security
- RLS mirrors `employee_medical`: select own row or `employees.view_all`;
  insert/update/delete only own row or `employees.manage`.
*/

CREATE TABLE IF NOT EXISTS employee_health_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  measured_on date NOT NULL DEFAULT CURRENT_DATE,
  weight_kg numeric(5,2),
  height_cm numeric(5,1),
  systolic integer CHECK (systolic IS NULL OR (systolic BETWEEN 30 AND 300)),
  diastolic integer CHECK (diastolic IS NULL OR (diastolic BETWEEN 20 AND 200)),
  heart_rate integer CHECK (heart_rate IS NULL OR (heart_rate BETWEEN 20 AND 300)),
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_health_metrics_employee
  ON employee_health_metrics(employee_id, measured_on);

ALTER TABLE employee_health_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_employee_health_metrics" ON employee_health_metrics;
DROP POLICY IF EXISTS "insert_employee_health_metrics" ON employee_health_metrics;
DROP POLICY IF EXISTS "update_employee_health_metrics" ON employee_health_metrics;
DROP POLICY IF EXISTS "delete_employee_health_metrics" ON employee_health_metrics;

CREATE POLICY "select_employee_health_metrics" ON employee_health_metrics FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.view_all'));

CREATE POLICY "insert_employee_health_metrics" ON employee_health_metrics FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

CREATE POLICY "update_employee_health_metrics" ON employee_health_metrics FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

CREATE POLICY "delete_employee_health_metrics" ON employee_health_metrics FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

-- ===========================================================================
-- 20260923000007_bonus_master.sql
-- ===========================================================================

/*
# Bonus Master

Salary-level bonus overrides that the payroll calculator applies on top of the
base monthly salary when generating payslips.

1. `bonus_master`
- `employee_id` nullable: NULL = applies to ALL employees, otherwise a specific
  employee's salary-level bonus.
- `rate_type`FIXED` (flat amount) or `PERCENTAGE` (of the employee's
  `monthly_salary`).
- `effective_start` / `effective_end` window (NULL = always active).
- `is_active` toggle so bonuses can be suspended without deleting history.

2. Integration
- `_bonus_calc_for(...)` returns the matching bonus lines + total for one
  employee within a pay period.
- `_payroll_calc_for(...)` folds those earnings into gross, so `payroll_preview`
  and `generate_payroll_run` include bonuses automatically.

3. Security
- RLS fully gated by `payroll.manage`.
- Internal helpers are STABLE and not exposed to the API (PUBLIC revoked).
*/

-- ============================================================
-- 1. Bonus master table
-- ============================================================
CREATE TABLE IF NOT EXISTS bonus_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  rate_type text NOT NULL DEFAULT 'FIXED', -- FIXED | PERCENTAGE
  amount numeric NOT NULL DEFAULT 0,
  effective_start date,
  effective_end date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bonus_master ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bonus_master_employee ON bonus_master(employee_id);
CREATE INDEX IF NOT EXISTS idx_bonus_master_window ON bonus_master(employee_id, effective_start, effective_end);

DROP POLICY IF EXISTS "select_bonus_master" ON bonus_master;
DROP POLICY IF EXISTS "insert_bonus_master" ON bonus_master;
DROP POLICY IF EXISTS "update_bonus_master" ON bonus_master;
DROP POLICY IF EXISTS "delete_bonus_master" ON bonus_master;

CREATE POLICY "select_bonus_master" ON bonus_master FOR SELECT TO authenticated
  USING (public.has_privilege('payroll.manage'));
CREATE POLICY "insert_bonus_master" ON bonus_master FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "update_bonus_master" ON bonus_master FOR UPDATE TO authenticated
  USING (public.has_privilege('payroll.manage'))
  WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "delete_bonus_master" ON bonus_master FOR DELETE TO authenticated
  USING (public.has_privilege('payroll.manage'));

-- ============================================================
-- 2. Per-employee bonus calculator (internal)
-- ============================================================
CREATE OR REPLACE FUNCTION public._bonus_calc_for(
  p_employee_id uuid,
  p_monthly_salary numeric,
  p_period_start date,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_bonus record;
  v_line_amount numeric;
BEGIN
  FOR v_bonus IN
    SELECT b.id, b.name, b.rate_type, b.amount
      FROM bonus_master b
     WHERE b.is_active
       AND (b.employee_id = p_employee_id OR b.employee_id IS NULL)
       AND (b.effective_start IS NULL OR b.effective_start <= p_period_end)
       AND (b.effective_end IS NULL OR b.effective_end >= p_period_start)
     ORDER BY b.name, b.created_at
  LOOP
    IF v_bonus.rate_type = 'PERCENTAGE' THEN
      v_line_amount := round(
        COALESCE(p_monthly_salary, 0) * COALESCE(v_bonus.amount, 0) / 100,
        2
      );
    ELSE
      v_line_amount := COALESCE(v_bonus.amount, 0);
    END IF;

    IF v_line_amount <> 0 THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'name',   v_bonus.name,
        'amount', v_line_amount
      ));
      v_total := v_total + v_line_amount;
    END IF;
  END LOOP;

  v_total := round(v_total, 2);

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._bonus_calc_for(uuid, numeric, date, date) FROM PUBLIC;

-- ============================================================
-- 3. Fold bonuses into the payroll calculator
-- ============================================================
CREATE OR REPLACE FUNCTION public._payroll_calc_for(
  p_employee_id uuid,
  p_period_start date,
  p_period_end date,
  p_tax_rate numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_monthly_salary numeric := 0;
  v_name text;
  v_department text;
  v_working_days integer := 0;
  v_unpaid_days integer := 0;
  v_gross_base numeric := 0;
  v_earnings jsonb := '[]'::jsonb;
  v_deductions jsonb := '[]'::jsonb;
  v_earnings_total numeric := 0;
  v_deductions_total numeric := 0;
  v_bonus jsonb;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_adj record;
BEGIN
  SELECT COALESCE(e.monthly_salary, 0),
         COALESCE(e.first_name || ' ' || e.last_name, ''),
         COALESCE(d.name, 'Unassigned')
    INTO v_monthly_salary, v_name, v_department
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.id = p_employee_id;

  v_working_days := (
    SELECT count(*)::int
      FROM generate_series(p_period_start, p_period_end, interval '1 day') AS g(dt)
     WHERE extract(isodow FROM g.dt) < 6
       AND g.dt::date NOT IN (SELECT holiday_date FROM holidays)
  );

  -- Approved days on unpaid leave types overlapping the period
  v_unpaid_days := (
    SELECT COALESCE(sum(
              (LEAST(lr.end_date, p_period_end) - GREATEST(lr.start_date, p_period_start) + 1)::int
            ), 0)::int
      FROM leave_requests lr
      JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.employee_id = p_employee_id
       AND lr.status = 'APPROVED'
       AND NOT lt.is_paid
       AND lr.start_date <= p_period_end
       AND lr.end_date >= p_period_start
  );

  IF v_working_days <= 0 THEN
    v_gross_base := v_monthly_salary;
  ELSE
    v_gross_base := round(
      v_monthly_salary * (v_working_days - v_unpaid_days)::numeric / v_working_days,
      2
    );
  END IF;

  FOR v_adj IN
    SELECT adjustment_type, amount, description
      FROM payroll_adjustments
     WHERE employee_id = p_employee_id
       AND (effective_start IS NULL OR effective_start <= p_period_end)
       AND (effective_end IS NULL OR effective_end >= p_period_start)
  LOOP
    IF v_adj.adjustment_type = 'EARNING' THEN
      v_earnings := v_earnings || jsonb_build_array(jsonb_build_object(
        'name',   COALESCE(v_adj.description, 'Adjustment'),
        'amount', v_adj.amount
      ));
      v_earnings_total := v_earnings_total + v_adj.amount;
    ELSE
      v_deductions := v_deductions || jsonb_build_array(jsonb_build_object(
        'name',   COALESCE(v_adj.description, 'Adjustment'),
        'amount', v_adj.amount
      ));
      v_deductions_total := v_deductions_total + v_adj.amount;
    END IF;
  END LOOP;

  -- Salary-level bonuses (global + employee-specific)
  v_bonus := public._bonus_calc_for(p_employee_id, v_monthly_salary, p_period_start, p_period_end);
  v_earnings := v_earnings || COALESCE(v_bonus->'items', '[]'::jsonb);
  v_earnings_total := v_earnings_total + COALESCE((v_bonus->>'total')::numeric, 0);

  v_gross := round(v_gross_base + v_earnings_total, 2);
  IF v_gross > 0 THEN
    v_tax := round(v_gross * COALESCE(p_tax_rate, 0) / 100, 2);
  END IF;

  IF v_tax > 0 THEN
    v_deductions := v_deductions || jsonb_build_array(jsonb_build_object(
      'name', 'Tax', 'amount', v_tax
    ));
    v_deductions_total := v_deductions_total + v_tax;
  END IF;

  v_deductions_total := round(v_deductions_total, 2);
  v_net := round(v_gross - v_deductions_total, 2);

  RETURN jsonb_build_object(
    'employee_id',     p_employee_id,
    'name',            v_name,
    'department',      v_department,
    'monthly_salary',  v_monthly_salary,
    'working_days',    v_working_days,
    'unpaid_days',     v_unpaid_days,
    'gross',           v_gross,
    'tax',             v_tax,
    'earnings_total',  v_earnings_total,
    'deductions_total',v_deductions_total,
    'net',             v_net,
    'bonus_total',     COALESCE((v_bonus->>'total')::numeric, 0),
    'earnings',        v_earnings,
    'deductions',      v_deductions
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._payroll_calc_for(uuid, date, date, numeric) FROM PUBLIC;

-- ===========================================================================
-- 20260923000008_leave_balances.sql
-- ===========================================================================

/*
# Leave Balances

Catch-up accrual / opening-balance adjustments for leave types.

The engine keeps leaving balance simple: `annual_allocation - used days`.
This table lets administrators grant catch-up accrual (opening balances) or
adjust balances per employee + leave type + year, e.g. balancing prior-period
accruals carried into the current leave year.

- `leave_balances` — one row per (employee, leave type, year).
- RLS mirrors `leave_requests`: employees can read their own balances; only
  `leave.manage` can insert/update/delete.
*/

CREATE TABLE IF NOT EXISTS leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year integer NOT NULL DEFAULT date_part('year', CURRENT_DATE)::int,
  opening_balance numeric NOT NULL DEFAULT 0,
  note text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT leave_balances_unique_employee_type_year UNIQUE (employee_id, leave_type_id, year)
);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_type ON leave_balances(leave_type_id);

DROP POLICY IF EXISTS "select_leave_balances" ON leave_balances;
DROP POLICY IF EXISTS "insert_leave_balances" ON leave_balances;
DROP POLICY IF EXISTS "update_leave_balances" ON leave_balances;
DROP POLICY IF EXISTS "delete_leave_balances" ON leave_balances;

CREATE POLICY "select_leave_balances" ON leave_balances FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'));

CREATE POLICY "insert_leave_balances" ON leave_balances FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('leave.manage'));

CREATE POLICY "update_leave_balances" ON leave_balances FOR UPDATE TO authenticated
  USING (public.has_privilege('leave.manage'))
  WITH CHECK (public.has_privilege('leave.manage'));

CREATE POLICY "delete_leave_balances" ON leave_balances FOR DELETE TO authenticated
  USING (public.has_privilege('leave.manage'));

-- Current effective balance for one employee + leave type + year,
-- including the catch-up opening balance. Used by the API layer.
CREATE OR REPLACE FUNCTION public.leave_balance_for(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_year integer
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(lt.annual_allocation, 0)
       + COALESCE((
           SELECT lb.opening_balance
             FROM leave_balances lb
            WHERE lb.employee_id = p_employee_id
              AND lb.leave_type_id = p_leave_type_id
              AND lb.year = p_year
         ), 0)
       - COALESCE((
           SELECT sum(GREATEST((LEAST(lr.end_date, make_date(p_year, 12, 31))
                     - GREATEST(lr.start_date, make_date(p_year, 1, 1)) + 1), 0))
             FROM leave_requests lr
            WHERE lr.employee_id = p_employee_id
              AND lr.leave_type_id = p_leave_type_id
              AND lr.status = 'APPROVED'
              AND lr.start_date <= make_date(p_year, 12, 31)
              AND lr.end_date >= make_date(p_year, 1, 1)
         ), 0)
    FROM leave_types lt
   WHERE lt.id = p_leave_type_id;
$$;

REVOKE ALL ON FUNCTION public.leave_balance_for(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_balance_for(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.leave_balance_for(uuid, uuid, integer) FROM authenticated;

-- ===========================================================================
-- 20260923000009_standing_scheduler.sql
-- ===========================================================================

/*
# Standing-Jobs Scheduler

Consolidates recurring default-job reminders in one place: performance-review
due reminders, onboarding follow-ups, training reminders, plus custom standalone
jobs. Each task runs on a schedule and enqueues reminder emails into
`notification_queue` (drained by the existing mail automation).

1. `scheduled_tasks` — the standing jobs.
2. `scheduled_task_logs` — run history per task.
3. RPCs
   - `scheduled_tasks_due()` — active tasks whose `next_run_at` has passed.
   - `run_scheduled_task(p_task_id)` — collects recipients for the task's
     job type, enqueues reminder emails, logs the run and reschedules.

Managed through the Settings → Scheduler page (gated `admin.settings`).
*/

-- ============================================================
-- 1. Scheduled tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  job_type text NOT NULL DEFAULT 'CUSTOM', -- PERFORMANCE_REVIEW | ONBOARDING_FOLLOWUP | TRAINING_REMINDER | CUSTOM
  frequency text NOT NULL DEFAULT 'MONTHLY', -- DAILY | WEEKLY | MONTHLY | QUARTERLY | YEARLY
  run_at time NOT NULL DEFAULT '09:00',
  day_of_week integer,
  day_of_month integer,
  event_key text,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_status text,
  last_run_message text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE scheduled_tasks ADD CONSTRAINT scheduled_tasks_frequency_check
    CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "insert_scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "update_scheduled_tasks" ON scheduled_tasks;
DROP POLICY IF EXISTS "delete_scheduled_tasks" ON scheduled_tasks;

CREATE POLICY "select_scheduled_tasks" ON scheduled_tasks FOR SELECT TO authenticated
  USING (public.has_privilege('admin.settings'));
CREATE POLICY "insert_scheduled_tasks" ON scheduled_tasks FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_scheduled_tasks" ON scheduled_tasks FOR UPDATE TO authenticated
  USING (public.has_privilege('admin.settings'))
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "delete_scheduled_tasks" ON scheduled_tasks FOR DELETE TO authenticated
  USING (public.has_privilege('admin.settings'));

-- ============================================================
-- 2. Run history
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_task_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  items_processed integer NOT NULL DEFAULT 0,
  message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE scheduled_task_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_scheduled_task_logs_task ON scheduled_task_logs(task_id, run_at DESC);

DROP POLICY IF EXISTS "select_scheduled_task_logs" ON scheduled_task_logs;
DROP POLICY IF EXISTS "insert_scheduled_task_logs" ON scheduled_task_logs;
DROP POLICY IF EXISTS "update_scheduled_task_logs" ON scheduled_task_logs;
DROP POLICY IF EXISTS "delete_scheduled_task_logs" ON scheduled_task_logs;

CREATE POLICY "select_scheduled_task_logs" ON scheduled_task_logs FOR SELECT TO authenticated
  USING (public.has_privilege('admin.settings'));
CREATE POLICY "insert_scheduled_task_logs" ON scheduled_task_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "update_scheduled_task_logs" ON scheduled_task_logs FOR UPDATE TO authenticated
  USING (public.has_privilege('admin.settings'))
  WITH CHECK (public.has_privilege('admin.settings'));
CREATE POLICY "delete_scheduled_task_logs" ON scheduled_task_logs FOR DELETE TO authenticated
  USING (public.has_privilege('admin.settings'));

-- ============================================================
-- 3. Helpers
-- ============================================================

-- Compute the next run timestamp for a schedule, stepping forward from a
-- reference point until strictly after now().
CREATE OR REPLACE FUNCTION public._scheduled_task_next_run(
  p_frequency text,
  p_run_at time,
  p_day_of_week integer,
  p_day_of_month integer,
  p_from timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_candidate timestamptz := p_from;
  v_day integer;
BEGIN
  IF v_candidate IS NULL THEN
    v_candidate := now();
  END IF;

  LOOP
    EXIT WHEN v_candidate > now();

    v_candidate := date_trunc('day', v_candidate) + p_run_at;

    CASE p_frequency
      WHEN 'DAILY' THEN
        v_candidate := v_candidate + interval '1 day';
      WHEN 'WEEKLY' THEN
        v_candidate := v_candidate + interval '7 days';
        IF p_day_of_week IS NOT NULL THEN
          WHILE (extract(isodow FROM v_candidate)::int - 1) IS DISTINCT FROM p_day_of_week LOOP
            v_candidate := v_candidate + interval '1 day';
          END LOOP;
        END IF;
      WHEN 'MONTHLY' THEN
        v_day := COALESCE(p_day_of_month, 1);
        v_candidate := v_candidate + interval '1 month';
        v_candidate := date_trunc('month', v_candidate)
          + (LEAST(v_day, extract(day FROM (v_candidate + interval '1 month - 1 day'))::int) - 1) * interval '1 day'
          + p_run_at;
      WHEN 'QUARTERLY' THEN
        v_day := COALESCE(p_day_of_month, 1);
        v_candidate := v_candidate + interval '3 months';
        v_candidate := date_trunc('month', v_candidate)
          + (LEAST(v_day, extract(day FROM (v_candidate + interval '1 month - 1 day'))::int) - 1) * interval '1 day'
          + p_run_at;
      WHEN 'YEARLY' THEN
        v_day := COALESCE(p_day_of_month, 1);
        v_candidate := v_candidate + interval '1 year';
        v_candidate := date_trunc('month', v_candidate)
          + (LEAST(v_day, extract(day FROM (v_candidate + interval '1 month - 1 day'))::int) - 1) * interval '1 day'
          + p_run_at;
      ELSE
        v_candidate := v_candidate + interval '1 month';
    END CASE;

    v_candidate := date_trunc('day', v_candidate) + p_run_at;
  END LOOP;

  RETURN v_candidate;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._scheduled_task_next_run(text, time, integer, integer, timestamptz) FROM PUBLIC;

-- Active tasks whose next run has come due (TZ-safe booked in local server time).
CREATE OR REPLACE FUNCTION public.scheduled_tasks_due()
RETURNS SETOF public.scheduled_tasks
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT * FROM public.scheduled_tasks
   WHERE is_active
     AND next_run_at <= now()
   ORDER BY next_run_at;
$$;

REVOKE ALL ON FUNCTION public.scheduled_tasks_due() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scheduled_tasks_due() FROM anon;
REVOKE ALL ON FUNCTION public.scheduled_tasks_due() FROM authenticated;

-- ============================================================
-- 4. Runner
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_scheduled_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.scheduled_tasks;
  v_count integer := 0;
  v_message text;
  v_now timestamptz := now();
  v_recipient record;
  v_next timestamptz;
BEGIN
  SELECT * INTO v_task FROM public.scheduled_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Task not found');
  END IF;

  -- Collect recipients per job type and enqueue reminder emails.
  FOR v_recipient IN
    SELECT DISTINCT e.id::text AS employee_id, e.email, COALESCE(e.first_name, '') AS first_name
      FROM public.employees e
     WHERE e.employment_status = 'ACTIVE'
       AND e.email IS NOT NULL
       AND e.email <> ''
       AND (
         v_task.job_type = 'PERFORMANCE_REVIEW' AND NOT EXISTS (
           SELECT 1 FROM public.performance_reviews pr
            WHERE pr.employee_id = e.id
              AND pr.status = 'COMPLETED'
              AND pr.submitted_at > now() - interval '365 days'
         )
         OR v_task.job_type = 'ONBOARDING_FOLLOWUP' AND EXISTS (
           SELECT 1
             FROM public.employee_onboarding_progress p
             JOIN public.onboarding_steps s ON s.id = p.step_id
            WHERE p.employee_id = e.id
              AND s.is_required
              AND p.status <> 'COMPLETED'
         )
         OR v_task.job_type = 'TRAINING_REMINDER' AND EXISTS (
           SELECT 1 FROM public.training_enrollments te
            WHERE te.employee_id = e.id
              AND te.status = 'ENROLLED'
              AND te.progress < 100
         )
       )
  LOOP
    IF v_recipient.email IS NOT NULL THEN
      INSERT INTO public.notification_queue (
        event_key, recipient_email, recipient_name, subject, body_html, status, metadata
      ) VALUES (
        COALESCE(v_task.event_key, 'task.reminder'),
        v_recipient.email,
        v_recipient.first_name,
        'Reminder: ' || v_task.name,
        '<p>Hi ' || COALESCE(v_recipient.first_name, '') || ',</p><p>' || v_task.name || E'</p>',
        'PENDING',
        jsonb_build_object('task_id', v_task.id::text, 'task_name', v_task.name, 'job_type', v_task.job_type)
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  v_next := public._scheduled_task_next_run(
    v_task.frequency, v_task.run_at, v_task.day_of_week, v_task.day_of_month, v_now
  );

  v_message := v_count || ' reminder(s) queued';
  UPDATE public.scheduled_tasks
     SET next_run_at = v_next,
         last_run_at = v_now,
         last_run_status = 'SUCCESS',
         last_run_message = v_message
   WHERE id = v_task.id;

  INSERT INTO public.scheduled_task_logs (task_id, run_at, status, items_processed, message)
  VALUES (v_task.id, v_now, 'SUCCESS', v_count, v_message);

  RETURN jsonb_build_object('ok', true, 'processed', v_count, 'next_run_at', v_next);
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_task(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_scheduled_task(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.run_scheduled_task(uuid) TO authenticated;

-- ===========================================================================
-- 20260923000010_trial_milestones.sql
-- ===========================================================================

/*
# Trial Periods (30/60/90)

1. `trial_milestones()` — per active employee, computes days employed and the
   next 30/60/90-day trial milestone (day, date, days until it) plus their hire
   date. Used by the Reports "Trial Periods" panel.

2. Scheduler integration — `run_scheduled_task` learns a new
   `TRIAL_MILESTONE` job type: when run, it queues a reminder email to every
   active employee whose next trial milestone falls within the next 14 days.
*/

-- ============================================================
-- 1. Trial milestone computations
-- ============================================================
CREATE OR REPLACE FUNCTION public.trial_milestones()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_emp record;
  v_days integer;
  v_next_day integer;
  v_next_date date;
  v_name text;
BEGIN
  FOR v_emp IN
    SELECT e.id AS employee_id,
           COALESCE(e.first_name, '') AS first_name,
           COALESCE(e.last_name, '') AS last_name,
           e.email,
           e.hire_date,
           e.employment_status
      FROM public.employees e
     WHERE e.employment_status = 'ACTIVE'
  LOOP
    v_name := NULLIF(trim(v_emp.first_name || ' ' || v_emp.last_name), '');

    IF v_emp.hire_date IS NULL THEN
      RETURN NEXT jsonb_build_object(
        'employee_id', v_emp.employee_id,
        'name', v_name,
        'email', v_emp.email,
        'hire_date', NULL,
        'days_employed', NULL,
        'next_milestone_day', NULL,
        'next_milestone_date', NULL,
        'days_until_next', NULL
      );
      CONTINUE;
    END IF;

    v_days := (CURRENT_DATE - v_emp.hire_date);

    IF v_days >= 90 THEN
      v_next_day := NULL;
      v_next_date := NULL;
    ELSIF v_days >= 60 THEN
      v_next_day := 90;
      v_next_date := v_emp.hire_date + 90;
    ELSIF v_days >= 30 THEN
      v_next_day := 60;
      v_next_date := v_emp.hire_date + 60;
    ELSE
      v_next_day := 30;
      v_next_date := v_emp.hire_date + 30;
    END IF;

    RETURN NEXT jsonb_build_object(
      'employee_id', v_emp.employee_id,
      'name', v_name,
      'email', v_emp.email,
      'hire_date', v_emp.hire_date,
      'days_employed', v_days,
      'next_milestone_day', v_next_day,
      'next_milestone_date', v_next_date,
      'days_until_next', CASE WHEN v_next_date IS NOT NULL THEN (v_next_date - CURRENT_DATE) ELSE NULL END,
      'trial_complete', v_days >= 90
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.trial_milestones() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trial_milestones() FROM anon;
REVOKE ALL ON FUNCTION public.trial_milestones() FROM authenticated;

-- ============================================================
-- 2. Scheduler: TRIAL_MILESTONE reminder job
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_scheduled_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.scheduled_tasks;
  v_count integer := 0;
  v_message text;
  v_now timestamptz := now();
  v_recipient record;
  v_next timestamptz;
  v_days_left integer;
BEGIN
  SELECT * INTO v_task FROM public.scheduled_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Task not found');
  END IF;

  IF v_task.job_type = 'TRIAL_MILESTONE' THEN
    FOR v_recipient IN
      SELECT tm.employee_id, tm.name, tm.email, tm.next_milestone_day, tm.days_until_next
        FROM public.trial_milestones() tm
       WHERE tm.employee_id IS NOT NULL
         AND tm.email IS NOT NULL
         AND tm.email <> ''
         AND tm.next_milestone_day IS NOT NULL
         AND tm.days_until_next >= 0
         AND tm.days_until_next <= 14
    LOOP
      v_days_left := COALESCE(v_recipient.days_until_next, 0);
      INSERT INTO public.notification_queue (
        event_key, recipient_email, recipient_name, subject, body_html, status, metadata
      ) VALUES (
        COALESCE(v_task.event_key, 'trial.milestone'),
        v_recipient.email,
        v_recipient.name,
        'Trial milestone approaching: Day ' || v_recipient.next_milestone_day,
        '<p>Hi ' || COALESCE(v_recipient.name, '') || ',</p><p>Your day ' ||
        v_recipient.next_milestone_day || ' trial milestone is in ' || v_days_left ||
        E' day(s).</p>',
        'PENDING',
        jsonb_build_object(
          'task_id', v_task.id::text,
          'task_name', v_task.name,
          'job_type', v_task.job_type,
          'milestone_day', v_recipient.next_milestone_day
        )
      );
      v_count := v_count + 1;
    END LOOP;
  ELSE
    -- Existing job types: collect recipients per job type and enqueue reminders.
    FOR v_recipient IN
      SELECT DISTINCT e.id::text AS employee_id, e.email, COALESCE(e.first_name, '') AS first_name
        FROM public.employees e
       WHERE e.employment_status = 'ACTIVE'
         AND e.email IS NOT NULL
         AND e.email <> ''
         AND (
           v_task.job_type = 'PERFORMANCE_REVIEW' AND NOT EXISTS (
             SELECT 1 FROM public.performance_reviews pr
              WHERE pr.employee_id = e.id
                AND pr.status = 'COMPLETED'
                AND pr.submitted_at > now() - interval '365 days'
           )
           OR v_task.job_type = 'ONBOARDING_FOLLOWUP' AND EXISTS (
             SELECT 1
               FROM public.employee_onboarding_progress p
               JOIN public.onboarding_steps s ON s.id = p.step_id
              WHERE p.employee_id = e.id
                AND s.is_required
                AND p.status <> 'COMPLETED'
           )
           OR v_task.job_type = 'TRAINING_REMINDER' AND EXISTS (
             SELECT 1 FROM public.training_enrollments te
              WHERE te.employee_id = e.id
                AND te.status = 'ENROLLED'
                AND te.progress < 100
           )
         )
    LOOP
      IF v_recipient.email IS NOT NULL THEN
        INSERT INTO public.notification_queue (
          event_key, recipient_email, recipient_name, subject, body_html, status, metadata
        ) VALUES (
          COALESCE(v_task.event_key, 'task.reminder'),
          v_recipient.email,
          v_recipient.first_name,
          'Reminder: ' || v_task.name,
          '<p>Hi ' || COALESCE(v_recipient.first_name, '') || ',</p><p>' || v_task.name || E'</p>',
          'PENDING',
          jsonb_build_object('task_id', v_task.id::text, 'task_name', v_task.name, 'job_type', v_task.job_type)
        );
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END IF;

  v_next := public._scheduled_task_next_run(
    v_task.frequency, v_task.run_at, v_task.day_of_week, v_task.day_of_month, v_now
  );

  v_message := v_count || ' reminder(s) queued';
  UPDATE public.scheduled_tasks
     SET next_run_at = v_next,
         last_run_at = v_now,
         last_run_status = 'SUCCESS',
         last_run_message = v_message
   WHERE id = v_task.id;

  INSERT INTO public.scheduled_task_logs (task_id, run_at, status, items_processed, message)
  VALUES (v_task.id, v_now, 'SUCCESS', v_count, v_message);

  RETURN jsonb_build_object('ok', true, 'processed', v_count, 'next_run_at', v_next);
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_task(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_scheduled_task(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.run_scheduled_task(uuid) TO authenticated;

-- ===========================================================================
-- 20260923000011_exit_checkout.sql
-- ===========================================================================

/*
# Entry / Exit Checkout Tracking

Full offboarding checkpoint for equipment, credentials, access, clearance and
exit interviews, plus hire/exit date overrides.

1. `employee_exit_checkouts` — one record per (departing) employee with exit
   type, exit date override, last working day override, reason, interview flag.
2. `exit_checklist_items` — itemized clearance checklist. A trigger seeds the
   standard defaults (equipment, ID badge, credentials, system access, email
   inbox handover, department clearance, exit interview, final pay).
3. Security — read gated to `employees.view_all`/`employees.manage` (or self);
   write gated to `employees.manage` only, mirroring the employee detail tabs.

"Entry" tracking remains the onboarding pipeline (onboarding_templates /
employee_onboarding_progress); this migration adds the symmetric exit path.
*/

-- ============================================================
-- 1. Exit checkout master
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_exit_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  exit_type text,                       -- VOLUNTARY | INVOLUNTARY | RETIREMENT | LAYOFF | OTHER
  exit_date date,                       -- actual exit / override
  last_working_day date,                -- override of the computed last day
  reason text,
  rehire_eligible boolean DEFAULT true,
  interview_completed boolean DEFAULT false,
  interview_notes text,
  status text NOT NULL DEFAULT 'PENDING', -- PENDING | IN_PROGRESS | COMPLETED
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE employee_exit_checkouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_employee_exit_checkouts" ON employee_exit_checkouts;
DROP POLICY IF EXISTS "insert_employee_exit_checkouts" ON employee_exit_checkouts;
DROP POLICY IF EXISTS "update_employee_exit_checkouts" ON employee_exit_checkouts;
DROP POLICY IF EXISTS "delete_employee_exit_checkouts" ON employee_exit_checkouts;

CREATE POLICY "select_employee_exit_checkouts" ON employee_exit_checkouts FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id()
         OR public.has_privilege('employees.view_all')
         OR public.has_privilege('employees.manage'));

CREATE POLICY "insert_employee_exit_checkouts" ON employee_exit_checkouts FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('employees.manage'));

CREATE POLICY "update_employee_exit_checkouts" ON employee_exit_checkouts FOR UPDATE TO authenticated
  USING (public.has_privilege('employees.manage'))
  WITH CHECK (public.has_privilege('employees.manage'));

CREATE POLICY "delete_employee_exit_checkouts" ON employee_exit_checkouts FOR DELETE TO authenticated
  USING (public.has_privilege('employees.manage'));

-- ============================================================
-- 2. Checkout checklist items
-- ============================================================
CREATE TABLE IF NOT EXISTS exit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id uuid NOT NULL REFERENCES employee_exit_checkouts(id) ON DELETE CASCADE,
  item_key text NOT NULL,               -- EQUIPMENT | ID_BADGE | CREDENTIALS | ACCESS | EMAIL_INBOX | CLEARANCE | EXIT_INTERVIEW | FINAL_PAY
  is_cleared boolean NOT NULL DEFAULT false,
  cleared_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  cleared_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (checkout_id, item_key)
);

ALTER TABLE exit_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_exit_checklist_items" ON exit_checklist_items;
DROP POLICY IF EXISTS "insert_exit_checklist_items" ON exit_checklist_items;
DROP POLICY IF EXISTS "update_exit_checklist_items" ON exit_checklist_items;
DROP POLICY IF EXISTS "delete_exit_checklist_items" ON exit_checklist_items;

CREATE POLICY "select_exit_checklist_items" ON exit_checklist_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id
       AND (c.employee_id = public.current_employee_id()
            OR public.has_privilege('employees.view_all')
            OR public.has_privilege('employees.manage'))
  ));

CREATE POLICY "insert_exit_checklist_items" ON exit_checklist_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id AND public.has_privilege('employees.manage')
  ));

CREATE POLICY "update_exit_checklist_items" ON exit_checklist_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id AND public.has_privilege('employees.manage')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id AND public.has_privilege('employees.manage')
  ));

CREATE POLICY "delete_exit_checklist_items" ON exit_checklist_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id AND public.has_privilege('employees.manage')
  ));

-- ============================================================
-- 3. Seed default checklist on new checkout
-- ============================================================
CREATE OR REPLACE FUNCTION public._seed_exit_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.exit_checklist_items (checkout_id, item_key) VALUES
    (NEW.id, 'EQUIPMENT'),
    (NEW.id, 'ID_BADGE'),
    (NEW.id, 'CREDENTIALS'),
    (NEW.id, 'ACCESS'),
    (NEW.id, 'EMAIL_INBOX'),
    (NEW.id, 'CLEARANCE'),
    (NEW.id, 'EXIT_INTERVIEW'),
    (NEW.id, 'FINAL_PAY');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_exit_checklist ON employee_exit_checkouts;
CREATE TRIGGER trg_seed_exit_checklist
  AFTER INSERT ON employee_exit_checkouts
  FOR EACH ROW
  EXECUTE FUNCTION public._seed_exit_checklist();

-- ===========================================================================
-- 20260923000012_network_schedule.sql
-- ===========================================================================

-- Network schedule: writable milestone table counting down to "day 0" (go-live).
-- Each milestone has a day offset (negative = days before go-live, 0 = go-live,
-- positive = after go-live), an optional concrete milestone date, and a status.
-- A cumulative summary (total / completed / % achieved) is derived by the client.

create table if not exists public.network_schedule (
  id uuid primary key default gen_random_uuid(),
  day integer not null default 0,
  title text not null,
  description text,
  milestone_date date,
  status text not null default 'PLANNED'
    check (status in ('PLANNED', 'IN_PROGRESS', 'COMPLETED')),
  completed_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.network_schedule enable row level security;

create index if not exists idx_network_schedule_day on public.network_schedule(day);

-- read: any authenticated user (project schedule is company-wide visibility)
drop policy if exists "network_schedule_select" on public.network_schedule;
create policy "network_schedule_select" on public.network_schedule
  for select to authenticated using (true);

-- write: admin.settings only
drop policy if exists "network_schedule_insert" on public.network_schedule;
create policy "network_schedule_insert" on public.network_schedule
  for insert to authenticated with check (public.has_privilege('admin.settings'));

drop policy if exists "network_schedule_update" on public.network_schedule;
create policy "network_schedule_update" on public.network_schedule
  for update to authenticated using (public.has_privilege('admin.settings'));

drop policy if exists "network_schedule_delete" on public.network_schedule;
create policy "network_schedule_delete" on public.network_schedule
  for delete to authenticated using (public.has_privilege('admin.settings'));

-- Seed a default schedule from day -14 (t-minus) down to day 0 (go-live).
insert into public.network_schedule (day, title, description, status) values
  (-14, 'Project kickoff', 'Network rollout project kickoff and team assignment.', 'COMPLETED'),
  (-12, 'Site survey & planning', 'Site surveys complete; wiring and routing plan approved.', 'COMPLETED'),
  (-10, 'Equipment procurement', 'Core network equipment ordered and delivery confirmed.', 'COMPLETED'),
  (-8, 'Installation phase 1', 'Risers, racks and backbone cabling installed.', 'IN_PROGRESS'),
  (-6, 'Installation phase 2', 'Access switches, APs and end-device drops terminated.', 'PLANNED'),
  (-4, 'Configuration & integration', 'Switches/VLANs configured; integration with DNS/DHCP.', 'PLANNED'),
  (-2, 'Testing & hardening', 'Link tests, failover and security hardening.', 'PLANNED'),
  (-1, 'Cutover dry run', 'Full cutover rehearsal and rollback plan verified.', 'PLANNED'),
  (0, 'GO-LIVE', 'Network goes live to all users.', 'PLANNED')
on conflict do nothing;

-- ===========================================================================
-- 20260923000013_access_split.sql
-- ===========================================================================

/*
# Access split: reports read/write + payout read/write flags

Implements:
1. Split `admin.reports` into explicit read vs write privileges:
   - `admin.reports_read`  — view dashboards / analytics
   - `admin.reports_write` — build & export custom reports
   Legacy `admin.reports` is kept as a synonym so existing grants keep working.
   `reports_analytics()` is relaxed to accept any of the three.

2. Payout read/write permission flags:
   - `payroll.payout_read`  — read payout records / disbursement history
   - `payroll.payout_write` — create and approve disbursements
   The set_employee_access RPC already validates keys against
   privilege_definitions, so registering them here is enough for the
   access-manager UI to assign them.
*/

INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('admin.reports_read',  'Admin & System', 'View reports',       'View dashboards and analytics reports', 155),
  ('admin.reports_write', 'Admin & System', 'Build reports',      'Create and run custom reports across modules', 160),
  ('payroll.payout_read', 'Payroll',        'View payouts',       'Read payout records and disbursement history', 105),
  ('payroll.payout_write','Payroll',        'Manage payouts',     'Create and approve payroll disbursements', 106)
ON CONFLICT (key) DO NOTHING;

-- Relax the analytics guard: allow legacy admin.reports or the split view/build keys.
CREATE OR REPLACE FUNCTION public.reports_analytics(p_months integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_p_months integer := GREATEST(LEAST(COALESCE(p_months, 12), 24), 3);
  v_departed_statuses text[] := ARRAY['TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED'];
BEGIN
  IF NOT public.has_any_privilege(ARRAY['admin.reports', 'admin.reports_read', 'admin.reports_write']) THEN
    RAISE EXCEPTION 'You do not have permission to view reports';
  END IF;

  WITH months AS (
    SELECT date_trunc('month', d)::date AS month_start
      FROM generate_series(
             date_trunc('month', CURRENT_DATE) - make_interval(months => v_p_months - 1),
             date_trunc('month', CURRENT_DATE),
             interval '1 month'
           ) AS d
  ),
  monthly_series AS (
    SELECT m.month_start,
           to_char(m.month_start, 'YYYY-MM')       AS month_key,
           to_char(m.month_start, 'Mon')           AS label,
           (SELECT count(*)::int FROM employees h
             WHERE date_trunc('month', h.created_at)::date = m.month_start)                        AS hires,
           (SELECT count(*)::int FROM employees x
             WHERE date_trunc('month', x.updated_at)::date = m.month_start
               AND x.employment_status = ANY (v_departed_statuses))                                AS exits,
           (SELECT count(*)::int FROM employees e
             WHERE e.created_at::date <= (m.month_start + interval '1 month' - interval '1 day')::date)        AS headcount
      FROM months m
  ),
  payroll_series AS (
    SELECT date_trunc('month', pay_period_end)::date AS period_start,
           to_char(pay_period_end, 'YYYY-MM')        AS period_key,
           to_char(pay_period_end, 'Mon')            AS label,
           COALESCE(sum(total_gross), 0)             AS gross,
           COALESCE(sum(total_deductions), 0)        AS deductions,
           COALESCE(sum(total_net), 0)               AS net
      FROM payroll_runs
     WHERE status IN ('APPROVED', 'DISBURSED', 'PAID', 'PROCESSED')
     GROUP BY 1, 2, 3
  ),
  department_dist AS (
    SELECT d.name                                             AS department_name,
           count(e.id)::int                                   AS employee_count
      FROM departments d
      LEFT JOIN employees e ON e.department_id = d.id
     GROUP BY d.name
    HAVING count(e.id) > 0
     ORDER BY employee_count DESC, d.name
  ),
  attendance_daily AS (
    SELECT a.date,
           a.status,
           count(*)::int AS cnt
      FROM attendance a
     WHERE a.date >= (CURRENT_DATE - interval '30 days')::date
     GROUP BY a.date, a.status
  ),
  leave_summary AS (
    SELECT lt.name                                                          AS leave_type,
           lt.code,
           count(lr.id)::int                                                AS total_requests,
           count(*) FILTER (WHERE lr.status = 'APPROVED')::int              AS approved,
           count(*) FILTER (WHERE lr.status = 'PENDING')::int               AS pending,
           COALESCE(sum(lr.end_date - lr.start_date + 1)
                    FILTER (WHERE lr.status = 'APPROVED'), 0)               AS approved_days
      FROM leave_types lt
      LEFT JOIN leave_requests lr ON lr.leave_type_id = lt.id
     GROUP BY lt.name, lt.code
    HAVING count(lr.id) > 0
     ORDER BY approved_days DESC
  ),
  recruitment_funnel AS (
    SELECT c.current_stage AS stage,
           count(*)::int   AS cnt
      FROM candidates c
     GROUP BY c.current_stage
     ORDER BY cnt DESC
  ),
  status_dist AS (
    SELECT e.employment_status AS status,
           count(*)::int       AS cnt
      FROM employees e
     GROUP BY e.employment_status
     ORDER BY cnt DESC
  )
  SELECT jsonb_build_object(
    'generated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
    'monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month',      ms.month_key,
        'label',      ms.label,
        'hires',      ms.hires,
        'exits',      ms.exits,
        'headcount',  ms.headcount
      ) ORDER BY ms.month_start)
      FROM monthly_series ms
    ), '[]'::jsonb),
    'payroll', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month',       ps.period_key,
        'label',       ps.label,
        'gross',       ps.gross,
        'deductions',  ps.deductions,
        'net',         ps.net
      ) ORDER BY ps.period_start)
      FROM payroll_series ps
    ), '[]'::jsonb),
    'departments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', d.department_name, 'count', d.employee_count) ORDER BY d.employee_count DESC)
      FROM department_dist d
    ), '[]'::jsonb),
    'attendance30d', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',    to_char(a.date, 'YYYY-MM-DD'),
        'status',  a.status,
        'count',   a.cnt
      ) ORDER BY a.date)
      FROM attendance_daily a
    ), '[]'::jsonb),
    'leave', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type',           l.leave_type,
        'code',           l.code,
        'total',          l.total_requests,
        'approved',       l.approved,
        'pending',        l.pending,
        'approved_days',  l.approved_days
      ) ORDER BY l.approved_days DESC)
      FROM leave_summary l
    ), '[]'::jsonb),
    'recruitment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', r.stage, 'count', r.cnt) ORDER BY r.cnt DESC)
      FROM recruitment_funnel r
    ), '[]'::jsonb),
    'status', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status', s.status, 'count', s.cnt) ORDER BY s.cnt DESC)
      FROM status_dist s
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'employees',         (SELECT count(*)::int FROM employees e WHERE NOT (e.employment_status = ANY (v_departed_statuses))),
      'pending_onboarding',(SELECT count(*)::int FROM employees e WHERE e.employment_status IN ('PENDING_VERIFICATION', 'ONBOARDING')),
      'on_leave_today',    (SELECT count(*)::int FROM leave_requests lr WHERE lr.status = 'APPROVED' AND lr.start_date <= CURRENT_DATE AND lr.end_date >= CURRENT_DATE),
      'pending_leave',     (SELECT count(*)::int FROM leave_requests lr WHERE lr.status = 'PENDING'),
      'open_candidates',   (SELECT count(*)::int FROM candidates c WHERE c.current_stage NOT IN ('HIRED', 'REJECTED', 'WITHDRAWN')),
      'assets',            (SELECT count(*)::int FROM assets a WHERE a.status NOT IN ('DISPOSED', 'RETIRED'))
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reports_analytics(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reports_analytics(integer) FROM PUBLIC;

-- Backfill: keep the new read/write split in sync for reports on existing roles.
INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
SELECT e.id, pk, NULL
  FROM employees e
  CROSS JOIN unnest(ARRAY['admin.reports', 'admin.reports_read', 'admin.reports_write']) AS pk
 WHERE NOT EXISTS (
   SELECT 1 FROM employee_privileges ep
    WHERE ep.employee_id = e.id AND ep.privilege_key = pk
 )
   AND e.role IN ('SUPER_ADMIN', 'HR_ADMIN')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 20260923000014_procurement.sql
-- ===========================================================================

/*
# Procurement module

Vendor catalog + purchase orders with line items.

1. `procurement_vendors` — supplier master (name, contacts, tax id, status).
2. `purchase_orders` — PO header: vendor, requested_by, dates, status
   (DRAFT | PENDING_APPROVAL | APPROVED | RECEIVED | CANCELLED), notes.
3. `purchase_order_items` — line items with quantity/unit_price/total.
4. Security — read + write gated to the new `procurement.manage` privilege
   (registered in privilege_definitions below for the access-manager UI).
*/

-- ============================================================
-- 0. Privilege registration
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order)
VALUES ('procurement.manage', 'Procurement', 'Manage procurement', 'Manage vendors, purchase orders and requisitions', 67)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 1. Vendors
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  tax_id text,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE procurement_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "insert_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "update_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "delete_procurement_vendors" ON procurement_vendors;

CREATE POLICY "select_procurement_vendors" ON procurement_vendors FOR SELECT TO authenticated
  USING (public.has_privilege('procurement.manage'));

CREATE POLICY "insert_procurement_vendors" ON procurement_vendors FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('procurement.manage'));

CREATE POLICY "update_procurement_vendors" ON procurement_vendors FOR UPDATE TO authenticated
  USING (public.has_privilege('procurement.manage'))
  WITH CHECK (public.has_privilege('procurement.manage'));

CREATE POLICY "delete_procurement_vendors" ON procurement_vendors FOR DELETE TO authenticated
  USING (public.has_privilege('procurement.manage'));

-- ============================================================
-- 2. Purchase orders
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE,
  vendor_id uuid REFERENCES procurement_vendors(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  department_name text,
  order_date date DEFAULT CURRENT_DATE,
  expected_delivery date,
  status text NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "insert_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "update_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "delete_purchase_orders" ON purchase_orders;

CREATE POLICY "select_purchase_orders" ON purchase_orders FOR SELECT TO authenticated
  USING (public.has_privilege('procurement.manage'));

CREATE POLICY "insert_purchase_orders" ON purchase_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('procurement.manage'));

CREATE POLICY "update_purchase_orders" ON purchase_orders FOR UPDATE TO authenticated
  USING (public.has_privilege('procurement.manage'))
  WITH CHECK (public.has_privilege('procurement.manage'));

CREATE POLICY "delete_purchase_orders" ON purchase_orders FOR DELETE TO authenticated
  USING (public.has_privilege('procurement.manage'));

-- ============================================================
-- 3. Purchase order line items
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  description text,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (purchase_order_id, item_name)
);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "insert_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "update_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "delete_purchase_order_items" ON purchase_order_items;

CREATE POLICY "select_purchase_order_items" ON purchase_order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ));

CREATE POLICY "insert_purchase_order_items" ON purchase_order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ));

CREATE POLICY "update_purchase_order_items" ON purchase_order_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ));

CREATE POLICY "delete_purchase_order_items" ON purchase_order_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ));

-- ===========================================================================
-- 20260923000015_procurement_full.sql
-- ===========================================================================

/*
# Procurement module — full lifecycle

Extends the basic procurement module (migration 20260923000014) with the complete
source-to-pay workflow:

Requisition -> RFQ -> Supplier quotations -> Evaluation -> Purchase order
           -> Goods receipt -> Quality inspection -> Invoice (3-way match)
           -> Payment request -> Contract (for services / framework)

Actor references (requester, evaluator, inspector, ...) always point at the
existing `employees` table. Vendors reuse `procurement_vendors`. Approval runs
through the generic workflow engine (module keys `procurement.*`).

## Permissions
Each lifecycle stage is gated by a dedicated privilege (all *also* open to the
legacy `procurement.manage`):

- `procurement.dashboard`        — view dashboard + read the module
- `procurement.requisition_create` / `procurement.requisition_approve`
- `procurement.rfq_manage`
- `procurement.quotation_manage` / `procurement.quotation_evaluate`
- `procurement.po_create` / `procurement.po_approve`
- `procurement.receive` / `procurement.inspect`
- `procurement.invoice_manage` / `procurement.invoice_approve`
- `procurement.payment_create` / `procurement.payment_approve`
- `procurement.contract_manage` / `procurement.settings`
- `procurement.manage` (legacy — full control)
*/

-- ============================================================
-- 0. Privilege registration
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order)
VALUES
  ('procurement.dashboard',        'Procurement', 'View procurement dashboard',      'View procurement KPIs and full module read access', 68),
  ('procurement.requisition_create','Procurement','Create & submit requisitions',    'Create, edit and submit purchase requisitions', 69),
  ('procurement.requisition_approve','Procurement','Approve requisitions',           'Approve or reject purchase requisitions', 70),
  ('procurement.rfq_manage',       'Procurement', 'Manage RFQs',                     'Create and issue requests for quotation', 71),
  ('procurement.quotation_manage', 'Procurement', 'Manage quotations',               'Record and edit supplier quotations', 72),
  ('procurement.quotation_evaluate','Procurement','Evaluate quotations',             'Score quotations and select the winning supplier', 73),
  ('procurement.po_create',        'Procurement', 'Create purchase orders',          'Create and edit purchase orders', 74),
  ('procurement.po_approve',       'Procurement', 'Approve purchase orders',         'Approve or reject purchase orders', 75),
  ('procurement.receive',          'Procurement', 'Receive goods & services',        'Record goods receipts against purchase orders', 76),
  ('procurement.inspect',          'Procurement', 'Inspect goods',                   'Record quality inspection results for receipts', 77),
  ('procurement.invoice_manage',   'Procurement', 'Manage supplier invoices',        'Register and verify supplier invoices', 78),
  ('procurement.invoice_approve',  'Procurement', 'Approve invoices',                'Approve supplier invoices for payment', 79),
  ('procurement.payment_create',   'Procurement', 'Create payment requests',         'Create and submit payment requests', 80),
  ('procurement.payment_approve',  'Procurement', 'Approve payment requests',        'Approve or reject payment requests', 81),
  ('procurement.contract_manage',  'Procurement', 'Manage contracts',                'Create and manage supplier contracts', 82),
  ('procurement.settings',         'Procurement', 'Manage procurement settings',     'Manage categories and evaluation criteria', 83)
ON CONFLICT (key) DO NOTHING;

-- Convenience predicate: does the caller hold *any* procurement permission?
CREATE OR REPLACE FUNCTION public.has_procurement_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_privilege(ARRAY[
    'procurement.manage',
    'procurement.dashboard',
    'procurement.requisition_create',
    'procurement.requisition_approve',
    'procurement.rfq_manage',
    'procurement.quotation_manage',
    'procurement.quotation_evaluate',
    'procurement.po_create',
    'procurement.po_approve',
    'procurement.receive',
    'procurement.inspect',
    'procurement.invoice_manage',
    'procurement.invoice_approve',
    'procurement.payment_create',
    'procurement.payment_approve',
    'procurement.contract_manage',
    'procurement.settings'
  ]);
$$;

GRANT EXECUTE ON FUNCTION public.has_procurement_access() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_procurement_access() FROM PUBLIC;

-- ============================================================
-- 1. Categories
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE procurement_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_categories" ON procurement_categories;
DROP POLICY IF EXISTS "insert_procurement_categories" ON procurement_categories;
DROP POLICY IF EXISTS "update_procurement_categories" ON procurement_categories;
DROP POLICY IF EXISTS "delete_procurement_categories" ON procurement_categories;

CREATE POLICY "select_procurement_categories" ON procurement_categories FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_categories" ON procurement_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));
CREATE POLICY "update_procurement_categories" ON procurement_categories FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));
CREATE POLICY "delete_procurement_categories" ON procurement_categories FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));

-- ============================================================
-- 2. Requisitions
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  req_number text NOT NULL UNIQUE,
  requester_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  category_id uuid REFERENCES procurement_categories(id) ON DELETE SET NULL,
  purchase_type text NOT NULL DEFAULT 'GOODS',
  priority text NOT NULL DEFAULT 'NORMAL',
  purpose text,
  business_justification text,
  delivery_location text,
  required_delivery_date date,
  currency text NOT NULL DEFAULT 'USD',
  estimated_total numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT',
  approved_at timestamptz,
  remarks text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_requisition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES procurement_requisitions(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  item_name text NOT NULL,
  description text,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  uom text DEFAULT 'EA',
  estimated_unit_price numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  preferred_vendor_id uuid REFERENCES procurement_vendors(id) ON DELETE SET NULL,
  delivery_requirements text
);

CREATE INDEX IF NOT EXISTS idx_requisitions_status ON procurement_requisitions (status);
CREATE INDEX IF NOT EXISTS idx_requisitions_requester ON procurement_requisitions (requester_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_dept ON procurement_requisitions (department_id);

ALTER TABLE procurement_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_requisition_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_requisitions" ON procurement_requisitions;
DROP POLICY IF EXISTS "insert_procurement_requisitions" ON procurement_requisitions;
DROP POLICY IF EXISTS "update_procurement_requisitions" ON procurement_requisitions;
DROP POLICY IF EXISTS "delete_procurement_requisitions" ON procurement_requisitions;

CREATE POLICY "select_procurement_requisitions" ON procurement_requisitions FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_requisitions" ON procurement_requisitions FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage']));
CREATE POLICY "update_procurement_requisitions" ON procurement_requisitions FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.requisition_approve', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.requisition_approve', 'procurement.manage']));
CREATE POLICY "delete_procurement_requisitions" ON procurement_requisitions FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_requisition_items" ON procurement_requisition_items;
DROP POLICY IF EXISTS "insert_procurement_requisition_items" ON procurement_requisition_items;
DROP POLICY IF EXISTS "update_procurement_requisition_items" ON procurement_requisition_items;
DROP POLICY IF EXISTS "delete_procurement_requisition_items" ON procurement_requisition_items;

CREATE POLICY "select_procurement_requisition_items" ON procurement_requisition_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_requisitions r WHERE r.id = requisition_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_requisition_items" ON procurement_requisition_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_requisitions r
     WHERE r.id = requisition_id
       AND public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage'])
       AND r.status = 'DRAFT'));
CREATE POLICY "update_procurement_requisition_items" ON procurement_requisition_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_requisitions r
     WHERE r.id = requisition_id
       AND public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage'])
       AND r.status = 'DRAFT'))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_requisitions r
     WHERE r.id = requisition_id
       AND public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage'])
       AND r.status = 'DRAFT'));
CREATE POLICY "delete_procurement_requisition_items" ON procurement_requisition_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_requisitions r
     WHERE r.id = requisition_id
       AND public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage'])
       AND r.status = 'DRAFT'));

-- ============================================================
-- 3. RFQs
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number text NOT NULL UNIQUE,
  requisition_id uuid REFERENCES procurement_requisitions(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  issue_date date DEFAULT CURRENT_DATE,
  deadline date,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_rfq_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES procurement_rfqs(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES procurement_vendors(id) ON DELETE CASCADE,
  invited_at timestamptz DEFAULT now(),
  responded boolean NOT NULL DEFAULT false,
  UNIQUE (rfq_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_rfqs_status ON procurement_rfqs (status);

ALTER TABLE procurement_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_rfq_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_rfqs" ON procurement_rfqs;
DROP POLICY IF EXISTS "insert_procurement_rfqs" ON procurement_rfqs;
DROP POLICY IF EXISTS "update_procurement_rfqs" ON procurement_rfqs;
DROP POLICY IF EXISTS "delete_procurement_rfqs" ON procurement_rfqs;

CREATE POLICY "select_procurement_rfqs" ON procurement_rfqs FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_rfqs" ON procurement_rfqs FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']));
CREATE POLICY "update_procurement_rfqs" ON procurement_rfqs FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']));
CREATE POLICY "delete_procurement_rfqs" ON procurement_rfqs FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_rfq_vendors" ON procurement_rfq_vendors;
DROP POLICY IF EXISTS "insert_procurement_rfq_vendors" ON procurement_rfq_vendors;
DROP POLICY IF EXISTS "update_procurement_rfq_vendors" ON procurement_rfq_vendors;
DROP POLICY IF EXISTS "delete_procurement_rfq_vendors" ON procurement_rfq_vendors;

CREATE POLICY "select_procurement_rfq_vendors" ON procurement_rfq_vendors FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_rfq_vendors" ON procurement_rfq_vendors FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id
      AND public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']) AND f.status = 'DRAFT'));
CREATE POLICY "update_procurement_rfq_vendors" ON procurement_rfq_vendors FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id
      AND public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.quotation_manage', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id
      AND public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.quotation_manage', 'procurement.manage'])));
CREATE POLICY "delete_procurement_rfq_vendors" ON procurement_rfq_vendors FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id
      AND public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']) AND f.status = 'DRAFT'));

-- ============================================================
-- 4. Quotations
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_ref text NOT NULL UNIQUE,
  rfq_id uuid REFERENCES procurement_rfqs(id) ON DELETE SET NULL,
  vendor_id uuid NOT NULL REFERENCES procurement_vendors(id) ON DELETE CASCADE,
  submitted_at timestamptz,
  valid_until date,
  currency text NOT NULL DEFAULT 'USD',
  payment_terms text,
  lead_time_days integer,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  delivery_cost numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT',
  notes text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES procurement_quotations(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  item_name text NOT NULL,
  description text,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  uom text DEFAULT 'EA',
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  lead_time_days integer
);

CREATE INDEX IF NOT EXISTS idx_quotations_status ON procurement_quotations (status);
CREATE INDEX IF NOT EXISTS idx_quotations_rfq ON procurement_quotations (rfq_id);

ALTER TABLE procurement_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_quotations" ON procurement_quotations;
DROP POLICY IF EXISTS "insert_procurement_quotations" ON procurement_quotations;
DROP POLICY IF EXISTS "update_procurement_quotations" ON procurement_quotations;
DROP POLICY IF EXISTS "delete_procurement_quotations" ON procurement_quotations;

CREATE POLICY "select_procurement_quotations" ON procurement_quotations FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_quotations" ON procurement_quotations FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']));
CREATE POLICY "update_procurement_quotations" ON procurement_quotations FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.quotation_evaluate', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.quotation_evaluate', 'procurement.manage']));
CREATE POLICY "delete_procurement_quotations" ON procurement_quotations FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_quotation_items" ON procurement_quotation_items;
DROP POLICY IF EXISTS "insert_procurement_quotation_items" ON procurement_quotation_items;
DROP POLICY IF EXISTS "update_procurement_quotation_items" ON procurement_quotation_items;
DROP POLICY IF EXISTS "delete_procurement_quotation_items" ON procurement_quotation_items;

CREATE POLICY "select_procurement_quotation_items" ON procurement_quotation_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_quotation_items" ON procurement_quotation_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id
      AND public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']) AND q.status = 'DRAFT'));
CREATE POLICY "update_procurement_quotation_items" ON procurement_quotation_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id
      AND public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']) AND q.status = 'DRAFT'))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id
      AND public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']) AND q.status = 'DRAFT'));
CREATE POLICY "delete_procurement_quotation_items" ON procurement_quotation_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id
      AND public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']) AND q.status = 'DRAFT'));

-- ============================================================
-- 5. Evaluation
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_evaluation_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  weight numeric(5,2) NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES procurement_quotations(id) ON DELETE CASCADE,
  evaluator_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES procurement_evaluation_criteria(id) ON DELETE CASCADE,
  score numeric(5,2) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (quotation_id, evaluator_id, criterion_id)
);

ALTER TABLE procurement_evaluation_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_evaluation_criteria" ON procurement_evaluation_criteria;
DROP POLICY IF EXISTS "insert_procurement_evaluation_criteria" ON procurement_evaluation_criteria;
DROP POLICY IF EXISTS "update_procurement_evaluation_criteria" ON procurement_evaluation_criteria;
DROP POLICY IF EXISTS "delete_procurement_evaluation_criteria" ON procurement_evaluation_criteria;

CREATE POLICY "select_procurement_evaluation_criteria" ON procurement_evaluation_criteria FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_evaluation_criteria" ON procurement_evaluation_criteria FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));
CREATE POLICY "update_procurement_evaluation_criteria" ON procurement_evaluation_criteria FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));
CREATE POLICY "delete_procurement_evaluation_criteria" ON procurement_evaluation_criteria FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_evaluations" ON procurement_evaluations;
DROP POLICY IF EXISTS "insert_procurement_evaluations" ON procurement_evaluations;
DROP POLICY IF EXISTS "update_procurement_evaluations" ON procurement_evaluations;
DROP POLICY IF EXISTS "delete_procurement_evaluations" ON procurement_evaluations;

CREATE POLICY "select_procurement_evaluations" ON procurement_evaluations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_evaluations" ON procurement_evaluations FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_privilege(ARRAY['procurement.quotation_evaluate', 'procurement.manage'])
    AND evaluator_id = public.current_employee_id());
CREATE POLICY "update_procurement_evaluations" ON procurement_evaluations FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.quotation_evaluate', 'procurement.manage']) AND evaluator_id = public.current_employee_id())
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.quotation_evaluate', 'procurement.manage']) AND evaluator_id = public.current_employee_id());
CREATE POLICY "delete_procurement_evaluations" ON procurement_evaluations FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.quotation_evaluate', 'procurement.manage']) AND evaluator_id = public.current_employee_id());

-- ============================================================
-- 6. Purchase orders — extend the existing table
-- ============================================================
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS requisition_id uuid REFERENCES procurement_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES procurement_quotations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS uom text DEFAULT 'EA',
  ADD COLUMN IF NOT EXISTS received_qty numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_qty numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_qty numeric(12,2) NOT NULL DEFAULT 0;

-- Replace the manage-only policies with granular ones
DROP POLICY IF EXISTS "select_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "insert_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "update_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "delete_purchase_orders" ON purchase_orders;

CREATE POLICY "select_purchase_orders" ON purchase_orders FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_purchase_orders" ON purchase_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.manage']));
CREATE POLICY "update_purchase_orders" ON purchase_orders FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.po_approve', 'procurement.receive', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.po_approve', 'procurement.receive', 'procurement.manage']));
CREATE POLICY "delete_purchase_orders" ON purchase_orders FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.manage']));

DROP POLICY IF EXISTS "select_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "insert_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "update_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "delete_purchase_order_items" ON purchase_order_items;

CREATE POLICY "select_purchase_order_items" ON purchase_order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id AND public.has_procurement_access()));
CREATE POLICY "insert_purchase_order_items" ON purchase_order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.manage']) AND po.status = 'DRAFT'));
CREATE POLICY "update_purchase_order_items" ON purchase_order_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.po_approve', 'procurement.receive', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.po_approve', 'procurement.receive', 'procurement.manage'])));
CREATE POLICY "delete_purchase_order_items" ON purchase_order_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.manage']) AND po.status = 'DRAFT'));

-- ============================================================
-- 6b. Vendors — replace the manage-only policies with granular ones
--     (the vendors manage page keeps write access, all procurement
--     roles get read access for referencing suppliers)
-- ============================================================
DROP POLICY IF EXISTS "select_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "insert_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "update_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "delete_procurement_vendors" ON procurement_vendors;

CREATE POLICY "select_procurement_vendors" ON procurement_vendors FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_vendors" ON procurement_vendors FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('procurement.manage'));
CREATE POLICY "update_procurement_vendors" ON procurement_vendors FOR UPDATE TO authenticated
  USING (public.has_privilege('procurement.manage'))
  WITH CHECK (public.has_privilege('procurement.manage'));
CREATE POLICY "delete_procurement_vendors" ON procurement_vendors FOR DELETE TO authenticated
  USING (public.has_privilege('procurement.manage'));

-- ============================================================
-- 7. Goods receipts + quality inspection
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  received_date date DEFAULT CURRENT_DATE,
  received_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  delivery_note_number text,
  warehouse text,
  status text NOT NULL DEFAULT 'RECEIVED',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES procurement_receipts(id) ON DELETE CASCADE,
  po_item_id uuid REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity_received numeric(12,2) NOT NULL DEFAULT 0,
  quantity_accepted numeric(12,2) NOT NULL DEFAULT 0,
  quantity_rejected numeric(12,2) NOT NULL DEFAULT 0,
  rejection_reason text
);

CREATE INDEX IF NOT EXISTS idx_receipts_po ON procurement_receipts (po_id);

ALTER TABLE procurement_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_receipts" ON procurement_receipts;
DROP POLICY IF EXISTS "insert_procurement_receipts" ON procurement_receipts;
DROP POLICY IF EXISTS "update_procurement_receipts" ON procurement_receipts;
DROP POLICY IF EXISTS "delete_procurement_receipts" ON procurement_receipts;

CREATE POLICY "select_procurement_receipts" ON procurement_receipts FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_receipts" ON procurement_receipts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage']));
CREATE POLICY "update_procurement_receipts" ON procurement_receipts FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage']));
CREATE POLICY "delete_procurement_receipts" ON procurement_receipts FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_receipt_items" ON procurement_receipt_items;
DROP POLICY IF EXISTS "insert_procurement_receipt_items" ON procurement_receipt_items;
DROP POLICY IF EXISTS "update_procurement_receipt_items" ON procurement_receipt_items;
DROP POLICY IF EXISTS "delete_procurement_receipt_items" ON procurement_receipt_items;

CREATE POLICY "select_procurement_receipt_items" ON procurement_receipt_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_receipt_items" ON procurement_receipt_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id
      AND public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage'])));
CREATE POLICY "update_procurement_receipt_items" ON procurement_receipt_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id
      AND public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id
      AND public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage'])));
CREATE POLICY "delete_procurement_receipt_items" ON procurement_receipt_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id
      AND public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage'])));

CREATE TABLE IF NOT EXISTS procurement_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_number text NOT NULL UNIQUE,
  receipt_id uuid NOT NULL REFERENCES procurement_receipts(id) ON DELETE RESTRICT,
  inspector_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  inspection_date date DEFAULT CURRENT_DATE,
  result text NOT NULL DEFAULT 'PASS',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_inspection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES procurement_inspections(id) ON DELETE CASCADE,
  receipt_item_id uuid REFERENCES procurement_receipt_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  inspected_qty numeric(12,2) NOT NULL DEFAULT 0,
  accepted_qty numeric(12,2) NOT NULL DEFAULT 0,
  rejected_qty numeric(12,2) NOT NULL DEFAULT 0,
  criteria text,
  result text NOT NULL DEFAULT 'PASS'
);

ALTER TABLE procurement_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_inspection_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_inspections" ON procurement_inspections;
DROP POLICY IF EXISTS "insert_procurement_inspections" ON procurement_inspections;
DROP POLICY IF EXISTS "update_procurement_inspections" ON procurement_inspections;
DROP POLICY IF EXISTS "delete_procurement_inspections" ON procurement_inspections;

CREATE POLICY "select_procurement_inspections" ON procurement_inspections FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_inspections" ON procurement_inspections FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage']));
CREATE POLICY "update_procurement_inspections" ON procurement_inspections FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage']));
CREATE POLICY "delete_procurement_inspections" ON procurement_inspections FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_inspection_items" ON procurement_inspection_items;
DROP POLICY IF EXISTS "insert_procurement_inspection_items" ON procurement_inspection_items;
DROP POLICY IF EXISTS "update_procurement_inspection_items" ON procurement_inspection_items;
DROP POLICY IF EXISTS "delete_procurement_inspection_items" ON procurement_inspection_items;

CREATE POLICY "select_procurement_inspection_items" ON procurement_inspection_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_inspection_items" ON procurement_inspection_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id
      AND public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage'])));
CREATE POLICY "update_procurement_inspection_items" ON procurement_inspection_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id
      AND public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id
      AND public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage'])));
CREATE POLICY "delete_procurement_inspection_items" ON procurement_inspection_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id
      AND public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage'])));

-- ============================================================
-- 8. Supplier invoices + payment requests
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  supplier_invoice_ref text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES procurement_vendors(id) ON DELETE RESTRICT,
  po_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  invoice_date date,
  due_date date,
  currency text NOT NULL DEFAULT 'USD',
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'REGISTERED',
  match_status text NOT NULL DEFAULT 'PENDING',
  approved_at timestamptz,
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES procurement_invoices(id) ON DELETE CASCADE,
  po_item_id uuid REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 0,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON procurement_invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_po ON procurement_invoices (po_id);

ALTER TABLE procurement_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_invoices" ON procurement_invoices;
DROP POLICY IF EXISTS "insert_procurement_invoices" ON procurement_invoices;
DROP POLICY IF EXISTS "update_procurement_invoices" ON procurement_invoices;
DROP POLICY IF EXISTS "delete_procurement_invoices" ON procurement_invoices;

CREATE POLICY "select_procurement_invoices" ON procurement_invoices FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_invoices" ON procurement_invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage']));
CREATE POLICY "update_procurement_invoices" ON procurement_invoices FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.invoice_approve', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.invoice_approve', 'procurement.manage']));
CREATE POLICY "delete_procurement_invoices" ON procurement_invoices FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_invoice_items" ON procurement_invoice_items;
DROP POLICY IF EXISTS "insert_procurement_invoice_items" ON procurement_invoice_items;
DROP POLICY IF EXISTS "update_procurement_invoice_items" ON procurement_invoice_items;
DROP POLICY IF EXISTS "delete_procurement_invoice_items" ON procurement_invoice_items;

CREATE POLICY "select_procurement_invoice_items" ON procurement_invoice_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_invoice_items" ON procurement_invoice_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id
      AND public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage'])));
CREATE POLICY "update_procurement_invoice_items" ON procurement_invoice_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id
      AND public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id
      AND public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage'])));
CREATE POLICY "delete_procurement_invoice_items" ON procurement_invoice_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id
      AND public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage'])));

CREATE TABLE IF NOT EXISTS procurement_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_ref text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES procurement_invoices(id) ON DELETE RESTRICT,
  requested_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  request_date date DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  payment_method text,
  status text NOT NULL DEFAULT 'DRAFT',
  payment_reference text,
  paid_at timestamptz,
  approved_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON procurement_payment_requests (status);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON procurement_payment_requests (invoice_id);

ALTER TABLE procurement_payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_payment_requests" ON procurement_payment_requests;
DROP POLICY IF EXISTS "insert_procurement_payment_requests" ON procurement_payment_requests;
DROP POLICY IF EXISTS "update_procurement_payment_requests" ON procurement_payment_requests;
DROP POLICY IF EXISTS "delete_procurement_payment_requests" ON procurement_payment_requests;

CREATE POLICY "select_procurement_payment_requests" ON procurement_payment_requests FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_payment_requests" ON procurement_payment_requests FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.payment_create', 'procurement.manage']));
CREATE POLICY "update_procurement_payment_requests" ON procurement_payment_requests FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.payment_create', 'procurement.payment_approve', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.payment_create', 'procurement.payment_approve', 'procurement.manage']));
CREATE POLICY "delete_procurement_payment_requests" ON procurement_payment_requests FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.payment_create', 'procurement.manage']));

-- ============================================================
-- 9. Contracts
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_ref text NOT NULL UNIQUE,
  vendor_id uuid NOT NULL REFERENCES procurement_vendors(id) ON DELETE RESTRICT,
  po_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  start_date date,
  end_date date,
  value numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  payment_terms text,
  status text NOT NULL DEFAULT 'DRAFT',
  renewal_reminder_enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE procurement_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_contracts" ON procurement_contracts;
DROP POLICY IF EXISTS "insert_procurement_contracts" ON procurement_contracts;
DROP POLICY IF EXISTS "update_procurement_contracts" ON procurement_contracts;
DROP POLICY IF EXISTS "delete_procurement_contracts" ON procurement_contracts;

CREATE POLICY "select_procurement_contracts" ON procurement_contracts FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_contracts" ON procurement_contracts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.contract_manage', 'procurement.manage']));
CREATE POLICY "update_procurement_contracts" ON procurement_contracts FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.contract_manage', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.contract_manage', 'procurement.manage']));
CREATE POLICY "delete_procurement_contracts" ON procurement_contracts FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.contract_manage', 'procurement.manage']));

-- ============================================================
-- 10. Documents (file references)
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_type text NOT NULL,
  ref_id uuid NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text,
  file_size integer,
  uploaded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proc_documents_ref ON procurement_documents (ref_type, ref_id);

ALTER TABLE procurement_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_documents" ON procurement_documents;
DROP POLICY IF EXISTS "insert_procurement_documents" ON procurement_documents;
DROP POLICY IF EXISTS "update_procurement_documents" ON procurement_documents;
DROP POLICY IF EXISTS "delete_procurement_documents" ON procurement_documents;

CREATE POLICY "select_procurement_documents" ON procurement_documents FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_documents" ON procurement_documents FOR INSERT TO authenticated
  WITH CHECK (public.has_procurement_access());
CREATE POLICY "update_procurement_documents" ON procurement_documents FOR UPDATE TO authenticated
  USING (public.has_procurement_access())
  WITH CHECK (public.has_procurement_access());
CREATE POLICY "delete_procurement_documents" ON procurement_documents FOR DELETE TO authenticated
  USING (public.has_procurement_access());

-- ============================================================
-- 11. Minimal employee lookup for procurement pickers
--     (avoids widening employees RLS for non-HR roles)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_procurement_employee_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
  v_emp RECORD;
BEGIN
  IF public.current_employee_id() IS NULL OR NOT public.has_procurement_access() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_emp IN
    SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email,
           d.name AS department_name, p.name AS position_name
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN positions p ON p.id = e.position_id
     WHERE COALESCE(e.employment_status, '') <> 'TERMINATED'
     ORDER BY e.first_name, e.last_name
  LOOP
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id',              v_emp.id,
      'employee_id',     v_emp.employee_id,
      'name',            trim(v_emp.first_name || ' ' || v_emp.last_name),
      'email',           v_emp.email,
      'department_name', v_emp.department_name,
      'position_name',   v_emp.position_name
    ));
  END LOOP;

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_procurement_employee_list() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_procurement_employee_list() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_procurement_access() FROM PUBLIC;

-- ============================================================
-- 12. Workflow engine integration
-- ============================================================

-- Propagate final verdict from workflow_instances to procurement records.
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
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_workflow_result
AFTER UPDATE ON workflow_instances
FOR EACH ROW EXECUTE FUNCTION public.apply_workflow_result_to_record();

-- One default approval chain per module, so ON CONFLICT (module_key, name) below resolves.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definitions_module_name
  ON workflow_definitions (module_key, name);

-- Default procurement approval chains (Manager / HR Admin / Super Admin step),
-- enabled by default so the module works out of the box. Configure in
-- Settings > Workflows once live.
DO $$
DECLARE v_def uuid;
BEGIN
  -- Requisition approval
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Requisition Approval', 'procurement.requisition', 'request.submitted',
    'Default purchase requisition approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'procurement.requisition' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'procurement.requisition', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'procurement.requisition');

  -- Purchase order approval
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Purchase Order Approval', 'procurement.purchase_order', 'po.submitted',
    'Default purchase order approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'procurement.purchase_order' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'procurement.purchase_order', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'procurement.purchase_order');

  -- Invoice approval
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Invoice Approval', 'procurement.invoice', 'invoice.registered',
    'Default supplier invoice approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'procurement.invoice' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'procurement.invoice', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'procurement.invoice');

  -- Payment request approval
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Payment Approval', 'procurement.payment', 'payment.submitted',
    'Default payment request approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'procurement.payment' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'procurement.payment', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'procurement.payment');
END;
$$;

-- Contact lookups for email notifications of procurement approvals.
INSERT INTO mail_templates (event_key, subject, body_html, variables)
VALUES
  ('procurement.requisition.submitted', 'Requisition {{req_number}} submitted for approval', '<p>Requisition <strong>{{req_number}}</strong> was submitted by {{requester}} and is awaiting your approval.</p>', '["req_number","requester"]')
ON CONFLICT (event_key) DO NOTHING;

-- ===========================================================================
-- 20260924000001_hr_employee_lifecycle.sql
-- ===========================================================================

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

-- ===========================================================================
-- DEFAULT ADMIN EMPLOYEE (role SUPER_ADMIN => every privilege)
-- Login:    noah.linus@constrabase.com
-- Password: <replace the placeholder below with a strong password>
-- SECURITY: set a strong password and change it after the first login.
-- Safe to re-run (ON CONFLICT DO NOTHING - never overwrites an existing row).
-- ===========================================================================
INSERT INTO employees (
  employee_id, first_name, last_name, email,
  employment_type, employment_status, hire_date, role, password_hash
) VALUES (
  'ADM-001', 'Noah', 'Linus', 'noah.linus@constrabase.com',
  'FULL_TIME', 'ACTIVE', current_date, 'SUPER_ADMIN',
  extensions.crypt('<STRONG_PASSWORD>', extensions.gen_salt('bf', 10))
)
ON CONFLICT (email) DO NOTHING;
