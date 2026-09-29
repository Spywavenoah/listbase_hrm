'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CalendarClock, Plus, Trash2, CheckCircle, Loader2, Rocket, Flag } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { toast } from 'sonner';

interface ScheduleMilestone {
  id: string;
  day: number;
  title: string;
  description: string | null;
  milestone_date: string | null;
  status: string;
  completed_at: string | null;
  notes: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  PLANNED: 'bg-muted text-muted-foreground border-border',
  IN_PROGRESS: 'bg-info/10 text-info border-info/20',
  COMPLETED: 'bg-success/10 text-success border-success/20',
};

const STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED'];

export default function NetworkSchedulePage() {
  const { can } = useAccess();
  const canWrite = can('admin.settings');

  const [rows, setRows] = useState<ScheduleMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleMilestone | null>(null);
  const [form, setForm] = useState({
    day: '',
    title: '',
    description: '',
    milestone_date: '',
    status: 'PLANNED',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('network_schedule')
        .select('*')
        .order('day', { ascending: true });
      if (error) throw error;
      setRows((data || []) as unknown as ScheduleMilestone[]);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load schedule: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const completed = rows.filter((r) => r.status === 'COMPLETED').length;
  const inProgress = rows.filter((r) => r.status === 'IN_PROGRESS').length;
  const pct = rows.length ? Math.round((completed / rows.length) * 100) : 0;
  const dayZero = rows.find((r) => r.day === 0) || null;

  const openCreate = () => {
    setForm({ day: '', title: '', description: '', milestone_date: '', status: 'PLANNED', notes: '' });
    setDialogOpen(true);
  };

  const openEdit = (row: ScheduleMilestone) => {
    setForm({
      day: String(row.day),
      title: row.title,
      description: row.description || '',
      milestone_date: row.milestone_date || '',
      status: row.status,
      notes: row.notes || '',
    });
    setDeleteTarget(null);
    setDialogOpen(true);
  };

  const save = async (existingId?: string) => {
    if (!form.title || form.day === '') {
      toast.error('Title and day offset are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        day: parseInt(form.day, 10),
        title: form.title,
        description: form.description || null,
        milestone_date: form.milestone_date || null,
        status: form.status,
        completed_at: form.status === 'COMPLETED' ? new Date().toISOString() : null,
        notes: form.notes || null,
      };
      const { error } = existingId
        ? await supabase.from('network_schedule').update(payload).eq('id', existingId)
        : await supabase.from('network_schedule').insert(payload);
      if (error) throw error;
      toast.success(existingId ? 'Milestone updated' : 'Milestone added');
      setDialogOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const advanceStatus = async (row: ScheduleMilestone) => {
    const next = row.status === 'PLANNED' ? 'IN_PROGRESS' : row.status === 'IN_PROGRESS' ? 'COMPLETED' : 'PLANNED';
    try {
      const { error } = await supabase
        .from('network_schedule')
        .update({
          status: next,
          completed_at: next === 'COMPLETED' ? new Date().toISOString() : null,
        })
        .eq('id', row.id);
      if (error) throw error;
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, status: next, completed_at: next === 'COMPLETED' ? new Date().toISOString() : null }
            : r
        )
      );
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase
        .from('network_schedule')
        .delete()
        .eq('id', deleteTarget.id);
      if (error) throw error;
      toast.success('Milestone deleted');
      setDeleteTarget(null);
      setDialogOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarClock className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle className="text-lg">Network Schedule</CardTitle>
              <CardDescription>
                Project milestones counting down to day 0 (go-live)
              </CardDescription>
            </div>
          </div>
          {canWrite && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Add Milestone
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Total Milestones</p>
              <p className="mt-1 text-2xl font-bold">{rows.length}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="mt-1 text-2xl font-bold text-success">{completed}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">In Progress</p>
              <p className="mt-1 text-2xl font-bold text-info">{inProgress}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Cumulative Complete</p>
              <p className="mt-1 text-2xl font-bold text-primary">{pct}%</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          {dayZero && (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <Rocket className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-semibold">
                  Day 0 — {dayZero.title}
                  {dayZero.milestone_date && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      ({dayZero.milestone_date})
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Go-live target. {dayZero.status === 'COMPLETED' ? 'Reached.' : 'Pending.'}
                </p>
              </div>
              <Badge variant="outline" className={STATUS_COLORS[dayZero.status]}>
                {dayZero.status.replace(/_/g, ' ')}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Milestones</CardTitle>
          <CardDescription>
            Day offsets are relative to go-live (day 0). Negative = before, positive = after.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Day</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead className="w-36">Date</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <div className="h-5 w-full animate-pulse rounded bg-muted" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">
                      No milestones yet. Add your first milestone.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} className={row.day === 0 ? 'bg-primary/5' : ''}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={row.day === 0 ? 'border-primary/40 bg-primary/10 text-primary' : ''}
                        >
                          {row.day === 0 ? 'Day 0' : row.day > 0 ? `+${row.day}` : row.day}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{row.title}</p>
                        {row.description && (
                          <p className="text-xs text-muted-foreground">{row.description}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.milestone_date || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[row.status]}>
                          {row.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {canWrite && (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => advanceStatus(row)}>
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => { setDeleteTarget(row); setDialogOpen(true); }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {deleteTarget
                ? 'Delete Milestone?'
                : form.title && rows.some((r) => r.title === form.title)
                  ? 'Edit Milestone'
                  : 'Add Milestone'}
            </DialogTitle>
          </DialogHeader>

          {deleteTarget ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Remove <span className="font-medium text-foreground">{deleteTarget.title}</span> (Day {deleteTarget.day}) from the schedule?
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setDeleteTarget(null); setDialogOpen(false); }}>
                  Cancel
                </Button>
                <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Day Offset (0 = go-live)</Label>
                  <Input
                    type="number"
                    placeholder="-7"
                    value={form.day}
                    onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  placeholder="e.g. Cutover dry run"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  placeholder="Optional details"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Milestone Date</Label>
                <Input
                  type="date"
                  value={form.milestone_date}
                  onChange={(e) => setForm((f) => ({ ...f, milestone_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  placeholder="Rollout notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
