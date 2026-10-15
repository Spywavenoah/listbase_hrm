'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { Tags, CheckCircle, XCircle, Package } from 'lucide-react';
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
import type { AssetCategory } from '@/lib/assets';
import { ASSET_CLASSES, DEPRECIATION_METHODS } from '@/lib/assets';

const EMPTY = {
  code: '',
  name: '',
  asset_class: 'OTHER',
  description: '',
  depreciation_method: 'STRAIGHT_LINE',
  default_useful_life_years: '',
  default_rate: '',
  is_active: true,
};

export default function AssetCategoriesPage() {
  const { can } = useAccess();
  const canManage = can('assets.manage') || can('admin.settings');
  const [rows, setRows] = useState<AssetCategory[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AssetCategory | null>(null);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([
        supabase.from('asset_categories').select('*').order('name'),
        supabase.from('assets').select('category_id'),
      ]);
      setRows((cats.data || []) as unknown as AssetCategory[]);
      const c: Record<string, number> = {};
      for (const it of (items.data || []) as { category_id: string | null }[]) {
        if (it.category_id) c[it.category_id] = (c[it.category_id] || 0) + 1;
      }
      setCounts(c);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => { setOpen(false); setEditing(null); setForm(EMPTY); };
  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (c: AssetCategory) => {
    setEditing(c);
    setForm({
      code: c.code || '',
      name: c.name,
      asset_class: c.asset_class,
      description: c.description || '',
      depreciation_method: c.depreciation_method,
      default_useful_life_years: c.default_useful_life_years == null ? '' : String(c.default_useful_life_years),
      default_rate: c.default_rate == null ? '' : String(c.default_rate),
      is_active: c.is_active,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Category name is required'); return; }
    try {
      const payload = {
        code: form.code || null,
        name: form.name.trim(),
        asset_class: form.asset_class,
        description: form.description || null,
        depreciation_method: form.depreciation_method,
        default_useful_life_years: form.default_useful_life_years ? Number(form.default_useful_life_years) : null,
        default_rate: form.default_rate ? Number(form.default_rate) : null,
        is_active: form.is_active,
      };
      const { error } = editing
        ? await supabase.from('asset_categories').update(payload).eq('id', editing.id)
        : await supabase.from('asset_categories').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Category updated' : 'Category added');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (c: AssetCategory) => {
    try {
      const { error } = await supabase.from('asset_categories').delete().eq('id', c.id);
      if (error) throw error;
      toast.success('Category deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Categories', value: rows.length, icon: Tags, color: 'primary' },
    { label: 'Active', value: rows.filter((r) => r.is_active).length, icon: CheckCircle, color: 'success' },
    { label: 'Inactive', value: rows.filter((r) => !r.is_active).length, icon: XCircle, color: 'destructive' },
    { label: 'Categorised Assets', value: Object.values(counts).reduce((a, b) => a + b, 0), icon: Package, color: 'info' },
  ];

  const columns: Column<AssetCategory>[] = [
    { key: 'code', label: 'Code', render: (c) => c.code ? <span className="font-mono text-xs">{c.code}</span> : '—' },
    { key: 'name', label: 'Category', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'asset_class', label: 'Class', render: (c) => ASSET_CLASSES.find((x) => x.value === c.asset_class)?.label || c.asset_class },
    { key: 'depreciation_method', label: 'Depreciation', render: (c) => DEPRECIATION_METHODS.find((x) => x.value === c.depreciation_method)?.label || c.depreciation_method },
    { key: '_items', label: 'Assets', render: (c) => <Badge variant="outline">{counts[c.id] || 0}</Badge>, searchable: false },
    {
      key: 'is_active',
      label: 'Status',
      render: (c) => c.is_active
        ? <Badge variant="outline" className="bg-success/10 text-success">Active</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Asset Categories"
        description="Manage categories for automobiles, plant & machinery, ICT, furniture, etc."
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search categories..."
        createLabel="Add Category"
        onCreate={canManage ? openCreate : undefined}
        onEdit={canManage ? openEdit : undefined}
        onDelete={canManage ? remove : undefined}
        emptyMessage="No categories yet."
        emptyDescription="Create categories to group your assets."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit Category' : 'Add Category'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="AUTO" />
              </div>
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Automobiles" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Asset Class</Label>
              <Select value={form.asset_class} onValueChange={(v) => setForm({ ...form, asset_class: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_CLASSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Default Depreciation</Label>
                <Select value={form.depreciation_method} onValueChange={(v) => setForm({ ...form, depreciation_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEPRECIATION_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Useful Life (years)</Label>
                <Input type="number" min={0} step="0.5" value={form.default_useful_life_years} onChange={(e) => setForm({ ...form, default_useful_life_years: e.target.value })} placeholder="8" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reducing Balance Rate (%)</Label>
              <Input type="number" min={0} step="0.5" value={form.default_rate} onChange={(e) => setForm({ ...form, default_rate: e.target.value })} placeholder="25" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <span className="text-sm text-muted-foreground">Active</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.name.trim()}>{editing ? 'Save Changes' : 'Add Category'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
