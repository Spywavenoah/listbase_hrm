'use client';

import { supabase } from '@/lib/supabase/client';
import type { AppraisalArea, AppraisalCycle, AppraisalStatus } from '@/lib/types';

export interface AppraisalWithPeople extends AppraisalCycle {
  employee?: { first_name: string; last_name: string; email: string | null } | null;
  manager?: { first_name: string; last_name: string } | null;
  md?: { first_name: string; last_name: string } | null;
  areas?: AppraisalArea[];
}

const PEOPLE = 'employee:employees!appraisal_cycles_employee_id_fkey(first_name,last_name,email),manager:employees!appraisal_cycles_reporting_manager_id_fkey(first_name,last_name),md:employees!appraisal_cycles_md_id_fkey(first_name,last_name)';

export function employeeName(e?: { first_name?: string; last_name?: string } | null): string {
  if (!e) return '—';
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || '—';
}

export async function fetchAppraisals(): Promise<AppraisalWithPeople[]> {
  const { data, error } = await supabase
    .from('appraisal_cycles')
    .select(`*, ${PEOPLE}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as AppraisalWithPeople[];
}

export async function fetchMyAppraisals(employeeId: string): Promise<AppraisalWithPeople[]> {
  const { data, error } = await supabase
    .from('appraisal_cycles')
    .select(`*, ${PEOPLE}`)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as AppraisalWithPeople[];
}

export async function fetchAppraisal(id: string): Promise<AppraisalWithPeople | null> {
  const { data, error } = await supabase
    .from('appraisal_cycles')
    .select(`*, ${PEOPLE}`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as unknown as AppraisalWithPeople | null;
}

export async function fetchAppraisalAreas(appraisalId: string): Promise<AppraisalArea[]> {
  const { data, error } = await supabase
    .from('appraisal_areas')
    .select('*')
    .eq('appraisal_id', appraisalId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []) as unknown as AppraisalArea[];
}

export async function createAppraisal(input: {
  employee_id: string;
  review_cycle: string;
  period_start?: string | null;
  period_end?: string | null;
  reporting_manager_id?: string | null;
  md_id?: string | null;
  allow_edit_areas?: boolean;
  notes?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_appraisal', {
    p_employee_id: input.employee_id,
    p_review_cycle: input.review_cycle,
    p_period_start: input.period_start || null,
    p_period_end: input.period_end || null,
    p_reporting_manager_id: input.reporting_manager_id || null,
    p_md_id: input.md_id || null,
    p_allow_edit_areas: input.allow_edit_areas ?? false,
    p_notes: input.notes || null,
  });
  if (error) throw error;
  return data as string;
}

export async function addAppraisalArea(appraisalId: string, name: string, description?: string, weight?: number): Promise<string> {
  const { data, error } = await supabase.rpc('add_appraisal_area', {
    p_appraisal_id: appraisalId,
    p_name: name,
    p_description: description || null,
    p_weight: weight ?? 1,
  });
  if (error) throw error;
  return data as string;
}

export async function updateAppraisalArea(areaId: string, name: string, description?: string, weight?: number): Promise<void> {
  const { error } = await supabase.rpc('update_appraisal_area', {
    p_area_id: areaId,
    p_name: name,
    p_description: description || null,
    p_weight: weight ?? 1,
  });
  if (error) throw error;
}

export async function deleteAppraisalArea(areaId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_appraisal_area', { p_area_id: areaId });
  if (error) throw error;
}

export async function setAppraisalEditAreas(appraisalId: string, allow: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_appraisal_edit_areas', { p_appraisal_id: appraisalId, p_allow: allow });
  if (error) throw error;
}

export async function submitAppraisalScores(
  appraisalId: string,
  party: 'employee' | 'manager',
  scores: { area_id: string; score: number | null; justification: string }[]
): Promise<void> {
  const { error } = await supabase.rpc('submit_appraisal_scores', {
    p_appraisal_id: appraisalId,
    p_party: party,
    p_scores: scores,
  });
  if (error) throw error;
}

export async function pushAppraisalToMd(appraisalId: string, mdId?: string | null): Promise<void> {
  const { error } = await supabase.rpc('push_appraisal_to_md', {
    p_appraisal_id: appraisalId,
    p_md_id: mdId || null,
  });
  if (error) throw error;
}

export async function giveAppraisalVerdict(
  appraisalId: string,
  finalRating: number,
  verdict: string,
  comments?: string
): Promise<void> {
  const { error } = await supabase.rpc('give_appraisal_verdict', {
    p_appraisal_id: appraisalId,
    p_final_rating: finalRating,
    p_verdict: verdict,
    p_comments: comments || null,
  });
  if (error) throw error;
}

export async function cancelAppraisal(appraisalId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_appraisal', { p_appraisal_id: appraisalId });
  if (error) throw error;
}

export function weightedAvg(areas: AppraisalArea[], party: 'employee' | 'manager'): number | null {
  const scored = areas.filter((a) => (party === 'employee' ? a.employee_score : a.manager_score) != null);
  if (scored.length === 0) return null;
  const totalW = scored.reduce((s, a) => s + (a.weight || 1), 0);
  if (totalW === 0) return null;
  const sum = scored.reduce((s, a) => s + ((party === 'employee' ? a.employee_score : a.manager_score) || 0) * (a.weight || 1), 0);
  return Math.round((sum / totalW) * 100) / 100;
}

export const APPRAISAL_STATUS_LABELS: Record<AppraisalStatus, string> = {
  DRAFT: 'Draft',
  SCORING: 'Scoring',
  PENDING_MD: 'Pending MD',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const APPRAISAL_STATUS_COLORS: Record<AppraisalStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCORING: 'bg-info/10 text-info',
  PENDING_MD: 'bg-warning/10 text-warning',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-destructive/10 text-destructive',
};
