'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { FileCheck2, Trophy, Star, X } from 'lucide-react';
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

interface Quote {
  id: string;
  quote_ref: string;
  rfq_id: string | null;
  vendor_id: string;
  submitted_at: string | null;
  valid_until: string | null;
  currency: string;
  payment_terms: string | null;
  lead_time_days: number | null;
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  delivery_cost: number;
  total: number;
  status: string;
  notes: string | null;
  version: number;
}

interface RFQ { id: string; rfq_number: string; title: string; status: string }
interface Vendor { id: string; name: string }
interface Criterion { id: string; name: string; weight: number; is_active: boolean }
interface Evaluation { quotation_id: string; evaluator_id: string; criterion_id: string; score: number }

export default function QuotationsPage() {
  const [rows, setRows] = useState<Quote[]>([]);
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [scoreByQuote, setScoreByQuote] = useState<Record<string, Evaluation[]>>({});
  const [itemsByQuote, setItemsByQuote] = useState<Record<string, LineItem[]>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [evaluate, setEvaluate] = useState<Quote | null>(null);
  const [detailQuote, setDetailQuote] = useState<Quote | null>(null);
  const [evalScores, setEvalScores] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    rfq_id: '',
    vendor_id: '',
    valid_until: '',
    currency: 'USD',
    payment_terms: '',
    lead_time_days: '',
    tax_rate: 0,
    discount: 0,
    delivery_cost: 0,
    notes: '',
  });
  const [items, setItems] = useState<LineItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, fRes, vRes, cRes, eRes, iRes] = await Promise.all([
        supabase.from('procurement_quotations').select('*').order('created_at', { ascending: false }),
        supabase.from('procurement_rfqs').select('id, rfq_number, title, status').in('status', ['OPEN', 'CLOSED']).order('created_at', { ascending: false }),
        supabase.from('procurement_vendors').select('id, name').eq('is_active', true).order('name'),
        supabase.from('procurement_evaluation_criteria').select('*').eq('is_active', true).order('name'),
        supabase.from('procurement_evaluations').select('*'),
        supabase.from('procurement_quotation_items').select('*').order('line_no', { ascending: true }),
      ]);
      setRows((qRes.data || []) as unknown as Quote[]);
      setRfqs(fRes.data || []);
      setVendors(vRes.data || []);
      setCriteria((cRes.data || []) as unknown as Criterion[]);
      const ev: Record<string, Evaluation[]> = {};
      for (const e of (eRes.data || []) as unknown as Evaluation[]) {
        (ev[e.quotation_id] = ev[e.quotation_id] || []).push(e);
      }
      setScoreByQuote(ev);
      const grouped: Record<string, LineItem[]> = {};
      for (const it of (iRes.data || []) as unknown as (LineItem & { quotation_id: string })[]) {
        (grouped[it.quotation_id] = grouped[it.quotation_id] || []).push(it);
      }
      setItemsByQuote(grouped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const weightedScore = (quoteId: string): number => {
    const evs = scoreByQuote[quoteId] || [];
    if (evs.length === 0) return 0;
    const totalWeight = criteria.reduce((s, c) => s + Number(c.weight), 0) || 1;
    const sum = evs.reduce((s, e) => {
      const c = criteria.find((x) => x.id === e.criterion_id);
      const w = c ? Number(c.weight) : 0;
      return s + Number(e.score) * w;
    }, 0);
    return Number((sum / totalWeight).toFixed(1));
  };

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name || '—';
  const rfqLabel = (id: string | null) => {
    const f = rfqs.find((x) => x.id === id);
    return f ? `${f.rfq_number}` : '—';
  };

  const resetForm = () => {
    setForm({ rfq_id: '', vendor_id: '', valid_until: '', currency: 'USD', payment_terms: '', lead_time_days: '', tax_rate: 0, discount: 0, delivery_cost: 0, notes: '' });
    setItems([]);
  };

  const totals = (list: LineItem[]) => {
    const subtotal = list.reduce((s, i) => s + Number(i.total || 0), 0);
    const tax = Number(((Number(form.tax_rate) / 100) * subtotal).toFixed(2));
    const total = subtotal - Number(form.discount || 0) + tax + Number(form.delivery_cost || 0);
    return { subtotal, tax, total };
  };

  const handleCreate = async () => {
    if (!form.vendor_id || items.length === 0 || items.some((i) => !i.item_name)) {
      toast.error('Select a vendor and add at least one item with a name');
      return;
    }
    setSaving(true);
    try {
      const { subtotal, tax, total } = totals(items);
      const ref = refNumber('QUO');
      const { data, error } = await supabase.from('procurement_quotations').insert({
        quote_ref: ref,
        rfq_id: form.rfq_id || null,
        vendor_id: form.vendor_id,
        valid_until: form.valid_until || null,
        currency: form.currency,
        payment_terms: form.payment_terms || null,
        lead_time_days: form.lead_time_days ? Number(form.lead_time_days) : null,
        subtotal: Number(subtotal.toFixed(2)),
        discount: Number(form.discount || 0),
        tax_rate: Number(form.tax_rate || 0),
        tax_amount: Number(tax.toFixed(2)),
        delivery_cost: Number(form.delivery_cost || 0),
        total: Number(total.toFixed(2)),
        status: 'SUBMITTED',
        notes: form.notes || null,
      }).select().single();
      if (error) throw error;
      const quote = data as unknown as Quote;
      const itemRows = items.map((i, idx) => ({
        quotation_id: quote.id,
        line_no: idx + 1,
        item_name: i.item_name,
        description: i.description || null,
        quantity: i.quantity,
        uom: i.uom,
        unit_price: i.unit_price,
        total: Number((Number(i.quantity) * Number(i.unit_price)).toFixed(2)),
      }));
      const { error: ie } = await supabase.from('procurement_quotation_items').insert(itemRows);
      if (ie) throw ie;
      if (form.rfq_id) {
        await supabase.from('procurement_rfq_vendors')
          .update({ responded: true })
          .eq('rfq_id', form.rfq_id)
          .eq('vendor_id', form.vendor_id);
      }
      toast.success('Quotation recorded');
      setCreateOpen(false);
      resetForm();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openEvaluate = (quote: Quote) => {
    setEvaluate(quote);
    const existing: Record<string, string> = {};
    for (const e of scoreByQuote[quote.id] || []) existing[e.criterion_id] = String(Number(e.score));
    setEvalScores(existing);
  };

  const saveEvaluation = async () => {
    if (!evaluate) return;
    setSaving(true);
    try {
      const evaluatorId = await supabase.rpc('current_employee_id').then((r) => r.data as string);
      for (const c of criteria) {
        const existing = (scoreByQuote[evaluate.id] || []).find((e) => e.criterion_id === c.id);
        const rawScore = evalScores[c.id];
        const score = rawScore === undefined || rawScore === null || String(rawScore).trim() === '' ? NaN : Number(rawScore);
        if (Number.isNaN(score)) {
          if (existing) {
            const { error } = await supabase.from('procurement_evaluations')
              .delete()
              .eq('quotation_id', evaluate.id)
              .eq('criterion_id', c.id);
            if (error) throw error;
          }
          continue;
        }
        if (existing) {
          const { error } = await supabase.from('procurement_evaluations')
            .update({ score })
            .eq('quotation_id', evaluate.id)
            .eq('criterion_id', c.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('procurement_evaluations').insert({
            quotation_id: evaluate.id,
            evaluator_id: evaluatorId,
            criterion_id: c.id,
            score,
          });
          if (error) throw error;
        }
      }
      toast.success('Evaluation saved');
      setEvaluate(null);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const selectWinner = async (quote: Quote) => {
    try {
      const { error } = await supabase.from('procurement_quotations')
        .update({ status: 'WINNER' })
        .eq('id', quote.id);
      if (error) throw error;
      await supabase.from('procurement_quotations')
        .update({ status: 'LOSER' })
        .neq('id', quote.id)
        .eq('rfq_id', quote.rfq_id || '');
      toast.success(`Supplier selected: ${vendorName(quote.vendor_id)}`);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Quotations', value: rows.length, icon: FileCheck2, color: 'primary' },
    { label: 'Submitted', value: rows.filter((r) => r.status === 'SUBMITTED').length, icon: FileCheck2, color: 'info' },
    { label: 'Winners', value: rows.filter((r) => r.status === 'WINNER').length, icon: Trophy, color: 'success' },
    { label: 'Needing Review', value: rows.filter((r) => (scoreByQuote[r.id] || []).length === 0 && r.status === 'SUBMITTED').length, icon: Star, color: 'warning' },
  ];

  const columns: Column<Quote>[] = [
    { key: 'quote_ref', label: 'Quote', render: (r) => <span className="font-medium">{r.quote_ref}</span> },
    { key: 'vendor_id', label: 'Vendor', render: (r) => vendorName(r.vendor_id), searchText: (r) => [vendorName(r.vendor_id)] },
    { key: 'rfq_id', label: 'RFQ', render: (r) => <span className="font-mono text-xs">{rfqLabel(r.rfq_id)}</span>, searchText: (r) => [rfqLabel(r.rfq_id)] },
    { key: 'total', label: 'Total', render: (r) => <span className="font-medium">{fmtMoney(r.total, r.currency)}</span> },
    {
      key: 'score', label: 'Score', render: (r) => {
        const s = weightedScore(r.id);
        return s > 0 ? <Badge variant="outline">{s}</Badge> : <span className="text-muted-foreground">—</span>;
      },
    },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={procStatusClass(r.status)}>{r.status}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Supplier Quotations"
        description="Record supplier responses and evaluate them"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search quotations..."
        statusKey="status"
        onRowClick={(r) => setDetailQuote(r)}
        createLabel="Record Quotation"
        onCreate={() => { resetForm(); setCreateOpen(true); }}
        rowActions={(r) => (
          <div className="flex items-center gap-1">
            {r.status !== 'WINNER' && (
              <Button size="sm" variant="ghost" onClick={() => openEvaluate(r)}>
                <Star className="mr-1 h-3.5 w-3.5" /> Score
              </Button>
            )}
            {(scoreByQuote[r.id] || []).length > 0 && r.status !== 'WINNER' && (
              <Button size="sm" variant="ghost" onClick={() => selectWinner(r)}>
                <Trophy className="mr-1 h-3.5 w-3.5" /> Select Winner
              </Button>
            )}
            {r.status === 'WINNER' && <Badge variant="outline" className="bg-success/10 text-success">Selected</Badge>}
          </div>
        )}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record Supplier Quotation</DialogTitle></DialogHeader>
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
                <Label>RFQ</Label>
                <Select value={form.rfq_id} onValueChange={(v) => setForm({ ...form, rfq_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select RFQ (optional)" /></SelectTrigger>
                  <SelectContent>
                    {rfqs.map((f) => <SelectItem key={f.id} value={f.id}>{f.rfq_number} — {f.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Valid Until</Label>
                <Input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Lead Time (days)</Label>
                <Input type="number" value={form.lead_time_days} onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })} />
              </div>
            </div>

            <LineItemsEditor items={items} onChange={setItems} priceLabel="Unit price" />

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Discount</Label>
                <Input type="number" step="0.01" value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Tax rate (%)</Label>
                <Input type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Delivery cost</Label>
                <Input type="number" step="0.01" value={form.delivery_cost} onChange={(e) => setForm({ ...form, delivery_cost: Number(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Payment terms</Label>
              <Input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} placeholder="e.g. Net 30" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {items.length > 0 && (
              <p className="text-right text-sm font-medium">
                Subtotal: {fmtMoney(totals(items).subtotal, form.currency)} · Tax: {fmtMoney(totals(items).tax, form.currency)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.vendor_id || items.length === 0 || items.some((i) => !i.item_name)}>
              {saving ? 'Saving...' : 'Record Quotation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!evaluate} onOpenChange={(o) => { if (!o && !saving) setEvaluate(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Evaluate — {evaluate ? vendorName(evaluate.vendor_id) : ''} ({evaluate?.quote_ref})</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {criteria.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No evaluation criteria defined. Add them in Procurement Settings first.
              </p>
            ) : (
              criteria.map((c) => (
                <div key={c.id} className="flex items-start gap-3">
                  <div className="flex-1">
                    <Label>{c.name} <span className="text-xs text-muted-foreground">(weight {c.weight})</span></Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder="Score 0–100"
                      value={evalScores[c.id] ?? ''}
                      onChange={(e) => setEvalScores({ ...evalScores, [c.id]: e.target.value })}
                    />
                  </div>
                  {evalScores[c.id] !== undefined && (
                    <Button size="icon" variant="ghost" className="mt-5 h-9 w-9 text-destructive" onClick={() => {
                      const next = { ...evalScores };
                      delete next[c.id];
                      setEvalScores(next);
                    }}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))
            )}
            {evaluate && weightedScore(evaluate.id) > 0 && (
              <p className="text-sm font-medium">Current weighted score: {weightedScore(evaluate.id)}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvaluate(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveEvaluation} disabled={saving || criteria.length === 0}>
              {saving ? 'Saving...' : 'Save Evaluation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailQuote} onOpenChange={(o) => { if (!o) setDetailQuote(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailQuote ? `${detailQuote.quote_ref} — ${vendorName(detailQuote.vendor_id)}` : 'Quotation'}
            </DialogTitle>
          </DialogHeader>
          {detailQuote && (() => {
            const q = detailQuote;
            const its = itemsByQuote[q.id] || [];
            const evs = scoreByQuote[q.id] || [];
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={procStatusClass(q.status)}>{q.status}</Badge>
                  <Badge variant="outline">RFQ: {rfqLabel(q.rfq_id)}</Badge>
                  <Badge variant="outline">Currency: {q.currency}</Badge>
                  {q.lead_time_days != null && <Badge variant="outline">Lead time: {q.lead_time_days} days</Badge>}
                  {q.valid_until && <Badge variant="outline">Valid until: {q.valid_until}</Badge>}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <p>Submitted: <span className="font-medium">{q.submitted_at ? new Date(q.submitted_at).toLocaleDateString() : '—'}</span></p>
                  <p>Payment terms: <span className="font-medium">{q.payment_terms || '—'}</span></p>
                </div>
                {q.notes && <p className="text-sm text-muted-foreground">{q.notes}</p>}
                {its.length === 0 && <p className="text-sm text-muted-foreground">No line items on this quotation.</p>}
                {its.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                    <p className="text-sm font-medium truncate">{it.item_name}</p>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium">{fmtMoney(it.total, q.currency)}</p>
                      <p className="text-xs text-muted-foreground">{it.quantity} {it.uom} × {fmtMoney(it.unit_price, q.currency)}</p>
                    </div>
                  </div>
                ))}
                <div className="space-y-1 border-t border-border pt-3 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtMoney(q.subtotal, q.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{fmtMoney(q.discount, q.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax ({Number(q.tax_rate) || 0}%)</span><span>{fmtMoney(q.tax_amount, q.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span>{fmtMoney(q.delivery_cost, q.currency)}</span></div>
                  <div className="flex justify-between font-bold"><span>Total</span><span>{fmtMoney(q.total, q.currency)}</span></div>
                </div>
                <div className="border-t border-border pt-3">
                  <p className="text-sm font-medium">Evaluation</p>
                  {evs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No scores recorded yet.</p>
                  ) : (
                    <div className="mt-2 space-y-1 text-sm">
                      {evs.map((e) => (
                        <div key={e.criterion_id} className="flex justify-between">
                          <span className="text-muted-foreground">{criteria.find((c) => c.id === e.criterion_id)?.name || 'Criterion'}</span>
                          <span>{e.score}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-border pt-2 font-medium">
                        <span>Weighted score</span>
                        <span>{weightedScore(q.id)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailQuote(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}