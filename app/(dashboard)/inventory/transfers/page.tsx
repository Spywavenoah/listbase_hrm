'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { ArrowRightLeft, Package, Warehouse as WarehouseIcon, CalendarDays, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { fmtDate, fmtQty, type InventoryItem, type Movement, type Warehouse } from '@/lib/inventory';

interface TransferRow extends Movement {
  performed_by_employee?: { first_name: string | null; last_name: string | null } | null;
}

export default function TransfersPage() {
  const { can } = useAccess();
  const canMove = can('inventory.move') || can('inventory.manage');
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    item_id: '',
    warehouse_id: '',
    dest_warehouse_id: '',
    quantity: '',
    reference: '',
    movement_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const load = useCallback(async () => {
    try {
      const [mv, it, wh, st] = await Promise.all([
        supabase
          .from('inventory_movements')
          .select('*, item:inventory_items(name,uom), warehouse:inventory_warehouses!inventory_movements_warehouse_id_fkey(name), dest_warehouse:inventory_warehouses!inventory_movements_dest_warehouse_id_fkey(name), performed_by_employee:employees(first_name,last_name)')
          .eq('movement_type', 'TRANSFER')
          .order('movement_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(300),
        supabase.from('inventory_items').select('*').eq('is_active', true).order('name'),
        supabase.from('inventory_warehouses').select('*').eq('is_active', true).order('name'),
        supabase.from('inventory_stock').select('item_id, warehouse_id, quantity'),
      ]);
      setRows((mv.data || []) as unknown as TransferRow[]);
      setItems((it.data || []) as unknown as InventoryItem[]);
      setWarehouses((wh.data || []) as unknown as Warehouse[]);
      const map: Record<string, number> = {};
      for (const s of (st.data || []) as { item_id: string; warehouse_id: string; quantity: number }[]) {
        map[`${s.item_id}:${s.warehouse_id}`] = Number(s.quantity);
      }
      setStock(map);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => setOpen(false);

  const openCreate = () => {
    const def = warehouses.find((w) => w.is_default) || warehouses[0];
    setForm({
      item_id: '',
      warehouse_id: def?.id || '',
      dest_warehouse_id: '',
      quantity: '',
      reference: '',
      movement_date: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    setOpen(true);
  };

  const available = form.item_id && form.warehouse_id
    ? stock[`${form.item_id}:${form.warehouse_id}`] ?? 0
    : null;

  const save = async () => {
    if (!form.item_id || !form.warehouse_id) { toast.error('Select an item and source warehouse'); return; }
    if (!form.dest_warehouse_id || form.dest_warehouse_id === form.warehouse_id) {
      toast.error('Select a different destination warehouse');
      return;
    }
    if (form.quantity === '' || Number(form.quantity) <= 0) { toast.error('Enter a quantity greater than zero'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('record_inventory_movement', {
        p_type: 'TRANSFER',
        p_item_id: form.item_id,
        p_warehouse_id: form.warehouse_id,
        p_dest_warehouse_id: form.dest_warehouse_id,
        p_quantity: Number(form.quantity),
        p_unit_cost: null,
        p_reference: form.reference || null,
        p_notes: form.notes || null,
        p_batch_no: null,
        p_expiry_date: null,
        p_movement_date: form.movement_date || null,
      });
      if (error) throw error;
      toast.success('Transfer recorded');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const totalUnits = useMemo(() => rows.reduce((a, r) => a + Math.abs(Number(r.quantity)), 0), [rows]);
  const routes = useMemo(() => new Set(rows.map((r) => `${r.warehouse_id}:${r.dest_warehouse_id}`)).size, [rows]);
  const thisMonth = useMemo(() => {
    const now = new Date();
    return rows.filter((r) => {
      const d = new Date(r.movement_date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }, [rows]);

  const summaryCards: SummaryCard[] = [
    { label: 'Transfers', value: rows.length, icon: ArrowRightLeft, color: 'primary' },
    { label: 'Units Moved', value: fmtQty(totalUnits), icon: Package, color: 'info' },
    { label: 'Routes Used', value: routes, icon: WarehouseIcon, color: 'success' },
    { label: 'This Month', value: thisMonth, icon: CalendarDays, color: 'warning' },
  ];

  const columns: Column<TransferRow>[] = [
    { key: 'movement_date', label: 'Date', render: (r) => fmtDate(r.movement_date) },
    { key: 'item', label: 'Item', render: (r) => <span className="font-medium">{r.item?.name || '—'}</span> },
    { key: 'warehouse', label: 'From', render: (r) => r.warehouse?.name || '—' },
    { key: 'dest_warehouse', label: 'To', render: (r) => r.dest_warehouse?.name || '—' },
    { key: 'quantity', label: 'Qty', render: (r) => <span className="font-medium">{fmtQty(Math.abs(Number(r.quantity)))} {r.item?.uom}</span> },
    { key: 'reference', label: 'Reference', render: (r) => r.reference || '—' },
    {
      key: 'performed_by_employee',
      label: 'By',
      render: (r) => r.performed_by_employee
        ? `${r.performed_by_employee.first_name || ''} ${r.performed_by_employee.last_name || ''}`.trim() || '—'
        : '—',
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Stock Transfers"
        description="Move stock between warehouses"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search transfers..."
        toolbarActions={
          canMove ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /><span className="hidden sm:inline">New Transfer</span><span className="sm:hidden">New</span>
            </Button>
          ) : undefined
        }
        emptyMessage="No transfers yet."
        emptyDescription="Transfer stock between warehouses to balance your locations."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Stock Transfer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Item *</Label>
              <Select value={form.item_id} onValueChange={(v) => setForm({ ...form, item_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>
                  {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>From Warehouse *</Label>
                <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>To Warehouse *</Label>
                <Select value={form.dest_warehouse_id} onValueChange={(v) => setForm({ ...form, dest_warehouse_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.filter((w) => w.id !== form.warehouse_id).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Quantity *</Label>
                <Input type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" />
                {available !== null && (
                  <p className="text-xs text-muted-foreground">Available at source: {fmtQty(available)}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Transfer Date</Label>
                <Input type="date" value={form.movement_date} onChange={(e) => setForm({ ...form, movement_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reference</Label>
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Record Transfer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
