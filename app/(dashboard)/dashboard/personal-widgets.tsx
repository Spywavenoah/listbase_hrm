'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/lib/access';
import { supabase } from '@/lib/supabase/client';
import { User, CalendarDays, Clock, ListTodo, Inbox, ArrowRight, Building2 } from 'lucide-react';

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    PENDING: 'bg-warning/10 text-warning',
    SUBMITTED: 'bg-warning/10 text-warning',
    APPROVED: 'bg-success/10 text-success',
    REJECTED: 'bg-destructive/10 text-destructive',
    COMPLETED: 'bg-success/10 text-success',
    IN_PROGRESS: 'bg-info/10 text-info',
    CANCELLED: 'bg-muted text-muted-foreground',
  };
  return <Badge variant="outline" className={map[status] || ''}>{status}</Badge>;
};

function WidgetCard({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col card-hover border border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4 float-icon" />
          </div>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="flex-1 pt-0">{children}</CardContent>
    </Card>
  );
}

export function MyProfileWidget() {
  const { employee } = useAccess();
  const [department, setDepartment] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;
    async function load() {
      const emp = employee as unknown as { department_id?: string; position_id?: string };
      const [dRes, pRes] = await Promise.all([
        emp.department_id ? supabase.from('departments').select('name').eq('id', emp.department_id).maybeSingle() : Promise.resolve({ data: null }),
        emp.position_id ? supabase.from('positions').select('title').eq('id', emp.position_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setDepartment((dRes.data as { name: string } | null)?.name || null);
      setPosition((pRes.data as { title: string } | null)?.title || null);
    }
    load();
  }, [employee]);

  if (!employee) return null;
  const emp = employee as unknown as { hire_date?: string | null; staff_category?: string | null };

  return (
    <WidgetCard
      title="My Profile"
      icon={User}
      action={
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/employees/${employee.id}/personal`}>
            Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      }
    >
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg glow-green">
            {(employee.first_name?.[0] || '') + (employee.last_name?.[0] || '')}
          </div>
          <div>
            <p className="font-semibold">{employee.first_name} {employee.last_name}</p>
            <p className="text-xs text-muted-foreground">{employee.email}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <div>
            <p className="text-xs text-muted-foreground">Position</p>
            <p className="font-medium">{position || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Department</p>
            <p className="font-medium">{department || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="font-medium">{employee.employment_status || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Hire Date</p>
            <p className="font-medium">{emp.hire_date || '—'}</p>
          </div>
        </div>
      </div>
    </WidgetCard>
  );
}

interface LeaveBalanceRow { id: string; leave_type_id: string; opening_balance: number }

export function MyLeaveWidget() {
  const { employee } = useAccess();
  const [balances, setBalances] = useState<{ name: string; balance: number }[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employee) return;
    async function load() {
      setLoading(true);
      const year = new Date().getFullYear();
      const [bRes, tRes, pRes] = await Promise.all([
        supabase.from('leave_balances').select('id, leave_type_id, opening_balance').eq('employee_id', employee!.id).eq('year', year),
        supabase.from('leave_types').select('id, name'),
        supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('employee_id', employee!.id).in('status', ['PENDING', 'SUBMITTED']),
      ]);
      const types = new Map(((tRes.data || []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
      setBalances(((bRes.data || []) as LeaveBalanceRow[]).map((b) => ({
        name: types.get(b.leave_type_id) || 'Leave',
        balance: Number(b.opening_balance || 0),
      })));
      setPending(pRes.count || 0);
      setLoading(false);
    }
    load();
  }, [employee]);

  return (
    <WidgetCard
      title="My Leave"
      icon={CalendarDays}
      action={
        <Button size="sm" variant="ghost" asChild>
          <Link href="/leave">View <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      }
    >
      {loading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pending requests</span>
            <span className="font-semibold">{pending}</span>
          </div>
          {balances.length === 0 ? (
            <p className="text-xs text-muted-foreground">No leave balances recorded for this year.</p>
          ) : (
            <div className="space-y-1.5">
              {balances.slice(0, 5).map((b) => (
                <div key={b.name} className="flex items-center justify-between border-t border-border pt-1.5">
                  <span className="text-muted-foreground">{b.name}</span>
                  <span className="font-medium">{b.balance} days</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

export function MyAttendanceWidget() {
  const { employee } = useAccess();
  const [today, setToday] = useState<{ clock_in: string | null; clock_out: string | null; status: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employee) return;
    async function load() {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('attendance')
        .select('clock_in, clock_out, status')
        .eq('employee_id', employee!.id)
        .eq('date', today)
        .maybeSingle();
      setToday(data as { clock_in: string; clock_out: string; status: string } | null);
      setLoading(false);
    }
    load();
  }, [employee]);

  const fmt = (t: string | null) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <WidgetCard
      title="My Attendance"
      icon={Clock}
      action={
        <Button size="sm" variant="ghost" asChild>
          <Link href="/attendance">Clock In/Out <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      }
    >
      {loading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : !today ? (
        <p className="text-sm text-muted-foreground">You have not clocked in today.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Clock In</p>
            <p className="font-medium">{fmt(today.clock_in)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Clock Out</p>
            <p className="font-medium">{fmt(today.clock_out)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            {statusBadge(today.status)}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}

interface TaskRow { id: string; title: string; priority: string; status: string; due_date: string | null }

export function MyTasksWidget() {
  const { employee } = useAccess();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employee) return;
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from('employee_tasks')
        .select('id, title, priority, status, due_date')
        .eq('employee_id', employee!.id)
        .in('status', ['PENDING', 'IN_PROGRESS'])
        .order('created_at', { ascending: false })
        .limit(5);
      setTasks((data || []) as unknown as { id: string; title: string; priority: string; status: string; due_date: string | null }[]);
      setLoading(false);
    }
    load();
  }, [employee]);

  return (
    <WidgetCard
      title="My Tasks"
      icon={ListTodo}
      action={
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/employees/${employee?.id}/tasks`}>View <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      }
    >
      {loading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open tasks.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{t.title}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {statusBadge(t.priority)}
                {t.due_date && <span className="text-xs text-muted-foreground">{t.due_date}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

export function MyRequestsWidget() {
  const { employee } = useAccess();
  const [counts, setCounts] = useState({ leave: 0, encashment: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employee) return;
    async function load() {
      setLoading(true);
      const [lRes, eRes] = await Promise.all([
        supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('employee_id', employee!.id).in('status', ['PENDING', 'SUBMITTED']),
        supabase.from('leave_encashment_requests').select('id', { count: 'exact', head: true }).eq('employee_id', employee!.id).eq('status', 'SUBMITTED'),
      ]);
      setCounts({ leave: lRes.count || 0, encashment: eRes.count || 0 });
      setLoading(false);
    }
    load();
  }, [employee]);

  return (
    <WidgetCard title="My Requests" icon={Inbox}>
      {loading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Link href="/leave" className="rounded-lg border border-border p-3 hover:border-primary/30">
            <p className="text-2xl font-bold">{counts.leave}</p>
            <p className="text-xs text-muted-foreground">Pending leave</p>
          </Link>
          <Link href="/leave/encashments" className="rounded-lg border border-border p-3 hover:border-primary/30">
            <p className="text-2xl font-bold">{counts.encashment}</p>
            <p className="text-xs text-muted-foreground">Encashment requests</p>
          </Link>
        </div>
      )}
    </WidgetCard>
  );
}

export function PersonalOrgHint() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4" />
        This is your personal dashboard. Use Customize to add widgets.
      </CardContent>
    </Card>
  );
}
