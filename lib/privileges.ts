export interface PrivilegeDef {
  key: string;
  label: string;
  description: string;
}

export interface PrivilegeCategory {
  key: string;
  label: string;
  privileges: PrivilegeDef[];
}

export const PRIVILEGE_CATEGORIES: PrivilegeCategory[] = [
  {
    key: 'employees',
    label: 'Employees',
    privileges: [
      { key: 'employees.view_all', label: 'View all employees', description: 'Read contact, job and personal details of every employee' },
      { key: 'employees.manage', label: 'Manage employees', description: 'Create, edit and delete any employee record' },
      { key: 'employees.invite', label: 'Invite employees', description: 'Add employees and send account invitations' },
      { key: 'employees.medical', label: 'View & manage medical records', description: 'Access employee medical records, health metrics and vitals' },
    ],
  },
  {
    key: 'organization',
    label: 'Organization',
    privileges: [
      { key: 'organization.manage', label: 'Manage organization', description: 'Create and edit departments and positions' },
    ],
  },
  {
    key: 'recruitment',
    label: 'Recruitment',
    privileges: [
      { key: 'recruitment.manage', label: 'Manage recruitment', description: 'Manage job postings and candidates' },
    ],
  },
  {
    key: 'attendance',
    label: 'Attendance',
    privileges: [
      { key: 'attendance.manage', label: 'Manage attendance', description: 'View and edit every employee attendance and timesheets' },
    ],
  },
  {
    key: 'leave',
    label: 'Leave',
    privileges: [
      { key: 'leave.manage', label: 'Manage leave requests', description: 'View, approve and edit all leave requests' },
      { key: 'leave.settings', label: 'Manage leave settings', description: 'Configure leave types and holiday calendar' },
    ],
  },
  {
    key: 'payroll',
    label: 'Payroll',
    privileges: [
      { key: 'payroll.manage', label: 'Manage payroll', description: 'Create payroll runs and generate payslips' },
      { key: 'payroll.settings', label: 'Manage pay components', description: 'Configure earnings and deduction components' },
      { key: 'payroll.payout_read', label: 'View payouts', description: 'Read payout records and disbursement history' },
      { key: 'payroll.payout_write', label: 'Manage payouts', description: 'Create and approve payroll disbursements' },
    ],
  },
  {
    key: 'performance',
    label: 'Performance',
    privileges: [
      { key: 'performance.manage', label: 'Manage performance', description: 'View and manage all reviews and goals' },
    ],
  },
  {
    key: 'training',
    label: 'Training',
    privileges: [
      { key: 'training.manage', label: 'Manage training', description: 'Manage courses and enrollments' },
    ],
  },
  {
    key: 'assets',
    label: 'Assets',
    privileges: [
      { key: 'assets.manage', label: 'Manage assets', description: 'Manage the asset catalog and assignments' },
    ],
  },
  {
    key: 'procurement',
    label: 'Procurement',
    privileges: [
      { key: 'procurement.manage', label: 'Manage procurement', description: 'Full control over vendors, requisitions, orders, and payments' },
      { key: 'procurement.dashboard', label: 'View procurement dashboard', description: 'View procurement KPIs and the module' },
      { key: 'procurement.requisition_create', label: 'Create & submit requisitions', description: 'Create, edit and submit purchase requisitions' },
      { key: 'procurement.requisition_approve', label: 'Approve requisitions', description: 'Approve or reject purchase requisitions' },
      { key: 'procurement.rfq_manage', label: 'Manage RFQs', description: 'Create and issue requests for quotation' },
      { key: 'procurement.quotation_manage', label: 'Manage quotations', description: 'Record and edit supplier quotations' },
      { key: 'procurement.quotation_evaluate', label: 'Evaluate quotations', description: 'Score quotations and select the winning supplier' },
      { key: 'procurement.po_create', label: 'Create purchase orders', description: 'Create and edit purchase orders' },
      { key: 'procurement.po_approve', label: 'Approve purchase orders', description: 'Approve or reject purchase orders' },
      { key: 'procurement.receive', label: 'Receive goods & services', description: 'Record goods receipts against purchase orders' },
      { key: 'procurement.inspect', label: 'Inspect goods', description: 'Record quality inspection results for receipts' },
      { key: 'procurement.invoice_manage', label: 'Manage supplier invoices', description: 'Register and verify supplier invoices' },
      { key: 'procurement.invoice_approve', label: 'Approve invoices', description: 'Approve supplier invoices for payment' },
      { key: 'procurement.payment_create', label: 'Create payment requests', description: 'Create and submit payment requests' },
      { key: 'procurement.payment_approve', label: 'Approve payment requests', description: 'Approve or reject payment requests' },
      { key: 'procurement.contract_manage', label: 'Manage contracts', description: 'Create and manage supplier contracts' },
      { key: 'procurement.settings', label: 'Manage procurement settings', description: 'Manage categories and evaluation criteria' },
    ],
  },
  {
    key: 'admin',
    label: 'Admin & System',
    privileges: [
      { key: 'admin.settings', label: 'System settings', description: 'Company profile, branding, email, payments, workflows and field builder' },
      { key: 'admin.audit', label: 'View audit log', description: 'Read the full audit trail and employee timelines' },
      { key: 'admin.reports_read', label: 'View reports', description: 'View dashboards and analytics reports' },
      { key: 'admin.reports_write', label: 'Build reports', description: 'Create and run custom reports across modules' },
      { key: 'admin.privileges', label: 'Manage access', description: 'Assign privileges and roles to employees' },
    ],
  },
];

export const ALL_PRIVILEGE_KEYS: string[] = PRIVILEGE_CATEGORIES.flatMap((c) =>
  c.privileges.map((p) => p.key)
);

export const SELF_SERVICE_PRIVILEGE = {
  key: 'self-service',
  label: 'Employee Self-Service',
  description: 'Default access to own profile, self-service and onboarding',
} as const;

export const DEFAULT_PRIVILEGE_KEYS: string[] = [SELF_SERVICE_PRIVILEGE.key];

export const ROLE_OPTIONS = [
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'HR_ADMIN', label: 'HR Admin' },
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
] as const;