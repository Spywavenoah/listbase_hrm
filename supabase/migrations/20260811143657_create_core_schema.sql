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
