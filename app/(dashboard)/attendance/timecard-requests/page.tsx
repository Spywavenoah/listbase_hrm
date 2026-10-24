'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Clock } from 'lucide-react';

interface AdjRequest {
  id: string;
  attendance_id: string;
  employee_id: string;
  field_name: string;
  original_time: string | null;
  requested_time: string;
  reason: string | null;
  status: string;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface AttendanceRow {
  id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_start: string | null;
  break_end: string | null;
}

const FIELD_LABEL: Record<string, string> = {
  CLOCK_IN: 'Clock In',
  CLOCK_OUT: 'Clock Out',
  BREAK_START: 'Break Out',
  BREAK_END: 'Break In',
};

function fmt(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function TimecardRequestsPage() {
  const [requests, setRequests] = useState<AdjRequest[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceRow>>({});
  const [employees, setEmployees] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('PENDING');
  const [reviewTarget, setReviewTarget] = useState<{ req: AdjRequest; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('timecard_adjustment_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const list = (data || []) as unknown as AdjRequest[];
      setRequests(list);

      const attIds = Array.from(new Set(list.map((r) => r.attendance_id)));
      const empIds = Array.from(new Set(list.map((r) => r.employee_id)));

      const [attRes, empRes] = await Promise.all([
        attIds.length ? supabase.from('attendance').select('*').in('id', attIds) : Promise.resolve({ data: [] as AttendanceRow[] }),
        empIds.length ? supabase.from('employees').select('id, first_name, last_name').in('id', empIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
      ]);

      const attMap: Record<string, AttendanceRow> = {};
      for (const a of (attRes.data || []) as unknown as AttendanceRow[]) attMap[a.id] = a;
      setAttendance(attMap);

      const empMap: Record<string, string> = {};
      for (const e of (empRes.data || []) as { id: string; first_name: string; last_name: string }[]) {
        empMap[e.id] = `${e.first_name} ${e.last_name}`;
      }
      setEmployees(empMap);
    } catch (err) {
      toast.error('Failed to load requests: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => (tab === 'ALL' ? requests : requests.filter((r) => r.status === tab)),
    [requests, tab]
  );

  const counts = useMemo(() => ({
    PENDING: requests.filter((r) => r.status === 'PENDING').length,
    APPROVED: requests.filter((r) => r.status === 'APPROVED').length,
    REJECTED: requests.filter((r) => r.status === 'REJECTED').length,
  }), [requests]);

  const openReview = (req: AdjRequest, approve: boolean) => {
    setNote('');
    setReviewTarget({ req, approve });
  };

  const submitReview = async () => {
    if (!reviewTarget) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('review_timecard_adjustment', {
        p_id: reviewTarget.req.id,
        p_approve: reviewTarget.approve,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      toast.success(reviewTarget.approve ? 'Adjustment approved' : 'Adjustment rejected');
      setReviewTarget(null);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const statusClass: Record<string, string> = {
    PENDING: 'bg-warning/10 text-warning',
    APPROVED: 'bg-success/10 text-success',
    REJECTED: 'bg-destructive/10 text-destructive',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Timecard Adjustment Requests</h1>
          <p className="text-sm text-muted-foreground">Review employee corrections for clock in/out and break times.</p>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="PENDING">Pending ({counts.PENDING})</TabsTrigger>
            <TabsTrigger value="APPROVED">Approved</TabsTrigger>
            <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
            <TabsTrigger value="ALL">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tab === 'ALL' ? 'All Requests' : `${tab.charAt(0)}${tab.slice(1).toLowerCase()} Requests`}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No requests in this view.</p>
          ) : (
            <div className="space-y-3">
              {visible.map((r) => {
                const att = attendance[r.attendance_id];
                const requestedField = r.field_name;
                const currentValue = att
                  ? requestedField === 'CLOCK_IN'
                    ? att.clock_in
                    : requestedField === 'CLOCK_OUT'
                    ? att.clock_out
                    : requestedField === 'BREAK_START'
                    ? att.break_start
                    : att.break_end
                  : null;
                return (
                  <div key={r.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{employees[r.employee_id] || 'Unknown employee'}</p>
                          <Badge variant="outline" className={statusClass[r.status] || ''}>{r.status}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {att ? new Date(att.date + 'T00:00:00').toLocaleDateString() : 'Unknown date'} · {FIELD_LABEL[r.field_name] || r.field_name}
                        </p>
                        <p className="text-sm">
                          <span className="text-muted-foreground">Recorded:</span> <b>{fmt(currentValue)}</b>
                          <span className="mx-2 text-muted-foreground">→</span>
                          <span className="text-muted-foreground">Requested:</span> <b>{fmt(r.requested_time)}</b>
                        </p>
                        {r.reason && <p className="text-sm text-muted-foreground">Reason: {r.reason}</p>}
                        {r.review_note && <p className="text-sm text-muted-foreground">Review note: {r.review_note}</p>}
                      </div>
                      {r.status === 'PENDING' && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => openReview(r, true)}>
                            <CheckCircle className="mr-1.5 h-4 w-4" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openReview(r, false)}>
                            <XCircle className="mr-1.5 h-4 w-4" /> Reject
                          </Button>
                        </div>
                      )}
                      {r.status !== 'PENDING' && r.reviewed_at && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" /> Reviewed {new Date(r.reviewed_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reviewTarget} onOpenChange={(o) => !submitting && !o && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewTarget?.approve ? 'Approve' : 'Reject'} Adjustment</DialogTitle>
            <DialogDescription>
              {reviewTarget ? `${employees[reviewTarget.req.employee_id] || 'Employee'} — ${FIELD_LABEL[reviewTarget.req.field_name] || reviewTarget.req.field_name} → ${fmt(reviewTarget.req.requested_time)}` : ''}
              {reviewTarget?.approve ? ' Approving will update the attendance record immediately.' : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Share context with the employee" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)} disabled={submitting}>Cancel</Button>
            <Button
              variant={reviewTarget?.approve ? 'default' : 'destructive'}
              onClick={submitReview}
              disabled={submitting}
            >
              {submitting ? 'Saving...' : reviewTarget?.approve ? 'Approve & Apply' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
