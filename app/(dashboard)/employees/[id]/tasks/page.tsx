'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { toast } from 'sonner';
import { ListChecks, Plus, CheckCircle } from 'lucide-react';

interface Task {
  id: string;
  employee_id: string;
  title: string;
  description: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  due_date: string | null;
  assigned_by: string | null;
  completed_at: string | null;
  created_at: string;
}

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-muted text-muted-foreground border-border',
  NORMAL: 'bg-info/10 text-info border-info/20',
  HIGH: 'bg-warning/10 text-warning border-warning/20',
  URGENT: 'bg-destructive/10 text-destructive border-destructive/20',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning border-warning/20',
  IN_PROGRESS: 'bg-info/10 text-info border-info/20',
  COMPLETED: 'bg-success/10 text-success border-success/20',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
};

export default function EmployeeTasksPage() {
  const params = useParams();
  const id = params.id as string;
  const { employeeId: myId, can } = useAccess();
  const isSelf = myId === id;
  const canManage = can('employees.manage') || can('employees.view_all') || can('admin.settings');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [dueDate, setDueDate] = useState('');

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('employee_tasks')
        .select('*')
        .eq('employee_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTasks((data || []) as unknown as Task[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('employee_tasks').insert({
        employee_id: id,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        due_date: dueDate || null,
        assigned_by: myId || null,
      });
      if (error) throw error;
      toast.success('Task assigned');
      setCreateOpen(false);
      setTitle('');
      setDescription('');
      setPriority('NORMAL');
      setDueDate('');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (task: Task, status: Task['status']) => {
    try {
      const { error } = await supabase
        .from('employee_tasks')
        .update({
          status,
          completed_at: status === 'COMPLETED' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id);
      if (error) throw error;
      toast.success('Task updated');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const canEdit = (t: Task) => canManage || isSelf || t.assigned_by === myId;

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Tasks</CardTitle>
        {(isSelf || canManage) && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Assign Task
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <ListChecks className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No tasks assigned yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`font-medium ${t.status === 'COMPLETED' ? 'line-through text-muted-foreground' : ''}`}>
                    {t.title}
                  </p>
                  <Badge variant="outline" className={PRIORITY_COLORS[t.priority] || ''}>{t.priority}</Badge>
                  <Badge variant="outline" className={STATUS_COLORS[t.status] || ''}>{t.status.replace('_', ' ')}</Badge>
                </div>
                {t.description && (
                  <p className="mt-2 text-sm text-muted-foreground">{t.description}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.due_date ? `Due ${new Date(t.due_date).toLocaleDateString()} · ` : ''}
                  Assigned {new Date(t.created_at).toLocaleDateString()}
                </p>
                {canEdit(t) && t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {t.status === 'PENDING' && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => updateStatus(t, 'IN_PROGRESS')}>
                        Start
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-success/30 text-success hover:bg-success/10"
                      onClick={() => updateStatus(t, 'COMPLETED')}
                    >
                      <CheckCircle className="mr-1 h-3.5 w-3.5" /> Complete
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => updateStatus(t, 'CANCELLED')}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={(o) => { if (!saving) setCreateOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Task</DialogTitle>
            <DialogDescription>Create a task and assign it to this employee.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="t-title">Title</Label>
              <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-due">Due date</Label>
                <Input id="t-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-desc">Description</Label>
              <Textarea id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Details..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Assigning...' : 'Assign'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
