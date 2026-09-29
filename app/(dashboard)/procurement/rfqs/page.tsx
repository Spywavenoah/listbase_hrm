'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Send, CheckCircle, Clock, XCircle, Factory, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { refNumber, procStatusClass, CURRENCIES } from '@/lib/procurement';

interface RFQVendor { vendor_id: string; responded: boolean }

interface RFQ {
  id: string;
  rfq_number: string;
  requisition_id: string | null;
  title: string;
  description: string | null;
  issue_date: string;
  deadline: string | null;
  currency: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface Vendor { id: string; name: string }
interface Requisition { id: string; req_number: string; purpose: string | null }

export default function RfqsPage() {
  const [rows, setRows] = useState<RFQ[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [rfqVendors, setRfqVendors] = useState<Record<string, RFQVendor[]>>({});
  const [vendorLookup, setVendorLookup] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingRfq, setEditingRfq] = useState<RFQ | null>(null);
  const [detail, setDetail] = useState<RFQ | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    requisition_id: '',
    title: '',
    description: '',
    deadline: '',
    currency: 'USD',
    selectedVendors: [] as string[],
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, vRes, rRes, rvRes] = await Promise.all([
        supabase.from('procurement_rfqs').select('*').order('created_at', { ascending: false }),
        supabase.from('procurement_vendors').select('id, name').eq('is_active', true).order('name'),
        supabase.from('procurement_requisitions').select('id, req_number, purpose').eq('status', 'APPROVED').order('created_at', { ascending: false }),
        supabase.from('procurement_rfq_vendors').select('rfq_id, vendor_id, responded'),
      ]);
      setRows((fRes.data || []) as unknown as RFQ[]);
      setVendors(vRes.data || []);
      setRequisitions((rRes.data || []) as unknown as Requisition[]);
      const vl: Record<string, string> = {};
      for (const v of (vRes.data || [])) vl[v.id] = v.name;
      setVendorLookup(vl);
      const grouped: Record<string, RFQVendor[]> = {};
      for (const row of (rvRes.data || []) as Record<string, unknown>[]) {
        (grouped[row.rfq_id as string] = grouped[row.rfq_id as string] || []).push({
          vendor_id: row.vendor_id as string,
          responded: Boolean(row.responded),
        });
      }
      setRfqVendors(grouped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleVendor = (vid: string) => {
    setForm((f) => ({
      ...f,
      selectedVendors: f.selectedVendors.includes(vid)
        ? f.selectedVendors.filter((x) => x !== vid)
        : [...f.selectedVendors, vid],
    }));
  };

  const resetForm = () => {
    setForm({ requisition_id: '', title: '', description: '', deadline: '', currency: 'USD', selectedVendors: [] });
  };

  const openEdit = (row: RFQ) => {
    setEditingRfq(row);
    setForm({
      requisition_id: row.requisition_id || '',
      title: row.title,
      description: row.description || '',
      deadline: row.deadline || '',
      currency: row.currency,
      selectedVendors: (rfqVendors[row.id] || []).map((v) => v.vendor_id),
    });
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setEditingRfq(null);
  };

  const handleCreate = async () => {
    if (!form.title || form.selectedVendors.length === 0) {
      toast.error('Provide a title and invite at least one vendor');
      return;
    }
    setSaving(true);
    try {
      if (editingRfq) {
        const { error } = await supabase.from('procurement_rfqs').update({
          requisition_id: form.requisition_id || null,
          title: form.title,
          description: form.description || null,
          deadline: form.deadline || null,
          currency: form.currency,
        }).eq('id', editingRfq.id);
        if (error) throw error;
        const { error: de } = await supabase.from('procurement_rfq_vendors').delete().eq('rfq_id', editingRfq.id);
        if (de) throw de;
        const { error: ve } = await supabase.from('procurement_rfq_vendors').insert(
          form.selectedVendors.map((vid) => ({ rfq_id: editingRfq.id, vendor_id: vid }))
        );
        if (ve) throw ve;
        toast.success('RFQ updated');
      } else {
        const number = refNumber('RFQ');
        const { data, error } = await supabase.from('procurement_rfqs').insert({
          rfq_number: number,
          requisition_id: form.requisition_id || null,
          title: form.title,
          description: form.description || null,
          deadline: form.deadline || null,
          currency: form.currency,
          status: 'DRAFT',
        }).select().single();
        if (error) throw error;
        const rfq = data as unknown as RFQ;
        const { error: ve } = await supabase.from('procurement_rfq_vendors').insert(
          form.selectedVendors.map((vid) => ({ rfq_id: rfq.id, vendor_id: vid }))
        );
        if (ve) throw ve;
        toast.success('RFQ created');
      }
      closeCreate();
      resetForm();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const publishRfq = async (row: RFQ) => {
    try {
      const { error } = await supabase.from('procurement_rfqs').update({ status: 'OPEN' }).eq('id', row.id);
      if (error) throw error;
      const invited = (rfqVendors[row.id] || []).map((v) => vendorLookup[v.vendor_id]).filter(Boolean).join(', ');
      toast.success(`RFQ published — invited: ${invited || 'no vendors'}`);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const closeRfq = async (row: RFQ) => {
    try {
      const { error } = await supabase.from('procurement_rfqs').update({ status: 'CLOSED' }).eq('id', row.id);
      if (error) throw error;
      toast.success('RFQ closed');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const reqNumber = (id: string | null) => {
    const req = requisitions.find((x) => x.id === id);
    return req ? req.req_number : null;
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total RFQs', value: rows.length, icon: Send, color: 'primary' },
    { label: 'Draft', value: rows.filter((r) => r.status === 'DRAFT').length, icon: Factory, color: 'info' },
    { label: 'Open', value: rows.filter((r) => r.status === 'OPEN').length, icon: Clock, color: 'warning' },
    { label: 'Closed', value: rows.filter((r) => r.status === 'CLOSED').length, icon: CheckCircle, color: 'success' },
  ];

  const columns: Column<RFQ>[] = [
    { key: 'rfq_number', label: 'RFQ #', render: (r) => <span className="font-medium">{r.rfq_number}</span> },
    { key: 'title', label: 'Title' },
    {
      key: 'requisition_id', label: 'Requisition', render: (r) => {
        const num = reqNumber(r.requisition_id);
        return num ? <span className="font-mono text-xs">{num}</span> : '—';
      },
      searchText: (r) => [reqNumber(r.requisition_id) || ''],
    },
    { key: 'deadline', label: 'Deadline', render: (r) => r.deadline || '—' },
    {
      key: 'responded', label: 'Responded', render: (r) => {
        const vs = rfqVendors[r.id] || [];
        const n = vs.filter((x) => x.responded).length;
        return `${n}/${vs.length}`;
      },
    },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={procStatusClass(r.status)}>{r.status}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Requests for Quotation"
        description="Invite suppliers to quote for approved requisitions"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search RFQs..."
        statusKey="status"
        createLabel="New RFQ"
        onCreate={() => { setEditingRfq(null); resetForm(); setCreateOpen(true); }}
        rowActions={(r) => (
          <div className="flex items-center gap-1">
            {r.status === 'DRAFT' && (
              <>
                <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => publishRfq(r)}>Publish</Button>
              </>
            )}
            {r.status === 'OPEN' && (
              <Button size="sm" variant="ghost" onClick={() => closeRfq(r)}>Close</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
              <Eye className="mr-1 h-3.5 w-3.5" /> View
            </Button>
          </div>
        )}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) closeCreate(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingRfq ? `Edit RFQ — ${editingRfq.rfq_number}` : 'New Request for Quotation'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Office laptops Q4" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Linked Requisition</Label>
                <Select value={form.requisition_id} onValueChange={(v) => setForm({ ...form, requisition_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select requisition (optional)" /></SelectTrigger>
                  <SelectContent>
                    {requisitions.map((r) => <SelectItem key={r.id} value={r.id}>{r.req_number} — {r.purpose || ''}</SelectItem>)}
                  </SelectContent>
                </Select>
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
            <div className="space-y-1.5">
              <Label>Deadline</Label>
              <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Invite Vendors *</Label>
              {vendors.length === 0 && <p className="text-xs text-muted-foreground">No active vendors yet. Add vendors first.</p>}
              <div className="grid gap-2 max-h-56 overflow-y-auto">
                {vendors.map((v) => (
                  <label key={v.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2.5 hover:bg-accent/50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={form.selectedVendors.includes(v.id)}
                      onChange={() => toggleVendor(v.id)}
                    />
                    <span className="text-sm">{v.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title || form.selectedVendors.length === 0}>
              {saving ? 'Saving...' : editingRfq ? 'Save Changes' : 'Create RFQ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.rfq_number} — {detail?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{detail?.description || 'No description.'}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={detail ? procStatusClass(detail.status) : ''}>{detail?.status}</Badge>
              {detail?.deadline && <Badge variant="outline">Deadline: {detail.deadline}</Badge>}
              <Badge variant="outline">Currency: {detail?.currency}</Badge>
            </div>
            <div>
              <p className="mb-1.5 font-medium">Invited Vendors</p>
              {(rfqVendors[detail?.id || ''] || []).length === 0 ? (
                <p className="text-muted-foreground">No vendors invited.</p>
              ) : (
                <ul className="space-y-1">
                  {(rfqVendors[detail?.id || ''] || []).map((v) => (
                    <li key={v.vendor_id} className="flex items-center justify-between rounded-lg border border-border p-2">
                      <span>{vendorLookup[v.vendor_id] || 'Unknown vendor'}</span>
                      {v.responded ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {detail?.status === 'DRAFT' && (
              <Button size="sm" onClick={() => { if (detail) publishRfq(detail); }}>
                Publish RFQ
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}