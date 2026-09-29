'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Receipt, CheckCircle, Clock, XCircle, Send } from 'lucide-react';
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

interface Invoice {
  id: string;
  invoice_number: string;
  supplier_invoice_ref: string;
  vendor_id: string;
  po_id: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  status: string;
  match_status: string;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
}

interface Vendor { id: string; name: string }
interface PO { id: string; po_number: string; vendor_id: string | null; status: string; currency: string; total: number }
interface POItem { id: string; purchase_order_id: string; item_name: string; quantity: number; accepted_qty: number; unit_price: number; uom: string }
interface InvoiceItem {
  id: string;
  invoice_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export default function InvoicesPage() {
  const { employee } = useAccess();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [itemsByInvoice, setItemsByInvoice] = useState<Record<string, InvoiceItem[]>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    vendor_id: '',
    po_id: '',
    supplier_invoice_ref: '',
    invoice_date: '',
    due_date: '',
    currency: 'USD',
    tax_rate: 0,
    notes: '',
  });
  const [items, setItems] = useState<LineItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [iRes, vRes, pRes, piRes, iiRes] = await Promise.all([
        supabase.from('procurement_invoices').select('*').order('created_at', { ascending: false }),
        supabase.from('procurement_vendors').select('id, name').order('name'),
        supabase.from('purchase_orders').select('id, po_number, vendor_id, status, currency, total').in('status', ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED']).order('created_at', { ascending: false }),
        supabase.from('purchase_order_items').select('id, purchase_order_id, item_name, quantity, accepted_qty, unit_price, uom').order('created_at', { ascending: true }),
        supabase.from('procurement_invoice_items').select('*'),
      ]);
      setRows((iRes.data || []) as unknown as Invoice[]);
      setVendors(vRes.data || []);
      setPos(pRes.data || []);
      setPoItems((piRes.data || []) as unknown as POItem[]);
      const grouped: Record<string, InvoiceItem[]> = {};
      for (const it of (iiRes.data || []) as unknown as InvoiceItem[]) {
        (grouped[it.invoice_id] = grouped[it.invoice_id] || []).push(it);
      }
      setItemsByInvoice(grouped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name || '—';
  const poNumber = (id: string | null) => pos.find((p) => p.id === id)?.po_number || '—';

  const resetForm = () => {
    setForm({ vendor_id: '', po_id: '', supplier_invoice_ref: '', invoice_date: '', due_date: '', currency: 'USD', tax_rate: 0, notes: '' });
    setItems([]);
  };

  const handleVendorChange = (vid: string) => setForm((f) => ({ ...f, vendor_id: vid }));

  const handlePoChange = (pid: string) => {
    const po = pos.find((p) => p.id === pid);
    setForm((f) => ({
      ...f,
      po_id: pid,
      vendor_id: po && po.vendor_id ? po.vendor_id : f.vendor_id,
    }));
    const poi = poItems.filter((p) => p.purchase_order_id === pid);
    if (poi.length > 0) {
      setItems(poi.map((p) => ({
        id: `poi-${p.id}`,
        item_name: p.item_name,
        quantity: Number(p.accepted_qty) || 0,
        uom: p.uom,
        unit_price: Number(p.unit_price),
        total: Number(((Number(p.accepted_qty) || 0) * Number(p.unit_price)).toFixed(2)),
      })));
    } else {
      setItems([]);
    }
  };

  const totals = (list: LineItem[]) => {
    const subtotal = list.reduce((s, i) => s + Number(i.total || 0), 0);
    const tax = Number(((Number(form.tax_rate) / 100) * subtotal).toFixed(2));
    return { subtotal, tax, total: subtotal + tax };
  };

  const handleCreate = async () => {
    if (!form.vendor_id || !form.supplier_invoice_ref || items.length === 0 || items.some((i) => !i.item_name)) {
      toast.error('Fill vendor, supplier invoice ref, and at least one item');
      return;
    }
    setSaving(true);
    try {
      const { subtotal, tax, total } = totals(items);
      const linkedPo = form.po_id ? pos.find((p) => p.id === form.po_id) : null;
      const match = linkedPo
        ? Math.abs(Number(total) - Number(linkedPo.total)) <= 0.01 * Number(linkedPo.total || 0)
          ? 'MATCHED'
          : 'DISCREPANCY'
        : 'MATCHED';
      const invNumber = refNumber('INV');
      const { data, error } = await supabase.from('procurement_invoices').insert({
        invoice_number: invNumber,
        supplier_invoice_ref: form.supplier_invoice_ref,
        vendor_id: form.vendor_id,
        po_id: form.po_id || null,
        invoice_date: form.invoice_date || null,
        due_date: form.due_date || null,
        currency: form.currency,
        subtotal: Number(subtotal.toFixed(2)),
        tax_rate: Number(form.tax_rate || 0),
        tax_amount: Number(tax.toFixed(2)),
        total: Number(total.toFixed(2)),
        status: 'VERIFIED',
        match_status: match,
        notes: form.notes || null,
        created_by: employee?.id || null,
      }).select().single();
      if (error) throw error;
      const inv = data as unknown as Invoice;
      const itemRows = items.map((i) => ({
        invoice_id: inv.id,
        item_name: i.item_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total: Number((Number(i.quantity) * Number(i.unit_price)).toFixed(2)),
      }));
      const { error: ie } = await supabase.from('procurement_invoice_items').insert(itemRows);
      if (ie) throw ie;
      toast.success(match === 'DISCREPANCY'
        ? `Invoice registered with a MATCH DISCREPANCY vs PO total`
        : 'Invoice registered');
      setCreateOpen(false);
      resetForm();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitInvoice = async (inv: Invoice) => {
    const previousStatus = inv.status === 'REJECTED' ? 'VERIFIED' : inv.status;
    try {
      const { error } = await supabase.from('procurement_invoices')
        .update({ status: 'PENDING_APPROVAL' })
        .eq('id', inv.id);
      if (error) throw error;
      const instanceId = await startWorkflow('procurement.invoice', inv.id, employee?.id);
      if (!instanceId) {
        await supabase.from('procurement_invoices')
          .update({ status: previousStatus })
          .eq('id', inv.id);
        toast.warning('No approval workflow is enabled for invoices — request returned to previous status');
        load();
        return;
      }
      toast.success('Invoice submitted for approval');
      load();
    } catch (err) {
      await supabase.from('procurement_invoices')
        .update({ status: previousStatus })
        .eq('id', inv.id);
      toast.error('Failed: ' + (err as Error).message);
      load();
    }
  };

  const markPaid = async (inv: Invoice) => {
    try {
      const { error } = await supabase.from('procurement_invoices').update({
        status: 'PAID',
        paid_amount: Number(inv.total),
      }).eq('id', inv.id);
      if (error) throw error;
      toast.success('Invoice marked as paid');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const rejectInvoice = async (inv: Invoice) => {
    try {
      const { error } = await supabase.from('procurement_invoices').update({ status: 'REJECTED' }).eq('id', inv.id);
      if (error) throw error;
      toast.success('Invoice rejected');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Invoices', value: rows.length, icon: Receipt, color: 'primary' },
    { label: 'Pending Approval', value: rows.filter((r) => r.status === 'PENDING_APPROVAL').length, icon: Clock, color: 'warning' },
    { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED' || r.status === 'PARTIALLY_PAID').length, icon: CheckCircle, color: 'success' },
    { label: 'Rejected', value: rows.filter((r) => r.status === 'REJECTED').length, icon: XCircle, color: 'destructive' },
  ];

  const columns: Column<Invoice>[] = [
    { key: 'invoice_number', label: 'Invoice', render: (r) => <span className="font-medium">{r.invoice_number}</span> },
    { key: 'supplier_invoice_ref', label: 'Supplier Ref', render: (r) => <span className="font-mono text-xs">{r.supplier_invoice_ref}</span> },
    { key: 'vendor_id', label: 'Vendor', render: (r) => vendorName(r.vendor_id), searchText: (r) => [vendorName(r.vendor_id)] },
    { key: 'po_id', label: 'PO', render: (r) => <span className="font-mono text-xs">{poNumber(r.po_id)}</span>, searchText: (r) => [poNumber(r.po_id)] },
    { key: 'total', label: 'Total', render: (r) => <span className="font-medium">{fmtMoney(r.total, r.currency)}</span> },
    { key: 'match_status', label: 'Match', render: (r) => <Badge variant="outline" className={procStatusClass(r.match_status)}>{r.match_status.replace(/_/g, ' ')}</Badge> },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={procStatusClass(r.status)}>{r.status.replace(/_/g, ' ')}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Supplier Invoices"
        description="Register, verify and approve supplier invoices for payment"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search invoices..."
        statusKey="status"
        onRowClick={(r) => { setDetailId(r.id); setDetailOpen(true); }}
        createLabel="Register Invoice"
        onCreate={() => { resetForm(); setCreateOpen(true); }}
        rowActions={(r) => (
          <div className="flex items-center gap-1">
            {(r.status === 'VERIFIED' || r.status === 'REGISTERED' || r.status === 'REJECTED') && (
              <Button size="sm" variant="ghost" onClick={() => submitInvoice(r)}>
                <Send className="mr-1 h-3.5 w-3.5" /> {r.status === 'REJECTED' ? 'Resubmit' : 'Submit'}
              </Button>
            )}
            {r.status === 'APPROVED' && (
              <Button size="sm" variant="ghost" onClick={() => markPaid(r)}>
                <CheckCircle className="mr-1 h-3.5 w-3.5" /> Mark Paid
              </Button>
            )}
            {(r.status === 'VERIFIED' || r.status === 'REGISTERED' || r.status === 'PENDING_APPROVAL') && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => rejectInvoice(r)}>
                <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
              </Button>
            )}
          </div>
        )}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Register Supplier Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Vendor *</Label>
                <Select value={form.vendor_id} onValueChange={handleVendorChange}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Purchase Order</Label>
                <Select value={form.po_id} onValueChange={handlePoChange} disabled={!form.vendor_id}>
                  <SelectTrigger><SelectValue placeholder={form.vendor_id ? 'Select PO (optional)' : 'Select a vendor first'} /></SelectTrigger>
                  <SelectContent>
                    {pos.filter((p) => p.vendor_id === form.vendor_id).map((p) => <SelectItem key={p.id} value={p.id}>{p.po_number} — {fmtMoney(p.total, p.currency)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {form.vendor_id && pos.filter((p) => p.vendor_id === form.vendor_id).length === 0 && (
                  <p className="text-xs text-muted-foreground">No active POs from this vendor.</p>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Supplier Invoice Ref *</Label>
                <Input value={form.supplier_invoice_ref} onChange={(e) => setForm({ ...form, supplier_invoice_ref: e.target.value })} />
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
                <Label>Invoice Date</Label>
                <Input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
            </div>

            <LineItemsEditor items={items} onChange={setItems} showUom={false} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tax rate (%)</Label>
                <Input type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5 self-end">
                {items.length > 0 && (
                  <p className="text-sm font-medium">
                    Subtotal {fmtMoney(totals(items).subtotal, form.currency)} · Total {fmtMoney(totals(items).total, form.currency)}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <p className="flex gap-1.5 text-xs text-muted-foreground">
              <CheckCircle className="h-3.5 w-3.5" />
              Compares the invoice total against the linked PO total (1% tolerance) and flags a match discrepancy.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.vendor_id || !form.supplier_invoice_ref || items.length === 0 || items.some((i) => !i.item_name)}>
              {saving ? 'Registering...' : 'Register Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailId ? rows.find((r) => r.id === detailId)?.invoice_number || 'Invoice' : 'Invoice'}
            </DialogTitle>
          </DialogHeader>
          {detailId && (() => {
            const inv = rows.find((r) => r.id === detailId);
            if (!inv) return null;
            const its = itemsByInvoice[inv.id] || [];
            const outstanding = Math.max(0, Number(inv.total) - Number(inv.paid_amount || 0));
            const due = inv.due_date ? new Date(inv.due_date) : null;
            const overdue = due && due.getTime() < Date.now() && outstanding > 0;
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={procStatusClass(inv.status)}>{inv.status.replace(/_/g, ' ')}</Badge>
                  <Badge variant="outline" className={procStatusClass(inv.match_status)}>{inv.match_status.replace(/_/g, ' ')}</Badge>
                  <Badge variant="outline">Vendor: {vendorName(inv.vendor_id)}</Badge>
                  <Badge variant="outline">PO: {poNumber(inv.po_id)}</Badge>
                  <Badge variant="outline">Currency: {inv.currency}</Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <p>Supplier ref: <span className="font-medium">{inv.supplier_invoice_ref}</span></p>
                  <p>Invoice date: <span className="font-medium">{inv.invoice_date || '—'}</span></p>
                  <p>
                    Due date:{' '}
                    <span className={overdue ? 'font-medium text-destructive' : 'font-medium'}>
                      {inv.due_date || '—'}{overdue ? ' (overdue)' : ''}
                    </span>
                  </p>
                  <p>Created: <span className="font-medium">{inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}</span></p>
                </div>
                {inv.notes && <p className="text-sm text-muted-foreground">{inv.notes}</p>}
                {its.length === 0 && <p className="text-sm text-muted-foreground">No line items on this invoice.</p>}
                {its.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                    <p className="text-sm font-medium truncate">{it.item_name}</p>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium">{fmtMoney(it.total, inv.currency)}</p>
                      <p className="text-xs text-muted-foreground">{it.quantity} × {fmtMoney(it.unit_price, inv.currency)}</p>
                    </div>
                  </div>
                ))}
                <div className="space-y-1 border-t border-border pt-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{fmtMoney(inv.subtotal, inv.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax ({Number(inv.tax_rate) || 0}%)</span>
                    <span>{fmtMoney(inv.tax_amount, inv.currency)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Total</span>
                    <span>{fmtMoney(inv.total, inv.currency)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Paid</span>
                    <span>{fmtMoney(inv.paid_amount || 0, inv.currency)}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Outstanding</span>
                    <span className={overdue ? 'text-destructive' : ''}>{fmtMoney(outstanding, inv.currency)}</span>
                  </div>
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