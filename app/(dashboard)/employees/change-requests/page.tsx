'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { AccessGate } from '@/lib/access';
import { getPendingWorkflowInstance, approveWorkflowStep, rejectWorkflowStep } from '@/lib/workflow/engine';
import { CheckCircle, XCircle, ClipboardList, Inbox } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ChangeRequest {
  id: string;
  employee_id: string;
  section: string;
  field_name: string;
  old_value: unknown | null;
  new_value: unknown;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  employees?: { first_name: string; last_name: string; email: string } | null;
}

const SECTION_LABELS: Record<string, string> = {
  PERSONAL: 'Personal',
  CONTACT: 'Contact',
  EMERGENCY: 'Emergency',
  BANK: 'Bank',
  OTHER: 'Other',
};

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

export default function ChangeRequestsPage() {
  const { loading: accessLoading } = useAccess();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<ChangeRequest | null>(null);
  const [approve, setApprove] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_change_requests')
        .select('*, employees(first_name, last_name, email)')
        .order('requested_at', { ascending: false });
      if (error) throw error;
      setRequests((data || []) as unknown as ChangeRequest[]);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load change requests: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!target) return;
    setSubmitting(true);
    try {
      // Prefer the workflow chain; fall back to the direct review RPC when no
      // chain is pending (e.g. an admin override).
      let instanceId: string | null = null;
      try {
        instanceId = await getPendingWorkflowInstance('employee.change_request', target.id);
      } catch {
        instanceId = null;
      }
      if (instanceId) {
        if (approve) await approveWorkflowStep(instanceId, note.trim() || undefined);
        else await rejectWorkflowStep(instanceId, note.trim() || undefined);
      } else {
        const { error } = await supabase.rpc('review_employee_change_request', {
          p_request_id: target.id,
          p_approve: approve,
          p_note: note.trim() || null,
        });
        if (error) throw error;
      }
      toast.success(approve ? 'Change request approved and applied' : 'Change request rejected');
      setTarget(null);
      setNote('');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const pending = requests.filter((r) => r.status === 'PENDING').length;

  return (
    <AccessGate privilege="employees.manage">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profile Change Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and apply changes requested by active employees to their locked profiles
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pending}</p>
                <p className="text-sm text-muted-foreground">Pending review</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
                <CheckCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{requests.filter((r) => r.status === 'APPROVED').length}</p>
                <p className="text-sm text-muted-foreground">Approved</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <XCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{requests.filter((r) => r.status === 'REJECTED').length}</p>
                <p className="text-sm text-muted-foreground">Rejected</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Requests</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading || accessLoading ? (
              <div className="h-32 animate-pulse rounded-lg bg-muted p-4" />
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Inbox className="h-10 w-10 mb-2 opacity-50" />
                <p className="text-sm">No change requests yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {requests.map((r) => (
                  <div key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {fieldLabel(r.field_name)}
                        </p>
                        <Badge variant="outline" className={
                          r.status === 'APPROVED' ? 'bg-success/10 text-success border-success/20'
                            : r.status === 'REJECTED' ? 'bg-destructive/10 text-destructive border-destructive/20'
                              : 'bg-warning/10 text-warning border-warning/20'
                        }>
                          {r.status}
                        </Badge>
                        {r.section && (
                          <Badge variant="outline" className="text-muted-foreground">
                            {SECTION_LABELS[r.section] || r.section}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {r.employees?.first_name} {r.employees?.last_name} ({r.employees?.email || r.employee_id})
                        {' · '}{r.requested_at ? new Date(r.requested_at).toLocaleString() : '—'}
                      </p>
                      <p className="mt-1 text-sm">
                        <span className="text-muted-foreground">from </span>
                        <span className="line-through decoration-muted-foreground/60">{displayValue(r.old_value)}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium text-success">{displayValue(r.new_value)}</span>
                      </p>
                      {r.reason && <p className="mt-0.5 text-xs text-muted-foreground">Reason: {r.reason}</p>}
                      {r.review_note && (
                        <p className="mt-0.5 text-xs text-muted-foreground">Review note: {r.review_note}</p>
                      )}
                    </div>
                    {r.status === 'PENDING' ? (
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-success/30 text-success hover:bg-success/10"
                          onClick={() => { setTarget(r); setApprove(true); setNote(''); }}
                        >
                          <CheckCircle className="mr-1 h-3.5 w-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-destructive/30 text-destructive hover:bg-destructive/10"
                          onClick={() => { setTarget(r); setApprove(false); setNote(''); }}
                        >
                          <XCircle className="mr-1 h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Reviewed {r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString() : ''}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={!!target} onOpenChange={(open) => { if (!open && !submitting) setTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{approve ? 'Approve change request?' : 'Reject change request?'}</AlertDialogTitle>
              <AlertDialogDescription>
                {target && (
                  <>
                    Update <strong>{fieldLabel(target.field_name)}</strong> to{' '}
                    <strong>{displayValue(target.new_value)}</strong> for{' '}
                    <strong>{target.employees?.first_name} {target.employees?.last_name}</strong>?
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="review-note">Note {approve ? '(optional)' : '(optional)'}</Label>
              <Textarea
                id="review-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={approve ? 'Add an optional note for the employee...' : 'Explain why this was rejected...'}
                rows={3}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={approve ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}
                disabled={submitting}
                onClick={(e) => { e.preventDefault(); submit(); }}
              >
                {submitting ? 'Submitting...' : approve ? 'Approve' : 'Reject'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AccessGate>
  );
}