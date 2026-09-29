'use client';

import { useEffect, useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Users, UserPlus, CalendarDays, ClipboardList, Briefcase, Package,
  RefreshCw, Wrench, ArrowRight, AlertCircle, Wallet, Hourglass,
  Download, Printer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { downloadCsvSections, csvFileName, type CsvSection } from '@/lib/export/csv';
import { AccessGate } from '@/lib/access';
import {
  fetchReportsAnalytics,
  fetchTrialMilestones,
  type TrialMilestone,
  formatCurrency,
  formatNumber,
  type ReportsAnalytics,
} from '@/lib/reports/analytics';

const CHART_COLORS = [
  'hsl(221 83% 53%)',
  'hsl(142 71% 45%)',
  'hsl(38 92% 50%)',
  'hsl(0 72% 51%)',
  'hsl(280 65% 60%)',
  'hsl(199 89% 48%)',
  'hsl(262 83% 58%)',
];

const tooltipStyle: React.CSSProperties = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
};

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return <Skeleton className="h-[260px] w-full" />;
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function ReportsDashboard() {
  const [analytics, setAnalytics] = useState<ReportsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [trial, setTrial] = useState<TrialMilestone[]>([]);
  const [trialLoading, setTrialLoading] = useState(true);

  const loadTrial = useCallback(async () => {
    setTrialLoading(true);
    try {
      const rows = await fetchTrialMilestones();
      setTrial(rows);
    } catch (err) {
      console.error('Failed to load trial milestones:', err);
    } finally {
      setTrialLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrial();
  }, [loadTrial]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchReportsAnalytics(12);
      setAnalytics(data);
    } catch (err) {
      console.error('Failed to load analytics:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const attendanceSeries = useMemo(() => {
    if (!analytics) return [];
    const byDate: Record<string, { present: number; absent: number; other: number }> = {};
    for (const rec of analytics.attendance30d) {
      if (!byDate[rec.date]) byDate[rec.date] = { present: 0, absent: 0, other: 0 };
      const bucket = byDate[rec.date];
      if (rec.status === 'PRESENT' || rec.status === 'LATE') bucket.present += rec.count;
      else if (rec.status === 'ABSENT') bucket.absent += rec.count;
      else bucket.other += rec.count;
    }
    return Object.keys(byDate)
      .sort()
      .slice(-14)
      .map((date) => ({
        day: new Date(date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        present: byDate[date].present,
        absent: byDate[date].absent,
        other: byDate[date].other,
      }));
  }, [analytics]);

  const latestPayroll = useMemo(() => {
    if (!analytics || analytics.payroll.length === 0) return null;
    return analytics.payroll[analytics.payroll.length - 1];
  }, [analytics]);

  if (loading && !analytics) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5"><Skeleton className="h-9 w-9" /><Skeleton className="mt-3 h-7 w-16" /><Skeleton className="mt-2 h-3 w-24" /></CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      </div>
    );
  }

  const totals = analytics?.totals;
  const kpiCards = [
    { label: 'Active Employees', value: formatNumber(totals?.employees ?? 0), icon: Users, color: 'primary' as const },
    { label: 'Pending Onboarding', value: formatNumber(totals?.pending_onboarding ?? 0), icon: UserPlus, color: 'warning' as const },
    { label: 'On Leave Today', value: formatNumber(totals?.on_leave_today ?? 0), icon: CalendarDays, color: 'info' as const },
    { label: 'Pending Requests', value: formatNumber(totals?.pending_leave ?? 0), icon: ClipboardList, color: 'success' as const },
    { label: 'Open Candidates', value: formatNumber(totals?.open_candidates ?? 0), icon: Briefcase, color: 'primary' as const },
    { label: 'Assets', value: formatNumber(totals?.assets ?? 0), icon: Package, color: 'destructive' as const },
  ];

  const colorClasses: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
  };

  const monthly = analytics?.monthly ?? [];
  const payroll = analytics?.payroll ?? [];
  const departments = analytics?.departments ?? [];
  const recruitment = analytics?.recruitment ?? [];
  const leave = analytics?.leave ?? [];

  const handleExportCsv = () => {
    const sections: CsvSection[] = [
      {
        title: 'Key Metrics',
        headers: ['Metric', 'Value'],
        rows: kpiCards.map((card) => [card.label, card.value]),
      },
      {
        title: 'Hires vs Exits & Headcount',
        headers: ['Month', 'Hires', 'Exits', 'Headcount'],
        rows: monthly.map((m) => [m.label, m.hires, m.exits, m.headcount]),
      },
      {
        title: 'Payroll Cost Trend (Approved Runs)',
        headers: ['Month', 'Gross', 'Deductions', 'Net'],
        rows: payroll.map((p) => [p.label, p.gross, p.deductions, p.net]),
      },
      {
        title: 'Department Distribution',
        headers: ['Department', 'Employees'],
        rows: departments.map((d) => [d.name, d.count]),
      },
      {
        title: 'Attendance (Recent 14 Days)',
        headers: ['Day', 'Present', 'Absent', 'Other'],
        rows: attendanceSeries.map((a) => [a.day, a.present, a.absent, a.other]),
      },
      {
        title: 'Recruitment Funnel',
        headers: ['Stage', 'Candidates'],
        rows: recruitment.map((r) => [r.stage, r.count]),
      },
      {
        title: 'Leave Summary',
        headers: ['Leave Type', 'Requests', 'Approved', 'Pending', 'Approved Days'],
        rows: leave.map((row) => [row.type, row.total, row.approved, row.pending, row.approved_days]),
      },
      {
        title: 'Trial Periods (30/60/90)',
        headers: ['Employee', 'Hire Date', 'Days Employed', 'Next Milestone', 'Milestone Date', 'Days Until'],
        rows: trial.map((row) => [
          row.name || '',
          row.hire_date || '',
          row.days_employed,
          row.next_milestone_day != null
            ? `Day ${row.next_milestone_day}`
            : row.trial_complete
              ? 'Complete'
              : '',
          row.next_milestone_date || '',
          row.days_until_next,
        ]),
      },
    ];
    downloadCsvSections(csvFileName('reports_analytics'), sections);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live organization-wide metrics
            {analytics?.generated_at && (
              <span className="ml-1"> · generated {analytics.generated_at.replace('T', ' ')}</span>
            )}
          </p>
          {latestPayroll && (
            <p className="mt-1 flex items-center gap-1.5 text-sm">
              <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Latest approved payroll ({latestPayroll.label}):</span>
              <span className="font-medium">{formatCurrency(latestPayroll.net)}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={loading && !analytics}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            Print
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">
              Failed to load analytics. The data shown may be incomplete. Click Refresh to try again.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className={cn('flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg', colorClasses[card.color])}>
                  <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <p className="mt-3 text-xl sm:text-2xl font-bold">{card.value}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">{card.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Hires vs Exits" subtitle="Monthly workforce movement">
          {loading ? (
            <ChartSkeleton />
          ) : monthly.length === 0 ? (
            <EmptyChart label="No employee data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="hires" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} name="Hires" />
                <Bar dataKey="exits" fill="hsl(0 72% 51%)" radius={[4, 4, 0, 0]} name="Exits" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Headcount Growth" subtitle="Employee count over the last 12 months">
          {loading ? (
            <ChartSkeleton />
          ) : monthly.length === 0 ? (
            <EmptyChart label="No employee data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={monthly}>
                <defs>
                  <linearGradient id="headcountGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(221 83% 53%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(221 83% 53%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="headcount" stroke="hsl(221 83% 53%)" strokeWidth={2} fill="url(#headcountGradient)" name="Employees" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Payroll Cost Trend" subtitle="Approved payroll runs by month (net)">
          {loading ? (
            <ChartSkeleton />
          ) : payroll.length === 0 ? (
            <EmptyChart label="No approved payroll runs yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={payroll}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                <Line type="monotone" dataKey="net" stroke="hsl(221 83% 53%)" strokeWidth={2} dot={{ r: 4 }} name="Net Pay" />
                <Line type="monotone" dataKey="gross" stroke="hsl(142 71% 45%)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Gross" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Department Distribution" subtitle="Employees by department">
          {loading ? (
            <ChartSkeleton />
          ) : departments.length === 0 ? (
            <EmptyChart label="No department data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={departments}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                >
                  {departments.map((entry, i) => (
                    <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Attendance" subtitle="Present vs absent employees (recent 14 days)">
          {loading ? (
            <ChartSkeleton />
          ) : attendanceSeries.length === 0 ? (
            <EmptyChart label="No attendance data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={attendanceSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="present" stackId="a" fill="hsl(142 71% 45%)" name="Present" />
                <Bar dataKey="absent" stackId="a" fill="hsl(0 72% 51%)" name="Absent" />
                <Bar dataKey="other" stackId="a" fill="hsl(199 89% 48%)" name="Other" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Recruitment Funnel" subtitle="Candidates by stage">
          {loading ? (
            <ChartSkeleton />
          ) : recruitment.length === 0 ? (
            <EmptyChart label="No candidates yet" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={recruitment} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <YAxis type="category" dataKey="stage" stroke="hsl(var(--muted-foreground))" fontSize={12} width={110} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="hsl(262 83% 58%)" radius={[0, 4, 4, 0]} name="Candidates" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Leave Summary</CardTitle>
          <CardDescription>Requests and approved days by leave type</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : leave.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No leave requests yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Leave Type</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Approved Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leave.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell className="font-medium">{row.type}</TableCell>
                    <TableCell className="text-right">{row.total}</TableCell>
                    <TableCell className="text-right text-success">{row.approved}</TableCell>
                    <TableCell className="text-right">{row.pending}</TableCell>
                    <TableCell className="text-right">{row.approved_days}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Hourglass className="h-4 w-4 text-primary" />
            Trial Periods (30/60/90)
          </CardTitle>
          <CardDescription>
            Employees in their trial window and their next milestone. Reminders are
            automated by the scheduler when a milestone falls within 14 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {trialLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : trial.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No active employees found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Days Employed</TableHead>
                  <TableHead className="text-right">Next Milestone</TableHead>
                  <TableHead>Milestone Date</TableHead>
                  <TableHead>Due In</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trial.map((row) => (
                  <TableRow key={row.employee_id}>
                    <TableCell className="font-medium">
                      {row.name || '—'}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {new Date(row.hire_date + 'T00:00:00').toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{row.days_employed ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {row.next_milestone_day ? `Day ${row.next_milestone_day}` : row.trial_complete ? 'Complete' : '—'}
                    </TableCell>
                    <TableCell>
                      {row.next_milestone_date
                        ? new Date(row.next_milestone_date + 'T00:00:00').toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {row.days_until_next != null && row.days_until_next <= 14 ? (
                        <Badge variant="outline" className="bg-warning/10 text-warning">
                          {row.days_until_next} day{row.days_until_next === 1 ? '' : 's'}
                        </Badge>
                      ) : row.days_until_next != null ? (
                        <span className="text-sm text-muted-foreground">{row.days_until_next} days</span>
                      ) : (
                        <span className="text-sm text-success">Done</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Report Builder</CardTitle>
          <CardDescription>Build custom reports combining data across modules, with filters and PDF export</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/reports/builder" className="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:border-primary/30 hover:bg-accent">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Wrench className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">Open Report Builder</p>
                <p className="text-xs text-muted-foreground">Select fields from any module, join related data, apply filters, and export to CSV or PDF</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <AccessGate anyPrivilege={['admin.reports', 'admin.reports_read']}>
      <ReportsDashboard />
    </AccessGate>
  );
}