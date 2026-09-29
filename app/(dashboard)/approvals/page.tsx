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
  WORKFLOW_MODULE_LABELS,
  type PendingApproval,
} from '@/lib/workflow/engine';
import { ALL_PROCUREMENT_PRIVILEGES } from '@/lib/navigation';
import { useAccess } from '@/lib/access';
import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchPendingApprovals();
      setApprovals(rows);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load approvals: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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