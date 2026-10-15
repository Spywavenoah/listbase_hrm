'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, SlidersHorizontal, Plus } from 'lucide-react';
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
import {
  fmtDate,
  fmtQty,
  movementLabel,
  movementSign,
  type InventoryItem,
  type Movement,
  type Warehouse,
} from '@/lib/inventory';

const FORM_TYPES = [
  { value: 'RECEIPT', label: 'Receipt (stock in)' },
  { value: 'ISSUE', label: 'Issue (stock out)' },
  { value: 'TRANSFER', label: 'Transfer (between warehouses)' },
  { value: 'ADJUSTMENT', label: 'Adjustment (set counted quantity)' },
  { value: 'RETURN', label: 'Return to store' },
  { value: 'OPENING', label: 'Opening balance' },
];

const typeClass: Record<string, string> = {
  RECEIPT: 'bg-success/10 text-success',
  OPENING: 'bg-info/10 text-info',
  RETURN: 'bg-success/10 text-success',
  ISSUE: 'bg-warning/10 text-warning',
  TRANSFER: 'bg-primary/10 text-primary',
  ADJUSTMENT: 'bg-muted text-muted-foreground',
};

interface MovementRow extends Movement {
  performed_by_employee?: { first_name: string | null; last_name: string | null } | null;
}

const EMPTY = {
  type: 'RECEIPT',
  item_id: '',
  warehouse_id: '',
  dest_warehouse_id: '',
  quantity: '',
  unit_cost: '',
  reference: '',
  batch_no: '',
  expiry_date: '',
  movement_date: new Date().toISOString().slice(0, 10),
  notes: '',
};

export default function MovementsPage() {
  const { can } = useAccess();
  const canMove = can('inventory.move') || can('inventory.manage');
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const load = useCallback(async () => {
    try {
      const [mv, it, wh] = await Promise.all([
        supabase
          .from('inventory_movements')
          .select('*, item:inventory_items(name,uom), warehouse:inventory_warehouses!inventory_movements_warehouse_id_fkey(name), dest_warehouse:inventory_warehouses!inventory_movements_dest_warehouse_id_fkey(name), performed_by_employee:employees(first_name,last_name)')
          .order('movement_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('inventory_items').select('*').eq('is_active', true).order('name'),
        supabase.from('inventory_warehouses').select('*').eq('is_active', true).order('name'),
      ]);
      setRows((mv.data || []) as unknown as MovementRow[]);
      setItems((it.data || []) as unknown as InventoryItem[]);
      setWarehouses((wh.data || []) as unknown as Warehouse[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => { setOpen(false); setForm({ ...EMPTY }); };

  const openCreate = () => {
    const def = warehouses.find((w) => w.is_default) || warehouses[0];
    setForm({ ...EMPTY, warehouse_id: def?.id || '' });
    setOpen(true);
  };

  const isTransfer = form.type === 'TRANSFER';
  const needsCost = ['RECEIPT', 'OPENING', 'RETURN'].includes(form.type);

  const save = async () => {
    if (!form.item_id || !form.warehouse_id) { toast.error('Select an item and a warehouse'); return; }
    if (isTransfer && (!form.dest_warehouse_id || form.dest_warehouse_id === form.warehouse_id)) {
      toast.error('Select a different destination warehouse');
      return;
    }
    if (form.quantity === '' || Number(form.quantity) < 0) { toast.error('Enter a valid quantity'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('record_inventory_movement', {
        p_type: form.type,
        p_item_id: form.item_id,
        p_warehouse_id: form.warehouse_id,
        p_dest_warehouse_id: isTransfer ? form.dest_warehouse_id : null,
        p_quantity: Number(form.quantity),
        p_unit_cost: needsCost && form.unit_cost !== '' ? Number(form.unit_cost) : null,
        p_reference: form.reference || null,
        p_notes: form.notes || null,
        p_batch_no: form.batch_no || null,
        p_expiry_date: form.expiry_date || null,
        p_movement_date: form.movement_date || null,
      });
      if (error) throw error;
      toast.success('Stock movement recorded');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const counts = useMemo(() => {
    const c = { in: 0, out: 0, transfer: 0, adjust: 0 } as Record<string, number>;
    for (const r of rows) {
      const s = movementSign(r.movement_type);
      if (s === 'in') c.in += 1;
      else if (s === 'out') c.out += 1;
      else c.adjust += 1;
    }
    return c;
  }, [rows]);

  const summaryCards: SummaryCard[] = [
    { label: 'Movements', value: rows.length, icon: ArrowRightLeft, color: 'primary' },
    { label: 'Stock In', value: counts.in, icon: ArrowDownToLine, color: 'success' },
    { label: 'Stock Out', value: counts.out, icon: ArrowUpFromLine, color: 'warning' },
    { label: 'Adjustments', value: counts.adjust, icon: SlidersHorizontal, color: 'info' },
  ];

  const columns: Column<MovementRow>[] = [
    { key: 'movement_date', label: 'Date', render: (r) => fmtDate(r.movement_date) },
    {
      key: 'movement_type',
      label: 'Type',
      render: (r) => <Badge variant="outline" className={typeClass[r.movement_type]}>{movementLabel(r.movement_type)}</Badge>,
    },
    { key: 'item', label: 'Item', render: (r) => <span className="font-medium">{r.item?.name || '—'}</span> },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: (r) => r.movement_type === 'TRANSFER'
        ? <span>{r.warehouse?.name} → {r.dest_warehouse?.name || '—'}</span>
        : (r.warehouse?.name || '—'),
    },
    {
      key: 'quantity',
      label: 'Qty',
      render: (r) => {
        const q = Number(r.quantity);
        const cls = q < 0 ? 'text-destructive' : 'text-success';
        return <span className={`font-medium ${cls}`}>{q > 0 ? '+' : ''}{fmtQty(q)} {r.item?.uom}</span>;
      },
    },
    { key: 'resulting_quantity', label: 'Balance', render: (r) => fmtQty(r.resulting_quantity) },
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
        title="Stock Movements"
        description="Immutable ledger of every receipt, issue, transfer and adjustment"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search by item, reference..."
        toolbarActions={
          canMove ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Record Movement</span><span className="sm:hidden">Record</span>
            </Button>
          ) : undefined
        }
        emptyMessage="No stock movements yet."
        emptyDescription="Record a receipt, issue or transfer to build the ledger."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record Stock Movement</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Movement Type *</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v, dest_warehouse_id: '' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORM_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Item *</Label>
                <Select value={form.item_id} onValueChange={(v) => setForm({ ...form, item_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                  <SelectContent>
                    {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{isTransfer ? 'From Warehouse *' : 'Warehouse *'}</Label>
                <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isTransfer && (
                <div className="space-y-1.5">
                  <Label>To Warehouse *</Label>
                  <Select value={form.dest_warehouse_id} onValueChange={(v) => setForm({ ...form, dest_warehouse_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.filter((w) => w.id !== form.warehouse_id).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{form.type === 'ADJUSTMENT' ? 'Counted Quantity *' : 'Quantity *'}</Label>
                <Input type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" />
              </div>
              {needsCost && (
                <div className="space-y-1.5">
                  <Label>Unit Cost</Label>
                  <Input type="number" min="0" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} placeholder="0.00" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Movement Date</Label>
                <Input type="date" value={form.movement_date} onChange={(e) => setForm({ ...form, movement_date: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Reference</Label>
                <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="GRN-0001 / PO-0007" />
              </div>
              <div className="space-y-1.5">
                <Label>Batch No.</Label>
                <Input value={form.batch_no} onChange={(e) => setForm({ ...form, batch_no: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Date</Label>
                <Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {form.type === 'ADJUSTMENT' && (
              <p className="text-xs text-muted-foreground">
                Adjustment sets the on-hand quantity to the counted value entered above.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Record Movement'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
