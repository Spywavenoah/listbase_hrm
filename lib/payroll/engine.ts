import { supabase } from '@/lib/supabase/client';

export interface PayrollLine {
  name: string;
  amount: number;
}

export interface PayrollPreviewRow {
  employee_id: string;
  name: string;
  department: string;
  monthly_salary: number;
  working_days: number;
  unpaid_days: number;
  gross: number;
  tax: number;
  earnings_total: number;
  deductions_total: number;
  net: number;
  bonus_total: number;
  earnings: PayrollLine[];
  deductions: PayrollLine[];
}

export interface PayrollRunRequest {
  name: string;
  pay_period_start: string;
  pay_period_end: string;
  employee_ids?: string[];
}

export async function previewPayroll(req: PayrollRunRequest): Promise<PayrollPreviewRow[]> {
  const { data, error } = await supabase.rpc('payroll_preview', {
    p_period_start: req.pay_period_start,
    p_period_end: req.pay_period_end,
    p_employee_ids: req.employee_ids?.length ? req.employee_ids : null,
  });
  if (error) throw error;
  return (data || []) as PayrollPreviewRow[];
}

export async function generatePayrollRun(req: PayrollRunRequest): Promise<string> {
  const { data, error } = await supabase.rpc('generate_payroll_run', {
    p_name: req.name,
    p_period_start: req.pay_period_start,
    p_period_end: req.pay_period_end,
    p_employee_ids: req.employee_ids?.length ? req.employee_ids : null,
  });
  if (error) throw error;
  return data as string;
}

export function formatMoney(value: number): string {
  return `$${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface BonusMaster {
  id: string;
  name: string;
  employee_id: string | null;
  rate_type: 'FIXED' | 'PERCENTAGE';
  amount: number;
  effective_start: string | null;
  effective_end: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BonusInput {
  name: string;
  employee_id?: string | null;
  rate_type: 'FIXED' | 'PERCENTAGE';
  amount: number;
  effective_start?: string | null;
  effective_end?: string | null;
  is_active?: boolean;
}

export async function fetchBonuses(): Promise<BonusMaster[]> {
  const { data, error } = await supabase
    .from('bonus_master')
    .select(
      'id, name, employee_id, rate_type, amount, effective_start, effective_end, is_active, created_at'
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as BonusMaster[];
}

export async function createBonus(input: BonusInput): Promise<void> {
  const { error } = await supabase
    .from('bonus_master')
    .insert({
      name: input.name,
      employee_id: input.employee_id || null,
      rate_type: input.rate_type,
      amount: input.amount,
      effective_start: input.effective_start || null,
      effective_end: input.effective_end || null,
      is_active: input.is_active ?? true,
    });
  if (error) throw error;
}

export async function updateBonus(id: string, patch: Partial<BonusInput>): Promise<void> {
  const { error } = await supabase.from('bonus_master').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteBonus(id: string): Promise<void> {
  const { error } = await supabase.from('bonus_master').delete().eq('id', id);
  if (error) throw error;
}