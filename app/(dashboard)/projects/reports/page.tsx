'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Download, CalendarDays, Coins, Users, FolderKanban } from 'lucide-react';
import { downloadCsv, csvFileName, type CsvValue } from '@/lib/export/csv';
import { cn } from '@/lib/utils';
import {
  fmtDate,
  fmtMoney,
  firstOfMonthIso,
  todayIso,
  type Project,
  type EmployeeLite,
  type OffshoreReportRow,
} from '@/lib/projects';

const ALL = '__all__';

function currencyOf(rows: { currency: string }[]): string {
  const set = new Set(rows.map((r) => r.currency));
  return set.size === 1 ? rows[0]?.currency || 'USD' : 'MIXED';
}

interface EmployeeAgg { employee_id: string; employee_name: string; days: number; amount: number; currency: string; projects: number }
interface ProjectAgg { project_id: string; project_code: string | null; project_name: string; days: number; amount: number; currency: string; employees: number }

export default function OffshoreReportPage() {
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const [projectId, setProjectId] = useState(ALL);
  const [employeeId, setEmployeeId] = useState(ALL);

  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [rows, setRows] = useState<OffshoreReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('detail');

  useEffect(() => {
    (async () => {
      const [p, e] = await Promise.all([
        supabase.from('projects').select('id, code, name').order('name'),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE').order('first_name'),
      ]);
      setProjects((p.data || []) as unknown as Project[]);
      setEmployees((e.data || []) as EmployeeLite[]);
    })();
  }, []);

  const run = useCallback(async () => {
    if (!from || !to) { toast.error('Select a date range'); return; }
    if (to < from) { toast.error('End date is before the start date'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('project_offshore_report', {
        p_from: from,
        p_to: to,
        p_project_id: projectId === ALL ? null : projectId,
        p_employee_id: employeeId === ALL ? null : employeeId,
      });
      if (error) throw error;
      setRows((data || []) as unknown as OffshoreReportRow[]);
    } catch (err) {
      toast.error('Failed to run report: ' + (err as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, projectId, employeeId]);

  useEffect(() => { run(); }, [run]);

  const byEmployee: EmployeeAgg[] = useMemo(() => {
    const m = new Map<string, EmployeeAgg & { rows: OffshoreReportRow[] }>();
    for (const r of rows) {
      const cur = m.get(r.employee_id) || { employee_id: r.employee_id, employee_name: r.employee_name, days: 0, amount: 0, currency: r.currency, projects: 0, rows: [] };
      cur.days += Number(r.offshore_days);
      cur.amount += Number(r.allowance_amount);
      cur.projects += 1;
      cur.rows.push(r);
      m.set(r.employee_id, cur);
    }
    return Array.from(m.values())
      .map((v) => ({ ...v, currency: currencyOf(v.rows) }))
      .sort((a, b) => b.days - a.days);
  }, [rows]);

  const byProject: ProjectAgg[] = useMemo(() => {
    const m = new Map<string, ProjectAgg & { rows: OffshoreReportRow[] }>();
    for (const r of rows) {
      const cur = m.get(r.project_id) || { project_id: r.project_id, project_code: r.project_code, project_name: r.project_name, days: 0, amount: 0, currency: r.currency, employees: 0, rows: [] };
      cur.days += Number(r.offshore_days);
      cur.amount += Number(r.allowance_amount);
      cur.employees += 1;
      cur.rows.push(r);
      m.set(r.project_id, cur);
    }
    return Array.from(m.values())
      .map((v) => ({ ...v, currency: currencyOf(v.rows) }))
      .sort((a, b) => b.days - a.days);
  }, [rows]);

  const totalDays = rows.reduce((s, r) => s + Number(r.offshore_days), 0);
  const totalAmount = rows.reduce((s, r) => s + Number(r.allowance_amount), 0);
  const overallCurrency = currencyOf(rows);

  const exportCurrent = () => {
    const base = `offshore_allowance_${from}_${to}`;
    if (tab === 'detail') {
      downloadCsv(csvFileName(base + '_detail'),
        ['Employee', 'Project code', 'Project', 'Offshore days', 'Allowance', 'Currency'],
        rows.map((r): CsvValue[] => [r.employee_name, r.project_code || '', r.project_name, Number(r.offshore_days), Number(r.allowance_amount), r.currency]));
    } else if (tab === 'employee') {
      downloadCsv(csvFileName(base + '_by_employee'),
        ['Employee', 'Projects', 'Offshore days', 'Allowance', 'Currency'],
        byEmployee.map((r): CsvValue[] => [r.employee_name, r.projects, r.days, r.amount, r.currency]));
    } else {
      downloadCsv(csvFileName(base + '_by_project'),
        ['Project code', 'Project', 'Employees', 'Offshore days', 'Allowance', 'Currency'],
        byProject.map((r): CsvValue[] => [r.project_code || '', r.project_name, r.employees, r.days, r.amount, r.currency]));
    }
  };

  const summary = [
    { label: 'Offshore days', value: totalDays.toLocaleString(), icon: CalendarDays, color: 'primary' as const },
    { label: 'Total allowance', value: overallCurrency === 'MIXED' ? 'Multiple currencies' : fmtMoney(totalAmount, overallCurrency), icon: Coins, color: 'success' as const },
    { label: 'Employees', value: byEmployee.length, icon: Users, color: 'info' as const },
    { label: 'Projects', value: byProject.length, icon: FolderKanban, color: 'warning' as const },
  ];

  const colorClasses: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    info: 'bg-info/10 text-info',
    warning: 'bg-warning/10 text-warning',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Offshore Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Offshore days and allowance per employee and per project for a chosen time frame.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="space-y-1.5">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All employees</SelectItem>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={run} disabled={loading}>{loading ? 'Running…' : 'Run Report'}</Button>
              <Button variant="outline" onClick={exportCurrent} disabled={!rows.length} className="print:hidden">
                <Download className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Export</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', colorClasses[c.color])}>
                  <Icon className="h-5 w-5" />
                </div>
                <p className="mt-3 text-2xl font-bold">{c.value}</p>
                <p className="text-sm text-muted-foreground">{c.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="detail">Detail</TabsTrigger>
          <TabsTrigger value="employee">By Employee</TabsTrigger>
          <TabsTrigger value="project">By Project</TabsTrigger>
        </TabsList>

        <TabsContent value="detail">
          <Card><CardContent className="p-0">
            <ReportTable
              loading={loading}
              empty="No offshore deployments in this range."
              headers={['Employee', 'Project', 'Offshore days', 'Allowance']}
              rows={rows.map((r) => [
                <span key="e" className="font-medium">{r.employee_name}</span>,
                <span key="p">{r.project_code ? <span className="font-mono text-xs mr-1">{r.project_code}</span> : null}{r.project_name}</span>,
                <span key="d">{Number(r.offshore_days).toLocaleString()}</span>,
                <span key="a">{fmtMoney(r.allowance_amount, r.currency)}</span>,
              ])}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="employee">
          <Card><CardContent className="p-0">
            <ReportTable
              loading={loading}
              empty="No employees with offshore days in this range."
              headers={['Employee', 'Projects', 'Offshore days', 'Allowance']}
              rows={byEmployee.map((r) => [
                <span key="e" className="font-medium">{r.employee_name}</span>,
                <Badge key="p" variant="outline">{r.projects}</Badge>,
                <span key="d">{r.days.toLocaleString()}</span>,
                <span key="a">{r.currency === 'MIXED' ? fmtMoney(r.amount) + ' *' : fmtMoney(r.amount, r.currency)}</span>,
              ])}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="project">
          <Card><CardContent className="p-0">
            <ReportTable
              loading={loading}
              empty="No offshore projects in this range."
              headers={['Project', 'Employees', 'Offshore days', 'Allowance']}
              rows={byProject.map((r) => [
                <span key="p" className="font-medium">{r.project_code ? <span className="font-mono text-xs mr-1">{r.project_code}</span> : null}{r.project_name}</span>,
                <Badge key="e" variant="outline">{r.employees}</Badge>,
                <span key="d">{r.days.toLocaleString()}</span>,
                <span key="a">{r.currency === 'MIXED' ? fmtMoney(r.amount) + ' *' : fmtMoney(r.amount, r.currency)}</span>,
              ])}
            />
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {overallCurrency === 'MIXED' && (
        <p className="text-xs text-muted-foreground">* Amounts span multiple currencies and are summed without conversion.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Frame: {fmtDate(from)} → {fmtDate(to)}. Only offshore projects are included.
      </p>
    </div>
  );
}

function ReportTable({ headers, rows, loading, empty }: { headers: string[]; rows: ReactNode[][]; loading: boolean; empty: string }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            {headers.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-b border-border/60">
                {headers.map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-muted" /></td>)}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="px-4 py-10 text-center text-muted-foreground">{empty}</td></tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-b border-border/60">
                {r.map((cell, j) => <td key={j} className="px-4 py-3">{cell}</td>)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
