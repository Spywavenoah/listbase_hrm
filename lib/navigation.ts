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
  MessageSquare,
  Warehouse,
  Boxes,
  Tags,
  Car,
  Fuel,
  FolderKanban,
  MapPin,
  Coins,
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

export const ALL_INVENTORY_PRIVILEGES: string[] = [
  'inventory.view',
  'inventory.manage',
  'inventory.move',
  'inventory.request',
  'inventory.issue',
  'inventory.settings',
];

export const ALL_ASSET_PRIVILEGES: string[] = [
  'assets.view',
  'assets.manage',
  'assets.repairs',
  'assets.fleet',
  'assets.maintenance',
  'assets.request',
];

export const ALL_PROJECT_PRIVILEGES: string[] = [
  'projects.view',
  'projects.manage',
  'projects.allowance',
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
      { label: 'Add Employee', href: '/employees/add', icon: UserPlus, privileges: ['employees.manage', 'employees.invite'] },
      { label: 'Change Requests', href: '/employees/change-requests', icon: ClipboardList, privilege: 'employees.manage' },
      { label: 'Queries', href: '/queries', icon: MessageSquare, privileges: ['employees.manage', 'admin.settings'] },
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
      { label: 'Shifts', href: '/attendance/shifts', icon: CalendarClock, privilege: 'attendance.manage' },
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
    label: 'Expenses',
    icon: Wallet,
    items: [
      { label: 'Expense Claims', href: '/expenses', icon: Receipt },
      { label: 'Expense Retirements', href: '/expenses/retirement', icon: Wallet },
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
      { label: 'My Training', href: '/training/my', icon: GraduationCap, privilege: 'training.enroll' },
      { label: 'Courses', href: '/training', icon: GraduationCap, privilege: 'training.manage' },
      { label: 'Certifications', href: '/training/certifications', icon: Award, privilege: 'training.manage' },
    ],
  },
  {
    label: 'Assets',
    icon: Package,
    items: [
      { label: 'Asset Catalog', href: '/assets', icon: Package, privileges: ALL_ASSET_PRIVILEGES },
      { label: 'Categories', href: '/assets/categories', icon: Tags, privileges: ['assets.manage', 'assets.view'] },
      { label: 'Assignments', href: '/assets/assignments', icon: ArrowRightLeft, privilege: 'assets.manage' },
      { label: 'Repairs', href: '/assets/repairs', icon: Wrench, privileges: ['assets.repairs', 'assets.manage', 'assets.view'] },
      { label: 'Fuel Tracking', href: '/assets/fuel', icon: Fuel, privileges: ['assets.fleet', 'assets.manage', 'assets.view'] },
      { label: 'Maintenance', href: '/assets/maintenance', icon: CalendarClock, privileges: ['assets.maintenance', 'assets.manage', 'assets.view'] },
      { label: 'Vehicle Requests', href: '/assets/vehicle-requests', icon: Car, privileges: ['assets.request', 'assets.manage', 'assets.view'] },
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
    label: 'Inventory',
    icon: Warehouse,
    items: [
      { label: 'Dashboard', href: '/inventory', icon: LayoutDashboard, privileges: ALL_INVENTORY_PRIVILEGES },
      { label: 'Stock Levels', href: '/inventory/stock', icon: Boxes, privileges: ['inventory.view', 'inventory.manage', 'inventory.move', 'inventory.issue'] },
      { label: 'Items', href: '/inventory/items', icon: Package, privileges: ['inventory.view', 'inventory.manage'] },
      { label: 'Material Requests', href: '/inventory/material-requests', icon: Send, privileges: ['inventory.request', 'inventory.issue', 'inventory.manage'] },
      { label: 'Expiry Alerts', href: '/inventory/expiry', icon: CalendarClock, privileges: ['inventory.view', 'inventory.manage', 'inventory.move', 'inventory.issue'] },
      { label: 'Movements', href: '/inventory/movements', icon: ClipboardList, privileges: ['inventory.view', 'inventory.manage', 'inventory.move'] },
      { label: 'Transfers', href: '/inventory/transfers', icon: ArrowRightLeft, privileges: ['inventory.move', 'inventory.manage'] },
      { label: 'Warehouses', href: '/inventory/warehouses', icon: Warehouse, privileges: ['inventory.manage', 'inventory.settings'] },
      { label: 'Categories', href: '/inventory/categories', icon: Tags, privileges: ['inventory.manage', 'inventory.settings'] },
      { label: 'Reports', href: '/inventory/reports', icon: ChartBar, privileges: ['inventory.view', 'inventory.manage'] },
    ],
  },
  {
    label: 'Projects',
    icon: FolderKanban,
    items: [
      { label: 'Projects', href: '/projects', icon: MapPin, privileges: ALL_PROJECT_PRIVILEGES },
      { label: 'Workforce', href: '/projects/workforce', icon: Users, privileges: ALL_PROJECT_PRIVILEGES },
      { label: 'Offshore Allowance', href: '/projects/allowances', icon: Coins, privileges: ALL_PROJECT_PRIVILEGES },
      { label: 'Offshore Report', href: '/projects/reports', icon: ChartBar, privileges: ALL_PROJECT_PRIVILEGES },
    ],
  },
  {
    label: 'Reports',
    icon: ChartBar,
    items: [
      { label: 'Dashboards', href: '/reports', icon: ChartBar, privileges: ['admin.reports_read'] },
      { label: 'Report Builder', href: '/reports/builder', icon: Wrench, privileges: ['admin.reports_write'] },
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
      { label: 'WhatsApp Attendance', href: '/settings/whatsapp', icon: MessageSquare, privilege: 'admin.settings' },
      { label: 'Attendance Geofences', href: '/settings/attendance-geofence', icon: MapPin, privileges: ['attendance.manage', 'admin.settings'] },
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
