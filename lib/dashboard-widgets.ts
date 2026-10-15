export interface DashboardWidgetDef {
  id: string;
  label: string;
  description: string;
  category: 'org' | 'personal';
  privileges?: string[];
}

export const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  {
    id: 'org_stats',
    label: 'Organization Summary',
    description: 'Headcount, onboarding, attendance and payroll totals',
    category: 'org',
    privileges: ['employees.view_all', 'employees.manage', 'admin.settings', 'payroll.manage', 'attendance.manage'],
  },
  {
    id: 'org_charts',
    label: 'Analytics Charts',
    description: 'Headcount, leave and payroll trends',
    category: 'org',
    privileges: ['employees.view_all', 'employees.manage', 'admin.settings', 'admin.reports_read', 'payroll.manage'],
  },
  {
    id: 'my_profile',
    label: 'My Profile',
    description: 'Your employment summary and quick links',
    category: 'personal',
  },
  {
    id: 'my_leave',
    label: 'My Leave',
    description: 'Your leave balances and recent requests',
    category: 'personal',
  },
  {
    id: 'my_attendance',
    label: 'My Attendance',
    description: "Today's clock-in status and recent attendance",
    category: 'personal',
  },
  {
    id: 'my_tasks',
    label: 'My Tasks',
    description: 'Tasks assigned to you',
    category: 'personal',
  },
  {
    id: 'my_requests',
    label: 'My Requests',
    description: 'Your pending requests',
    category: 'personal',
  },
];

export function widgetsForAccess(
  canAny: (keys?: string[]) => boolean,
  isSuperAdmin: boolean
): DashboardWidgetDef[] {
  return DASHBOARD_WIDGETS.filter((w) => {
    if (!w.privileges) return true;
    return isSuperAdmin || canAny(w.privileges);
  });
}

export function isOrgViewer(
  canAny: (keys?: string[]) => boolean,
  isSuperAdmin: boolean
): boolean {
  return isSuperAdmin || canAny(['employees.view_all', 'employees.manage', 'admin.settings']);
}

export function defaultWidgetIds(
  available: DashboardWidgetDef[],
  orgViewer: boolean
): string[] {
  return available
    .filter((w) => (orgViewer ? true : w.category === 'personal'))
    .map((w) => w.id);
}
