'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Target, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Goal {
  id: string;
  employee_id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  status: string;
  progress: number;
  review_cycle: string | null;
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: '', title: '', description: '', target_date: '', review_cycle: '' });

  const load = useCallback(async () => {
    try {
      const [gRes, eRes] = await Promise.all([
        supabase.from('performance_goals').select('*').order('created_at', { ascending: false }),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE'),
      ]);
      setGoals((gRes.data || []) as unknown as Goal[]);
      setEmployees(eRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('performance_goals').insert({
        employee_id: form.employee_id,
        title: form.title,
        description: form.description || null,
        target_date: form.target_date || null,
        review_cycle: form.review_cycle || null,
        status: 'IN_PROGRESS',
        progress: 0,
      });
      if (error) throw error;
      toast.success('Goal created');
      setCreateOpen(false);
      setForm({ employee_id: '', title: '', description: '', target_date: '', review_cycle: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const empName = (id: string) => {
    const e = employees.find((e) => e.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };

  const statusColors: Record<string, string> = {
    IN_PROGRESS: 'bg-info/10 text-info',
    COMPLETED: 'bg-success/10 text-success',
    ON_HOLD: 'bg-warning/10 text-warning',
    CANCELLED: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Goals', value: goals.length, icon: Target, color: 'primary' },
    { label: 'In Progress', value: goals.filter((g) => g.status === 'IN_PROGRESS').length, icon: Clock, color: 'info' },
    { label: 'Completed', value: goals.filter((g) => g.status === 'COMPLETED').length, icon: CheckCircle, color: 'success' },
    { label: 'On Hold', value: goals.filter((g) => g.status === 'ON_HOLD').length, icon: AlertCircle, color: 'warning' },
  ];

  const columns: Column<Goal>[] = [
    { key: 'employee', label: 'Employee', render: (g) => empName(g.employee_id) },
    { key: 'title', label: 'Goal' },
    { key: 'description', label: 'Description', render: (g) => g.description?.slice(0, 60) || '—' },
    { key: 'target_date', label: 'Target Date', render: (g) => g.target_date || '—' },
    {
      key: 'progress', label: 'Progress',
      render: (g) => <div className="flex items-center gap-2"><div className="h-2 w-20 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${g.progress}%` }} /></div><span className="text-xs text-muted-foreground">{g.progress}%</span></div>,
    },
    {
      key: 'status', label: 'Status',
      render: (g) => <Badge variant="outline" className={statusColors[g.status] || ''}>{g.status}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Performance Goals"
        description="Track individual employee goals and progress"
        summaryCards={summaryCards}
        columns={columns}
        data={goals}
        searchPlaceholder="Search goals..."
        createLabel="Add Goal"
        onCreate={() => setCreateOpen(true)}
        rowActions={(g) => (
          g.status === 'IN_PROGRESS' ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-success"
              onClick={async () => {
                await supabase.from('performance_goals').update({ status: 'COMPLETED', progress: 100 }).eq('id', g.id);
                toast.success('Goal completed');
                load();
              }}
            >
              Complete
            </Button>
          ) : null
        )}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Performance Goal</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Goal Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Increase sales by 20%" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Target Date</Label>
                <Input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Review Cycle</Label>
                <Input value={form.review_cycle} onChange={(e) => setForm({ ...form, review_cycle: e.target.value })} placeholder="Q3 2026" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.employee_id || !form.title}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
