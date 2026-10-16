'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { Coins, Globe, FolderKanban, CheckCircle } from 'lucide-react';
import {
  ALLOWANCE_CURRENCIES,
  fmtDate,
  fmtMoney,
  todayIso,
  type Project,
  type OffshoreAllowance,
} from '@/lib/projects';

const GLOBAL = '__global__';

const EMPTY = {
  project_id: GLOBAL,
  name: '',
  amount: '',
  currency: 'USD',
  effective_from: todayIso(),
  effective_to: '',
  is_active: true,
  notes: '',
};

type Form = typeof EMPTY;

export default function OffshoreAllowancesPage() {
  const { can } = useAccess();
  const canManage = can('projects.allowance') || can('projects.manage') || can('admin.settings');

  const [rows, setRows] = useState<OffshoreAllowance[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OffshoreAllowance | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);

  const load = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([
        supabase.from('offshore_allowances').select('*').order('effective_from', { ascending: false }),
        supabase.from('projects').select('*').order('name'),
      ]);
      setRows((a.data || []) as unknown as OffshoreAllowance[]);
      setProjects((p.data || []) as unknown as Project[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const projectMap = (() => {
    const m: Record<string, Project> = {};
    for (const p of projects) m[p.id] = p;
    return m;
  })();

  const close = () => { setOpen(false); setEditing(null); setForm(EMPTY); };
  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (a: OffshoreAllowance) => {
    setEditing(a);
    setForm({
      project_id: a.project_id || GLOBAL,
      name: a.name,
      amount: String(a.amount),
      currency: a.currency,
      effective_from: a.effective_from,
      effective_to: a.effective_to || '',
      is_active: a.is_active,
      notes: a.notes || '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (form.amount === '' || Number(form.amount) < 0) { toast.error('Enter a valid per-day amount'); return; }
    if (!form.effective_from) { toast.error('Effective from date is required'); return; }
    if (form.effective_to && form.effective_to < form.effective_from) { toast.error('Effective to cannot be before effective from'); return; }
    try {
      const payload = {
        project_id: form.project_id === GLOBAL ? null : form.project_id,
        name: form.name.trim(),
        amount: Number(form.amount),
        currency: form.currency,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        is_active: form.is_active,
        notes: form.notes.trim() || null,
      };
      const { error } = editing
        ? await supabase.from('offshore_allowances').update(payload).eq('id', editing.id)
        : await supabase.from('offshore_allowances').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Allowance updated' : 'Allowance added');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (a: OffshoreAllowance) => {
    try {
      const { error } = await supabase.from('offshore_allowances').delete().eq('id', a.id);
      if (error) throw error;
      toast.success('Allowance deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Rate rules', value: rows.length, icon: Coins, color: 'primary' },
    { label: 'Active', value: rows.filter((r) => r.is_active).length, icon: CheckCircle, color: 'success' },
    { label: 'Project-specific', value: rows.filter((r) => r.project_id).length, icon: FolderKanban, color: 'info' },
    { label: 'Global defaults', value: rows.filter((r) => !r.project_id).length, icon: Globe, color: 'warning' },
  ];

  const columns: Column<OffshoreAllowance>[] = [
    { key: 'name', label: 'Rule', render: (a) => <span className="font-medium">{a.name}</span> },
    {
      key: 'project_id',
      label: 'Applies to',
      render: (a) => a.project_id
        ? <span>{projectMap[a.project_id]?.name || 'Project'}</span>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">All projects (default)</Badge>,
      searchText: (a) => [a.project_id ? projectMap[a.project_id]?.name || '' : 'All projects default'],
    },
    { key: 'amount', label: 'Per day', render: (a) => <span className="font-medium">{fmtMoney(a.amount, a.currency)}</span> },
    { key: 'currency', label: 'Currency', render: (a) => a.currency },
    {
      key: '_window',
      label: 'Effective',
      render: (a) => <span className="text-xs text-muted-foreground">{fmtDate(a.effective_from)} → {a.effective_to ? fmtDate(a.effective_to) : 'open'}</span>,
      searchable: false,
    },
    {
      key: 'is_active',
      label: 'Status',
      render: (a) => a.is_active
        ? <Badge variant="outline" className="bg-success/10 text-success">Active</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Offshore Allowance Setup"
        description="Configure the per-day offshore allowance. Project-specific rates override the default; the latest effective rate wins."
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search allowance rules..."
        createLabel="Add Rate"
        onCreate={canManage ? openCreate : undefined}
        onEdit={canManage ? openEdit : undefined}
        onDelete={canManage ? remove : undefined}
        emptyMessage="No allowance rates yet."
        emptyDescription="Add a default rate and optionally override it per project."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit Allowance Rate' : 'Add Allowance Rate'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Applies to</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL}>All projects (default)</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Standard offshore rate" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Amount per day *</Label>
                <Input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="120" />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALLOWANCE_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Effective from *</Label>
                <Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Effective to</Label>
                <Input type="date" value={form.effective_to} min={form.effective_from} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <span className="text-sm text-muted-foreground">Active</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.name.trim() || form.amount === ''}>{editing ? 'Save Changes' : 'Add Rate'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
