'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Layers, CheckCircle2, XCircle, Hash } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import type { GradeLevel } from '@/lib/types';

export default function GradeLevelsPage() {
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', level: '', description: '' });

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('grade_levels')
        .select('*')
        .order('level', { ascending: true });
      if (error) throw error;
      setGrades((data || []) as unknown as GradeLevel[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('grade_levels').insert({
        name: form.name,
        level: parseInt(form.level, 10),
        description: form.description || null,
      });
      if (error) throw error;
      toast.success('Grade level created');
      setCreateOpen(false);
      setForm({ name: '', level: '', description: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const toggleActive = async (g: GradeLevel) => {
    try {
      const { error } = await supabase.from('grade_levels').update({ is_active: !g.is_active }).eq('id', g.id);
      if (error) throw error;
      toast.success(g.is_active ? 'Grade deactivated' : 'Grade activated');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Grades', value: grades.length, icon: Layers, color: 'primary' },
    { label: 'Active', value: grades.filter((g) => g.is_active).length, icon: CheckCircle2, color: 'success' },
    { label: 'Inactive', value: grades.filter((g) => !g.is_active).length, icon: XCircle, color: 'destructive' },
  ];

  const columns: Column<GradeLevel>[] = [
    { key: 'name', label: 'Grade Name' },
    { key: 'level', label: 'Level', render: (g) => <Badge variant="outline"><Hash className="mr-1 h-3 w-3" />{g.level}</Badge> },
    { key: 'description', label: 'Description', render: (g) => g.description || '—' },
    {
      key: 'is_active', label: 'Status',
      render: (g) => <Badge variant="outline" className={g.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>
        {g.is_active ? 'Active' : 'Inactive'}
      </Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Grade Levels"
        description="Structured compensation ladder used across employee records"
        summaryCards={summaryCards}
        columns={columns}
        data={grades}
        searchPlaceholder="Search grades..."
        createLabel="Add Grade"
        statusKey="is_active"
        statusValue={(g) => (g.is_active ? 'active' : 'inactive')}
        onCreate={() => setCreateOpen(true)}
        rowActions={(g) => (
          <Button
            variant="ghost"
            size="sm"
            className={g.is_active ? 'text-destructive' : 'text-success'}
            onClick={() => toggleActive(g)}
          >
            {g.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        )}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Grade Level</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Grade Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. GL 18, Band C" />
            </div>
            <div className="space-y-1.5">
              <Label>Level Number *</Label>
              <Input type="number" min="1" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} placeholder="e.g. 18" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Senior Management band" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name || !form.level}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}