'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Network, CheckCircle, AlertCircle, Plus, X, Loader2 } from 'lucide-react';
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

interface Competency {
  id: string;
  name: string;
  category: string | null;
}

interface CompRow {
  key: string;
  competencyId: string;
  name: string;
  category: string;
  requiredLevel: string;
}

const levelLabels = ['', 'Novice', 'Basic', 'Proficient', 'Advanced', 'Expert'];
const blankRow = (): CompRow => ({
  key: Math.random().toString(36).slice(2),
  competencyId: '',
  name: '',
  category: '',
  requiredLevel: '3',
});

const emptyForm = {
  title: '',
  department_id: '',
  grade: '',
  employment_type: 'FULL_TIME',
  budgeted_salary_min: '',
  budgeted_salary_max: '',
};

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [library, setLibrary] = useState<Competency[]>([]);
  const [compByPosition, setCompByPosition] = useState<Record<string, CompRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [rows, setRows] = useState<CompRow[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pRes, dRes, cRes, pcRes] = await Promise.all([
        supabase.from('positions').select('*').order('title'),
        supabase.from('departments').select('id, name').eq('is_active', true),
        supabase.from('competencies').select('id, name, category').eq('is_active', true).order('name'),
        supabase.from('position_competencies').select('position_id, required_level, competencies(id, name, category)'),
      ]);
      setPositions((pRes.data || []) as unknown as Position[]);
      setDepartments(dRes.data || []);
      setLibrary((cRes.data || []) as unknown as Competency[]);

      const map: Record<string, CompRow[]> = {};
      for (const raw of (pcRes.data || []) as unknown as Array<{
        position_id: string;
        required_level: number;
        competencies: Competency | Competency[] | null;
      }>) {
        const comp = Array.isArray(raw.competencies) ? raw.competencies[0] : raw.competencies;
        if (!comp) continue;
        (map[raw.position_id] ||= []).push({
          key: Math.random().toString(36).slice(2),
          competencyId: comp.id,
          name: comp.name,
          category: comp.category || '',
          requiredLevel: String(raw.required_level ?? 3),
        });
      }
      setCompByPosition(map);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setRows([]);
    setCreateOpen(true);
  };

  const openEdit = (p: Position) => {
    setEditing(p);
    setForm({
      title: p.title,
      department_id: p.department_id || '',
      grade: p.grade || '',
      employment_type: p.employment_type,
      budgeted_salary_min: p.budgeted_salary_min != null ? String(p.budgeted_salary_min) : '',
      budgeted_salary_max: p.budgeted_salary_max != null ? String(p.budgeted_salary_max) : '',
    });
    setRows((compByPosition[p.id] || []).map((r) => ({ ...r, key: Math.random().toString(36).slice(2) })));
    setCreateOpen(true);
  };

  const updateRow = (key: string, patch: Partial<CompRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const pickExisting = (key: string, competencyId: string) => {
    if (!competencyId) {
      updateRow(key, { competencyId: '', name: '', category: '' });
      return;
    }
    const comp = library.find((c) => c.id === competencyId);
    updateRow(key, { competencyId, name: comp?.name || '', category: comp?.category || '' });
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        department_id: form.department_id || null,
        grade: form.grade || null,
        employment_type: form.employment_type,
        budgeted_salary_min: form.budgeted_salary_min ? parseFloat(form.budgeted_salary_min) : null,
        budgeted_salary_max: form.budgeted_salary_max ? parseFloat(form.budgeted_salary_max) : null,
      };

      let positionId: string;
      if (editing) {
        const { error } = await supabase.from('positions').update(payload).eq('id', editing.id);
        if (error) throw error;
        positionId = editing.id;
      } else {
        const { data, error } = await supabase
          .from('positions')
          .insert({ ...payload, status: 'VACANT' })
          .select('id')
          .single();
        if (error) throw error;
        positionId = (data as { id: string }).id;
      }

      const items = rows
        .map((r) => ({
          name: r.name.trim(),
          category: r.category.trim(),
          requiredLevel: parseInt(r.requiredLevel, 10) || 3,
        }))
        .filter((r) => r.name);

      const { error: rpcError } = await supabase.rpc('set_position_competencies', {
        p_position_id: positionId,
        p_items: items,
      });
      if (rpcError) throw rpcError;

      toast.success(editing ? 'Position updated' : 'Position created');
      setCreateOpen(false);
      setEditing(null);
      setForm({ ...emptyForm });
      setRows([]);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
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
      key: 'competencies', label: 'Competencies',
      render: (p) => {
        const list = compByPosition[p.id] || [];
        if (list.length === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {list.slice(0, 3).map((r) => (
              <Badge key={r.key} variant="outline" className="bg-muted text-muted-foreground">
                {r.name}
              </Badge>
            ))}
            {list.length > 3 && (
              <Badge variant="outline" className="bg-muted text-muted-foreground">+{list.length - 3}</Badge>
            )}
          </div>
        );
      },
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
        onCreate={openCreate}
        onEdit={openEdit}
      />
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{editing ? 'Edit Position' : 'Add Position'}</DialogTitle></DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto py-4 pr-1">
            <div className="space-y-1.5">
              <Label>Position Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Senior Engineer" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={form.department_id || 'none'} onValueChange={(v) => setForm({ ...form, department_id: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
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

            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Required competencies</Label>
                  <p className="text-xs text-muted-foreground">Pick from the library or type a new competency.</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, blankRow()])}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add
                </Button>
              </div>

              {rows.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">No competencies added.</p>
              ) : (
                <div className="space-y-2">
                  {rows.map((r) => (
                    <div key={r.key} className="grid gap-2 rounded-md border border-border bg-muted/20 p-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                      <div className="space-y-1">
                        <Select value={r.competencyId || 'new'} onValueChange={(v) => pickExisting(r.key, v === 'new' ? '' : v)}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">New competency…</SelectItem>
                            {library.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {!r.competencyId && (
                          <Input
                            className="h-8"
                            value={r.name}
                            onChange={(e) => updateRow(r.key, { name: e.target.value })}
                            placeholder="Competency name"
                          />
                        )}
                      </div>
                      <div className="space-y-1">
                        <Input
                          className="h-8"
                          value={r.category}
                          onChange={(e) => updateRow(r.key, { category: e.target.value })}
                          placeholder="Category"
                          disabled={Boolean(r.competencyId)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Select value={r.requiredLevel} onValueChange={(v) => updateRow(r.key, { requiredLevel: v })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <SelectItem key={n} value={String(n)}>{n} — {levelLabels[n]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-start">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={!form.title.trim() || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
