import {
  LayoutDashboard,
  Users,
  UserPlus,
  Clock,
  CalendarDays,
  Wallet,
  Target,
  Package,
  Briefcase,
  GraduationCap,
  Settings,
  Building2,
  FileText,
  ShieldCheck,
  ChartBar,
  Network,
  UserCog,
  Mail,
  CreditCard,
  Palette,
  Layers,
  Wrench,
  ClipboardList,
  ArrowRightLeft,
  Send,
  Shield,
  FileCheck2,
  CalendarClock,
  ShoppingCart,
  Factory,
  Receipt,
  Award,
  BookMarked,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  privilege?: string;
  privileges?: string[];
}

export interface NavSection {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}

export const ALL_PROCUREMENT_PRIVILEGES: string[] = [
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

export const navSections: NavSection[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    items: [
      { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Approvals', href: '/approvals', icon: FileCheck2, badge: 'Inbox' },
    ],
  },
  {
    label: 'Employees',
    icon: Users,
    items: [
      { label: 'All Employees', href: '/employees', icon: Users, privileges: ['employees.view_all', 'employees.manage', 'employees.invite'] },
      { label: 'Organization Chart', href: '/organization/org-chart', icon: Network, privilege: 'organization.manage' },
      { label: 'Departments', href: '/organization/departments', icon: Building2, privilege: 'organization.manage' },
      { label: 'Positions', href: '/organization/positions', icon: Network, privilege: 'organization.manage' },
      { label: 'Grade Levels', href: '/organization/grade-levels', icon: Layers, privilege: 'organization.manage' },
      { label: 'Onboarding', href: '/employees/onboarding', icon: UserPlus, privilege: 'employees.invite' },
    ],
  },
  {
    label: 'Recruitment',
    icon: Briefcase,
    items: [
      { label: 'Requisitions', href: '/recruitment/requisitions', icon: ClipboardList, privilege: 'recruitment.manage' },
      { label: 'Job Postings', href: '/recruitment', icon: Briefcase, privilege: 'recruitment.manage' },
      { label: 'Candidates', href: '/recruitment/candidates', icon: UserPlus, privilege: 'recruitment.manage' },
    ],
  },
  {
    label: 'Attendance',
    icon: Clock,
    items: [
      { label: 'Clock In/Out', href: '/attendance', icon: Clock },
      { label: 'Timesheets', href: '/attendance/timesheets', icon: ClipboardList, privilege: 'attendance.manage' },
    ],
  },
  {
    label: 'Leave',
    icon: CalendarDays,
    items: [
      { label: 'Leave Requests', href: '/leave', icon: CalendarDays },
      { label: 'Encashment Requests', href: '/leave/encashments', icon: Wallet },
      { label: 'Leave Types', href: '/leave/types', icon: Settings, privilege: 'leave.settings' },
      { label: 'Holidays', href: '/leave/holidays', icon: CalendarDays, privilege: 'leave.settings' },
    ],
  },
  {
    label: 'Payroll',
    icon: Wallet,
    items: [
      { label: 'Payroll Runs', href: '/payroll', icon: Wallet, privilege: 'payroll.manage' },
      { label: 'Pay Components', href: '/payroll/components', icon: Layers, privilege: 'payroll.settings' },
      { label: 'Payslips', href: '/payroll/payslips', icon: FileText, privileges: ['payroll.manage', 'payroll.settings'] },
    ],
  },
  {
    label: 'Performance',
    icon: Target,
    items: [
      { label: 'Reviews', href: '/performance', icon: Target, privilege: 'performance.manage' },
      { label: 'Goals', href: '/performance/goals', icon: Target, privilege: 'performance.manage' },
    ],
  },
  {
    label: 'Training',
    icon: GraduationCap,
    items: [
      { label: 'Courses', href: '/training', icon: GraduationCap, privilege: 'training.manage' },
      { label: 'Enrollments', href: '/training/enrollments', icon: UserPlus, privilege: 'training.manage' },
      { label: 'Certifications', href: '/training/certifications', icon: Award, privilege: 'training.manage' },
      { label: 'Competencies', href: '/training/competencies', icon: BookMarked, privilege: 'training.manage' },
    ],
  },
  {
    label: 'Assets',
    icon: Package,
    items: [
      { label: 'Asset Catalog', href: '/assets', icon: Package },
      { label: 'Assignments', href: '/assets/assignments', icon: ArrowRightLeft, privilege: 'assets.manage' },
    ],
  },
  {
    label: 'Procurement',
    icon: ShoppingCart,
    items: [
      { label: 'Dashboard', href: '/procurement', icon: ChartBar, privileges: ALL_PROCUREMENT_PRIVILEGES },
      { label: 'Requisitions', href: '/procurement/requisitions', icon: ClipboardList, privileges: ['procurement.requisition_create', 'procurement.requisition_approve', 'procurement.manage'] },
      { label: 'RFQs', href: '/procurement/rfqs', icon: Send, privileges: ['procurement.rfq_manage', 'procurement.quotation_manage', 'procurement.quotation_evaluate', 'procurement.manage'] },
      { label: 'Quotations', href: '/procurement/quotations', icon: FileCheck2, privileges: ['procurement.quotation_manage', 'procurement.quotation_evaluate', 'procurement.rfq_manage', 'procurement.manage'] },
      { label: 'Purchase Orders', href: '/procurement/purchase-orders', icon: ShoppingCart, privileges: ['procurement.po_create', 'procurement.po_approve', 'procurement.manage'] },
      { label: 'Goods Receipts', href: '/procurement/receipts', icon: Package, privileges: ['procurement.receive', 'procurement.manage'] },
      { label: 'Inspections', href: '/procurement/inspections', icon: ShieldCheck, privileges: ['procurement.inspect', 'procurement.manage'] },
      { label: 'Invoices', href: '/procurement/invoices', icon: Receipt, privileges: ['procurement.invoice_manage', 'procurement.invoice_approve', 'procurement.manage'] },
      { label: 'Payments', href: '/procurement/payments', icon: Wallet, privileges: ['procurement.payment_create', 'procurement.payment_approve', 'procurement.manage'] },
      { label: 'Contracts', href: '/procurement/contracts', icon: FileText, privileges: ['procurement.contract_manage', 'procurement.manage'] },
      { label: 'Vendors', href: '/procurement/vendors', icon: Factory, privilege: 'procurement.manage' },
      { label: 'Reports', href: '/procurement/reports', icon: ChartBar, privileges: ALL_PROCUREMENT_PRIVILEGES },
      { label: 'Settings', href: '/procurement/settings', icon: Wrench, privileges: ['procurement.settings', 'procurement.manage'] },
    ],
  },
  {
    label: 'Reports',
    icon: ChartBar,
    items: [
      { label: 'Dashboards', href: '/reports', icon: ChartBar, privileges: ['admin.reports', 'admin.reports_read'] },
      { label: 'Report Builder', href: '/reports/builder', icon: Wrench, privileges: ['admin.reports', 'admin.reports_write'] },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    items: [
      { label: 'Privileges & Access', href: '/settings/access', icon: Shield, privilege: 'admin.privileges' },
      { label: 'Branding', href: '/settings/branding', icon: Palette, privilege: 'admin.settings' },
      { label: 'Company Profile', href: '/settings/company', icon: Building2, privilege: 'admin.settings' },
      { label: 'Payments', href: '/settings/payments', icon: CreditCard, privilege: 'admin.settings' },
      { label: 'Email (SMTP)', href: '/settings/smtp', icon: Mail, privilege: 'admin.settings' },
      { label: 'Mail Templates', href: '/settings/templates', icon: FileText, privilege: 'admin.settings' },
      { label: 'Email Queue', href: '/settings/email-queue', icon: Send, privilege: 'admin.settings' },
      { label: 'Field Builder', href: '/settings/fields', icon: Wrench, privilege: 'admin.settings' },
      { label: 'Workflows', href: '/settings/workflows', icon: ArrowRightLeft, privilege: 'admin.settings' },
      { label: 'Onboarding Templates', href: '/settings/onboarding-templates', icon: UserPlus, privilege: 'admin.settings' },
      { label: 'Scheduler', href: '/settings/scheduler', icon: CalendarClock, privilege: 'admin.settings' },
      { label: 'Network Schedule', href: '/settings/network-schedule', icon: CalendarClock, privilege: 'admin.settings' },
      { label: 'Performance', href: '/settings/performance', icon: Target, privilege: 'admin.settings' },
      { label: 'Security', href: '/settings/security', icon: ShieldCheck, privilege: 'admin.settings' },
      { label: 'Audit Log', href: '/settings/audit-log', icon: ClipboardList, privilege: 'admin.audit' },
    ],
  },
];

export const allNavItems: NavItem[] = navSections.flatMap((s) => s.items);
