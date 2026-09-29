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
  { re: /^\/employees\/onboarding/, guard: { privilege: 'employees.invite' } },
  { re: /^\/organization\/(departments|positions|org-chart|grade-levels)/, guard: { privilege: 'organization.manage' } },
  { re: /^\/recruitment(\/|$)/, guard: { privilege: 'recruitment.manage' } },
  { re: /^\/attendance\/timesheets/, guard: { privilege: 'attendance.manage' } },
  { re: /^\/attendance$/, guard: {} },
  { re: /^\/leave\/(types|holidays)/, guard: { privilege: 'leave.settings' } },
  { re: /^\/leave$/, guard: {} },
  { re: /^\/payroll$/, guard: { privilege: 'payroll.manage' } },
  { re: /^\/payroll\/components/, guard: { privilege: 'payroll.settings' } },
  { re: /^\/payroll\/payslips/, guard: { anyPrivilege: ['payroll.manage', 'payroll.settings'] } },
  { re: /^\/performance(\/|$)/, guard: { privilege: 'performance.manage' } },
  { re: /^\/training(\/|$)/, guard: { privilege: 'training.manage' } },
  { re: /^\/assets$/, guard: {} },
  { re: /^\/assets\/assignments/, guard: { privilege: 'assets.manage' } },
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
  { re: /^\/procurement\/reports/, guard: { anyPrivilege: ALL_PROCUREMENT_PRIVILEGES } },
  { re: /^\/procurement\/settings/, guard: { anyPrivilege: ['procurement.settings', 'procurement.manage'] } },
  { re: /^\/procurement(\/|$)/, guard: { anyPrivilege: ALL_PROCUREMENT_PRIVILEGES } },
  { re: /^\/reports\/builder/, guard: { anyPrivilege: ['admin.reports', 'admin.reports_write'] } },
  { re: /^\/reports(\/|$)/, guard: { anyPrivilege: ['admin.reports', 'admin.reports_read'] } },
  { re: /^\/settings\/access/, guard: { privilege: 'admin.privileges' } },
  { re: /^\/settings\/audit-log/, guard: { privilege: 'admin.audit' } },
  {
    re: /^\/settings\/(branding|company|payments|smtp|templates|email-queue|fields|workflows|onboarding-templates|scheduler|security|network-schedule|performance)/,
    guard: { privilege: 'admin.settings' },
  },
];

export function routeGuardForPath(pathname: string): RouteGuard | null {
  for (const rule of RULES) {
    if (rule.re.test(pathname)) return rule.guard ?? null;
  }
  return null;
}