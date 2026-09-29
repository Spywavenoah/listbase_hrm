'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { FileText, CalendarClock, CalendarX, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { refNumber, fmtMoney, procStatusClass, CURRENCIES } from '@/lib/procurement';
import { useAccess } from '@/lib/access';

interface Contract {
  id: string;
  contract_ref: string;
  vendor_id: string;
  po_id: string | null;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  value: number;
  currency: string;
  payment_terms: string | null;
  status: string;
  renewal_reminder_enabled: boolean;
  notes: string | null;
  created_at: string;
}

interface Vendor { id: string; name: string }
interface PO { id: string; po_number: string }

export default function ContractsPage() {
  const { employee } = useAccess();
  const [rows, setRows] = useState<Contract[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    vendor_id: '',
    po_id: '',
    title: '',
    description: '',
    start_date: '',
    end_date: '',
    value: '',
    currency: 'USD',
    payment_terms: '',
    renewal_reminder_enabled: true,
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, vRes, pRes] = await Promise.all([
        supabase.from('procurement_contracts').select('*').order('created_at', { ascending: false }),
        supabase.from('procurement_vendors').select('id, name').order('name'),
        supabase.from('purchase_orders').select('id, po_number').order('created_at', { ascending: false }),
      ]);
      setRows((cRes.data || []) as unknown as Contract[]);
      setVendors(vRes.data || []);
      setPos(pRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name || '—';
  const poLabel = (id: string | null) => pos.find((p) => p.id === id)?.po_number || '—';

  const derivedStatus = (c: Contract): string => {
    if (c.status === 'TERMINATED' || c.status === 'EXPIRED' || c.status === 'CLOSED') return c.status;
    if (c.end_date && new Date(c.end_date) < new Date()) return 'EXPIRED';
    if (c.start_date && new Date(c.start_date) > new Date()) return 'DRAFT';
    return 'ACTIVE';
  };

  const daysToExpiry = (c: Contract): number | null => {
    if (!c.end_date) return null;
    return Math.ceil((new Date(c.end_date).getTime() - Date.now()) / 86400000);
  };

  const resetForm = () => {
    setForm({ vendor_id: '', po_id: '', title: '', description: '', start_date: '', end_date: '', value: '', currency: 'USD', payment_terms: '', renewal_reminder_enabled: true, notes: '' });
  };

  const handleCreate = async () => {
    if (!form.vendor_id || !form.title) {
      toast.error('Vendor and title are required');
      return;
    }
    setSaving(true);
    try {
      const storedStatus =
        form.end_date && new Date(form.end_date) < new Date()
          ? 'EXPIRED'
          : form.start_date && new Date(form.start_date) > new Date()
            ? 'DRAFT'
            : 'ACTIVE';
      const { error } = await supabase.from('procurement_contracts').insert({
        contract_ref: refNumber('CT'),
        vendor_id: form.vendor_id,
        po_id: form.po_id || null,
        title: form.title,
        description: form.description || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        value: Number(form.value || 0),
        currency: form.currency,
        payment_terms: form.payment_terms || null,
        status: storedStatus,
        renewal_reminder_enabled: form.renewal_reminder_enabled,
        notes: form.notes || null,
        created_by: employee?.id || null,
      });
      if (error) throw error;
      toast.success('Contract created');
      setCreateOpen(false);
      resetForm();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (c: Contract, status: string) => {
    try {
      const { error } = await supabase.from('procurement_contracts').update({ status }).eq('id', c.id);
      if (error) throw error;
      toast.success(`Contract marked ${status.replace(/_/g, ' ')}`);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Contracts', value: rows.length, icon: FileText, color: 'primary' },
    { label: 'Active', value: rows.filter((c) => derivedStatus(c) === 'ACTIVE').length, icon: CheckCircle2, color: 'success' },
    { label: 'Expiring ≤ 30d', value: rows.filter((c) => derivedStatus(c) === 'ACTIVE' && daysToExpiry(c) !== null && daysToExpiry(c)! <= 30).length, icon: AlertTriangle, color: 'warning' },
    { label: 'Expired', value: rows.filter((c) => derivedStatus(c) === 'EXPIRED').length, icon: CalendarX, color: 'destructive' },
  ];

  const columns: Column<Contract>[] = [
    { key: 'contract_ref', label: 'Ref', render: (r) => <span className="font-medium">{r.contract_ref}</span> },
    { key: 'title', label: 'Title' },
    { key: 'vendor_id', label: 'Vendor', render: (r) => vendorName(r.vendor_id), searchText: (r) => [vendorName(r.vendor_id)] },
    { key: 'value', label: 'Value', render: (r) => <span className="font-medium">{fmtMoney(r.value, r.currency)}</span> },
    {
      key: 'renewal_reminder_enabled', label: 'Renewal Reminder', render: (r) => r.renewal_reminder_enabled
        ? <Badge variant="outline" className="bg-success/10 text-success">On</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Off</Badge>,
    },
    {
      key: 'end_date', label: 'Expiry', render: (r) => {
        if (!r.end_date) return '—';
        const d = daysToExpiry(r);
        const color = d !== null && d <= 30 ? 'text-destructive' : '';
        return <span className={color}>{r.end_date}</span>;
      },
    },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={procStatusClass(derivedStatus(r))}>{derivedStatus(r).replace(/_/g, ' ')}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Supplier Contracts"
        description="Track supplier agreements, renewal dates and values"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search contracts..."
        statusKey="status"
        statusValue={derivedStatus}
        createLabel="New Contract"
        onCreate={() => { resetForm(); setCreateOpen(true); }}
        rowActions={(r) => (
          <div className="flex items-center gap-1">
            {derivedStatus(r) === 'ACTIVE' && r.status !== 'TERMINATED' && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setStatus(r, 'TERMINATED')}>Terminate</Button>
            )}
            {derivedStatus(r) === 'ACTIVE' && (
              <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'CLOSED')}>Close</Button>
            )}
            {derivedStatus(r) === 'EXPIRED' && (
              <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'ACTIVE')}>Re-open</Button>
            )}
          </div>
        )}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Supplier Contract</DialogTitle></DialogHeader>
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
                <Label>Linked PO</Label>
                <Select value={form.po_id} onValueChange={(v) => setForm({ ...form, po_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select PO (optional)" /></SelectTrigger>
                  <SelectContent>
                    {pos.map((p) => <SelectItem key={p.id} value={p.id}>{p.po_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. SaaS platform license — annual" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Value</Label>
                <Input type="number" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
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
                <Label>Payment Terms</Label>
                <Input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} placeholder="e.g. Net 30" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.renewal_reminder_enabled}
                onCheckedChange={(v) => setForm({ ...form, renewal_reminder_enabled: v })}
              />
              <span className="text-sm text-muted-foreground">Send renewal reminder before expiry</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.vendor_id || !form.title}>
              {saving ? 'Creating...' : 'Create Contract'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rows.filter((c) => derivedStatus(c) === 'ACTIVE' && daysToExpiry(c) !== null && daysToExpiry(c)! <= 30).length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          <CalendarClock className="h-4 w-4" />
          {rows.filter((c) => derivedStatus(c) === 'ACTIVE' && daysToExpiry(c) !== null && daysToExpiry(c)! <= 30).length} active contract(s) expire within the next 30 days — renew soon.
        </div>
      )}
    </>
  );
}