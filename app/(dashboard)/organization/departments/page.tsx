'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Building2, Network, Users, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface Department {
  id: string;
  name: string;
  description: string | null;
  cost_center: string | null;
  is_active: boolean;
}

export default function DepartmentsPage() {
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', cost_center: '' });

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .order('name');
      if (error) throw error;
      setDepts((data || []) as unknown as Department[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('departments').insert({
        name: form.name,
        description: form.description || null,
        cost_center: form.cost_center || null,
      });
      if (error) throw error;
      toast.success('Department created');
      setCreateOpen(false);
      setForm({ name: '', description: '', cost_center: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Departments', value: depts.length, icon: Building2, color: 'primary' },
    { label: 'Active', value: depts.filter((d) => d.is_active).length, icon: Users, color: 'success' },
    { label: 'With Cost Center', value: depts.filter((d) => d.cost_center).length, icon: Layers, color: 'info' },
  ];

  const columns: Column<Department>[] = [
    { key: 'name', label: 'Department Name' },
    { key: 'description', label: 'Description', render: (d) => d.description || '—' },
    { key: 'cost_center', label: 'Cost Center', render: (d) => d.cost_center || '—' },
    {
      key: 'is_active', label: 'Status',
      render: (d) => <Badge variant="outline" className={d.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>
        {d.is_active ? 'Active' : 'Inactive'}
      </Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Departments"
        description="Organizational units and cost centers"
        summaryCards={summaryCards}
        columns={columns}
        data={depts}
        searchPlaceholder="Search departments..."
        createLabel="Add Department"
        onCreate={() => setCreateOpen(true)}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Department</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Department Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Cost Center</Label>
              <Input value={form.cost_center} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} placeholder="CC-001" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
