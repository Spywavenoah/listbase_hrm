'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { CheckCircle, XCircle, Inbox, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  fetchPendingApprovals,
  approveWorkflowStep,
  rejectWorkflowStep,
  fetchAppealable,
  appealWorkflowStep,
  getPendingWorkflowInstance,
  getWorkflowStepContext,
  WORKFLOW_MODULE_LABELS,
  type PendingApproval,
  type AppealableWorkflow,
} from '@/lib/workflow/engine';
import { ALL_PROCUREMENT_PRIVILEGES } from '@/lib/navigation';
import { useAccess } from '@/lib/access';
import { useRouter } from 'next/navigation';
import { ExternalLink, RotateCcw, UserCog, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/client';

const MODULE_PAGES: Record<string, string> = {
  leave: '/leave',
  'leave.encashment': '/leave/encashments',
  expense: '/expenses',
  travel: '/expenses',
  'employee': '/employees/change-requests',
  'employee.change_request': '/employees/change-requests',
  'procurement.requisition': '/procurement/requisitions',
  'procurement.purchase_order': '/procurement/purchase-orders',
  'procurement.invoice': '/procurement/invoices',
  'procurement.payment': '/procurement/payments',
  'inventory.material_request': '/inventory/material-requests',
  'assets.vehicle_request': '/assets/vehicle-requests',
};

const PROC_MODULE_PAGES: Record<string, string> = {
  'procurement.requisition': '/procurement/requisitions',
  'procurement.purchase_order': '/procurement/purchase-orders',
  'procurement.invoice': '/procurement/invoices',
  'procurement.payment': '/procurement/payments',
};

interface ActionTarget {
  approval: PendingApproval;
  action: 'APPROVE' | 'REJECT';
  isFinal: boolean;
}

interface ProfileChangeRequest {
  id: string;
  field_name: string;
  section: string | null;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  requested_at: string;
  status?: string;
  review_note?: string | null;
  employees?: { first_name: string; last_name: string; email: string } | null;
}

interface ChangeActionTarget {
  request: ProfileChangeRequest;
  action: 'APPROVE' | 'REJECT';
  isFinal: boolean;
}

const fieldLabel = (field: string) =>
  field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const displayValue = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  try {
    const parsed = JSON.parse(v as string);
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
  } catch {
    return String(v);
  }
};

export default function ApprovalsPage() {
  const router = useRouter();
  const { canAny, employeeId } = useAccess();
  const canViewProcurement = canAny(ALL_PROCUREMENT_PRIVILEGES);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<ActionTarget | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [appealables, setAppealables] = useState<AppealableWorkflow[]>([]);
  const [appealTarget, setAppealTarget] = useState<AppealableWorkflow | null>(null);
  const [appealComment, setAppealComment] = useState('');
  const [appealing, setAppealing] = useState(false);
  const [profileChanges, setProfileChanges] = useState<ProfileChangeRequest[]>([]);
  const [changeTarget, setChangeTarget] = useState<ChangeActionTarget | null>(null);
  const [changeComment, setChangeComment] = useState('');
  const [changeSubmitting, setChangeSubmitting] = useState(false);
  const [changeStepFinal, setChangeStepFinal] = useState<Record<string, boolean>>({});
  const [detailTarget, setDetailTarget] = useState<PendingApproval | null>(null);
  const [detailChange, setDetailChange] = useState<ProfileChangeRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, appeals, crRes] = await Promise.all([
        fetchPendingApprovals(),
        fetchAppealable().catch(() => [] as AppealableWorkflow[]),
        supabase
          .from('employee_change_requests')
          .select('id, field_name, section, old_value, new_value, reason, requested_at, employees!employee_change_requests_employee_id_fkey(first_name, last_name, email)')
          .eq('status', 'PENDING')
          .order('requested_at', { ascending: false }),
      ]);
      setApprovals(rows);
      setAppealables(appeals);
      const crs = (crRes.data || []) as unknown as ProfileChangeRequest[];
      setProfileChanges(crs);
      const finals: Record<string, boolean> = {};
      await Promise.all(
        crs.map(async (c) => {
          try {
            const ctx = await getWorkflowStepContext('employee.change_request', c.id);
            finals[c.id] = ctx ? ctx.is_final !== false : true;
          } catch {
            finals[c.id] = true;
          }
        })
      );
      setChangeStepFinal(finals);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load approvals: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitAppeal = async () => {
    if (!appealTarget) return;
    setAppealing(true);
    try {
      await appealWorkflowStep(appealTarget.instance_id, appealComment);
      toast.success('Workflow appealed — it is now pending re-approval');
      setAppealTarget(null);
      setAppealComment('');
      load();
    } catch (err) {
      toast.error('Failed to appeal: ' + (err as Error).message);
    } finally {
      setAppealing(false);
    }
  };

  const submit = async () => {
    if (!target) return;
    setSubmitting(true);
    try {
      if (target.action === 'APPROVE') {
        await approveWorkflowStep(target.approval.instance_id, comment);
        toast.success(target.isFinal ? 'Request approved' : 'Request authorized');
      } else {
        await rejectWorkflowStep(target.approval.instance_id, comment);
        toast.success('Request rejected');
      }
      setTarget(null);
      setComment('');
      load();
    } catch (err) {
      const msg = (err as Error).message || 'Unknown error';
      toast.error('Failed: ' + msg);
      setTarget(null);
      setComment('');
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const submitChangeRequest = async () => {
    if (!changeTarget) return;
    setChangeSubmitting(true);
    try {
      let instanceId: string | null = null;
      try {
        instanceId = await getPendingWorkflowInstance('employee.change_request', changeTarget.request.id);
      } catch {
        instanceId = null;
      }
      const approve = changeTarget.action === 'APPROVE';
      if (instanceId) {
        if (approve) await approveWorkflowStep(instanceId, changeComment || undefined);
        else await rejectWorkflowStep(instanceId, changeComment || undefined);
      } else {
        const { error } = await supabase.rpc('review_employee_change_request', {
          p_request_id: changeTarget.request.id,
          p_approve: approve,
          p_note: changeComment || null,
        });
        if (error) throw error;
      }
      toast.success(
        approve
          ? changeTarget.isFinal
            ? 'Profile change approved and applied'
            : 'Profile change authorized — awaiting final approval'
          : 'Profile change rejected'
      );
      setChangeTarget(null);
      setChangeComment('');
      load();
    } catch (err) {
      toast.error('Failed: ' + ((err as Error).message || 'Unknown error'));
    } finally {
      setChangeSubmitting(false);
    }
  };

  const openDetails = async (a: PendingApproval) => {
    setDetailTarget(a);
    setDetailChange(null);
    const isChange = a.module_key === 'employee.change_request' || a.module_key === 'employee';
    if (!isChange) return;
    const local = profileChanges.find((c) => c.id === a.record_id);
    if (local) {
      setDetailChange(local);
      return;
    }
    setDetailLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_change_requests')
        .select('id, field_name, section, old_value, new_value, reason, requested_at, status, review_note, employees!employee_change_requests_employee_id_fkey(first_name, last_name, email)')
        .eq('id', a.record_id)
        .maybeSingle();
      if (error) throw error;
      if (data) setDetailChange(data as unknown as ProfileChangeRequest);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load request details: ' + (err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Pending Approvals', value: approvals.length, icon: Inbox, color: 'primary' },
    { label: 'Leave Requests', value: approvals.filter((a) => a.module_key === 'leave').length, icon: Clock, color: 'info' },
    { label: 'Profile Changes', value: profileChanges.length, icon: UserCog, color: 'warning' },
  ];

  const columns: Column<PendingApproval>[] = [
    { key: 'requester', label: 'Requester', render: (a) => a.requester_name || '—' },
    { key: 'module', label: 'Module', render: (a) => WORKFLOW_MODULE_LABELS[a.module_key] || a.module_key },
    { key: 'workflow', label: 'Workflow', render: (a) => a.workflow_name || '—' },
    { key: 'step', label: 'Step', render: (a) => (a.total_steps && a.total_steps > 1 ? `Step ${a.step_order || 1} of ${a.total_steps}` : (a.step_title || `Step ${a.step_order || 1}`)) },
    {
      key: 'initiated', label: 'Initiated',
      render: (a) => a.initiated_at ? new Date(a.initiated_at).toLocaleString() : '—',
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Approvals"
        description="Requests waiting for your action"
        summaryCards={summaryCards}
        columns={columns}
        data={approvals}
        loading={loading}
        searchPlaceholder="Search approvals..."
        emptyMessage="Nothing awaiting your approval"
        emptyDescription="When workflows are configured and enabled, the requests assigned to you will appear here."
        rowActions={(a) => {
          const isSelf = !!employeeId && a.initiated_by === employeeId;
          if (isSelf) {
            return <Badge variant="outline" className="bg-muted text-muted-foreground">Awaiting others</Badge>;
          }
          if (a.status !== 'PENDING') {
            return <Badge variant="outline">Completed</Badge>;
          }
          return (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openDetails(a)}
              >
                <Eye className="mr-1 h-3.5 w-3.5" />
                View
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-success/30 text-success hover:bg-success/10"
                onClick={() => { setTarget({ approval: a, action: 'APPROVE', isFinal: a.is_final !== false }); setComment(''); }}
              >
                <CheckCircle className="mr-1 h-3.5 w-3.5" />
                {a.is_final === false ? 'Authorize' : 'Approve'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => { setTarget({ approval: a, action: 'REJECT', isFinal: a.is_final !== false }); setComment(''); }}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          );
        }}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Employee Information Modification Requests</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Profile changes submitted by employees and waiting for your decision
            </p>
          </div>
          <UserCog className="h-4.5 w-4.5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted p-4" />
          ) : profileChanges.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <UserCog className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">No pending profile change requests.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {profileChanges.map((c) => {
                const isFinal = changeStepFinal[c.id] !== false;
                return (
                  <div key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{fieldLabel(c.field_name)}</p>
                        <Badge variant="outline" className="text-muted-foreground">PENDING</Badge>
                        {c.section && (
                          <Badge variant="outline" className="text-muted-foreground">{c.section}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {c.employees?.first_name} {c.employees?.last_name} ({c.employees?.email || 'employee'}) ·{' '}
                        {c.requested_at ? new Date(c.requested_at).toLocaleString() : '—'}
                      </p>
                      <p className="mt-1 text-sm">
                        <span className="line-through decoration-muted-foreground/60">{displayValue(c.old_value)}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium text-success">{displayValue(c.new_value)}</span>
                      </p>
                      {c.reason && <p className="mt-0.5 text-xs text-muted-foreground">Reason: {c.reason}</p>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-success/30 text-success hover:bg-success/10"
                        onClick={() => { setChangeTarget({ request: c, action: 'APPROVE', isFinal }); setChangeComment(''); }}
                      >
                        <CheckCircle className="mr-1 h-3.5 w-3.5" />
                        {isFinal ? 'Approve' : 'Authorize'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => { setChangeTarget({ request: c, action: 'REJECT', isFinal }); setChangeComment(''); }}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Approved — Appealable</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Approved workflows you can reopen for a fresh approval round
            </p>
          </div>
          <RotateCcw className="h-4.5 w-4.5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-0">
          {appealables.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <RotateCcw className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">No appealable workflows right now.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {appealables.map((a) => (
                <div key={a.instance_id} className="flex items-center gap-4 p-4 hover:bg-accent/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">
                      {WORKFLOW_MODULE_LABELS[a.module_key] || a.module_key}
                      <span className="ml-2 text-sm text-muted-foreground">{a.workflow_name}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.requester_name || 'Unknown'} · approved {a.approved_at ? new Date(a.approved_at).toLocaleString() : '—'}
                    </p>
                  </div>
                  {PROC_MODULE_PAGES[a.module_key] && canViewProcurement && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push(PROC_MODULE_PAGES[a.module_key])}
                    >
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      View
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-warning/30 text-warning hover:bg-warning/10"
                    onClick={() => { setAppealTarget(a); setAppealComment(''); }}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                    Appeal
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!appealTarget} onOpenChange={(open) => { if (!open && !appealing) setAppealTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Appeal this approval?</AlertDialogTitle>
            <AlertDialogDescription>
              This reopens{' '}
              <strong>{appealTarget ? WORKFLOW_MODULE_LABELS[appealTarget.module_key] || appealTarget.module_key : ''}</strong>{' '}
              for a fresh approval round. It becomes pending again and the request record can be edited while it is pending.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="appeal-comment">Reason for appeal (optional)</Label>
            <Textarea
              id="appeal-comment"
              value={appealComment}
              onChange={(e) => setAppealComment(e.target.value)}
              placeholder="Explain why this should be re-reviewed..."
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={appealing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-warning text-warning-foreground hover:bg-warning/90"
              disabled={appealing}
              onClick={(e) => { e.preventDefault(); submitAppeal(); }}
            >
              {appealing ? 'Appealing...' : 'Appeal'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!target} onOpenChange={(open) => { if (!open && !submitting) setTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target?.action === 'APPROVE' ? (target.isFinal ? 'Approve request?' : 'Authorize request?') : 'Reject request?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target && (
                <>
                  <strong>{target.approval.requester_name || 'Requester'}</strong> —{' '}
                  {WORKFLOW_MODULE_LABELS[target.approval.module_key] || target.approval.module_key} ·{' '}
                  {target.approval.workflow_name}
                  {target.approval.step_title ? ` · Step: ${target.approval.step_title}` : ''}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {target && PROC_MODULE_PAGES[target.approval.module_key] && canViewProcurement && (
            <button
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
              onClick={() => {
                setTarget(null);
                router.push(PROC_MODULE_PAGES[target.approval.module_key]);
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open the request record before deciding
            </button>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="approval-comment">Comment (optional)</Label>
            <Textarea
              id="approval-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add an optional note for the requester..."
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(e) => { e.preventDefault(); submit(); }}
            >
              {submitting ? 'Submitting...' : target?.action === 'APPROVE' ? (target.isFinal ? 'Approve' : 'Authorize') : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!changeTarget} onOpenChange={(open) => { if (!open && !changeSubmitting) setChangeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {changeTarget?.action === 'APPROVE'
                ? changeTarget.isFinal ? 'Approve profile change?' : 'Authorize profile change?'
                : 'Reject profile change?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {changeTarget && (
                <>
                  Update <strong>{fieldLabel(changeTarget.request.field_name)}</strong> from{' '}
                  <strong>{displayValue(changeTarget.request.old_value)}</strong> to{' '}
                  <strong>{displayValue(changeTarget.request.new_value)}</strong> for{' '}
                  <strong>
                    {changeTarget.request.employees?.first_name} {changeTarget.request.employees?.last_name}
                  </strong>
                  ?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="change-comment">Comment (optional)</Label>
            <Textarea
              id="change-comment"
              value={changeComment}
              onChange={(e) => setChangeComment(e.target.value)}
              placeholder={changeTarget?.action === 'APPROVE' ? 'Add an optional note for the employee...' : 'Explain why this was rejected...'}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={changeSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={changeSubmitting}
              onClick={(e) => { e.preventDefault(); submitChangeRequest(); }}
            >
              {changeSubmitting
                ? 'Submitting...'
                : changeTarget?.action === 'APPROVE'
                  ? changeTarget.isFinal ? 'Approve' : 'Authorize'
                  : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!detailTarget} onOpenChange={(open) => { if (!open) { setDetailTarget(null); setDetailChange(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {detailTarget ? (WORKFLOW_MODULE_LABELS[detailTarget.module_key] || detailTarget.module_key) : ''} request
            </DialogTitle>
            <DialogDescription>
              {detailTarget?.workflow_name}
              {detailTarget?.step_title ? ` · ${detailTarget.step_title}` : ''}
            </DialogDescription>
          </DialogHeader>

          {detailTarget && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Requester</p>
                <p className="text-sm font-medium">{detailTarget.requester_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                <p className="text-sm font-medium">{detailTarget.status || 'PENDING'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Step</p>
                <p className="text-sm font-medium">
                  {detailTarget.total_steps && detailTarget.total_steps > 1
                    ? `Step ${detailTarget.step_order || 1} of ${detailTarget.total_steps}`
                    : (detailTarget.step_title || `Step ${detailTarget.step_order || 1}`)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Initiated</p>
                <p className="text-sm font-medium">
                  {detailTarget.initiated_at ? new Date(detailTarget.initiated_at).toLocaleString() : '—'}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Record ID</p>
                <p className="break-all font-mono text-xs">{detailTarget.record_id}</p>
              </div>
            </div>
          )}

          {(detailTarget?.module_key === 'employee.change_request' || detailTarget?.module_key === 'employee') && (
            <div className="rounded-lg border border-border p-4">
              {detailLoading ? (
                <div className="h-16 animate-pulse rounded bg-muted" />
              ) : detailChange ? (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Requested change</p>
                  <p className="text-sm font-medium">
                    {detailChange.employees?.first_name} {detailChange.employees?.last_name}
                    {detailChange.employees?.email ? ` (${detailChange.employees.email})` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{fieldLabel(detailChange.field_name)}</span>
                    {detailChange.section && (
                      <Badge variant="outline" className="text-muted-foreground">{detailChange.section}</Badge>
                    )}
                  </div>
                  <p className="text-sm">
                    <span className="line-through decoration-muted-foreground/60">{displayValue(detailChange.old_value)}</span>
                    <span className="text-muted-foreground"> → </span>
                    <span className="font-medium text-success">{displayValue(detailChange.new_value)}</span>
                  </p>
                  {detailChange.reason && (
                    <p className="text-xs text-muted-foreground">Reason: {detailChange.reason}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Requested {detailChange.requested_at ? new Date(detailChange.requested_at).toLocaleString() : '—'}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No additional details available for this request.</p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {detailTarget && MODULE_PAGES[detailTarget.module_key] ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { const p = MODULE_PAGES[detailTarget.module_key]; setDetailTarget(null); setDetailChange(null); router.push(p); }}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open full record
              </Button>
            ) : <span />}
            {detailTarget && detailTarget.status === 'PENDING' && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-success/30 text-success hover:bg-success/10"
                  onClick={() => {
                    const a = detailTarget;
                    setDetailTarget(null); setDetailChange(null);
                    setTarget({ approval: a, action: 'APPROVE', isFinal: a.is_final !== false });
                    setComment('');
                  }}
                >
                  <CheckCircle className="mr-1 h-3.5 w-3.5" />
                  {detailTarget.is_final === false ? 'Authorize' : 'Approve'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    const a = detailTarget;
                    setDetailTarget(null); setDetailChange(null);
                    setTarget({ approval: a, action: 'REJECT', isFinal: a.is_final !== false });
                    setComment('');
                  }}
                >
                  <XCircle className="mr-1 h-3.5 w-3.5" />
                  Reject
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}