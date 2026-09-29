'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Award, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Certification {
  id: string;
  employee_id: string;
  title: string;
  issuing_body: string | null;
  reference_no: string | null;
  issued_at: string | null;
  expiry_date: string | null;
  document_url: string | null;
}

type CertStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY';

function certStatus(expiry: string | null): CertStatus {
  if (!expiry) return 'NO_EXPIRY';
  const exp = new Date(expiry + 'T00:00:00');
  const now = new Date();
  if (exp < now) return 'EXPIRED';
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return exp <= soon ? 'EXPIRING_SOON' : 'ACTIVE';
}

const statusMeta: Record<CertStatus, { label: string; cls: string }> = {
  ACTIVE: { label: 'Active', cls: 'bg-success/10 text-success' },
  EXPIRING_SOON: { label: 'Expiring Soon', cls: 'bg-warning/10 text-warning' },
  EXPIRED: { label: 'Expired', cls: 'bg-destructive/10 text-destructive' },
  NO_EXPIRY: { label: 'No Expiry', cls: 'bg-muted text-muted-foreground' },
};

export default function CertificationsPage() {
  const [certs, setCerts] = useState<Certification[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    employee_id: '', title: '', issuing_body: '', reference_no: '', issued_at: '', expiry_date: '', document_url: '',
  });

  const load = useCallback(async () => {
    try {
      const [cRes, empRes] = await Promise.all([
        supabase.from('employee_certifications').select('*').order('created_at', { ascending: false }),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE'),
      ]);
      setCerts((cRes.data || []) as unknown as Certification[]);
      setEmployees(empRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('employee_certifications').insert({
        employee_id: form.employee_id,
        title: form.title,
        issuing_body: form.issuing_body || null,
        reference_no: form.reference_no || null,
        issued_at: form.issued_at || null,
        expiry_date: form.expiry_date || null,
        document_url: form.document_url || null,
      });
      if (error) throw error;
      toast.success('Certification recorded');
      setCreateOpen(false);
      setForm({ employee_id: '', title: '', issuing_body: '', reference_no: '', issued_at: '', expiry_date: '', document_url: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const empName = (id: string) => {
    const e = employees.find((e) => e.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };

  const counts = {
    ACTIVE: certs.filter((c) => certStatus(c.expiry_date) === 'ACTIVE').length,
    EXPIRING_SOON: certs.filter((c) => certStatus(c.expiry_date) === 'EXPIRING_SOON').length,
    EXPIRED: certs.filter((c) => certStatus(c.expiry_date) === 'EXPIRED').length,
    NO_EXPIRY: certs.filter((c) => certStatus(c.expiry_date) === 'NO_EXPIRY').length,
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Certs', value: certs.length, icon: Award, color: 'primary' },
    { label: 'Active', value: counts.ACTIVE, icon: CheckCircle, color: 'success' },
    { label: 'Expiring Soon', value: counts.EXPIRING_SOON, icon: AlertTriangle, color: 'warning' },
    { label: 'Expired', value: counts.EXPIRED, icon: XCircle, color: 'destructive' },
  ];

  const columns: Column<Certification>[] = [
    { key: 'employee', label: 'Employee', render: (c) => empName(c.employee_id) },
    { key: 'title', label: 'Certification' },
    { key: 'issuing_body', label: 'Issuing Body', render: (c) => c.issuing_body || '—' },
    { key: 'reference_no', label: 'Ref No', render: (c) => c.reference_no || '—' },
    { key: 'issued_at', label: 'Issued', render: (c) => c.issued_at || '—' },
    { key: 'expiry_date', label: 'Expires', render: (c) => c.expiry_date || '—' },
    {
      key: 'status', label: 'Status',
      render: (c) => {
        const s = certStatus(c.expiry_date);
        return <Badge variant="outline" className={statusMeta[s].cls}>{statusMeta[s].label}</Badge>;
      },
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Certifications"
        description="Track professional certifications, licensure, and document expiry"
        summaryCards={summaryCards}
        columns={columns}
        data={certs}
        searchPlaceholder="Search certifications..."
        createLabel="Record Certification"
        onCreate={() => setCreateOpen(true)}
        rowActions={(c) => (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-destructive"
            onClick={async () => {
              await supabase.from('employee_certifications').delete().eq('id', c.id);
              toast.success('Certification removed');
              load();
            }}
          >
            Delete
          </Button>
        )}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Certification</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Certification Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="AWS Solutions Architect" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Issuing Body</Label>
                <Input value={form.issuing_body} onChange={(e) => setForm({ ...form, issuing_body: e.target.value })} placeholder="AWS" />
              </div>
              <div className="space-y-1.5">
                <Label>Reference No.</Label>
                <Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Issued Date</Label>
                <Input type="date" value={form.issued_at} onChange={(e) => setForm({ ...form, issued_at: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Date</Label>
                <Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Document URL</Label>
              <Input value={form.document_url} onChange={(e) => setForm({ ...form, document_url: e.target.value })} placeholder="https://drive.google.com/..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.employee_id || !form.title}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}