'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { ShieldCheck, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
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

interface Inspection {
  id: string;
  inspection_number: string;
  receipt_id: string;
  inspector_id: string | null;
  inspection_date: string;
  result: string;
  notes: string | null;
  created_at: string;
}

interface InspectionItem {
  id: string;
  inspection_id: string;
  receipt_item_id: string | null;
  item_name: string;
  inspected_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  criteria: string | null;
  result: string;
}

interface Receipt {
  id: string;
  receipt_number: string;
  po_id: string;
  received_by: string | null;
}
interface ReceiptItem {
  id: string;
  receipt_id: string;
  po_item_id: string | null;
  item_name: string;
  quantity_accepted: number;
  quantity_rejected: number;
  rejection_reason: string | null;
}
interface PO { id: string; po_number: string }
interface POItem {
  id: string;
  purchase_order_id: string;
  receipt_item_id?: string;
  accepted_qty: number;
  rejected_qty: number;
  received_qty: number;
}

export default function InspectionsPage() {
  const { employee } = useAccess();
  const [rows, setRows] = useState<Inspection[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState('');
  const [inspectionDate, setInspectionDate] = useState('');
  const [lines, setLines] = useState<Record<string, { accepted: number; rejected: number; criteria: string }>>({});
  const [result, setResult] = useState('PASS');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [iRes, rRes, riRes, pRes, piRes, empRes] = await Promise.all([
        supabase.from('procurement_inspections').select('*').order('created_at', { ascending: false }),
        supabase.from('procurement_receipts').select('id, receipt_number, po_id, received_by').order('created_at', { ascending: false }),
        supabase.from('procurement_receipt_items').select('id, receipt_id, po_item_id, item_name, quantity_accepted, quantity_rejected, rejection_reason'),
        supabase.from('purchase_orders').select('id, po_number'),
        supabase.from('purchase_order_items').select('id, purchase_order_id, accepted_qty, rejected_qty, received_qty'),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      setRows((iRes.data || []) as unknown as Inspection[]);
      setReceipts(rRes.data || []);
      setReceiptItems((riRes.data || []) as unknown as ReceiptItem[]);
      setPos(pRes.data || []);
      setPoItems((piRes.data || []) as unknown as POItem[]);
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

  const receiptLabel = (id: string) => receipts.find((r) => r.id === id)?.receipt_number || '—';
  const poOf = (receiptId: string) => {
    const r = receipts.find((x) => x.id === receiptId);
    const po = pos.find((p) => p.id === r?.po_id);
    return po ? po.po_number : '—';
  };

  const openCreate = (receiptId: string) => {
    setSelectedReceiptId(receiptId);
    setInspectionDate(new Date().toISOString().split('T')[0]);
    setResult('PASS');
    setNotes('');
    const l: Record<string, { accepted: number; rejected: number; criteria: string }> = {};
    for (const it of receiptItems.filter((r) => r.receipt_id === receiptId)) {
      l[it.id] = { accepted: Number(it.quantity_accepted) || 0, rejected: 0, criteria: '' };
    }
    setLines(l);
    setCreateOpen(true);
  };

  const handleSave = async () => {
    if (!selectedReceiptId) return;
    const receiptLines = receiptItems.filter((r) => r.receipt_id === selectedReceiptId);
    const invalid = receiptLines.some((rit) => {
      const l = lines[rit.id];
      if (!l) return false;
      const accepted = Number(l.accepted) || 0;
      const rejected = Number(l.rejected) || 0;
      const received = Number(rit.quantity_accepted) + Number(rit.quantity_rejected);
      return accepted < 0 || rejected < 0 || accepted + rejected > received;
    });
    if (invalid) {
      toast.error('Accepted + rejected quantities cannot exceed the received quantity for each item');
      return;
    }
    setSaving(true);
    try {
      const number = refNumber('INSP');
      const { data, error } = await supabase.from('procurement_inspections').insert({
        inspection_number: number,
        receipt_id: selectedReceiptId,
        inspector_id: employee?.id || null,
        inspection_date: inspectionDate || new Date().toISOString().split('T')[0],
        result,
        notes: notes || null,
      }).select().single();
      if (error) throw error;
      const inspection = data as unknown as Inspection;

      const itemRows: { inspection_id: string; receipt_item_id: string | null; item_name: string; inspected_qty: number; accepted_qty: number; rejected_qty: number; criteria: string | null; result: string }[] = [];
      const poItemById = new Map(poItems.map((p) => [p.id, p]));
      for (const rit of receiptLines) {
        const l = lines[rit.id];
        if (!l) continue;
        const accepted = Number(l.accepted) || 0;
        const rejected = Number(l.rejected) || 0;
        itemRows.push({
          inspection_id: inspection.id,
          receipt_item_id: rit.id,
          item_name: rit.item_name,
          inspected_qty: accepted + rejected,
          accepted_qty: accepted,
          rejected_qty: rejected,
          criteria: l.criteria || null,
          result: rejected > 0 ? 'FAIL' : result,
        });
        if (rit.po_item_id) {
          const poItem = poItemById.get(rit.po_item_id);
          if (poItem) {
            const deltaAcc = accepted - Number(rit.quantity_accepted);
            const deltaRej = rejected - Number(rit.quantity_rejected);
            if (deltaAcc !== 0 || deltaRej !== 0) {
              const { error: ue } = await supabase.from('purchase_order_items')
                .update({
                  accepted_qty: Math.max(0, Number(poItem.accepted_qty) + deltaAcc),
                  rejected_qty: Math.max(0, Number(poItem.rejected_qty) + deltaRej),
                })
                .eq('id', poItem.id);
              if (ue) throw ue;
            }
          }
        }
      }
      if (itemRows.length > 0) {
        const { error: ie } = await supabase.from('procurement_inspection_items').insert(itemRows);
        if (ie) throw ie;
      }
      toast.success(`Inspection ${number} recorded`);
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Inspections', value: rows.length, icon: ShieldCheck, color: 'primary' },
    { label: 'Passed', value: rows.filter((r) => r.result === 'PASS').length, icon: CheckCircle, color: 'success' },
    { label: 'Failed', value: rows.filter((r) => r.result === 'FAIL').length, icon: XCircle, color: 'destructive' },
    { label: 'Partial', value: rows.filter((r) => r.result === 'PARTIAL').length, icon: AlertTriangle, color: 'warning' },
  ];

  const columns: Column<Inspection>[] = [
    { key: 'inspection_number', label: 'Inspection', render: (r) => <span className="font-medium">{r.inspection_number}</span> },
    { key: 'receipt_id', label: 'Receipt', render: (r) => <span className="font-mono text-xs">{receiptLabel(r.receipt_id)}</span>, searchText: (r) => [receiptLabel(r.receipt_id)] },
    { key: 'po', label: 'PO', render: (r) => <span className="font-mono text-xs">{poOf(r.receipt_id)}</span>, searchText: (r) => [poOf(r.receipt_id)] },
    { key: 'inspection_date', label: 'Date' },
    { key: 'inspector_id', label: 'Inspector', render: (r) => (r.inspector_id ? employeeNames[r.inspector_id] || '—' : '—'), searchText: (r) => (r.inspector_id ? [employeeNames[r.inspector_id] || ''] : []) },
    { key: 'result', label: 'Result', render: (r) => <Badge variant="outline" className={procStatusClass(r.result)}>{r.result}</Badge> },
  ];

  const inspectable = (r: Receipt) => {
    const latest = rows.find((i) => i.receipt_id === r.id);
    return !latest || latest.result !== 'PASS';
  };

  const selectedLines = selectedReceiptId ? receiptItems.filter((r) => r.receipt_id === selectedReceiptId) : [];

  const receivedTotal = (rit: ReceiptItem) => Number(rit.quantity_accepted) + Number(rit.quantity_rejected);

  return (
    <>
      <ModuleListPage
        title="Quality Inspections"
        description="Inspect received goods and record quality results"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search inspections..."
        statusKey="result"
        toolbarActions={
          <Select value="" onValueChange={(v) => v && openCreate(v)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Inspect receipt..." />
            </SelectTrigger>
            <SelectContent>
              {receipts.filter(inspectable).map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.receipt_number} · {poOf(r.id)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        emptyMessage="No inspections yet"
        emptyDescription="Record an inspection against a goods receipt to start quality control."
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Inspect — {receiptLabel(selectedReceiptId)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Result</Label>
                <Select value={result} onValueChange={setResult}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PASS">Pass</SelectItem>
                    <SelectItem value="PARTIAL">Partial</SelectItem>
                    <SelectItem value="FAIL">Fail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Inspection Date</Label>
                <Input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Inspected Items</Label>
              {selectedLines.length === 0 && <p className="text-xs text-muted-foreground">No items on this receipt.</p>}
              {selectedLines.map((rit) => (
                <div key={rit.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{rit.item_name}</p>
                      <p className="text-xs text-muted-foreground">Received: {rit.quantity_accepted} accepted / {rit.quantity_rejected} rejected</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        type="number"
                        className="w-24"
                        placeholder="Accepted"
                        min={0}
                        max={receivedTotal(rit)}
                        value={lines[rit.id]?.accepted ?? ''}
                        onChange={(e) => setLines({
                          ...lines,
                          [rit.id]: {
                            ...lines[rit.id],
                            accepted: Math.min(Math.max(0, Number(e.target.value)), receivedTotal(rit)),
                            rejected: lines[rit.id]?.rejected || 0,
                            criteria: lines[rit.id]?.criteria || '',
                          },
                        })}
                      />
                      <Input
                        type="number"
                        className="w-24"
                        placeholder="Rejected"
                        min={0}
                        max={receivedTotal(rit)}
                        value={lines[rit.id]?.rejected ?? ''}
                        onChange={(e) => setLines({
                          ...lines,
                          [rit.id]: {
                            ...lines[rit.id],
                            rejected: Math.min(Math.max(0, Number(e.target.value)), receivedTotal(rit)),
                            accepted: lines[rit.id]?.accepted || 0,
                            criteria: lines[rit.id]?.criteria || '',
                          },
                        })}
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      className="flex-1"
                      placeholder="Inspection criteria / remarks"
                      value={lines[rit.id]?.criteria || ''}
                      onChange={(e) => setLines({ ...lines, [rit.id]: { ...lines[rit.id], criteria: e.target.value } })}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || selectedLines.length === 0}>
              {saving ? 'Saving...' : 'Save Inspection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}