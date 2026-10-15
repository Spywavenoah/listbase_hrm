'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { Boxes, AlertTriangle, DollarSign, Layers, PackagePlus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { fmtDate, fmtMoney, fmtQty, type InventoryItem, type StockRow, type Warehouse } from '@/lib/inventory';

type StockItem = StockRow & { _low: boolean; _over: boolean; _value: number };

const EMPTY_ADD = {
  item_id: '',
  warehouse_id: '',
  quantity: '',
  unit_cost: '',
  reference: '',
  batch_no: '',
  expiry_date: '',
  movement_date: new Date().toISOString().slice(0, 10),
  notes: '',
};

export default function StockPage() {
  const { can } = useAccess();
  const canManage = can('inventory.manage');
  const canMove = can('inventory.move') || can('inventory.manage');
  const [rows, setRows] = useState<StockItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouseId, setWarehouseId] = useState('__all__');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [form, setForm] = useState({ bin_location: '', reorder_level: '' });
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_ADD });

  const load = useCallback(async () => {
    try {
      const [stock, wh, it] = await Promise.all([
        supabase
          .from('inventory_stock')
          .select('*, item:inventory_items(name,uom,reorder_level,unit_cost,max_stock_level), warehouse:inventory_warehouses(name)')
          .order('updated_at', { ascending: false }),
        supabase.from('inventory_warehouses').select('*').order('name'),
        supabase.from('inventory_items').select('*').eq('is_active', true).order('name'),
      ]);
      const mapped = ((stock.data || []) as unknown as StockRow[]).map((r) => {
        const reorder = r.reorder_level ?? r.item?.reorder_level ?? 0;
        const maxLevel = (r.item as { max_stock_level?: number | null } | null)?.max_stock_level ?? null;
        return {
          ...r,
          _low: Number(r.quantity) <= Number(reorder),
          _over: maxLevel != null && Number(r.quantity) >= Number(maxLevel),
          _value: Number(r.quantity) * Number((r.item as { unit_cost?: number } | null)?.unit_cost || 0),
        };
      });
      setRows(mapped);
      setWarehouses((wh.data || []) as unknown as Warehouse[]);
      setItems((it.data || []) as unknown as InventoryItem[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => (warehouseId === '__all__' ? rows : rows.filter((r) => r.warehouse_id === warehouseId)),
    [rows, warehouseId]
  );

  const openEdit = (r: StockItem) => {
    setEditing(r);
    setForm({ bin_location: r.bin_location || '', reorder_level: String(r.reorder_level ?? '') });
    setOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    try {
      const { error } = await supabase
        .from('inventory_stock')
        .update({
          bin_location: form.bin_location || null,
          reorder_level: form.reorder_level === '' ? null : Number(form.reorder_level),
        })
        .eq('id', editing.id);
      if (error) throw error;
      toast.success('Stock record updated');
      setOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openAddStock = (row?: StockItem) => {
    const def = row?.warehouse_id || warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || '';
    setAddForm({
      ...EMPTY_ADD,
      item_id: row?.item_id || '',
      warehouse_id: def,
      unit_cost: row ? String((row.item as { unit_cost?: number } | null)?.unit_cost ?? '') : '',
    });
    setAddOpen(true);
  };

  const saveAddStock = async () => {
    if (!addForm.item_id || !addForm.warehouse_id) { toast.error('Select an item and a warehouse'); return; }
    const qty = Number(addForm.quantity);
    if (!Number.isFinite(qty) || qty <= 0) { toast.error('Enter a quantity greater than zero'); return; }
    setAdding(true);
    try {
      const { error } = await supabase.rpc('record_inventory_movement', {
        p_type: 'RECEIPT',
        p_item_id: addForm.item_id,
        p_warehouse_id: addForm.warehouse_id,
        p_dest_warehouse_id: null,
        p_quantity: qty,
        p_unit_cost: addForm.unit_cost !== '' ? Number(addForm.unit_cost) : null,
        p_reference: addForm.reference || null,
        p_notes: addForm.notes || null,
        p_batch_no: addForm.batch_no || null,
        p_expiry_date: addForm.expiry_date || null,
        p_movement_date: addForm.movement_date || null,
      });
      if (error) throw error;
      toast.success('Stock added');
      setAddOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const lowCount = rows.filter((r) => r._low).length;
  const totalUnits = rows.reduce((a, r) => a + Number(r.quantity), 0);
  const totalValue = rows.reduce((a, r) => a + r._value, 0);

  const summaryCards: SummaryCard[] = [
    { label: 'Stock Records', value: rows.length, icon: Boxes, color: 'primary' },
    { label: 'Units On Hand', value: fmtQty(totalUnits), icon: Layers, color: 'info' },
    { label: 'Low Stock', value: lowCount, icon: AlertTriangle, color: lowCount ? 'warning' : 'success' },
    { label: 'Stock Value', value: fmtMoney(totalValue), icon: DollarSign, color: 'success' },
  ];

  const columns: Column<StockItem>[] = [
    { key: 'item', label: 'Item', render: (r) => <span className="font-medium">{r.item?.name || '—'}</span> },
    { key: 'warehouse', label: 'Warehouse', render: (r) => r.warehouse?.name || '—' },
    { key: 'bin_location', label: 'Rack / Bin', render: (r) => r.bin_location || '—' },
    { key: 'quantity', label: 'On Hand', render: (r) => <span className="font-medium">{fmtQty(r.quantity)} {r.item?.uom}</span> },
    { key: 'reserved_quantity', label: 'Reserved', render: (r) => fmtQty(r.reserved_quantity) },
    { key: 'available', label: 'Available', render: (r) => fmtQty(Number(r.quantity) - Number(r.reserved_quantity)) },
    { key: 'expiry_date', label: 'Expiry', render: (r) => r.expiry_date ? fmtDate(r.expiry_date) : '—' },
    { key: 'reorder_level', label: 'Reorder At', render: (r) => fmtQty(r.reorder_level ?? r.item?.reorder_level ?? 0) },
    {
      key: '_low',
      label: 'Status',
      render: (r) => r._over
        ? <Badge variant="outline" className="bg-primary/10 text-primary">Over-stocked</Badge>
        : r._low
          ? <Badge variant="outline" className="bg-warning/10 text-warning">Low</Badge>
          : <Badge variant="outline" className="bg-success/10 text-success">In Stock</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Stock Levels"
        description="On-hand quantities for every item in every warehouse"
        summaryCards={summaryCards}
        columns={columns}
        data={filtered}
        loading={loading}
        searchPlaceholder="Search stock..."
        toolbarActions={
          <>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All warehouses</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {canMove && (
              <Button size="sm" variant="outline" onClick={() => openAddStock()}>
                <PackagePlus className="mr-2 h-4 w-4" /> Add Stock
              </Button>
            )}
          </>
        }
        onEdit={canManage ? openEdit : undefined}
        rowActions={canMove ? (r) => (
          <Button size="sm" variant="ghost" onClick={() => openAddStock(r)}>
            <PackagePlus className="mr-1 h-3.5 w-3.5" /> Add Stock
          </Button>
        ) : undefined}
        emptyMessage="No stock recorded yet."
        emptyDescription="Add stock or record a receipt to create stock."
      />

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Stock Record</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {editing?.item?.name} · {editing?.warehouse?.name} · On hand {fmtQty(editing?.quantity)} {editing?.item?.uom}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Rack / Bin Location</Label>
                <Input value={form.bin_location} onChange={(e) => setForm({ ...form, bin_location: e.target.value })} placeholder="A-12" />
              </div>
              <div className="space-y-1.5">
                <Label>Reorder Level (this warehouse)</Label>
                <Input type="number" min="0" step="0.01" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} placeholder="Use item default" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Quantities are changed through stock movements to keep the ledger accurate.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={save}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setAddForm({ ...EMPTY_ADD }); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Stock</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Item *</Label>
                <Select value={addForm.item_id} onValueChange={(v) => setAddForm({ ...addForm, item_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                  <SelectContent>
                    {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Warehouse *</Label>
                <Select value={addForm.warehouse_id} onValueChange={(v) => setAddForm({ ...addForm, warehouse_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Quantity *</Label>
                <Input type="number" min="0" step="0.01" value={addForm.quantity} onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Unit Cost</Label>
                <Input type="number" min="0" step="0.01" value={addForm.unit_cost} onChange={(e) => setAddForm({ ...addForm, unit_cost: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={addForm.movement_date} onChange={(e) => setAddForm({ ...addForm, movement_date: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Reference</Label>
                <Input value={addForm.reference} onChange={(e) => setAddForm({ ...addForm, reference: e.target.value })} placeholder="Opening balance / GRN" />
              </div>
              <div className="space-y-1.5">
                <Label>Batch No.</Label>
                <Input value={addForm.batch_no} onChange={(e) => setAddForm({ ...addForm, batch_no: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Date</Label>
                <Input type="date" value={addForm.expiry_date} onChange={(e) => setAddForm({ ...addForm, expiry_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              Adds stock directly to the warehouse without a purchase order. This records a receipt movement in the ledger.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); setAddForm({ ...EMPTY_ADD }); }} disabled={adding}>Cancel</Button>
            <Button onClick={saveAddStock} disabled={adding}>{adding ? 'Adding...' : 'Add Stock'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
