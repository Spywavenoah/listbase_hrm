'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Wallet, CheckCircle, Clock, XCircle, Send, Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { refNumber, fmtMoney, procStatusClass } from '@/lib/procurement';
import { startWorkflow } from '@/lib/workflow/engine';
import { useAccess } from '@/lib/access';

interface Payment {
  id: string;
  payment_ref: string;
  invoice_id: string;
  requested_by: string | null;
  request_date: string;
  amount: number;
  currency: string;
  payment_method: string | null;
  status: string;
  payment_reference: string | null;
  paid_at: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  vendor_id: string;
  currency: string;
  total: number;
  paid_amount: number;
  status: string;
}
interface Vendor { id: string; name: string }
interface EmployeeInfo { id: string; name: string }

const METHODS = ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'MONNIFY', 'STANDING_ORDER'];

export default function PaymentsPage() {
  const { employee } = useAccess();
  const [rows, setRows] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [payOpen, setPayOpen] = useState<Payment | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    invoice_id: '',
    payment_method: 'BANK_TRANSFER',
    amount: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, iRes, vRes, empRes] = await Promise.all([
        supabase.from('procurement_payment_requests').select('*').order('created_at', { ascending: false }),
        supabase.from('procurement_invoices').select('id, invoice_number, vendor_id, currency, total, paid_amount, status').in('status', ['APPROVED', 'PARTIALLY_PAID', 'PENDING_APPROVAL']).order('created_at', { ascending: false }),
        supabase.from('procurement_vendors').select('id, name'),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      setRows((pRes.data || []) as unknown as Payment[]);
      setInvoices(iRes.data || []);
      setVendors(vRes.data || []);
      const names: Record<string, string> = {};
      for (const e of (empRes.data || []) as EmployeeInfo[]) names[e.id] = e.name;
      setEmployeeNames(names);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const invoiceLabel = (id: string) => invoices.find((i) => i.id === id)?.invoice_number || '—';
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name || '—';
  const invoiceVendor = (invoiceId: string) => {
    const i = invoices.find((x) => x.id === invoiceId);
    return i ? vendorName(i.vendor_id) : '—';
  };
  const remaining = (invoiceId: string) => {
    const i = invoices.find((x) => x.id === invoiceId);
    return i ? Math.max(0, Number(i.total) - Number(i.paid_amount || 0)) : 0;
  };

  const resetForm = () => {
    setForm({ invoice_id: '', payment_method: 'BANK_TRANSFER', amount: '', notes: '' });
  };

  const handleCreate = async () => {
    if (!form.invoice_id) {
      toast.error('Select an invoice to pay');
      return;
    }
    setSaving(true);
    try {
      const inv = invoices.find((i) => i.id === form.invoice_id);
      if (!inv) return;
      const remainingAmt = remaining(inv.id);
      if (remainingAmt <= 0) {
        toast.error('This invoice is already fully paid');
        return;
      }
      const amount = form.amount === '' ? remainingAmt : Number(form.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > remainingAmt + 0.001) {
        toast.error('Amount must be greater than 0 and no more than the remaining balance');
        return;
      }
      const { data: existing } = await supabase
        .from('procurement_payment_requests')
        .select('id')
        .eq('invoice_id', inv.id)
        .in('status', ['PENDING_APPROVAL', 'APPROVED']);
      if (existing && existing.length > 0) {
        toast.error('A payment request is already pending or approved for this invoice');
        return;
      }
      const paymentRef = refNumber('PAY');
      const { error } = await supabase.from('procurement_payment_requests').insert({
        payment_ref: paymentRef,
        invoice_id: inv.id,
        requested_by: employee?.id || null,
        request_date: new Date().toISOString().split('T')[0],
        amount,
        currency: inv.currency,
        payment_method: form.payment_method,
        status: 'PENDING_APPROVAL',
        notes: form.notes || null,
      });
      if (error) throw error;
      const { data: pr } = await supabase.from('procurement_payment_requests').select('id').eq('payment_ref', paymentRef).single();
      if (pr) await startWorkflow('procurement.payment', (pr as { id: string }).id, employee?.id);
      toast.success(`Payment request ${paymentRef} created for approval`);
      setCreateOpen(false);
      resetForm();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const recordPayment = async (payment: Payment) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('procurement_payment_requests').update({
        status: 'PAID',
        payment_reference: paymentReference || null,
        paid_at: new Date().toISOString(),
      }).eq('id', payment.id);
      if (error) throw error;
      const inv = invoices.find((i) => i.id === payment.invoice_id);
      if (inv) {
        const newPaid = Number(inv.paid_amount || 0) + Number(payment.amount);
        await supabase.from('procurement_invoices')
          .update({
            paid_amount: newPaid,
            status: newPaid >= Number(inv.total) - 0.001 ? 'PAID' : 'PARTIALLY_PAID',
          })
          .eq('id', inv.id);
      }
      toast.success('Payment recorded');
      setPayOpen(null);
      setPaymentReference('');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Payment Requests', value: rows.length, icon: Wallet, color: 'primary' },
    { label: 'Pending Approval', value: rows.filter((r) => r.status === 'PENDING_APPROVAL').length, icon: Clock, color: 'warning' },
    { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length, icon: CheckCircle, color: 'success' },
    { label: 'Paid', value: rows.filter((r) => r.status === 'PAID').length, icon: Banknote, color: 'success' },
  ];

  const columns: Column<Payment>[] = [
    { key: 'payment_ref', label: 'Reference', render: (r) => <span className="font-medium">{r.payment_ref}</span> },
    { key: 'invoice_id', label: 'Invoice', render: (r) => <span className="font-mono text-xs">{invoiceLabel(r.invoice_id)}</span>, searchText: (r) => [invoiceLabel(r.invoice_id)] },
    { key: 'vendor', label: 'Vendor', render: (r) => invoiceVendor(r.invoice_id), searchText: (r) => [invoiceVendor(r.invoice_id)] },
    { key: 'amount', label: 'Amount', render: (r) => <span className="font-medium">{fmtMoney(r.amount, r.currency)}</span> },
    { key: 'requested_by', label: 'Requested By', render: (r) => (r.requested_by ? employeeNames[r.requested_by] || '—' : '—') },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={procStatusClass(r.status)}>{r.status.replace(/_/g, ' ')}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Payment Requests"
        description="Request and approve supplier payments against approved invoices"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search payments..."
        statusKey="status"
        createLabel="New Payment Request"
        onCreate={() => { resetForm(); setCreateOpen(true); }}
        rowActions={(r) =>
          r.status === 'APPROVED' && (
            <Button size="sm" variant="ghost" onClick={() => { setPayOpen(r); setPaymentReference(''); }}>
              <Banknote className="mr-1 h-3.5 w-3.5" /> Record Payment
            </Button>
          )
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Payment Request</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Invoice *</Label>
              <Select value={form.invoice_id} onValueChange={(v) => setForm({ ...form, invoice_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select approved invoice" /></SelectTrigger>
                <SelectContent>
                  {invoices.filter((i) => remaining(i.id) > 0).map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.invoice_number} — {vendorName(i.vendor_id)} · {fmtMoney(i.total - (i.paid_amount || 0), i.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {invoices.filter((i) => remaining(i.id) > 0).length === 0 && (
                <p className="text-xs text-muted-foreground">No invoices with an outstanding balance.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Full remaining balance by default"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
              {form.invoice_id && (
                <p className="text-xs text-muted-foreground">
                  Remaining balance: {fmtMoney(remaining(form.invoice_id), invoices.find((i) => i.id === form.invoice_id)?.currency)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.invoice_id}>
              <Send className="mr-1 h-4 w-4" /> Submit for Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payOpen} onOpenChange={(o) => { if (!o) setPayOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment — {payOpen?.payment_ref}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-border p-3 text-sm">
              <p>Invoice: {payOpen ? invoiceLabel(payOpen.invoice_id) : ''}</p>
              <p>Vendor: {payOpen ? invoiceVendor(payOpen.invoice_id) : ''}</p>
              <p className="font-medium mt-1">Amount: {payOpen ? fmtMoney(payOpen.amount, payOpen.currency) : ''}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Payment Reference</Label>
              <Input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="e.g. bank confirmation or Monnify reference" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(null)}>Close</Button>
            <Button onClick={() => payOpen && recordPayment(payOpen)} disabled={saving}>
              {saving ? 'Recording...' : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}