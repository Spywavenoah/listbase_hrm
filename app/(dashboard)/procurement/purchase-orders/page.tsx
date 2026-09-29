'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { ShoppingCart, CheckCircle, Clock, XCircle, Receipt, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { LineItemsEditor, type LineItem } from '@/components/shared/line-items-editor';
import { refNumber, fmtMoney, procStatusClass, CURRENCIES } from '@/lib/procurement';
import { startWorkflow } from '@/lib/workflow/engine';
import { useAccess } from '@/lib/access';

interface Vendor { id: string; name: string }
interface Requisition { id: string; req_number: string; purpose: string | null }

interface POItem extends LineItem {
  purchase_order_id: string;
  quantity: number;
  received_qty: number;
  accepted_qty: number;
  rejected_qty: number;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id: string | null;
  requested_by: string | null;
  requisition_id: string | null;
  quotation_id: string | null;
  department_name: string | null;
  order_date: string;
  expected_delivery: string | null;
  status: string;
  currency: string;
  payment_terms: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes: string | null;
  created_at: string;
}

export default function PurchaseOrdersPage() {
  const { employee } = useAccess();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, POItem[]>>({});
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailItems, setDetailItems] = useState<POItem[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    vendor_id: '',
    requisition_id: '',
    department_name: '',
    order_date: new Date().toISOString().split('T')[0],
    expected_delivery: '',
    currency: 'USD',
    payment_terms: '',
    tax_rate: 0,
    notes: '',
  });
  const [items, setItems] = useState<LineItem[]>([]);

  const load = useCallback(async () => {
    try {
      const [oRes, vRes, iRes, rRes] = await Promise.all([
        supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
        supabase.from('procurement_vendors').select('id, name').eq('is_active', true).order('name'),
        supabase.from('purchase_order_items').select('*').order('created_at', { ascending: true }),
        supabase.from('procurement_requisitions').select('id, req_number, purpose').eq('status', 'APPROVED').order('created_at', { ascending: false }),
      ]);
      setOrders((oRes.data || []) as unknown as PurchaseOrder[]);
      setVendors(vRes.data || []);
      setRequisitions((rRes.data || []) as unknown as Requisition[]);
      const grouped: Record<string, POItem[]> = {};
      for (const it of (iRes.data || []) as unknown as POItem[]) {
        const key = it.purchase_order_id;
        (grouped[key] = grouped[key] || []).push(it);
      }
      setItemsByOrder(grouped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const vendorName = (id: string | null) => {
    if (!id) return '—';
    return vendors.find((v) => v.id === id)?.name || '—';
  };

  const reqLabel = (id: string | null) => {
    const r = requisitions.find((x) => x.id === id);
    return r ? r.req_number : null;
  };

  const orderTotal = (id: string) => {
    const o = orders.find((x) => x.id === id);
    return o ? Number(o.total) : 0;
  };

  const totals = (list: LineItem[]) => {
    const subtotal = list.reduce((s, i) => s + Number(i.total || 0), 0);
    const tax = Number(((Number(form.tax_rate) / 100) * subtotal).toFixed(2));
    return { subtotal, tax, total: subtotal + tax };
  };

  const resetForm = () => {
    setForm({
      vendor_id: '',
      requisition_id: '',
      department_name: '',
      order_date: new Date().toISOString().split('T')[0],
      expected_delivery: '',
      currency: 'USD',
      payment_terms: '',
      tax_rate: 0,
      notes: '',
    });
    setItems([]);
  };

  const handleCreate = async () => {
    if (!form.vendor_id || items.length === 0 || items.some((i) => !i.item_name)) {
      toast.error('Select a vendor and add at least one item with a name');
      return;
    }
    setSaving(true);
    try {
      const { subtotal, tax, total } = totals(items);
      const poNumber = refNumber('PO');
      const { data, error } = await supabase
        .from('purchase_orders')
        .insert({
          po_number: poNumber,
          vendor_id: form.vendor_id,
          requisition_id: form.requisition_id || null,
          department_name: form.department_name || null,
          order_date: form.order_date,
          expected_delivery: form.expected_delivery || null,
          status: 'DRAFT',
          currency: form.currency,
          payment_terms: form.payment_terms || null,
          subtotal: Number(subtotal.toFixed(2)),
          tax_rate: Number(form.tax_rate || 0),
          tax_amount: Number(tax.toFixed(2)),
          total: Number(total.toFixed(2)),
          notes: form.notes || null,
        })
        .select()
        .single();
      if (error) throw error;
      const po = data as unknown as PurchaseOrder;
      const itemRows = items.map((i) => ({
        purchase_order_id: po.id,
        item_name: i.item_name,
        description: i.description || null,
        quantity: i.quantity,
        uom: i.uom,
        unit_price: i.unit_price,
        total: Number((Number(i.quantity) * Number(i.unit_price)).toFixed(2)),
      }));
      const { error: ie } = await supabase.from('purchase_order_items').insert(itemRows);
      if (ie) throw ie;
      toast.success('Purchase order created');
      setCreateOpen(false);
      resetForm();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitOrder = async (po: PurchaseOrder) => {
    try {
      const { error } = await supabase.from('purchase_orders')
        .update({ status: 'PENDING_APPROVAL' })
        .eq('id', po.id);
      if (error) throw error;
      const instanceId = await startWorkflow('procurement.purchase_order', po.id, po.requested_by || employee?.id);
      if (!instanceId) {
        await supabase.from('purchase_orders').update({ status: 'DRAFT' }).eq('id', po.id);
        toast.warning('No approval workflow is enabled for purchase orders — request returned to draft');
        load();
        return;
      }
      toast.success('PO submitted for approval');
      load();
    } catch (err) {
      await supabase.from('purchase_orders').update({ status: 'DRAFT' }).eq('id', po.id);
      toast.error('Failed: ' + (err as Error).message);
      load();
    }
  };

  const setStatus = async (po: PurchaseOrder, status: string) => {
    try {
      const { error } = await supabase.from('purchase_orders').update({ status }).eq('id', po.id);
      if (error) throw error;
      toast.success(`Marked ${status.replace(/_/g, ' ')}`);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openDetail = (po: PurchaseOrder) => {
    setDetailId(po.id);
    setDetailItems(itemsByOrder[po.id] || []);
    setDetailOpen(true);
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Orders', value: orders.length, icon: ShoppingCart, color: 'primary' },
    { label: 'Approved', value: orders.filter((o) => o.status === 'APPROVED').length, icon: CheckCircle, color: 'success' },
    { label: 'Pending Approval', value: orders.filter((o) => o.status === 'PENDING_APPROVAL').length, icon: Clock, color: 'warning' },
    { label: 'Received', value: orders.filter((o) => ['RECEIVED', 'PARTIALLY_RECEIVED', 'CLOSED'].includes(o.status)).length, icon: Receipt, color: 'info' },
  ];

  const columns: Column<PurchaseOrder>[] = [
    { key: 'po_number', label: 'PO Number', render: (o) => <span className="font-medium">{o.po_number}</span> },
    { key: 'vendor_id', label: 'Vendor', render: (o) => vendorName(o.vendor_id), searchText: (o) => [vendorName(o.vendor_id)] },
    { key: 'requisition_id', label: 'Requisition', render: (o) => reqLabel(o.requisition_id) || '—', searchText: (o) => [reqLabel(o.requisition_id) || ''] },
    { key: 'order_date', label: 'Order Date' },
    { key: 'total', label: 'Total', render: (o) => <span className="font-medium">{fmtMoney(o.total, o.currency)}</span> },
    { key: 'status', label: 'Status', render: (o) => <Badge variant="outline" className={procStatusClass(o.status)}>{o.status.replace(/_/g, ' ')}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Purchase Orders"
        description="Create and manage purchase orders with vendors"
        summaryCards={summaryCards}
        columns={columns}
        data={orders}
        loading={loading}
        searchPlaceholder="Search purchase orders..."
        statusKey="status"
        createLabel="New Purchase Order"
        onCreate={() => { resetForm(); setCreateOpen(true); }}
        onRowClick={openDetail}
        rowActions={(o) => (
          <div className="flex items-center gap-1">
            {o.status === 'DRAFT' && (
              <Button size="sm" variant="ghost" onClick={() => submitOrder(o)}>
                <Send className="mr-1 h-3.5 w-3.5" /> Submit
              </Button>
            )}
            {o.status === 'REJECTED' && (
              <Button size="sm" variant="ghost" onClick={() => submitOrder(o)}>
                Resubmit
              </Button>
            )}
            {o.status === 'APPROVED' && (
              <Button size="sm" variant="ghost" onClick={() => setStatus(o, 'CLOSED')}>
                Close
              </Button>
            )}
            {(o.status === 'DRAFT' || o.status === 'CANCELLED') && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setStatus(o, 'CANCELLED')}>
                <XCircle className="mr-1 h-3.5 w-3.5" /> Cancel
              </Button>
            )}
          </div>
        )}
        onDelete={async (o) => {
          if (o.status !== 'DRAFT') {
            toast.error('Only draft purchase orders can be deleted');
            return;
          }
          try {
            const { error } = await supabase.from('purchase_orders').delete().eq('id', o.id);
            if (error) throw error;
            toast.success('Purchase order deleted');
            load();
          } catch (err) {
            toast.error('Failed: ' + (err as Error).message);
          }
        }}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Purchase Order</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Vendor *</Label>
                <Select value={form.vendor_id} onValueChange={(v) => setForm({ ...form, vendor_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Requisition</Label>
                <Select value={form.requisition_id} onValueChange={(v) => setForm({ ...form, requisition_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select requisition (optional)" /></SelectTrigger>
                  <SelectContent>
                    {requisitions.map((r) => <SelectItem key={r.id} value={r.id}>{r.req_number} — {r.purpose || ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Input value={form.department_name} onChange={(e) => setForm({ ...form, department_name: e.target.value })} placeholder="IT" />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Order Date</Label>
                <Input type="date" value={form.order_date} onChange={(e) => setForm({ ...form, order_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Expected Delivery</Label>
                <Input type="date" value={form.expected_delivery} onChange={(e) => setForm({ ...form, expected_delivery: e.target.value })} />
              </div>
            </div>

            <LineItemsEditor items={items} onChange={setItems} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tax rate (%)</Label>
                <Input type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Payment terms</Label>
                <Input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} placeholder="e.g. Net 30" />
              </div>
            </div>
            {items.length > 0 && (
              <p className="text-right text-sm font-medium">
                Total: {fmtMoney(totals(items).total, form.currency)} (incl. tax {fmtMoney(totals(items).tax, form.currency)})
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.vendor_id || items.length === 0 || items.some((i) => !i.item_name)}>
              {saving ? 'Creating...' : 'Create PO'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailId && orders.find((o) => o.id === detailId)
                ? `${orders.find((o) => o.id === detailId)!.po_number} — ${vendorName(orders.find((o) => o.id === detailId)!.vendor_id)}`
                : 'Purchase Order'}
            </DialogTitle>
          </DialogHeader>
          {detailId && (() => {
            const po = orders.find((o) => o.id === detailId);
            if (!po) return null;
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={procStatusClass(po.status)}>{po.status.replace(/_/g, ' ')}</Badge>
                  {po.requisition_id && <Badge variant="outline">Requisition: {reqLabel(po.requisition_id)}</Badge>}
                  {po.payment_terms && <Badge variant="outline">Terms: {po.payment_terms}</Badge>}
                  <Badge variant="outline">Currency: {po.currency}</Badge>
                </div>
                {po.notes && <p className="text-sm text-muted-foreground">{po.notes}</p>}
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <p>Order date: <span className="font-medium">{po.order_date}</span></p>
                  <p>Expected delivery: <span className="font-medium">{po.expected_delivery || '—'}</span></p>
                  <p>Department: <span className="font-medium">{po.department_name || '—'}</span></p>
                  <p>Status changed: <span className="font-medium">{po.created_at ? new Date(po.created_at).toLocaleDateString() : '—'}</span></p>
                </div>
                {detailItems.length === 0 && (
                  <p className="text-sm text-muted-foreground">No line items on this order.</p>
                )}
                {detailItems.map((it) => (
                  <div key={it.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{it.item_name}</p>
                        {it.description && <p className="text-xs text-muted-foreground">{it.description}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">{fmtMoney(it.total, po.currency)}</p>
                        <p className="text-xs text-muted-foreground">{it.quantity} {it.uom} × {fmtMoney(it.unit_price, po.currency)}</p>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Received {Number(it.received_qty || 0)} / {it.quantity} {it.uom} · accepted {Number(it.accepted_qty || 0)} · rejected {Number(it.rejected_qty || 0)}
                    </p>
                  </div>
                ))}
                {detailItems.length > 0 && (
                  <div className="space-y-1 border-t border-border pt-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{fmtMoney(Number(po.subtotal) || 0, po.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax ({Number(po.tax_rate) || 0}%)</span>
                      <span>{fmtMoney(Number(po.tax_amount) || 0, po.currency)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold">
                      <span>Order Total</span>
                      <span>{fmtMoney(orderTotal(po.id), po.currency)}</span>
                    </div>
                  </div>
                )}
                {po.status === 'DRAFT' && (
                  <Button onClick={() => { setDetailOpen(false); submitOrder(po); }}>
                    Submit for Approval
                  </Button>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}