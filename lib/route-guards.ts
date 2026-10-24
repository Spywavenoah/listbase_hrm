export interface RouteGuard {
  privilege?: string;
  anyPrivilege?: string[];
}

const ALL_PROCUREMENT_PRIVILEGES: string[] = [
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
  'procurement.settings',
];

const ALL_INVENTORY_PRIVILEGES: string[] = [
  'inventory.view',
  'inventory.manage',
  'inventory.move',
  'inventory.request',
  'inventory.issue',
  'inventory.settings',
];

const ALL_ASSET_PRIVILEGES: string[] = [
  'assets.view',
  'assets.manage',
  'assets.repairs',
  'assets.fleet',
  'assets.maintenance',
  'assets.request',
];

const ALL_PROJECT_PRIVILEGES: string[] = [
  'projects.view',
  'projects.manage',
  'projects.allowance',
];

interface Rule {
  re: RegExp;
  guard?: RouteGuard;
}

// A rule with `guard: {}` means "any signed-in user allowed".
// `${guard: undefined}` means no restriction.
const RULES: Rule[] = [
  { re: /^\/onboarding/, guard: {} },
  { re: /^\/approvals/, guard: {} },
  {
    re: /^\/employees\/[^/]+\/(personal|employment|documents|guarantor|medical|qualifications|exit)$/,
    guard: {},
  },
  {
    re: /^\/employees$/,
    guard: { anyPrivilege: ['employees.view_all', 'employees.manage', 'employees.invite'] },
  },
  { re: /^\/employees\/add/, guard: { anyPrivilege: ['employees.manage', 'employees.invite'] } },
  { re: /^\/employees\/change-requests/, guard: { privilege: 'employees.manage' } },
  { re: /^\/queries/, guard: { anyPrivilege: ['employees.manage', 'admin.settings'] } },
  { re: /^\/employees\/onboarding/, guard: { privilege: 'employees.invite' } },
  { re: /^\/organization\/(departments|positions|org-chart|grade-levels)/, guard: { privilege: 'organization.manage' } },
  { re: /^\/recruitment(\/|$)/, guard: { privilege: 'recruitment.manage' } },
  { re: /^\/attendance\/timesheets/, guard: { privilege: 'attendance.manage' } },
  { re: /^\/attendance\/timecard-requests/, guard: { privilege: 'attendance.manage' } },
  { re: /^\/attendance\/timecard/, guard: {} },
  { re: /^\/attendance\/shifts/, guard: { privilege: 'attendance.manage' } },
  { re: /^\/attendance$/, guard: {} },
  { re: /^\/leave\/(types|holidays)/, guard: { privilege: 'leave.settings' } },
  { re: /^\/leave$/, guard: {} },
  { re: /^\/payroll$/, guard: { privilege: 'payroll.manage' } },
  { re: /^\/payroll\/components/, guard: { privilege: 'payroll.settings' } },
  { re: /^\/payroll\/recorder/, guard: { anyPrivilege: ['payroll.manage', 'payroll.settings'] } },
  { re: /^\/payroll\/payslips/, guard: { anyPrivilege: ['payroll.manage', 'payroll.settings'] } },
  { re: /^\/performance\/my-appraisals/, guard: {} },
  { re: /^\/performance\/appraisals/, guard: {} },
  { re: /^\/performance(\/|$)/, guard: { privilege: 'performance.manage' } },
  { re: /^\/training\/(enrollments|certifications|competencies)/, guard: { privilege: 'training.manage' } },
  { re: /^\/training\/my/, guard: { privilege: 'training.enroll' } },
  { re: /^\/training$/, guard: { privilege: 'training.manage' } },
  { re: /^\/training(\/|$)/, guard: { anyPrivilege: ['training.manage', 'training.enroll'] } },
  { re: /^\/assets\/categories/, guard: { anyPrivilege: ['assets.manage', 'assets.view'] } },
  { re: /^\/assets\/repairs/, guard: { anyPrivilege: ['assets.repairs', 'assets.manage', 'assets.view'] } },
  { re: /^\/assets\/fuel/, guard: { anyPrivilege: ['assets.fleet', 'assets.manage', 'assets.view'] } },
  { re: /^\/assets\/maintenance/, guard: { anyPrivilege: ['assets.maintenance', 'assets.manage', 'assets.view'] } },
  { re: /^\/assets\/vehicle-requests/, guard: { anyPrivilege: ['assets.request', 'assets.manage', 'assets.view'] } },
  { re: /^\/assets\/assignments/, guard: { privilege: 'assets.manage' } },
  { re: /^\/assets(\/|$)/, guard: { anyPrivilege: ALL_ASSET_PRIVILEGES } },
  { re: /^\/procurement\/requisitions/, guard: { anyPrivilege: ['procurement.requisition_create', 'procurement.requisition_approve', 'procurement.manage'] } },
  { re: /^\/procurement\/rfqs/, guard: { anyPrivilege: ['procurement.rfq_manage', 'procurement.quotation_manage', 'procurement.quotation_evaluate', 'procurement.manage'] } },
  { re: /^\/procurement\/quotations/, guard: { anyPrivilege: ['procurement.quotation_manage', 'procurement.quotation_evaluate', 'procurement.rfq_manage', 'procurement.manage'] } },
  { re: /^\/procurement\/purchase-orders/, guard: { anyPrivilege: ['procurement.po_create', 'procurement.po_approve', 'procurement.manage'] } },
  { re: /^\/procurement\/receipts/, guard: { anyPrivilege: ['procurement.receive', 'procurement.manage'] } },
  { re: /^\/procurement\/inspections/, guard: { anyPrivilege: ['procurement.inspect', 'procurement.manage'] } },
  { re: /^\/procurement\/invoices/, guard: { anyPrivilege: ['procurement.invoice_manage', 'procurement.invoice_approve', 'procurement.manage'] } },
  { re: /^\/procurement\/payments/, guard: { anyPrivilege: ['procurement.payment_create', 'procurement.payment_approve', 'procurement.manage'] } },
  { re: /^\/procurement\/contracts/, guard: { anyPrivilege: ['procurement.contract_manage', 'procurement.manage'] } },
  { re: /^\/procurement\/vendors/, guard: { privilege: 'procurement.manage' } },
  { re: /^\/procurement\/items/, guard: { anyPrivilege: ['procurement.manage', 'inventory.manage'] } },
  { re: /^\/procurement\/reports/, guard: { anyPrivilege: ALL_PROCUREMENT_PRIVILEGES } },
  { re: /^\/procurement\/settings/, guard: { anyPrivilege: ['procurement.settings', 'procurement.manage'] } },
  { re: /^\/procurement(\/|$)/, guard: { anyPrivilege: ALL_PROCUREMENT_PRIVILEGES } },
  { re: /^\/inventory\/warehouses/, guard: { anyPrivilege: ['inventory.manage', 'inventory.settings'] } },
  { re: /^\/inventory\/categories/, guard: { anyPrivilege: ['inventory.manage', 'inventory.settings'] } },
  { re: /^\/inventory\/items/, guard: { anyPrivilege: ['inventory.view', 'inventory.manage'] } },
  { re: /^\/inventory\/material-requests/, guard: { anyPrivilege: ['inventory.request', 'inventory.issue', 'inventory.manage'] } },
  { re: /^\/inventory\/expiry/, guard: { anyPrivilege: ['inventory.view', 'inventory.manage', 'inventory.move', 'inventory.issue'] } },
  { re: /^\/inventory\/stock/, guard: { anyPrivilege: ['inventory.view', 'inventory.manage', 'inventory.move', 'inventory.issue'] } },
  { re: /^\/inventory\/movements/, guard: { anyPrivilege: ['inventory.view', 'inventory.manage', 'inventory.move'] } },
  { re: /^\/inventory\/transfers/, guard: { anyPrivilege: ['inventory.move', 'inventory.manage'] } },
  { re: /^\/inventory\/reports/, guard: { anyPrivilege: ['inventory.view', 'inventory.manage'] } },
  { re: /^\/inventory(\/|$)/, guard: { anyPrivilege: ALL_INVENTORY_PRIVILEGES } },
  { re: /^\/projects\/allowance-payments/, guard: { anyPrivilege: ['projects.allowance', 'projects.manage'] } },
  { re: /^\/projects\/allowances/, guard: { anyPrivilege: ['projects.allowance', 'projects.manage'] } },
  { re: /^\/projects\/reports/, guard: { anyPrivilege: ALL_PROJECT_PRIVILEGES } },
  { re: /^\/projects(\/|$)/, guard: { anyPrivilege: ALL_PROJECT_PRIVILEGES } },
  { re: /^\/reports\/builder/, guard: { anyPrivilege: ['admin.reports', 'admin.reports_write'] } },
  { re: /^\/reports(\/|$)/, guard: { anyPrivilege: ['admin.reports', 'admin.reports_read'] } },
  { re: /^\/settings\/access/, guard: { privilege: 'admin.privileges' } },
  { re: /^\/settings\/audit-log/, guard: { privilege: 'admin.audit' } },
  { re: /^\/settings\/attendance-geofence/, guard: { anyPrivilege: ['attendance.manage', 'admin.settings'] } },
  {
    re: /^\/settings\/(branding|company|payments|smtp|templates|letterheads|email-queue|fields|workflows|onboarding-templates|scheduler|security|network-schedule|performance|whatsapp|payroll)/,
    guard: { privilege: 'admin.settings' },
  },
];

export function routeGuardForPath(pathname: string): RouteGuard | null {
  for (const rule of RULES) {
    if (rule.re.test(pathname)) return rule.guard ?? null;
  }
  return null;
}