'use client';

import { usePathname } from 'next/navigation';
import { AccessGate } from '@/lib/access';

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === '/settings/access') {
    return <AccessGate anyPrivilege={['admin.privileges', 'admin.settings']}>{children}</AccessGate>;
  }
  if (pathname === '/settings/audit-log') {
    return <AccessGate anyPrivilege={['admin.audit', 'admin.settings']}>{children}</AccessGate>;
  }
  return <AccessGate privilege="admin.settings">{children}</AccessGate>;
}