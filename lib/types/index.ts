export type FieldDataType =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'SELECT'
  | 'MULTISELECT'
  | 'FILE'
  | 'RELATION';

export interface FieldDefinition {
  id: string;
  module_key: string;
  field_key: string;
  label: string;
  data_type: FieldDataType;
  options?: string[] | null;
  is_required: boolean;
  is_unique: boolean;
  default_value?: unknown;
  validation?: {
    min?: number;
    max?: number;
    regex?: string;
    minLength?: number;
    maxLength?: number;
  } | null;
  visibility?: Record<string, 'read' | 'edit' | 'hidden'> | null;
  section?: string | null;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
}

export interface FieldValue {
  id: string;
  module_key: string;
  record_id: string;
  field_key: string;
  value: unknown;
}

export interface Employee {
  id: string;
  employee_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  user_id?: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  national_id: string | null;
  avatar_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  employment_type: string;
  employment_status: string;
  hire_date: string | null;
  position_id: string | null;
  department_id: string | null;
  reporting_manager_id: string | null;
  compensation_grade: string | null;
  monthly_salary: number | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_routing_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  marital_status: string | null;
  nationality: string | null;
  state_of_origin: string | null;
  lga: string | null;
  residential_address: string | null;
  permanent_address: string | null;
  blood_group: string | null;
  genotype: string | null;
  disability_status: string | null;
  disability_details: string | null;
  staff_category: string | null;
  grade_level_id: string | null;
  confirmation_date: string | null;
  contract_type: string | null;
  contract_expiry_date: string | null;
  retirement_date: string | null;
  is_2fa_enabled: boolean;
  is_login_blocked: boolean;
  role: string;
  password_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  head_id: string | null;
  cost_center: string | null;
  is_active: boolean;
}

export interface GradeLevel {
  id: string;
  name: string;
  level: number;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface EmployeeEmergencyContact {
  id: string;
  employee_id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
}

export interface EmployeeHistoryEntry {
  id: string;
  employee_id: string;
  event_type: string;
  title: string;
  description: string | null;
  metadata: unknown;
  effective_date: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Position {
  id: string;
  title: string;
  department_id: string | null;
  grade: string | null;
  reporting_to_position_id: string | null;
  budgeted_salary_min: number | null;
  budgeted_salary_max: number | null;
  employment_type: string;
  status: string;
  description: string | null;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  description: string | null;
  color: string | null;
  accrual_policy: string;
  annual_allocation: number;
  carry_forward_limit: number;
  is_paid: boolean;
  is_active: boolean;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  approver_id: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  clock_in: string | null;
  clock_out: string | null;
  date: string;
  status: string;
  work_hours: number | null;
  overtime_hours: number;
  notes: string | null;
}

export interface Asset {
  id: string;
  asset_tag: string | null;
  name: string;
  asset_type: string | null;
  category: string | null;
  serial_number: string | null;
  condition_status: string;
  status: string;
  purchase_date: string | null;
  purchase_value: number | null;
  current_value: number | null;
  assigned_to: string | null;
  assigned_at: string | null;
}

export interface PayComponent {
  id: string;
  name: string;
  code: string;
  component_type: string;
  calculation_type: string;
  formula: string | null;
  is_taxable: boolean;
  is_active: boolean;
}

export interface PayrollRun {
  id: string;
  name: string;
  pay_period_start: string;
  pay_period_end: string;
  status: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  run_date: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export interface Payslip {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  earnings: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  status: string;
}

export interface OnboardingTemplate {
  id: string;
  name: string;
  department_id: string | null;
  is_active: boolean;
}

export interface OnboardingStep {
  id: string;
  template_id: string;
  sort_order: number;
  step_type: string;
  title: string;
  description: string | null;
  is_required: boolean;
  document_url: string | null;
  module_key: string | null;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  module_key: string;
  trigger_event: string;
  description: string | null;
  is_active: boolean;
}

export interface WorkflowInstance {
  id: string;
  workflow_definition_id: string;
  module_key: string;
  record_id: string;
  status: string;
  current_step_id: string | null;
  initiated_by: string | null;
  initiated_at: string;
  completed_at: string | null;
}

export interface SystemSetting {
  id: string;
  group_name: string;
  key: string;
  value: unknown;
}

export interface MailTemplate {
  id: string;
  event_key: string;
  subject: string;
  body_html: string;
  variables: string[];
  is_active: boolean;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  action: string;
  module_key: string;
  record_id: string | null;
  field_key: string | null;
  old_value: unknown;
  new_value: unknown;
  metadata: unknown;
  created_at: string;
}

export interface RecruitmentJob {
  id: string;
  position_id: string | null;
  title: string;
  department_id: string | null;
  description: string | null;
  requirements: string | null;
  status: string;
  posted_date: string | null;
  closing_date: string | null;
}

export interface Candidate {
  id: string;
  job_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  resume_url: string | null;
  current_stage: string;
  rating: number | null;
  notes: string | null;
}

export interface PerformanceReview {
  id: string;
  employee_id: string;
  review_cycle: string;
  reviewer_id: string | null;
  status: string;
  rating: number | null;
  goals: unknown;
  feedback: string | null;
  submitted_at: string | null;
}

export interface PrivilegeDefinition {
  id: string;
  key: string;
  category: string;
  label: string;
  description: string | null;
  sort_order: number;
}

export interface EmployeePrivilege {
  employee_id: string;
  privilege_key: string;
  granted_by: string | null;
  created_at: string;
}
