'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Users, UserPlus, CalendarDays, Wallet, Clock, Package, CheckCircle2, Circle, ArrowRight, AlertCircle, Settings2, GraduationCap, TrendingUp, Users as UsersIcon, Briefcase } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useAccess } from '@/lib/access';
import { storage } from '@/lib/storage';
import {
  widgetsForAccess,
  defaultWidgetIds,
  isOrgViewer,
  type DashboardWidgetDef,
} from '@/lib/dashboard-widgets';
import {
  MyProfileWidget,
  MyLeaveWidget,
  MyAttendanceWidget,
  MyTasksWidget,
  MyRequestsWidget,
} from './personal-widgets';
import type { Employee } from '@/lib/types';

export const dynamicParams = true;

const DashboardCharts = dynamic(
  () => import('./dashboard-charts').then((m) => m.DashboardCharts),
  { ssr: false, loading: () => <div className="h-96 animate-pulse rounded-xl bg-card border border-border" /> }
);

interface DashboardStats {
  totalEmployees: number;
  pendingOnboarding: number;
  onLeaveToday: number;
  monthlyPayroll: number;
  presentToday: number;
  totalAssets: number;
}

const WIDGET_STORAGE_KEY = 'dashboard.widgets';

const summaryCards = [
  { label: 'Total Employees', value: '0', icon: Users, color: 'primary' as const, trend: '+12% vs last month', trendColor: 'text-success' as const },
  { label: 'Present Today', value: '0', icon: Clock, color: 'success' as const, trend: '94% attendance rate', trendColor: 'text-success' as const },
  { label: 'On Leave Today', value: '0', icon: CalendarDays, color: 'warning' as const, trend: '-5% vs last month', trendColor: 'text-destructive' as const },
  { label: 'Monthly Payroll', value: '$0', icon: Wallet, color: 'destructive' as const, trend: '+8% vs last month', trendColor: 'text-primary' as const },
  { label: 'Total Assets', value: '0', icon: Package, color: 'info' as const, trend: '+15 vs last month', trendColor: 'text-success' as const },
  { label: 'Departments', value: '0', icon: Briefcase, color: 'primary' as const, trend: 'Active', trendColor: 'text-primary' as const },
];

export default function DashboardPage() {
  const router = useRouter();
  const { employee: currentUser, canAny, isSuperAdmin } = useAccess();

  const available = useMemo<DashboardWidgetDef[]>(
    () => widgetsForAccess(canAny, isSuperAdmin),
    [canAny, isSuperAdmin]
  );
  const orgViewer = useMemo(() => isOrgViewer(canAny, isSuperAdmin), [canAny, isSuperAdmin]);

  const [selected, setSelected] = useState<string[] | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  // Load stored widget selection once the employee is known.
  useEffect(() => {
    if (!currentUser) return;
    const saved = storage.get<string[]>(WIDGET_STORAGE_KEY, currentUser.id);
    const validIds = available.map((w) => w.id);
    const next = (saved && saved.length > 0 ? saved : defaultWidgetIds(available, orgViewer))
      .filter((id) => validIds.includes(id));
    setSelected(next.length > 0 ? next : defaultWidgetIds(available, orgViewer));
  }, [currentUser, available, orgViewer]);

  const toggleDraft = (id: string, on: boolean) => {
    setDraft((prev) => (on ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)));
  };

  const openCustomize = () => {
    setDraft(selected || []);
    setCustomizeOpen(true);
  };

  const saveCustomize = () => {
    const validIds = available.map((w) => w.id);
    const next = draft.filter((id) => validIds.includes(id));
    setSelected(next);
    if (currentUser) storage.set(WIDGET_STORAGE_KEY, next, currentUser.id);
    setCustomizeOpen(false);
  };

  const show = (id: string) => (selected || []).includes(id);
  const showOrgStats = show('org_stats');

  const [stats, setStats] = useState<DashboardStats>({
    totalEmployees: 0,
    pendingOnboarding: 0,
    onLeaveToday: 0,
    monthlyPayroll: 0,
    presentToday: 0,
    totalAssets: 0,
  });

  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    if (!showOrgStats) return;
    async function loadStats() {
      try {
        setStatsError(false);
        const today = new Date().toISOString().split('T')[0];
        const [empCount, onboardingCount, leaveToday, assetCount, attendanceCount, payrollSum] =
          await Promise.all([
            supabase.from('employees').select('id', { count: 'exact', head: true }),
            supabase.from('employees').select('id', { count: 'exact', head: true }).eq('employment_status', 'PENDING_VERIFICATION'),
            supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED').lte('start_date', today).gte('end_date', today),
            supabase.from('assets').select('id', { count: 'exact', head: true }),
            supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('date', today),
            supabase.from('payroll_runs').select('total_net').in('status', ['APPROVED', 'DISBURSED']),
          ]);

        const monthlyPayroll = (payrollSum.data || []).reduce(
          (sum: number, r: { total_net: number }) => sum + (r.total_net || 0),
          0
        );

        setStats({
          totalEmployees: empCount.count || 0,
          pendingOnboarding: onboardingCount.count || 0,
          onLeaveToday: leaveToday.count || 0,
          monthlyPayroll,
          presentToday: attendanceCount.count || 0,
          totalAssets: assetCount.count || 0,
        });
      } catch (err) {
        console.error('Failed to load stats:', err);
        setStatsError(true);
      }
    }
    loadStats();
  }, [showOrgStats]);

  // Run the training reminder cycle, then surface unread training alerts as a popup.
  const [trainingAlerts, setTrainingAlerts] = useState<
    { id: string; title: string; message: string; type: string; created_at: string }[]
  >([]);
  const [trainingAlertOpen, setTrainingAlertOpen] = useState(false);
  const [trainingAlertsChecked, setTrainingAlertsChecked] = useState(false);

  useEffect(() => {
    if (!currentUser || trainingAlertsChecked) return;
    setTrainingAlertsChecked(true);
    let cancelled = false;
    (async () => {
      await supabase.rpc('training_send_reminders').then(() => {}, () => {});
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('id, title, message, type, created_at, metadata')
          .eq('is_read', false)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        if (cancelled) return;
        const training = (data || []).filter((n) => {
          const kind = (n.metadata as { kind?: string } | null)?.kind;
          return typeof kind === 'string' && kind.startsWith('training_');
        });
        setTrainingAlerts(training);
        if (training.length > 0) setTrainingAlertOpen(true);
      } catch {
        // notifications are non-critical
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser, trainingAlertsChecked]);

  const dismissTrainingAlerts = async (goToTraining: boolean) => {
    setTrainingAlertOpen(false);
    const ids = trainingAlerts.map((a) => a.id);
    setTrainingAlerts([]);
    if (ids.length > 0) {
      await supabase.from('notifications').update({ is_read: true }).in('id', ids).then(() => {}, () => {});
    }
    if (goToTraining) router.push('/training/enrollments');
  };

  const summaryCards = [
    { label: 'Total Employees', value: stats.totalEmployees, icon: Users, color: 'primary' as const },
    { label: 'Pending Onboarding', value: stats.pendingOnboarding, icon: UserPlus, color: 'warning' as const },
    { label: 'On Leave Today', value: stats.onLeaveToday, icon: CalendarDays, color: 'info' as const },
    { label: 'Present Today', value: stats.presentToday, icon: Clock, color: 'success' as const },
    { label: 'Total Payroll (Approved)', value: stats.monthlyPayroll > 0 ? `$${(stats.monthlyPayroll / 1000).toFixed(1)}K` : '—', icon: Wallet, color: 'primary' as const },
    { label: 'Total Assets', value: stats.totalAssets, icon: Package, color: 'destructive' as const },
  ];

  const colorClasses: Record<string, string> = {
    primary: 'bg-primary/10 text-primary border border-primary/20',
    success: 'bg-success/10 text-success border border-success/20',
    warning: 'bg-warning/10 text-warning border border-warning/20',
    destructive: 'bg-destructive/10 text-destructive border border-destructive/20',
    info: 'bg-info/10 text-info border border-info/20',
  };

  const personalWidgetIds = ['my_profile', 'my_leave', 'my_attendance', 'my_tasks', 'my_requests'];
  const hasPersonal = personalWidgetIds.some((id) => show(id));

  const personalWidgetMap: Record<string, React.ReactNode> = {
    my_profile: <MyProfileWidget />,
    my_leave: <MyLeaveWidget />,
    my_attendance: <MyAttendanceWidget />,
    my_tasks: <MyTasksWidget />,
    my_requests: <MyRequestsWidget />,
  };

  return (
    <div className="space-y-6 view-transition reveal">
      {currentUser?.employment_status === 'ONBOARDING' && (
        <OnboardingBanner employee={currentUser} onNavigate={(path) => router.push(path)} />
      )}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 lg:gap-0 animate-fade-in reveal-delay-1">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-gradient-primary">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {orgViewer ? "Overview of your organization's key metrics" : 'Your personal workspace'}
          </p>
        </div>
        <Button variant="outline" size="sm" className="btn-lift glow-green-hover" onClick={openCustomize}>
          <Settings2 className="mr-2 h-4 w-4" />
          Customize
        </Button>
      </div>

      {statsError && showOrgStats && (
        <Card className="border-destructive/30 bg-destructive/5 card-hover reveal-delay-2">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">
              Some stats failed to load. The values shown may be incomplete.
            </p>
          </CardContent>
        </Card>
      )}

      {showOrgStats && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-6 stagger reveal-delay-3">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            const cls = colorClasses[card.color];
            const valueMap: Record<string, string> = {
              'Total Employees': String(stats.totalEmployees),
              'Present Today': String(stats.presentToday),
              'On Leave Today': String(stats.onLeaveToday),
              'Monthly Payroll': stats.monthlyPayroll > 0 ? `$${(stats.monthlyPayroll / 1000).toFixed(1)}K` : '$0',
              'Total Assets': String(stats.totalAssets),
              'Departments': '6',
            };
            return (
              <Card key={card.label} className="card-hover reveal">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl shadow-sm', cls)}>
                      <Icon className="h-5 w-5 float-icon" />
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/50 border border-white/60 backdrop-blur ml-2">
                      <TrendingUp className="h-4 w-4 text-success" />
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-bold">{valueMap[card.label] || card.value}</p>
                  <p className="text-xs sm:text-sm text-muted-foreground">{card.label}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {hasPersonal && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 stagger reveal-delay-4">
          {personalWidgetIds.filter((id) => show(id)).map((id) => (
            <div key={id} className="reveal">{personalWidgetMap[id]}</div>
          ))}
        </div>
      )}

      {show('org_charts') && (
        <div className="reveal">
          <DashboardCharts />
        </div>
      )}

      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Customize Dashboard</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Choose which widgets appear on your dashboard.
            </p>
            {available.map((w) => (
              <div key={w.id} className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{w.label}</p>
                  <p className="text-xs text-muted-foreground">{w.description}</p>
                </div>
                <Switch
                  checked={draft.includes(w.id)}
                  onCheckedChange={(v) => toggleDraft(w.id, v)}
                />
              </div>
            ))}
            {available.length === 0 && (
              <p className="text-sm text-muted-foreground">No widgets available.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomizeOpen(false)} className="btn-lift">
              Cancel
            </Button>
            <Button onClick={saveCustomize} className="btn-lift glow-green-hover">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={trainingAlertOpen} onOpenChange={(o) => { if (!o) void dismissTrainingAlerts(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              Training alerts
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-3 overflow-y-auto py-1">
            {trainingAlerts.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{a.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{a.message}</p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => void dismissTrainingAlerts(false)} className="btn-lift">
              Later
            </Button>
            <Button onClick={() => void dismissTrainingAlerts(true)} className="btn-lift glow-green-hover">
              Go to Training
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OnboardingBanner({
  employee,
  onNavigate,
}: {
  employee: Employee;
  onNavigate: (path: string) => void;
}) {
  const [progress, setProgress] = useState<{
    personal: boolean;
    employment: boolean;
    documents: boolean;
    guarantor: boolean;
    medical: boolean;
  }>({ personal: false, employment: false, documents: false, guarantor: false, medical: false });

  useEffect(() => {
    async function checkProgress() {
      const [personal, employment, documents, guarantor, medical] = await Promise.all([
        supabase.from('employees').select('phone, address, date_of_birth, emergency_contact_name').eq('id', employee.id).maybeSingle(),
        supabase.from('employee_employment').select('id').eq('employee_id', employee.id).maybeSingle(),
        supabase.from('employee_documents').select('id').eq('employee_id', employee.id).limit(1),
        supabase.from('employee_guarantors').select('id').eq('employee_id', employee.id).maybeSingle(),
        supabase.from('employee_medical').select('id').eq('employee_id', employee.id).maybeSingle(),
      ]);

      setProgress({
        personal: !!(personal.data?.phone && personal.data?.address && personal.data?.date_of_birth && personal.data?.emergency_contact_name),
        employment: !!employment.data,
        documents: (documents.data?.length || 0) > 0,
        guarantor: !!guarantor.data,
        medical: !!medical.data,
      });
    }
    checkProgress();
  }, [employee.id]);

  const steps = [
    { key: 'personal', label: 'Personal Information', href: `/employees/${employee.id}/personal` },
    { key: 'employment', label: 'Employment Details', href: `/employees/${employee.id}/employment` },
    { key: 'documents', label: 'Upload Documents', href: `/employees/${employee.id}/documents` },
    { key: 'guarantor', label: 'Guarantor Information', href: `/employees/${employee.id}/guarantor` },
    { key: 'medical', label: 'Medical Records', href: `/employees/${employee.id}/medical` },
  ];

  const completedCount = steps.filter((s) => progress[s.key as keyof typeof progress]).length;
  const progressPct = Math.round((completedCount / steps.length) * 100);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Complete Your Onboarding
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome, {employee.first_name}! Please complete the following steps to finish onboarding.
            </p>
          </div>
          <div className="hidden shrink-0 text-right sm:block">
            <p className="text-2xl font-bold text-primary">{progressPct}%</p>
            <p className="text-xs text-muted-foreground">{completedCount} of {steps.length} done</p>
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step) => {
            const isDone = progress[step.key as keyof typeof progress];
            return (
              <button
                key={step.key}
                onClick={() => onNavigate(step.href)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:shadow-sm',
                  isDone ? 'border-success/30 bg-success/5' : 'border-border bg-card hover:border-primary/30'
                )}
              >
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className={cn('flex-1', isDone ? 'text-foreground' : 'text-muted-foreground')}>
                  {step.label}
                </span>
                {!isDone && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
