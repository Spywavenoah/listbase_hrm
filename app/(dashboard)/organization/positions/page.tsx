'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Network, Briefcase, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Position {
  id: string;
  title: string;
  department_id: string | null;
  grade: string | null;
  employment_type: string;
  status: string;
  budgeted_salary_min: number | null;
  budgeted_salary_max: number | null;
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', department_id: '', grade: '', employment_type: 'FULL_TIME', budgeted_salary_min: '', budgeted_salary_max: '' });

  const load = useCallback(async () => {
    try {
      const [pRes, dRes] = await Promise.all([
        supabase.from('positions').select('*').order('title'),
        supabase.from('departments').select('id, name').eq('is_active', true),
      ]);
      setPositions((pRes.data || []) as unknown as Position[]);
      setDepartments(dRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('positions').insert({
        title: form.title,
        department_id: form.department_id || null,
        grade: form.grade || null,
        employment_type: form.employment_type,
        status: 'VACANT',
        budgeted_salary_min: form.budgeted_salary_min ? parseFloat(form.budgeted_salary_min) : null,
        budgeted_salary_max: form.budgeted_salary_max ? parseFloat(form.budgeted_salary_max) : null,
      });
      if (error) throw error;
      toast.success('Position created');
      setCreateOpen(false);
      setForm({ title: '', department_id: '', grade: '', employment_type: 'FULL_TIME', budgeted_salary_min: '', budgeted_salary_max: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name || '—';

  const summaryCards: SummaryCard[] = [
    { label: 'Total Positions', value: positions.length, icon: Network, color: 'primary' },
    { label: 'Filled', value: positions.filter((p) => p.status === 'FILLED').length, icon: CheckCircle, color: 'success' },
    { label: 'Vacant', value: positions.filter((p) => p.status === 'VACANT').length, icon: AlertCircle, color: 'warning' },
  ];

  const columns: Column<Position>[] = [
    { key: 'title', label: 'Position Title' },
    { key: 'department', label: 'Department', render: (p) => deptName(p.department_id) },
    { key: 'grade', label: 'Grade', render: (p) => p.grade || '—' },
    { key: 'employment_type', label: 'Type', render: (p) => p.employment_type.replace('_', ' ') },
    {
      key: 'budget', label: 'Salary Band',
      render: (p) => p.budgeted_salary_min ? `$${p.budgeted_salary_min} - $${p.budgeted_salary_max}` : '—',
    },
    {
      key: 'status', label: 'Status',
      render: (p) => <Badge variant="outline" className={p.status === 'FILLED' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}>
        {p.status}
      </Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Positions"
        description="Job positions in your organization — separate from the employees who fill them"
        summaryCards={summaryCards}
        columns={columns}
        data={positions}
        searchPlaceholder="Search positions..."
        createLabel="Add Position"
        onCreate={() => setCreateOpen(true)}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Position</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Position Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Senior Engineer" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Grade</Label>
                <Input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="L5" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Employment Type</Label>
              <Select value={form.employment_type} onValueChange={(v) => setForm({ ...form, employment_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL_TIME">Full Time</SelectItem>
                  <SelectItem value="PART_TIME">Part Time</SelectItem>
                  <SelectItem value="CONTRACT">Contract</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Budgeted Salary Min</Label>
                <Input type="number" value={form.budgeted_salary_min} onChange={(e) => setForm({ ...form, budgeted_salary_min: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Budgeted Salary Max</Label>
                <Input type="number" value={form.budgeted_salary_max} onChange={(e) => setForm({ ...form, budgeted_salary_max: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.title}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
