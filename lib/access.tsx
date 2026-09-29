'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { getSessionEmployeeId } from '@/lib/supabase/session';
import type { Employee } from '@/lib/types';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AccessContextValue {
  loading: boolean;
  role: string;
  employee: Employee | null;
  employeeId: string | null;
  privileges: Set<string>;
  isSuperAdmin: boolean;
  can: (key?: string) => boolean;
  canAny: (keys?: string[]) => boolean;
}

const AccessContext = createContext<AccessContextValue>({
  loading: true,
  role: 'EMPLOYEE',
  employee: null,
  employeeId: null,
  privileges: new Set<string>(),
  isSuperAdmin: false,
  can: () => false,
  canAny: () => false,
});

export function AccessProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [privileges, setPrivileges] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || !session.access_token) {
          if (active) setLoading(false);
          return;
        }

        let empId = getSessionEmployeeId();
        if (!empId) {
          const { data: rpcId } = await supabase.rpc('current_employee_id');
          empId = (rpcId as string | null) ?? null;
        }

        let data = null;
        if (empId) {
          const { data: row } = await supabase
            .from('employees')
            .select('*')
            .eq('id', empId)
            .maybeSingle();
          data = row;
        } else {
          const { data: row } = await supabase
            .from('employees')
            .select('*')
            .limit(1)
            .maybeSingle();
          data = row;
        }
        const emp = (data as Employee | null) ?? null;

        const granted = new Set<string>();

        if (emp) {
          const { data: grants } = await supabase
            .from('employee_privileges')
            .select('privilege_key')
            .eq('employee_id', emp.id);
          for (const g of (grants || []) as { privilege_key: string }[]) {
            granted.add(g.privilege_key);
          }
        }

        if (!active) return;
        setEmployee(emp);
        setPrivileges(granted);
      } catch (err) {
        console.error('Failed to load access profile:', err);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AccessContextValue>(() => {
    const role = employee?.role || 'EMPLOYEE';
    const isSuperAdmin = role === 'SUPER_ADMIN';

    return {
      loading,
      role,
      employee,
      employeeId: employee?.id || null,
      privileges,
      isSuperAdmin,
      can: (key?: string) => (key ? isSuperAdmin || privileges.has(key) : false),
      canAny: (keys?: string[]) => (keys ? keys.some((k) => isSuperAdmin || privileges.has(k)) : false),
    };
  }, [loading, employee, privileges]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  return useContext(AccessContext);
}

export function AccessGate({
  privilege,
  anyPrivilege,
  children,
}: {
  privilege?: string;
  anyPrivilege?: string[];
  children: ReactNode;
}) {
  const { loading, can, canAny } = useAccess();
  const router = useRouter();
  const allowed = privilege ? can(privilege) : anyPrivilege ? canAny(anyPrivilege) : false;

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace('/access-denied');
    }
  }, [loading, allowed, router]);

  if (loading || !allowed) return null;

  return <>{children}</>;
}

export function AccessDenied() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Access Denied</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You do not have permission to view this page. Contact your administrator if you believe this is a mistake.
          </p>
        </div>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">Back to Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}