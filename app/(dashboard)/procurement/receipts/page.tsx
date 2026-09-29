'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Package, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { refNumber, procStatusClass } from '@/lib/procurement';
import { useAccess } from '@/lib/access';

interface Receipt {
  id: string;
  receipt_number: string;
  po_id: string;
  received_date: string;
  received_by: string | null;
  delivery_note_number: string | null;
  warehouse: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

interface ReceiptItem {
  id: string;
  receipt_id: string;
  po_item_id: string | null;
  item_name: string;
  quantity_received: number;
  quantity_accepted: number;
  quantity_rejected: number;
  rejection_reason: string | null;
}

interface PO {
  id: string;
  po_number: string;
  vendor_id: string | null;
  status: string;
  currency: string;
}
interface POItem {
  id: string;
  purchase_order_id: string;
  item_name: string;
  quantity: number;
  received_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  uom: string;
  unit_price: number;
}
interface Vendor { id: string; name: string }

export default function ReceiptsPage() {
  const { employee } = useAccess();
  const [rows, setRows] = useState<Receipt[]>([]);
  const [itemsByReceipt, setItemsByReceipt] = useState<Record<string, ReceiptItem[]>>({});
  const [pos, setPos] = useState<PO[]>([]);
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [receiveLines, setReceiveLines] = useState<Record<string, { received: number; rejected: number; reason: string }>>({});
  const [receiptDate, setReceiptDate] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, iRes, pRes, piRes, vRes, empRes] = await Promise.all([
        supabase.from('procurement_receipts').select('*').order('created_at', { ascending: false }),
        supabase.from('procurement_receipt_items').select('*'),
        supabase.from('purchase_orders').select('id, po_number, vendor_id, status, currency').in('status', ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED']).order('created_at', { ascending: false }),
        supabase.from('purchase_order_items').select('*').order('created_at', { ascending: true }),
        supabase.from('procurement_vendors').select('id, name'),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      setRows((rRes.data || []) as unknown as Receipt[]);
      const grouped: Record<string, ReceiptItem[]> = {};
      for (const it of (iRes.data || []) as unknown as ReceiptItem[]) {
        (grouped[it.receipt_id] = grouped[it.receipt_id] || []).push(it);
      }
      setItemsByReceipt(grouped);
      setPos(pRes.data || []);
      setPoItems((piRes.data || []) as unknown as POItem[]);
      setVendors(vRes.data || []);
      const names: Record<string, string> = {};
      for (const e of (empRes.data || []) as { id: string; name: string }[]) names[e.id] = e.name;
      setEmployeeNames(names);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const poNumber = (id: string) => pos.find((p) => p.id === id)?.po_number || '—';
  const vendorName = (id: string | null) => vendors.find((v) => v.id === id)?.name || '—';

  const today = () => new Date().toISOString().split('T')[0];

  const openCreate = (poId: string) => {
    setSelectedPoId(poId);
    setReceiptDate(today());
    setDeliveryNote('');
    setWarehouse('');
    setNotes('');
    const lines: Record<string, { received: number; rejected: number; reason: string }> = {};
    for (const it of poItems.filter((p) => p.purchase_order_id === poId)) {
      lines[it.id] = { received: 0, rejected: 0, reason: '' };
    }
    setReceiveLines(lines);
    setCreateOpen(true);
  };

  const remainingOf = (poi: POItem) => Math.max(0, Number(poi.quantity) - Number(poi.received_qty));

  const handleRecord = async () => {
    if (!selectedPoId) return;
    const lines = Object.entries(receiveLines).filter(([, v]) => v.received > 0 || v.rejected > 0);
    if (lines.length === 0) {
      toast.error('Enter at least one received/rejected quantity');
      return;
    }
    const overReceipt = poItems
      .filter((p) => p.purchase_order_id === selectedPoId)
      .some((p) => {
        const l = receiveLines[p.id];
        return l && (Number(l.received) + Number(l.rejected)) > remainingOf(p);
      });
    if (overReceipt) {
      toast.error('Received/rejected quantities cannot exceed the remaining order quantity');
      return;
    }
    setSaving(true);
    try {
      const number = refNumber('GRN');
      const { data, error } = await supabase.from('procurement_receipts').insert({
        receipt_number: number,
        po_id: selectedPoId,
        received_date: receiptDate || today(),
        received_by: employee?.id || null,
        delivery_note_number: deliveryNote || null,
        warehouse: warehouse || null,
        status: 'RECEIVED',
        notes: notes || null,
      }).select().single();
      if (error) throw error;
      const receipt = data as unknown as Receipt;

      const itemRows: { receipt_id: string; po_item_id: string; item_name: string; quantity_received: number; quantity_accepted: number; quantity_rejected: number; rejection_reason: string | null }[] = [];
      for (const poi of poItems.filter((p) => p.purchase_order_id === selectedPoId)) {
        const l = receiveLines[poi.id];
        if (!l || (Number(l.received) <= 0 && Number(l.rejected) <= 0)) continue;
        const received = Number(l.received) || 0;
        const rejected = Number(l.rejected) || 0;
        itemRows.push({
          receipt_id: receipt.id,
          po_item_id: poi.id,
          item_name: poi.item_name,
          quantity_received: received + rejected,
          quantity_accepted: received,
          quantity_rejected: rejected,
          rejection_reason: rejected > 0 ? l.reason || null : null,
        });
        const { error: ue } = await supabase.from('purchase_order_items')
          .update({
            received_qty: (Number(poi.received_qty) || 0) + received + rejected,
            accepted_qty: (Number(poi.accepted_qty) || 0) + received,
            rejected_qty: (Number(poi.rejected_qty) || 0) + rejected,
          })
          .eq('id', poi.id);
        if (ue) throw ue;
      }
      if (itemRows.length > 0) {
        const { error: ie } = await supabase.from('procurement_receipt_items').insert(itemRows);
        if (ie) throw ie;
      }

      const allItems = poItems.filter((p) => p.purchase_order_id === selectedPoId);
      const fullyReceived = allItems.every((p) => {
        const l = receiveLines[p.id];
        return Number(p.received_qty) + (l ? Number(l.received) + Number(l.rejected) : 0) >= Number(p.quantity);
      });
      const anyReceived = (await supabase.from('purchase_orders').select('*').eq('id', selectedPoId).single()).data;
      await supabase.from('purchase_orders').update({
        status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
        closed_at: fullyReceived ? new Date().toISOString() : null,
      }).eq('id', selectedPoId);

      toast.success(`Goods receipt ${number} recorded against ${poNumber(selectedPoId)} (vendor: ${vendorName(anyReceived?.vendor_id)})`);
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Receipts', value: rows.length, icon: Package, color: 'primary' },
    { label: 'This Month', value: rows.filter((r) => new Date(r.received_date).getMonth() === new Date().getMonth()).length, icon: Clock, color: 'info' },
    { label: 'Active POs', value: pos.filter((p) => p.status === 'APPROVED' || p.status === 'PARTIALLY_RECEIVED').length, icon: CheckCircle, color: 'success' },
  ];

  const columns: Column<Receipt>[] = [
    { key: 'receipt_number', label: 'Receipt', render: (r) => <span className="font-medium">{r.receipt_number}</span> },
    { key: 'po_id', label: 'PO', render: (r) => <span className="font-mono text-xs">{poNumber(r.po_id)}</span>, searchText: (r) => [poNumber(r.po_id)] },
    { key: 'warehouse', label: 'Warehouse', render: (r) => r.warehouse || '—' },
    { key: 'received_date', label: 'Received' },
    { key: 'received_by', label: 'Received By', render: (r) => (r.received_by ? employeeNames[r.received_by] || '—' : '—'), searchText: (r) => (r.received_by ? [employeeNames[r.received_by] || ''] : []) },
    {
      key: 'qty', label: 'Quantity',
      render: (r) => {
        const its = itemsByReceipt[r.id] || [];
        const q = its.reduce((s, i) => s + Number(i.quantity_received), 0);
        return <span className="font-medium">{q}</span>;
      },
    },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={procStatusClass(r.status)}>{r.status.replace(/_/g, ' ')}</Badge> },
  ];

  const selectedLines = selectedPoId ? poItems.filter((p) => p.purchase_order_id === selectedPoId) : [];
  const selectedPo = pos.find((p) => p.id === selectedPoId);

  return (
    <>
      <ModuleListPage
        title="Goods Receipts"
        description="Record deliveries received against purchase orders"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search receipts..."
        statusKey="status"
        onRowClick={(r) => { setDetailId(r.id); setDetailOpen(true); }}
        toolbarActions={
          <Select value="" onValueChange={(v) => v && openCreate(v)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Record receipt for PO..." />
            </SelectTrigger>
            <SelectContent>
              {pos.filter((p) => p.status === 'APPROVED' || p.status === 'PARTIALLY_RECEIVED').map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.po_number} — {vendorName(p.vendor_id)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        emptyMessage="No goods receipts yet"
        emptyDescription="Receives appear here once a delivery is recorded against a purchase order."
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Goods Receipt — {selectedPo ? `${poNumber(selectedPo.id)} · ${vendorName(selectedPo.vendor_id)}` : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Delivery Note</Label>
                <Input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Warehouse</Label>
                <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Accepted / Rejected Quantities</Label>
                <span className="text-xs text-muted-foreground">Rejected quantities trigger inspection &amp; return</span>
              </div>
              {selectedLines.length === 0 && <p className="text-xs text-muted-foreground">No line items on this order.</p>}
              {selectedLines.map((poi) => (
                <div key={poi.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{poi.item_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Ordered {poi.quantity} {poi.uom} · Already received {poi.received_qty} · Remaining {Math.max(0, Number(poi.quantity) - Number(poi.received_qty))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        type="number"
                        className="w-24"
                        placeholder="Accepted"
                        min={0}
                        max={remainingOf(poi)}
                        value={receiveLines[poi.id]?.received ?? ''}
                        onChange={(e) => setReceiveLines({
                          ...receiveLines,
                          [poi.id]: {
                            ...receiveLines[poi.id],
                            received: Math.min(Math.max(0, Number(e.target.value)), remainingOf(poi)),
                            rejected: receiveLines[poi.id]?.rejected || 0,
                            reason: receiveLines[poi.id]?.reason || '',
                          },
                        })}
                      />
                      <Input
                        type="number"
                        className="w-24"
                        placeholder="Rejected"
                        min={0}
                        max={remainingOf(poi)}
                        value={receiveLines[poi.id]?.rejected ?? ''}
                        onChange={(e) => setReceiveLines({
                          ...receiveLines,
                          [poi.id]: {
                            ...receiveLines[poi.id],
                            rejected: Math.min(Math.max(0, Number(e.target.value)), remainingOf(poi)),
                            received: receiveLines[poi.id]?.received || 0,
                            reason: receiveLines[poi.id]?.reason || '',
                          },
                        })}
                      />
                    </div>
                  </div>
                  {(receiveLines[poi.id]?.rejected || 0) > 0 && (
                    <Input
                      className="mt-2"
                      placeholder="Rejection reason"
                      value={receiveLines[poi.id]?.reason || ''}
                      onChange={(e) => setReceiveLines({ ...receiveLines, [poi.id]: { ...receiveLines[poi.id], reason: e.target.value } })}
                    />
                  )}
                </div>
              ))}
              {selectedLines.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Accepted quantities flow into supplier invoicing.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleRecord} disabled={saving}>
              {saving ? 'Recording...' : 'Record Receipt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailId && rows.find((r) => r.id === detailId)?.receipt_number || 'Goods Receipt'}
            </DialogTitle>
          </DialogHeader>
          {detailId && (() => {
            const row = rows.find((r) => r.id === detailId);
            if (!row) return null;
            const its = itemsByReceipt[row.id] || [];
            const accepted = its.reduce((s, i) => s + Number(i.quantity_accepted), 0);
            const rejected = its.reduce((s, i) => s + Number(i.quantity_rejected), 0);
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={procStatusClass(row.status)}>{row.status.replace(/_/g, ' ')}</Badge>
                  <Badge variant="outline">PO: {poNumber(row.po_id)}</Badge>
                  <Badge variant="outline">Vendor: {vendorName(pos.find((p) => p.id === row.po_id)?.vendor_id || null)}</Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <p>Received: <span className="font-medium">{row.received_date}</span></p>
                  <p>Received by: <span className="font-medium">{row.received_by ? employeeNames[row.received_by] || '—' : '—'}</span></p>
                  <p>Delivery note: <span className="font-medium">{row.delivery_note_number || '—'}</span></p>
                  <p>Warehouse: <span className="font-medium">{row.warehouse || '—'}</span></p>
                </div>
                {row.notes && <p className="text-sm text-muted-foreground">{row.notes}</p>}
                {its.length === 0 && <p className="text-sm text-muted-foreground">No items on this receipt.</p>}
                {its.map((it) => (
                  <div key={it.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">{it.item_name}</p>
                      <p className="text-sm font-medium shrink-0">
                        +{it.quantity_accepted} / -{it.quantity_rejected}
                      </p>
                    </div>
                    {it.rejection_reason && (
                      <p className="mt-1 text-xs text-destructive">Rejected: {it.rejection_reason}</p>
                    )}
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-3 text-sm font-medium">
                  <span>Accepted {accepted} · Rejected {rejected}</span>
                  <span>{accepted + rejected} total</span>
                </div>
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