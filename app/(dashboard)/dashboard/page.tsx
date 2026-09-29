'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Users, UserPlus, CalendarDays, Wallet, TrendingUp, TrendingDown, Clock, Package, CheckCircle2, Circle, ArrowRight, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useAccess } from '@/lib/access';
import type { Employee } from '@/lib/types';

export const dynamicParams = true;

const DashboardCharts = dynamic(
  () => import('./dashboard-charts').then((m) => m.DashboardCharts),
  { ssr: false, loading: () => <div className="h-96 animate-pulse rounded-xl bg-muted" /> }
);

interface DashboardStats {
  totalEmployees: number;
  pendingOnboarding: number;
  onLeaveToday: number;
  monthlyPayroll: number;
  presentToday: number;
  totalAssets: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { employee: currentUser } = useAccess();
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
    async function loadStats() {
      try {
        setStatsError(false);

        const today = new Date().toISOString().split('T')[0];

        const [empCount, onboardingCount, leaveToday, assetCount, attendanceCount, payrollSum] =
          await Promise.all([
            supabase.from('employees').select('id', { count: 'exact', head: true }),
            supabase
              .from('employees')
              .select('id', { count: 'exact', head: true })
              .eq('employment_status', 'PENDING_VERIFICATION'),
            supabase
              .from('leave_requests')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'APPROVED')
              .lte('start_date', today)
              .gte('end_date', today),
            supabase.from('assets').select('id', { count: 'exact', head: true }),
            supabase
              .from('attendance')
              .select('id', { count: 'exact', head: true })
              .eq('date', today),
            supabase
              .from('payroll_runs')
              .select('total_net')
              .in('status', ['APPROVED', 'DISBURSED']),
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
  }, []);

  const summaryCards = [
    { label: 'Total Employees', value: stats.totalEmployees, icon: Users, color: 'primary' as const },
    { label: 'Pending Onboarding', value: stats.pendingOnboarding, icon: UserPlus, color: 'warning' as const },
    { label: 'On Leave Today', value: stats.onLeaveToday, icon: CalendarDays, color: 'info' as const },
    { label: 'Present Today', value: stats.presentToday, icon: Clock, color: 'success' as const },
    { label: 'Total Payroll (Approved)', value: stats.monthlyPayroll > 0 ? `$${(stats.monthlyPayroll / 1000).toFixed(1)}K` : '—', icon: Wallet, color: 'primary' as const },
    { label: 'Total Assets', value: stats.totalAssets, icon: Package, color: 'destructive' as const },
  ];

  const colorClasses: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {currentUser?.employment_status === 'ONBOARDING' && (
        <OnboardingBanner employee={currentUser} onNavigate={(path) => router.push(path)} />
      )}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your organization&apos;s key metrics
        </p>
      </div>

      {statsError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">
              Some stats failed to load. The values shown may be incomplete.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className={cn('flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg', colorClasses[card.color])}>
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                </div>
                <p className="mt-3 text-xl sm:text-2xl font-bold">{card.value}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">{card.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <DashboardCharts />
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
