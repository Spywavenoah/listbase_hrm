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
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import type { InventoryCategory } from '@/lib/inventory';

const EMPTY = { code: '', name: '', description: '', is_active: true };

export default function CategoriesPage() {
  const { can } = useAccess();
  const canManage = can('inventory.settings') || can('inventory.manage');
  const [rows, setRows] = useState<InventoryCategory[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryCategory | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const load = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([
        supabase.from('inventory_categories').select('*').order('name'),
        supabase.from('inventory_items').select('category_id'),
      ]);
      setRows((cats.data || []) as unknown as InventoryCategory[]);
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

  const close = () => { setOpen(false); setEditing(null); setForm({ ...EMPTY }); };

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); setOpen(true); };

  const openEdit = (c: InventoryCategory) => {
    setEditing(c);
    setForm({ code: c.code || '', name: c.name, description: c.description || '', is_active: c.is_active });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Category name is required'); return; }
    try {
      const payload = {
        code: form.code || null,
        name: form.name.trim(),
        description: form.description || null,
        is_active: form.is_active,
      };
      const { error } = editing
        ? await supabase.from('inventory_categories').update(payload).eq('id', editing.id)
        : await supabase.from('inventory_categories').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Category updated' : 'Category added');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (c: InventoryCategory) => {
    try {
      const { error } = await supabase.from('inventory_categories').delete().eq('id', c.id);
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
    { label: 'Categorised Items', value: Object.values(counts).reduce((a, b) => a + b, 0), icon: Package, color: 'info' },
  ];

  const columns: Column<InventoryCategory>[] = [
    { key: 'code', label: 'Code', render: (c) => c.code ? <span className="font-mono text-xs">{c.code}</span> : '—' },
    { key: 'name', label: 'Category', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'description', label: 'Description', render: (c) => c.description || '—' },
    { key: '_items', label: 'Items', render: (c) => <Badge variant="outline">{counts[c.id] || 0}</Badge> },
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
        title="Inventory Categories"
        description="Organise stockable items into categories"
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
        emptyDescription="Create categories to group your inventory items."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit Category' : 'Add Category'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="STA" />
              </div>
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Stationery" />
              </div>
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
