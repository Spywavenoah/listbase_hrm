'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { CalendarClock, Plus, Play, Trash2, CheckCircle, XCircle, History, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { triggerMailProcessing } from '@/lib/notifications';

interface ScheduledTask {
  id: string;
  name: string;
  job_type: string;
  frequency: string;
  run_at: string;
  day_of_week: number | null;
  day_of_month: number | null;
  event_key: string | null;
  next_run_at: string;
  is_active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
}

interface TaskLog {
  id: string;
  task_id: string;
  run_at: string;
  status: string;
  items_processed: number;
  message: string | null;
}

const jobTypes = [
  { value: 'PERFORMANCE_REVIEW', label: 'Performance review due' },
  { value: 'ONBOARDING_FOLLOWUP', label: 'Onboarding follow-up' },
  { value: 'TRAINING_REMINDER', label: 'Training reminder' },
  { value: 'TRIAL_MILESTONE', label: 'Trial milestone (30/60/90)' },
  { value: 'CUSTOM', label: 'Custom reminder' },
];

const frequencies = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
];

const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const jobTypeLabel = (v: string) => jobTypes.find((j) => j.value === v)?.label || v;
const freqLabel = (v: string) => frequencies.find((f) => f.value === v)?.label || v;

export default function SchedulerPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    job_type: 'PERFORMANCE_REVIEW',
    frequency: 'MONTHLY',
    run_at: '09:00',
    day_of_week: '0',
    day_of_month: '1',
    event_key: '',
  });
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [historyTask, setHistoryTask] = useState<ScheduledTask | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('scheduled_tasks')
        .select('*')
        .order('next_run_at', { ascending: true });
      if (error) throw error;
      setTasks((data || []) as unknown as ScheduledTask[]);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load scheduled tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        job_type: form.job_type,
        frequency: form.frequency,
        run_at: form.run_at,
        event_key: form.event_key || null,
        next_run_at: new Date().toISOString(),
      };
      if (form.frequency === 'WEEKLY') payload.day_of_week = parseInt(form.day_of_week, 10);
      if (['MONTHLY', 'QUARTERLY', 'YEARLY'].includes(form.frequency)) {
        payload.day_of_month = parseInt(form.day_of_month, 10);
      }
      const { error } = await supabase.from('scheduled_tasks').insert(payload);
      if (error) throw error;
      toast.success('Task scheduled');
      setCreateOpen(false);
      setForm({
        name: '',
        job_type: 'PERFORMANCE_REVIEW',
        frequency: 'MONTHLY',
        run_at: '09:00',
        day_of_week: '0',
        day_of_month: '1',
        event_key: '',
      });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async (task: ScheduledTask) => {
    setRunningId(task.id);
    try {
      const { data, error } = await supabase.rpc('run_scheduled_task', { p_task_id: task.id });
      if (error) throw error;
      const result = (data || {}) as { ok?: boolean; processed?: number; error?: string };
      if (!result.ok) throw new Error(result.error || 'Run failed');
      toast.success(`Run complete — ${result.processed || 0} reminder(s) queued`);
      await triggerMailProcessing().catch(() => {
        toast.info('Reminders queued. The mail queue will drain automatically.');
      });
      load();
    } catch (err) {
      toast.error('Run failed: ' + (err as Error).message);
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('scheduled_tasks').delete().eq('id', id);
      if (error) throw error;
      toast.success('Task removed');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const handleToggle = async (task: ScheduledTask) => {
    try {
      const { error } = await supabase
        .from('scheduled_tasks')
        .update({ is_active: !task.is_active })
        .eq('id', task.id);
      if (error) throw error;
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openHistory = async (task: ScheduledTask) => {
    setHistoryTask(task);
    setLogsLoading(true);
    setLogs([]);
    try {
      const { data, error } = await supabase
        .from('scheduled_task_logs')
        .select('*')
        .eq('task_id', task.id)
        .order('run_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setLogs((data || []) as unknown as TaskLog[]);
    } catch (err) {
      toast.error('Failed to load history: ' + (err as Error).message);
    } finally {
      setLogsLoading(false);
    }
  };

  const formatTime = (t: string) => {
    if (!t) return '—';
    const [h, m] = t.split(':');
    const hour = parseInt(h, 10);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };

  const dueCount = tasks.filter((t) => t.is_active && new Date(t.next_run_at) <= new Date()).length;

  const scheduleSummary = (t: ScheduledTask) => {
    const parts = [freqLabel(t.frequency), `at ${formatTime(t.run_at)}`];
    if (t.frequency === 'WEEKLY' && t.day_of_week != null) {
      parts.splice(1, 0, `on ${weekDays[t.day_of_week] || '—'}`);
    }
    if (['MONTHLY', 'QUARTERLY', 'YEARLY'].includes(t.frequency) && t.day_of_month != null) {
      parts.splice(1, 0, `on day ${t.day_of_month}`);
    }
    return parts.join(' ');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Scheduler</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Standing jobs for reminders across performance reviews, onboarding and training
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-2xl font-bold">{tasks.length}</p>
            <p className="text-sm text-muted-foreground">Scheduled tasks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-2xl font-bold">{tasks.filter((t) => t.is_active).length}</p>
            <p className="text-sm text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-2xl font-bold">{dueCount}</p>
            <p className="text-sm text-muted-foreground">Due now</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            Standing Jobs
          </CardTitle>
          <CardDescription>
            Tasks run on schedule and queue reminder emails to the email queue
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Job Type</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-5 w-full animate-pulse rounded bg-muted" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : tasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32">
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <CalendarClock className="h-10 w-10 opacity-40" />
                        <p className="text-sm font-medium">No scheduled tasks yet</p>
                        <p className="text-xs">Create a standing job to start sending reminders</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  tasks.map((task) => {
                    const isDue = task.is_active && new Date(task.next_run_at) <= new Date();
                    return (
                      <TableRow key={task.id}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{task.name}</p>
                            {task.event_key && (
                              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                {task.event_key}
                              </code>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{jobTypeLabel(task.job_type)}</TableCell>
                        <TableCell className="text-sm">{scheduleSummary(task)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(task.next_run_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              !task.is_active
                                ? 'bg-muted text-muted-foreground'
                                : isDue
                                ? 'bg-warning/10 text-warning'
                                : 'bg-success/10 text-success'
                            }
                          >
                            {!task.is_active ? 'Paused' : isDue ? 'Due' : 'Scheduled'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              title="Run now"
                              disabled={runningId === task.id}
                              onClick={() => handleRunNow(task)}
                            >
                              {runningId === task.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              title="Run history"
                              onClick={() => openHistory(task)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => handleToggle(task)}
                            >
                              {task.is_active ? 'Pause' : 'Resume'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-destructive"
                              title="Delete"
                              onClick={() => handleDelete(task.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Scheduled Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Task Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Monthly performance review reminders"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Job Type</Label>
                <Select value={form.job_type} onValueChange={(v) => setForm({ ...form, job_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {jobTypes.map((j) => (
                      <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {frequencies.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Run Time</Label>
                <Input
                  type="time"
                  value={form.run_at}
                  onChange={(e) => setForm({ ...form, run_at: e.target.value })}
                />
              </div>
              {form.frequency === 'WEEKLY' && (
                <div className="space-y-1.5">
                  <Label>Day of Week</Label>
                  <Select value={form.day_of_week} onValueChange={(v) => setForm({ ...form, day_of_week: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {weekDays.map((d, i) => (
                        <SelectItem key={d} value={String(i)}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {['MONTHLY', 'QUARTERLY', 'YEARLY'].includes(form.frequency) && (
                <div className="space-y-1.5">
                  <Label>Day of Month</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={form.day_of_month}
                    onChange={(e) => setForm({ ...form, day_of_month: e.target.value })}
                  />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Mail Template Event Key (optional)</Label>
              <Input
                value={form.event_key}
                onChange={(e) => setForm({ ...form, event_key: e.target.value })}
                placeholder="e.g. performance.review.reminder"
              />
              <p className="text-xs text-muted-foreground">
                If a mail template with this key exists it will be used for the reminder email body.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : 'Schedule Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyTask} onOpenChange={(open) => { if (!open) setHistoryTask(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run History — {historyTask?.name}</DialogTitle>
          </DialogHeader>
          {logsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No runs recorded yet.</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run At</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">{new Date(log.run_at).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            log.status === 'SUCCESS'
                              ? 'bg-success/10 text-success'
                              : 'bg-destructive/10 text-destructive'
                          }
                        >
                          {log.status === 'SUCCESS' ? (
                            <CheckCircle className="mr-1 h-3 w-3" />
                          ) : (
                            <XCircle className="mr-1 h-3 w-3" />
                          )}
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{log.items_processed}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{log.message || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}