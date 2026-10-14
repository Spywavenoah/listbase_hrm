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
  fetchPendingApprovals,
  approveWorkflowStep,
  rejectWorkflowStep,
  fetchAppealable,
  appealWorkflowStep,
  WORKFLOW_MODULE_LABELS,
  type PendingApproval,
  type AppealableWorkflow,
} from '@/lib/workflow/engine';
import { ALL_PROCUREMENT_PRIVILEGES } from '@/lib/navigation';
import { useAccess } from '@/lib/access';
import { useRouter } from 'next/navigation';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const PROC_MODULE_PAGES: Record<string, string> = {
  'procurement.requisition': '/procurement/requisitions',
  'procurement.purchase_order': '/procurement/purchase-orders',
  'procurement.invoice': '/procurement/invoices',
  'procurement.payment': '/procurement/payments',
};

interface ActionTarget {
  approval: PendingApproval;
  action: 'APPROVE' | 'REJECT';
}

export default function ApprovalsPage() {
  const router = useRouter();
  const { canAny } = useAccess();
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, appeals] = await Promise.all([
        fetchPendingApprovals(),
        fetchAppealable().catch(() => [] as AppealableWorkflow[]),
      ]);
      setApprovals(rows);
      setAppealables(appeals);
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
        toast.success('Request approved');
      } else {
        await rejectWorkflowStep(target.approval.instance_id, comment);
        toast.success('Request rejected');
      }
      setTarget(null);
      setComment('');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Pending Approvals', value: approvals.length, icon: Inbox, color: 'primary' },
    { label: 'Leave Requests', value: approvals.filter((a) => a.module_key === 'leave').length, icon: Clock, color: 'info' },
  ];

  const columns: Column<PendingApproval>[] = [
    { key: 'requester', label: 'Requester', render: (a) => a.requester_name || '—' },
    { key: 'module', label: 'Module', render: (a) => WORKFLOW_MODULE_LABELS[a.module_key] || a.module_key },
    { key: 'workflow', label: 'Workflow', render: (a) => a.workflow_name || '—' },
    { key: 'step', label: 'Step', render: (a) => a.step_title || `Step ${a.step_order || 1}` },
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
        rowActions={(a) =>
          a.status === 'PENDING' ? (
            <div className="flex items-center gap-1.5">
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
                className="h-7 border-success/30 text-success hover:bg-success/10"
                onClick={() => { setTarget({ approval: a, action: 'APPROVE' }); setComment(''); }}
              >
                <CheckCircle className="mr-1 h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => { setTarget({ approval: a, action: 'REJECT' }); setComment(''); }}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          ) : (
            <Badge variant="outline">Completed</Badge>
          )
        }
      />

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
              {target?.action === 'APPROVE' ? 'Approve request?' : 'Reject request?'}
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
              {submitting ? 'Submitting...' : target?.action === 'APPROVE' ? 'Approve' : 'Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}