import { supabase } from '@/lib/supabase/client';

export interface PendingApproval {
  id?: string;
  instance_id: string;
  module_key: string;
  record_id: string;
  status: string;
  initiated_by: string | null;
  requester_name: string;
  initiated_at: string;
  workflow_name: string;
  step_title: string;
  step_order: number;
}

export async function fetchPendingApprovals(): Promise<PendingApproval[]> {
  const { data, error } = await supabase.rpc('pending_approvals');
  if (error) throw error;
  const rows = (data || []) as PendingApproval[];
  return rows.map((row) => ({ ...row, id: row.instance_id }));
}

export async function approveWorkflowStep(instanceId: string, comment?: string): Promise<void> {
  const { error } = await supabase.rpc('approve_workflow_step', {
    p_instance_id: instanceId,
    p_comment: comment || null,
  });
  if (error) throw error;
}

export async function rejectWorkflowStep(instanceId: string, comment?: string): Promise<void> {
  const { error } = await supabase.rpc('reject_workflow_step', {
    p_instance_id: instanceId,
    p_comment: comment || null,
  });
  if (error) throw error;
}

export async function startWorkflow(
  moduleKey: string,
  recordId: string,
  initiatorId: string | null | undefined
): Promise<string | null> {
  const { data, error } = await supabase.rpc('maybe_start_workflow', {
    p_module_key: moduleKey,
    p_record_id: recordId,
    p_initiator_id: initiatorId || null,
  });
  if (error) throw error;
  return (data as string) || null;
}

export async function getPendingWorkflowInstance(
  moduleKey: string,
  recordId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_pending_workflow_instance', {
    p_module_key: moduleKey,
    p_record_id: recordId,
  });
  if (error) throw error;
  return (data as string) || null;
}

export interface WorkflowActorCandidate {
  id: string;
  name: string;
  role: string;
  department_name: string | null;
}

export async function fetchWorkflowActorCandidates(): Promise<WorkflowActorCandidate[]> {
  const { data, error } = await supabase.rpc('get_workflow_actor_candidates');
  if (error) throw error;
  return (data || []) as WorkflowActorCandidate[];
}

export async function setWorkflowActors(
  moduleKey: string,
  recordId: string,
  authorizerId: string | null,
  approverId: string | null
): Promise<void> {
  const { error } = await supabase.rpc('set_workflow_actors', {
    p_module_key: moduleKey,
    p_record_id: recordId,
    p_authorizer_id: authorizerId || null,
    p_approver_id: approverId || null,
  });
  if (error) throw error;
}

export interface AppealableWorkflow {
  instance_id: string;
  module_key: string;
  record_id: string;
  requester_name: string;
  workflow_name: string;
  initiated_at: string | null;
  approved_at: string | null;
}

export async function fetchAppealable(): Promise<AppealableWorkflow[]> {
  const { data, error } = await supabase.rpc('appealable_workflows');
  if (error) throw error;
  return (data || []) as AppealableWorkflow[];
}

export async function appealWorkflowStep(instanceId: string, comment?: string): Promise<void> {
  const { error } = await supabase.rpc('appeal_workflow_step', {
    p_instance_id: instanceId,
    p_comment: comment || null,
  });
  if (error) throw error;
}

export const WORKFLOW_MODULE_LABELS: Record<string, string> = {
  leave: 'Leave Request',
  'leave.encashment': 'Leave Encashment',
  expense: 'Expense Claim',
  'employee.change_request': 'Profile Change',
  attendance: 'Attendance',
  assets: 'Asset',
  onboarding: 'Onboarding',
  'procurement.requisition': 'Requisition',
  'procurement.purchase_order': 'Purchase Order',
  'procurement.invoice': 'Invoice',
  'procurement.payment': 'Payment Request',
  'recruitment.requisition': 'Recruitment Requisition',
};