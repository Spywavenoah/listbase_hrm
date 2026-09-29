import { supabase } from '@/lib/supabase/client';

export interface MonthlyPoint {
  month: string;
  label: string;
  hires: number;
  exits: number;
  headcount: number;
}

export interface PayrollPoint {
  month: string;
  label: string;
  gross: number;
  deductions: number;
  net: number;
}

export interface DepartmentSlice {
  name: string;
  count: number;
}

export interface AttendancePoint {
  date: string;
  status: string;
  count: number;
}

export interface LeaveSlice {
  type: string;
  code: string;
  total: number;
  approved: number;
  pending: number;
  approved_days: number;
}

export interface RecruitmentSlice {
  stage: string;
  count: number;
}

export interface StatusSlice {
  status: string;
  count: number;
}

export interface ReportsTotals {
  employees: number;
  pending_onboarding: number;
  on_leave_today: number;
  pending_leave: number;
  open_candidates: number;
  assets: number;
}

export interface TrialMilestone {
  employee_id: string;
  name: string | null;
  email: string | null;
  hire_date: string | null;
  days_employed: number | null;
  next_milestone_day: number | null;
  next_milestone_date: string | null;
  days_until_next: number | null;
  trial_complete?: boolean;
}

export interface ReportsAnalytics {
  generated_at: string;
  monthly: MonthlyPoint[];
  payroll: PayrollPoint[];
  departments: DepartmentSlice[];
  attendance30d: AttendancePoint[];
  leave: LeaveSlice[];
  recruitment: RecruitmentSlice[];
  status: StatusSlice[];
  totals: ReportsTotals;
}

export async function fetchReportsAnalytics(months = 12): Promise<ReportsAnalytics> {
  const { data, error } = await supabase.rpc('reports_analytics', { p_months: months });
  if (error) throw error;
  return (data || {}) as ReportsAnalytics;
}

export async function fetchTrialMilestones(): Promise<TrialMilestone[]> {
  const { data, error } = await supabase.rpc('trial_milestones');
  if (error) throw error;
  return (data || []) as TrialMilestone[];
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value || 0);
}