'use client';

import { useState, useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar, SidebarContent } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAccess } from '@/lib/access';
import { getPreference, setPreference } from '@/lib/storage';
import { routeGuardForPath } from '@/lib/route-guards';

const ONBOARDING_STATUSES = ['ONBOARDING', 'PENDING_VERIFICATION'];

const ONBOARDING_ALLOWED = [
  /^\/onboarding$/,
  /^\/employees\/[^/]+\/(personal|employment|documents|guarantor|medical|qualifications|exit)$/,
];

function isOnboardingWhitelisted(pathname: string): boolean {
  return ONBOARDING_ALLOWED.some((re) => re.test(pathname));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { loading: accessLoading, employee, can, canAny } = useAccess();
  const pathname = usePathname();
  const router = useRouter();
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const routeGuard = useMemo(() => routeGuardForPath(pathname), [pathname]);

  useEffect(() => {
    setDesktopOpen(getPreference('sidebarOpen'));
  }, []);

  useEffect(() => {
    if (accessLoading || !employee) return;
    const status = employee.employment_status;
    if (ONBOARDING_STATUSES.includes(status) && !isOnboardingWhitelisted(pathname)) {
      router.replace('/onboarding');
      return;
    }
    if (!routeGuard) return;
    const allowed = routeGuard.anyPrivilege
      ? canAny(routeGuard.anyPrivilege)
      : routeGuard.privilege
        ? can(routeGuard.privilege)
        : true;
    if (!allowed) {
      router.replace('/access-denied');
    }
  }, [accessLoading, employee, pathname, routeGuard, can, canAny, router]);

  const toggleDesktop = () => {
    setDesktopOpen((v) => {
      const next = !v;
      setPreference('sidebarOpen', next);
      return next;
    });
  };

  if (accessLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden print:h-auto print:overflow-visible">
      <div
        className={cn(
          'hidden lg:flex shrink-0 transition-all duration-300 overflow-hidden print:hidden',
          desktopOpen ? 'w-64' : 'w-0'
        )}
      >
        <div className="w-64 shrink-0">
          <Sidebar />
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
        <Topbar
          desktopOpen={desktopOpen}
          onToggleDesktop={toggleDesktop}
          onToggleMobile={() => setMobileOpen(true)}
        />
        <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6 print:h-auto print:overflow-visible print:p-0">
          {children}
        </main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 sm:max-w-xs">
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
