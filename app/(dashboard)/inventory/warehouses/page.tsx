'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { Warehouse as WarehouseIcon, CheckCircle, Package, Layers } from 'lucide-react';
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
import { WAREHOUSE_TYPES, fmtQty, type Warehouse } from '@/lib/inventory';

const EMPTY = {
  code: '',
  name: '',
  type: 'MAIN',
  address: '',
  city: '',
  state: '',
  country: '',
  phone: '',
  notes: '',
  is_active: true,
  is_default: false,
};

interface WarehouseStockLite {
  warehouse_id: string;
  item_id: string;
  quantity: number;
  reserved_quantity: number;
}

export default function WarehousesPage() {
  const { can } = useAccess();
  const canManage = can('inventory.settings') || can('inventory.manage');
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<WarehouseStockLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const load = useCallback(async () => {
    try {
      const [wRes, sRes] = await Promise.all([
        supabase.from('inventory_warehouses').select('*').order('name'),
        supabase.from('inventory_stock').select('warehouse_id, item_id, quantity, reserved_quantity'),
      ]);
      setRows((wRes.data || []) as unknown as Warehouse[]);
      setStock((sRes.data || []) as unknown as WarehouseStockLite[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => { setOpen(false); setEditing(null); setForm({ ...EMPTY }); };

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); setOpen(true); };

  const openEdit = (w: Warehouse) => {
    setEditing(w);
    setForm({
      code: w.code,
      name: w.name,
      type: w.type,
      address: w.address || '',
      city: w.city || '',
      state: w.state || '',
      country: w.country || '',
      phone: w.phone || '',
      notes: w.notes || '',
      is_active: w.is_active,
      is_default: w.is_default,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error('Warehouse code and name are required');
      return;
    }
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        country: form.country || null,
        phone: form.phone || null,
        notes: form.notes || null,
        is_active: form.is_active,
        is_default: form.is_default,
      };
      if (form.is_default) {
        await supabase.from('inventory_warehouses').update({ is_default: false }).neq('id', editing?.id || '00000000-0000-0000-0000-000000000000');
      }
      const { error } = editing
        ? await supabase.from('inventory_warehouses').update(payload).eq('id', editing.id)
        : await supabase.from('inventory_warehouses').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Warehouse updated' : 'Warehouse added');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (w: Warehouse) => {
    try {
      const { error } = await supabase.from('inventory_warehouses').delete().eq('id', w.id);
      if (error) throw error;
      toast.success('Warehouse deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete. It may still be referenced by stock or movements.');
    }
  };

  const stockTotals = (warehouseId: string) => {
    const positions = stock.filter((s) => s.warehouse_id === warehouseId);
    return {
      items: new Set(positions.map((s) => s.item_id)).size,
      units: positions.reduce((sum, s) => sum + Number(s.quantity || 0), 0),
      reserved: positions.reduce((sum, s) => sum + Number(s.reserved_quantity || 0), 0),
    };
  };

  const totalItems = new Set(stock.map((s) => s.item_id)).size;
  const totalUnits = stock.reduce((sum, s) => sum + Number(s.quantity || 0), 0);

  const summaryCards: SummaryCard[] = [
    { label: 'Warehouses', value: rows.length, icon: WarehouseIcon, color: 'primary' },
    { label: 'Active', value: rows.filter((r) => r.is_active).length, icon: CheckCircle, color: 'success' },
    { label: 'Stock Items', value: totalItems, icon: Package, color: 'info' },
    { label: 'Units On Hand', value: fmtQty(totalUnits), icon: Layers, color: 'primary' },
  ];

  const columns: Column<Warehouse>[] = [
    { key: 'code', label: 'Code', render: (w) => <span className="font-mono text-xs">{w.code}</span> },
    { key: 'name', label: 'Warehouse', render: (w) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{w.name}</span>
        {w.is_default && <Badge variant="outline" className="bg-primary/10 text-primary">Default</Badge>}
      </div>
    ) },
    { key: 'type', label: 'Type', render: (w) => WAREHOUSE_TYPES.find((t) => t.value === w.type)?.label || w.type },
    { key: 'city', label: 'Location', render: (w) => [w.city, w.state, w.country].filter(Boolean).join(', ') || '—' },
    { key: 'phone', label: 'Phone', render: (w) => w.phone || '—' },
    {
      key: 'items',
      label: 'Stock Items',
      searchable: false,
      render: (w) => stockTotals(w.id).items,
    },
    {
      key: 'stock',
      label: 'On Hand',
      searchable: false,
      render: (w) => {
        const totals = stockTotals(w.id);
        return (
          <div>
            <p className="font-medium">{fmtQty(totals.units)}</p>
            {totals.reserved > 0 && <p className="text-xs text-muted-foreground">{fmtQty(totals.reserved)} reserved</p>}
          </div>
        );
      },
    },
    {
      key: 'is_active',
      label: 'Status',
      render: (w) => w.is_active
        ? <Badge variant="outline" className="bg-success/10 text-success">Active</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Warehouses"
        description="Manage multiple stock locations used across the inventory module"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search warehouses..."
        createLabel="Add Warehouse"
        onCreate={canManage ? openCreate : undefined}
        onEdit={canManage ? openEdit : undefined}
        onDelete={canManage ? remove : undefined}
        emptyMessage="No warehouses yet."
        emptyDescription="Add your first warehouse to start tracking stock."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit Warehouse' : 'Add Warehouse'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MAIN" />
              </div>
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main Warehouse" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WAREHOUSE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <span className="text-sm text-muted-foreground">Active</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} />
                <span className="text-sm text-muted-foreground">Default warehouse</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.name.trim() || !form.code.trim()}>
              {editing ? 'Save Changes' : 'Add Warehouse'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
