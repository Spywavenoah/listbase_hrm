'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Factory, CheckCircle, XCircle, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface Vendor {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  address: string | null;
  is_active: boolean;
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [quoteCounts, setQuoteCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState({
    name: '',
    contact_person: '',
    email: '',
    phone: '',
    tax_id: '',
    address: '',
    is_active: true,
  });

  const load = useCallback(async () => {
    try {
      const [vRes, qRes] = await Promise.all([
        supabase.from('procurement_vendors').select('*').order('created_at', { ascending: false }),
        supabase.from('procurement_quotations').select('vendor_id'),
      ]);
      setVendors((vRes.data || []) as unknown as Vendor[]);
      const counts: Record<string, number> = {};
      for (const q of (qRes.data || []) as { vendor_id: string }[]) {
        counts[q.vendor_id] = (counts[q.vendor_id] || 0) + 1;
      }
      setQuoteCounts(counts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ name: '', contact_person: '', email: '', phone: '', tax_id: '', address: '', is_active: true });
    setEditing(null);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (v: Vendor) => {
    setEditing(v);
    setForm({
      name: v.name,
      contact_person: v.contact_person || '',
      email: v.email || '',
      phone: v.phone || '',
      tax_id: v.tax_id || '',
      address: v.address || '',
      is_active: v.is_active,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name) {
      toast.error('Vendor name is required');
      return;
    }
    try {
      const payload = {
        name: form.name,
        contact_person: form.contact_person || null,
        email: form.email || null,
        phone: form.phone || null,
        tax_id: form.tax_id || null,
        address: form.address || null,
        is_active: form.is_active,
      };
      const { error } = editing
        ? await supabase.from('procurement_vendors').update(payload).eq('id', editing.id)
        : await supabase.from('procurement_vendors').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Vendor updated' : 'Vendor added');
      setOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const toggleActive = async (v: Vendor) => {
    try {
      const { error } = await supabase
        .from('procurement_vendors')
        .update({ is_active: !v.is_active })
        .eq('id', v.id);
      if (error) throw error;
      toast.success(v.is_active ? 'Vendor deactivated' : 'Vendor activated');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Vendors', value: vendors.length, icon: Factory, color: 'primary' },
    { label: 'Active', value: vendors.filter((v) => v.is_active).length, icon: CheckCircle, color: 'success' },
    { label: 'Inactive', value: vendors.filter((v) => !v.is_active).length, icon: XCircle, color: 'destructive' },
    { label: 'Quotes Submitted', value: Object.values(quoteCounts).reduce((s, n) => s + n, 0), icon: FileText, color: 'info' },
  ];

  const columns: Column<Vendor>[] = [
    { key: 'name', label: 'Vendor', render: (v) => <span className="font-medium">{v.name}</span> },
    { key: 'contact_person', label: 'Contact', render: (v) => v.contact_person || '—' },
    { key: 'email', label: 'Email', render: (v) => v.email || '—' },
    { key: 'phone', label: 'Phone', render: (v) => v.phone || '—' },
    {
      key: 'is_active', label: 'Status',
      render: (v) => v.is_active
        ? <Badge variant="outline" className="bg-success/10 text-success">Active</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Vendors"
        description="Manage supplier and vendor master records"
        summaryCards={summaryCards}
        columns={columns}
        data={vendors}
        loading={loading}
        searchPlaceholder="Search vendors..."
        createLabel="Add Vendor"
        onCreate={openCreate}
        onEdit={openEdit}
        onDelete={async (v) => {
          try {
            const { error } = await supabase.from('procurement_vendors').delete().eq('id', v.id);
            if (error) throw error;
            toast.success('Vendor deleted');
            load();
          } catch (err) {
            toast.error('Failed: ' + (err as Error).message);
          }
        }}
        rowActions={(v) => (
          <Button size="sm" variant="ghost" onClick={() => toggleActive(v)}>
            {v.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        )}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Vendor Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Supplies Ltd" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Contact Person</Label>
                <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Tax ID</Label>
                <Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <span className="text-sm text-muted-foreground">Active vendor</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name}>{editing ? 'Save Changes' : 'Add Vendor'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}