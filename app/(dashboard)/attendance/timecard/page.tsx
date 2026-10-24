'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { toast } from 'sonner';
import { Clock, Coffee, Play, Square, Pencil, CheckCircle, XCircle, Timer } from 'lucide-react';

interface AttendanceRow {
  id: string;
  employee_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_start: string | null;
  break_end: string | null;
  work_hours: number | null;
  status: string;
}

interface AdjRequest {
  id: string;
  attendance_id: string;
  field_name: string;
  requested_time: string;
  status: string;
  reason: string | null;
  review_note: string | null;
  created_at: string;
}

type FieldKey = 'CLOCK_IN' | 'CLOCK_OUT' | 'BREAK_START' | 'BREAK_END';

const FIELD_LABEL: Record<FieldKey, string> = {
  CLOCK_IN: 'Clock In',
  CLOCK_OUT: 'Clock Out',
  BREAK_START: 'Break Out',
  BREAK_END: 'Break In',
};

function fmt(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateOnly(value: string) {
  return new Date(value + 'T00:00:00');
}

function isWithin3Days(dateStr: string) {
  const d = dateOnly(dateStr).getTime();
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 3);
  return d >= cutoff.getTime();
}

export default function TimecardPage() {
  const { employeeId: myId } = useAccess();
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [requests, setRequests] = useState<AdjRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingBreak, setSavingBreak] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [target, setTarget] = useState<AttendanceRow | null>(null);
  const [field, setField] = useState<FieldKey>('CLOCK_IN');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const load = useCallback(async () => {
    if (!myId) return;
    setLoading(true);
    try {
      const [attRes, reqRes] = await Promise.all([
        supabase
          .from('attendance')
          .select('*')
          .eq('employee_id', myId)
          .order('date', { ascending: false })
          .limit(60),
        supabase
          .from('timecard_adjustment_requests')
          .select('*')
          .eq('employee_id', myId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (attRes.error) throw attRes.error;
      setRows((attRes.data || []) as unknown as AttendanceRow[]);
      setRequests((reqRes.data || []) as unknown as AdjRequest[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [myId]);

  useEffect(() => { load(); }, [load]);

  const todayRow = useMemo(() => rows.find((r) => r.date === today) || null, [rows, today]);

  const pendingByAttendance = useMemo(() => {
    const map: Record<string, AdjRequest[]> = {};
    for (const r of requests) {
      if (r.status === 'PENDING') {
        (map[r.attendance_id] ||= []).push(r);
      }
    }
    return map;
  }, [requests]);

  const punchBreak = async (start: boolean) => {
    if (!todayRow) {
      toast.error('You must clock in first');
      return;
    }
    setSavingBreak(true);
    try {
      const stamp = new Date().toISOString();
      const patch = start ? { break_start: stamp, break_end: null } : { break_end: stamp };
      const { error } = await supabase.from('attendance').update(patch).eq('id', todayRow.id);
      if (error) throw error;
      toast.success(start ? 'Break started' : 'Break ended');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSavingBreak(false);
    }
  };

  const openAdjust = (row: AttendanceRow, f: FieldKey) => {
    if (!isWithin3Days(row.date)) {
      toast.error('Adjustments are only available for entries made within the last 3 days');
      return;
    }
    setTarget(row);
    setField(f);
    const current = row[f === 'CLOCK_IN' ? 'clock_in' : f === 'CLOCK_OUT' ? 'clock_out' : f === 'BREAK_START' ? 'break_start' : 'break_end'];
    setTime(current ? new Date(current).toTimeString().slice(0, 5) : '');
    setReason('');
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    if (!target || !time) {
      toast.error('Please choose a time');
      return;
    }
    if (!reason.trim()) {
      toast.error('Please provide a reason');
      return;
    }
    setSubmitting(true);
    try {
      const requested = new Date(`${target.date}T${time}:00`).toISOString();
      const { error } = await supabase.rpc('request_timecard_adjustment', {
        p_attendance_id: target.id,
        p_field: field,
        p_requested_time: requested,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast.success('Adjustment request submitted');
      setAdjustOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const statusMeta: Record<string, string> = {
    PENDING: 'bg-warning/10 text-warning',
    APPROVED: 'bg-success/10 text-success',
    REJECTED: 'bg-destructive/10 text-destructive',
  };

  const canPunchBreak = !!todayRow && !!todayRow.clock_in && !todayRow.clock_out;
  const onBreak = !!todayRow?.break_start && !todayRow?.break_end;

  return (
    <div className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Today&apos;s Time Card</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          ) : todayRow ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Clock In</p>
                  <p className="mt-1 text-lg font-semibold">{fmt(todayRow.clock_in)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Clock Out</p>
                  <p className="mt-1 text-lg font-semibold">{fmt(todayRow.clock_out)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Coffee className="h-3.5 w-3.5" /> Break Out</p>
                  <p className="mt-1 text-lg font-semibold">{fmt(todayRow.break_start)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Coffee className="h-3.5 w-3.5" /> Break In</p>
                  <p className="mt-1 text-lg font-semibold">{fmt(todayRow.break_end)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {!onBreak ? (
                  <Button size="sm" variant="outline" onClick={() => punchBreak(true)} disabled={!canPunchBreak || savingBreak}>
                    <Play className="mr-2 h-4 w-4" /> Start Break
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => punchBreak(false)} disabled={savingBreak}>
                    <Square className="mr-2 h-4 w-4" /> End Break
                  </Button>
                )}
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Timer className="h-3.5 w-3.5" /> Work hours: {todayRow.work_hours ?? '—'}
                </span>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No attendance recorded for today. Use <b>Clock In/Out</b> to start your day, then return here to punch breaks.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Time Card History</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No time card entries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Clock In</th>
                    <th className="py-2 pr-3">Break Out</th>
                    <th className="py-2 pr-3">Break In</th>
                    <th className="py-2 pr-3">Clock Out</th>
                    <th className="py-2 pr-3">Hours</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Adjust</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const within = isWithin3Days(r.date);
                    const pending = pendingByAttendance[r.id] || [];
                    return (
                      <tr key={r.id} className="border-b border-border/60">
                        <td className="py-2 pr-3 whitespace-nowrap">{new Date(r.date + 'T00:00:00').toLocaleDateString()}</td>
                        {(['clock_in', 'break_start', 'break_end', 'clock_out'] as const).map((k) => {
                          const fk: FieldKey = k === 'clock_in' ? 'CLOCK_IN' : k === 'clock_out' ? 'CLOCK_OUT' : k === 'break_start' ? 'BREAK_START' : 'BREAK_END';
                          const hasPending = pending.some((p) => p.field_name === fk);
                          return (
                            <td key={k} className="py-2 pr-3 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => openAdjust(r, fk)}
                                disabled={!within}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                                  within ? 'hover:bg-muted' : 'cursor-not-allowed opacity-60'
                                }`}
                                title={within ? 'Request adjustment' : 'Adjustment window closed (older than 3 days)'}
                              >
                                {fmt(r[k])}
                                {within && (hasPending ? <span className="text-warning">•</span> : <Pencil className="h-3 w-3 text-muted-foreground" />)}
                              </button>
                            </td>
                          );
                        })}
                        <td className="py-2 pr-3">{r.work_hours ?? '—'}</td>
                        <td className="py-2 pr-3"><Badge variant="outline">{r.status}</Badge></td>
                        <td className="py-2">
                          {within ? (
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => openAdjust(r, 'CLOCK_IN')}>
                              Request
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">My Adjustment Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No adjustment requests submitted.</p>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <div key={r.id} className="flex flex-col gap-1 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {FIELD_LABEL[r.field_name as FieldKey] || r.field_name} → {fmt(r.requested_time)}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.reason || 'No reason provided'}</p>
                    {r.review_note && <p className="text-xs text-muted-foreground">HR: {r.review_note}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status === 'APPROVED' && <CheckCircle className="h-4 w-4 text-success" />}
                    {r.status === 'REJECTED' && <XCircle className="h-4 w-4 text-destructive" />}
                    <Badge variant="outline" className={statusMeta[r.status] || ''}>{r.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={adjustOpen} onOpenChange={(o) => !submitting && setAdjustOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Timecard Adjustment</DialogTitle>
            <DialogDescription>
              {target ? new Date(target.date + 'T00:00:00').toLocaleDateString() : ''} — HR will review and apply the change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Field</Label>
              <Select value={field} onValueChange={(v) => setField(v as FieldKey)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(FIELD_LABEL) as FieldKey[]).map((f) => (
                    <SelectItem key={f} value={f}>{FIELD_LABEL[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Actual time *</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this entry needs correcting" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={submitAdjust} disabled={submitting || !time || !reason.trim()}>
              {submitting ? 'Submitting...' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
