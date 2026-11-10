'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import {
  ClipboardCheck,
  Clock,
  FileText,
  PackageCheck,
  Plus,
  ShieldCheck,
  Trash2,
  Truck,
  Upload,
  AlertTriangle,
} from 'lucide-react';
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
  INVENTORY_DOCUMENT_ACCEPT,
  INVENTORY_DOCUMENT_BUCKET,
  RECEIPT_OUTCOMES,
  RECEIPT_VERDICTS,
  fmtDate,
  fmtQty,
  inventoryDocumentError,
  inventoryDocumentPath,
  type InventoryItem,
  type InventoryReceipt,
  type InventoryReceiptItem,
  type Warehouse,
} from '@/lib/inventory';

interface Line {
  item_id: string;
  quantity: string;
}

interface InspectionRow {
  accepted_qty: string;
  verdict: string;
  outcome: string;
  comment: string;
}

const EMPTY_FORM = {
  warehouse_id: '',
  supplier_name: '',
  source_reference: '',
  received_date: new Date().toISOString().slice(0, 10),
};

const statusClass = (status: string) => {
  switch (status) {
    case 'ACKNOWLEDGED': return 'bg-success/10 text-success border-success/30';
    case 'INSPECTED': return 'bg-info/10 text-info border-info/30';
    case 'CANCELLED': return 'bg-muted text-muted-foreground';
    default: return 'bg-warning/10 text-warning border-warning/30';
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'PENDING_INSPECTION': return 'Pending inspection';
    case 'INSPECTED': return 'Inspected';
    case 'ACKNOWLEDGED': return 'Acknowledged';
    default: return status.charAt(0) + status.slice(1).toLowerCase();
  }
};

const employeeName = (row?: { first_name: string | null; last_name: string | null } | null) =>
  row ? [row.first_name, row.last_name].filter(Boolean).join(' ') || '—' : '—';

export default function GoodsReceivingPage() {
  const { can } = useAccess();
  const canMove = can('inventory.move') || can('inventory.manage');

  const [rows, setRows] = useState<InventoryReceipt[]>([]);
  const [linesByReceipt, setLinesByReceipt] = useState<Record<string, InventoryReceiptItem[]>>({});
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [lines, setLines] = useState<Line[]>([{ item_id: '', quantity: '' }]);
  const [waybillFile, setWaybillFile] = useState<File | null>(null);
  const [poFile, setPoFile] = useState<File | null>(null);
  const [mriFile, setMriFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const waybillRef = useRef<HTMLInputElement>(null);
  const poFileRef = useRef<HTMLInputElement>(null);
  const mriFileRef = useRef<HTMLInputElement>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Record<string, InspectionRow>>({});
  const [inspectionRemarks, setInspectionRemarks] = useState('');
  const [ackRemarks, setAckRemarks] = useState('');
  const [working, setWorking] = useState(false);
  const initialReceiptHandled = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, iRes, itemsRes, wRes] = await Promise.all([
        supabase
          .from('inventory_receipts')
          .select('*, warehouse:inventory_warehouses(name), received_by_employee:employees!inventory_receipts_received_by_fkey(first_name,last_name)')
          .order('created_at', { ascending: false }),
        supabase
          .from('inventory_receipt_items')
          .select('*, item:inventory_items(name,uom,sku)'),
        supabase.from('inventory_items').select('*').eq('is_active', true).order('name'),
        supabase.from('inventory_warehouses').select('*').eq('is_active', true).order('name'),
      ]);
      setRows((rRes.data || []) as unknown as InventoryReceipt[]);
      const grouped: Record<string, InventoryReceiptItem[]> = {};
      for (const line of (iRes.data || []) as unknown as InventoryReceiptItem[]) {
        (grouped[line.receipt_id] = grouped[line.receipt_id] || []).push(line);
      }
      setLinesByReceipt(grouped);
      setItems((itemsRes.data || []) as unknown as InventoryItem[]);
      setWarehouses((wRes.data || []) as unknown as Warehouse[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Deep link from an item's receiving history: /inventory/receiving?receipt=<id>
  useEffect(() => {
    if (typeof window === 'undefined' || initialReceiptHandled.current) return;
    const id = new URLSearchParams(window.location.search).get('receipt');
    if (id && rows.some((row) => row.id === id)) {
      initialReceiptHandled.current = true;
      setDetailId(id);
    }
  }, [rows]);

  const attachmentError = (file: File | null) => (file ? inventoryDocumentError(file) : null);

  const uploadDocument = async (receiptId: string, kind: 'WAYBILL' | 'PO' | 'MRI', file: File) => {
    const path = inventoryDocumentPath('receiving', receiptId, file);
    const { error: uploadError } = await supabase.storage
      .from(INVENTORY_DOCUMENT_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from(INVENTORY_DOCUMENT_BUCKET).getPublicUrl(path);
    const { error: attachError } = await supabase.rpc('attach_inventory_receipt_document', {
      p_receipt_id: receiptId,
      p_kind: kind,
      p_url: data.publicUrl,
    });
    if (attachError) throw attachError;
  };

  const openCreate = () => {
    const def = warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || '';
    setForm({ ...EMPTY_FORM, warehouse_id: def });
    setLines([{ item_id: '', quantity: '' }]);
    setWaybillFile(null);
    setPoFile(null);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!form.warehouse_id) { toast.error('Select a receiving warehouse'); return; }
    const valid = lines.filter((l) => l.item_id || l.quantity);
    if (valid.length === 0) { toast.error('Add at least one delivered item'); return; }
    const seen = new Set<string>();
    for (const l of valid) {
      if (!l.item_id) { toast.error('Select an item on every line'); return; }
      if (Number(l.quantity) <= 0) { toast.error('Every delivered item needs a positive quantity'); return; }
      if (seen.has(l.item_id)) { toast.error('An item may appear only once on a receipt'); return; }
      seen.add(l.item_id);
    }
    const fileError = attachmentError(waybillFile) || attachmentError(poFile);
    if (fileError) { toast.error(fileError); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('create_inventory_receipt', {
        p_warehouse_id: form.warehouse_id,
        p_rows: valid.map((l) => ({ item_id: l.item_id, quantity: Number(l.quantity) })),
        p_supplier_name: form.supplier_name || null,
        p_source_reference: form.source_reference || null,
        p_received_date: form.received_date || null,
      });
      if (error) throw error;
      toast.success('Goods receipt registered — inspection required');
      const receiptId = data ? String(data) : null;
      if (receiptId) {
        try {
          if (waybillFile) await uploadDocument(receiptId, 'WAYBILL', waybillFile);
          if (poFile) await uploadDocument(receiptId, 'PO', poFile);
        } catch (docErr) {
          toast.error('Receipt saved, but a document could not be attached: ' + (docErr as Error).message);
        }
      }
      setCreateOpen(false);
      await load();
      if (receiptId) setDetailId(receiptId);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const detailRow = rows.find((r) => r.id === detailId) || null;
  const detailLines = useMemo(
    () => (detailRow ? linesByReceipt[detailRow.id] || [] : []),
    [detailRow, linesByReceipt]
  );

  useEffect(() => {
    if (!detailRow) return;
    const next: Record<string, InspectionRow> = {};
    for (const line of detailLines) {
      next[line.item_id] = {
        accepted_qty: String(line.accepted_qty ?? line.delivered_qty ?? ''),
        verdict: line.verdict || 'CONFORMING',
        outcome: line.outcome || 'ACCEPTED',
        comment: line.inspection_comment || '',
      };
    }
    setInspection(next);
    setInspectionRemarks(detailRow.inspection_remarks || '');
    setAckRemarks(detailRow.acknowledgement_remarks || '');
    setMriFile(null);
  }, [detailRow?.id, detailLines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitInspection = async () => {
    if (!detailRow) return;
    const payload = detailLines.map((line) => {
      const row = inspection[line.item_id];
      return {
        item_id: line.item_id,
        accepted_qty: Number(row?.accepted_qty ?? 0),
        verdict: row?.verdict || 'CONFORMING',
        outcome: row?.outcome || 'ACCEPTED',
        comment: row?.comment || null,
      };
    });
    for (const line of detailLines) {
      const row = inspection[line.item_id];
      const accepted = Number(row?.accepted_qty ?? 0);
      if (!Number.isFinite(accepted) || accepted < 0 || accepted > Number(line.delivered_qty)) {
        toast.error(`Accepted quantity for ${line.item?.name || 'item'} must be between 0 and ${fmtQty(line.delivered_qty)}`);
        return;
      }
      const rejected = Number(line.delivered_qty) - accepted;
      if (row?.outcome === 'ACCEPTED' && (rejected > 0 || row?.verdict !== 'CONFORMING')) {
        toast.error(`${line.item?.name || 'Item'}: use "Accepted with comment" when there is a discrepancy`);
        return;
      }
      if ((row?.outcome === 'ACCEPTED_WITH_COMMENT' || row?.outcome === 'REJECTED') && !row?.comment.trim()) {
        toast.error(`${line.item?.name || 'Item'}: add a comment for the selected decision`);
        return;
      }
      if (row?.outcome === 'REJECTED' && accepted > 0) {
        toast.error(`${line.item?.name || 'Item'}: rejected items must have zero accepted quantity`);
        return;
      }
    }
    setWorking(true);
    try {
      const { error } = await supabase.rpc('inspect_inventory_receipt', {
        p_receipt_id: detailRow.id,
        p_rows: payload,
        p_remarks: inspectionRemarks || null,
      });
      if (error) throw error;
      if (mriFile) {
        try {
          await uploadDocument(detailRow.id, 'MRI', mriFile);
        } catch (docErr) {
          toast.error('Inspection saved, but the MRI report could not be attached: ' + (docErr as Error).message);
        }
      }
      toast.success('Inspection recorded — ready for acknowledgement');
      setMriFile(null);
      await load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const submitAcknowledgement = async () => {
    if (!detailRow) return;
    setWorking(true);
    try {
      const { data, error } = await supabase.rpc('acknowledge_inventory_receipt', {
        p_receipt_id: detailRow.id,
        p_remarks: ackRemarks || null,
      });
      if (error) throw error;
      toast.success(`Receipt acknowledged — ${fmtQty(Number(data) || 0)} unit(s) posted to stock`);
      await load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Goods Receipts', value: rows.length, icon: Truck, color: 'primary' },
    { label: 'Pending Inspection', value: rows.filter((r) => r.status === 'PENDING_INSPECTION').length, icon: Clock, color: 'warning' },
    { label: 'Inspected', value: rows.filter((r) => r.status === 'INSPECTED').length, icon: ClipboardCheck, color: 'info' },
    { label: 'Acknowledged', value: rows.filter((r) => r.status === 'ACKNOWLEDGED').length, icon: PackageCheck, color: 'success' },
  ];

  const columns: Column<InventoryReceipt>[] = [
    { key: 'receipt_number', label: 'GRN', render: (r) => <span className="font-medium">{r.receipt_number}</span> },
    { key: 'supplier_name', label: 'Supplier', render: (r) => r.supplier_name || '—' },
    { key: 'source_reference', label: 'Reference', render: (r) => r.source_reference || '—' },
    { key: 'warehouse', label: 'Warehouse', render: (r) => r.warehouse?.name || '—' },
    { key: 'received_date', label: 'Received', render: (r) => fmtDate(r.received_date) },
    { key: 'lines', label: 'Items', render: (r) => (linesByReceipt[r.id] || []).length, searchable: false },
    { key: 'received_by', label: 'Received By', render: (r) => employeeName(r.received_by_employee), searchable: false },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Badge variant="outline" className={statusClass(r.status)}>{statusLabel(r.status)}</Badge>,
    },
  ];

  const detailEditable = detailRow?.status === 'PENDING_INSPECTION' && canMove;
  const detailAcknowledge = detailRow?.status === 'INSPECTED' && canMove;

  return (
    <>
      <ModuleListPage
        title="Goods Receiving"
        description="Register deliveries, inspect accepted quantities, then post stock on acknowledgement"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search receipts, suppliers or references..."
        statusKey="status"
        createLabel="Register Delivery"
        onCreate={canMove ? openCreate : undefined}
        onRowClick={(r) => setDetailId(r.id)}
        rowActions={(r) => (
          r.status === 'PENDING_INSPECTION' && canMove
            ? <Button size="sm" variant="outline" onClick={() => setDetailId(r.id)}><ClipboardCheck className="mr-1.5 h-4 w-4" /> Inspect</Button>
            : r.status === 'INSPECTED' && canMove
              ? <Button size="sm" variant="outline" onClick={() => setDetailId(r.id)}><ShieldCheck className="mr-1.5 h-4 w-4" /> Acknowledge</Button>
              : null
        )}
        emptyMessage="No goods receipts yet"
        emptyDescription="Register a delivery to start the inspection and acknowledgement workflow."
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Register Delivery</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Receiving warehouse *</Label>
                <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}{w.is_default ? ' (default)' : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Received date</Label>
                <Input type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Supplier</Label>
                <Input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} placeholder="Supplier / vendor name" />
              </div>
              <div className="space-y-1.5">
                <Label>PO / Waybill reference</Label>
                <Input value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} placeholder="PO-0007 / WB-2210" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Waybill / delivery note</Label>
                <input
                  ref={waybillRef}
                  type="file"
                  accept={INVENTORY_DOCUMENT_ACCEPT}
                  className="hidden"
                  onChange={(e) => setWaybillFile(e.target.files?.[0] || null)}
                />
                <Button type="button" variant="outline" className="w-full justify-start" onClick={() => waybillRef.current?.click()}>
                  <Upload className="mr-1.5 h-4 w-4" /> {waybillFile ? waybillFile.name : 'Choose waybill'}
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label>PO document</Label>
                <input
                  ref={poFileRef}
                  type="file"
                  accept={INVENTORY_DOCUMENT_ACCEPT}
                  className="hidden"
                  onChange={(e) => setPoFile(e.target.files?.[0] || null)}
                />
                <Button type="button" variant="outline" className="w-full justify-start" onClick={() => poFileRef.current?.click()}>
                  <Upload className="mr-1.5 h-4 w-4" /> {poFile ? poFile.name : 'Choose PO attachment'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                PDF, image, Excel, CSV or Word document up to 20 MB. Documents stay attached to the goods receipt.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Delivered items</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { item_id: '', quantity: '' }])}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add line
                </Button>
              </div>
              {lines.map((l, idx) => (
                <div key={idx} className="flex items-start gap-2 rounded-lg border border-border p-3">
                  <div className="flex-1">
                    <Select value={l.item_id || undefined} onValueChange={(v) => {
                      const next = [...lines]; next[idx] = { ...next[idx], item_id: v }; setLines(next);
                    }}>
                      <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>
                        {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}{i.sku ? ` · ${i.sku}` : ''}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-32"
                    placeholder="Delivered qty"
                    value={l.quantity}
                    onChange={(e) => { const next = [...lines]; next[idx] = { ...next[idx], quantity: e.target.value }; setLines(next); }}
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, i) => i !== idx))} disabled={lines.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Stock is not posted until the inspection is completed and the receipt is acknowledged.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={saving}>{saving ? 'Registering...' : 'Register Delivery'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detailRow?.receipt_number || 'Goods Receipt'}
              {detailRow && <Badge variant="outline" className={statusClass(detailRow.status)}>{statusLabel(detailRow.status)}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p>Warehouse: <span className="font-medium">{detailRow.warehouse?.name || '—'}</span></p>
                <p>Received: <span className="font-medium">{fmtDate(detailRow.received_date)}</span></p>
                <p>Supplier: <span className="font-medium">{detailRow.supplier_name || '—'}</span></p>
                <p>Reference: <span className="font-medium">{detailRow.source_reference || '—'}</span></p>
                <p>Received by: <span className="font-medium">{employeeName(detailRow.received_by_employee)}</span></p>
                {detailRow.inspected_at && <p>Inspected: <span className="font-medium">{fmtDate(detailRow.inspected_at)}</span></p>}
                {detailRow.acknowledged_at && <p>Acknowledged: <span className="font-medium">{fmtDate(detailRow.acknowledged_at)}</span></p>}
              </div>

              {(detailRow.delivery_note_url || detailRow.po_document_url || detailRow.mri_document_url) && (
                <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  {detailRow.delivery_note_url && (
                    <a className="flex items-center gap-1.5 text-primary underline" href={detailRow.delivery_note_url} target="_blank" rel="noreferrer">
                      <FileText className="h-4 w-4" /> Waybill
                    </a>
                  )}
                  {detailRow.po_document_url && (
                    <a className="flex items-center gap-1.5 text-primary underline" href={detailRow.po_document_url} target="_blank" rel="noreferrer">
                      <FileText className="h-4 w-4" /> PO document
                    </a>
                  )}
                  {detailRow.mri_document_url && (
                    <a className="flex items-center gap-1.5 text-primary underline" href={detailRow.mri_document_url} target="_blank" rel="noreferrer">
                      <FileText className="h-4 w-4" /> MRI report
                    </a>
                  )}
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Delivered</th>
                      <th className="px-3 py-2">Accepted</th>
                      <th className="px-3 py-2">Rejected</th>
                      <th className="px-3 py-2">Verdict / Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detailLines.map((line) => {
                      const row = inspection[line.item_id];
                      return (
                        <tr key={line.id} className="align-top">
                          <td className="px-3 py-2">
                            <p className="font-medium">{line.item?.name || '—'}</p>
                            <p className="text-xs text-muted-foreground">{line.item?.sku || ''} {line.item?.uom || ''}</p>
                            {line.inspection_comment && <p className="mt-1 text-xs text-muted-foreground">{line.inspection_comment}</p>}
                          </td>
                          <td className="px-3 py-2">{fmtQty(line.delivered_qty)} {line.item?.uom}</td>
                          {detailEditable ? (
                            <>
                              <td className="px-3 py-2">
                                <Input
                                  type="number"
                                  min={0}
                                  max={Number(line.delivered_qty)}
                                  step="0.01"
                                  className="w-24"
                                  value={row?.accepted_qty ?? ''}
                                  onChange={(e) => setInspection({ ...inspection, [line.item_id]: { ...row, accepted_qty: e.target.value } })}
                                />
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {fmtQty(Math.max(0, Number(line.delivered_qty) - Number(row?.accepted_qty || 0)))}
                              </td>
                              <td className="px-3 py-2">
                                <div className="space-y-1.5">
                                  <Select value={row?.verdict || 'CONFORMING'} onValueChange={(v) => setInspection({ ...inspection, [line.item_id]: { ...row, verdict: v } })}>
                                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {RECEIPT_VERDICTS.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  <Select value={row?.outcome || 'ACCEPTED'} onValueChange={(v) => setInspection({ ...inspection, [line.item_id]: { ...row, outcome: v } })}>
                                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {RECEIPT_OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2">{line.accepted_qty != null ? fmtQty(line.accepted_qty) : '—'}</td>
                              <td className="px-3 py-2">{line.rejected_qty != null ? fmtQty(line.rejected_qty) : '—'}</td>
                              <td className="px-3 py-2">
                                <p>{line.verdict ? RECEIPT_VERDICTS.find((v) => v.value === line.verdict)?.label || line.verdict : '—'}</p>
                                <p className="text-xs text-muted-foreground">{line.outcome ? RECEIPT_OUTCOMES.find((o) => o.value === line.outcome)?.label || line.outcome : ''}</p>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {detailEditable && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>MRI / inspection report</Label>
                    <input
                      ref={mriFileRef}
                      type="file"
                      accept={INVENTORY_DOCUMENT_ACCEPT}
                      className="hidden"
                      onChange={(e) => setMriFile(e.target.files?.[0] || null)}
                    />
                    <Button type="button" variant="outline" className="w-full justify-start sm:w-auto" onClick={() => mriFileRef.current?.click()}>
                      <Upload className="mr-1.5 h-4 w-4" /> {mriFile ? mriFile.name : 'Attach MRI report'}
                    </Button>
                    <p className="text-xs text-muted-foreground">Optional. Upload the inspection report before completing the inspection.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Inspection remarks</Label>
                    <Textarea rows={2} value={inspectionRemarks} onChange={(e) => setInspectionRemarks(e.target.value)} placeholder="Optional notes about the inspection (MRI reference, discrepancies, etc.)" />
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5" /> Every line must be inspected before acknowledgement.
                    </p>
                  </div>
                </div>
              )}

              {detailRow.status === 'INSPECTED' && (
                <div className="space-y-1.5">
                  <Label>Acknowledgement remarks</Label>
                  <Textarea rows={2} value={ackRemarks} onChange={(e) => setAckRemarks(e.target.value)} placeholder="Optional acknowledgement notes" />
                  <p className="text-xs text-muted-foreground">
                    Acknowledging posts the accepted quantities to the warehouse stock ledger. Rejected quantities are not posted.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {detailEditable && (
              <Button onClick={submitInspection} disabled={working}>{working ? 'Saving...' : 'Complete Inspection'}</Button>
            )}
            {detailAcknowledge && (
              <Button onClick={submitAcknowledgement} disabled={working}>
                <ShieldCheck className="mr-1.5 h-4 w-4" /> {working ? 'Posting...' : 'Acknowledge & Post Stock'}
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
