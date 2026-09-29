'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Coins, CheckCircle, Clock, XCircle, Receipt } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { startWorkflow } from '@/lib/workflow/engine';
import { useAccess } from '@/lib/access';
import { enqueueAndProcess } from '@/lib/notifications';

interface Encashment {
  id: string;
  employee_id: string;
  leave_type_id: string;
  days: number;
  rate_per_day: number;
  estimated_amount: number;
  reason: string | null;
  requested_by: string | null;
  status: string;
  approved_at: string | null;
  created_at: string;
}

interface LeaveType { id: string; name: string; encashable: boolean; encashment_rate_per_day: number }

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-destructive/10 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground line-through',
};

export default function LeaveEncashmentsPage() {
  const { employee } = useAccess();
  const [rows, setRows] = useState<Encashment[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quoted, setQuoted] = useState<LeaveType | null>(null);
  const [form, setForm] = useState({ leave_type_id: '', days: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, tRes, empRes] = await Promise.all([
        supabase.from('leave_encashment_requests').select('*').order('created_at', { ascending: false }),
        supabase.from('leave_types').select('id, name, encashable, encashment_rate_per_day').eq('is_active', true).order('name'),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      setRows((rRes.data || []) as unknown as Encashment[]);
      setTypes((tRes.data || []) as unknown as LeaveType[]);
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

  const employeeName = (id: string | null) => (id ? employeeNames[id] || 'You' : 'You');
  const typeName = (id: string) => types.find((t) => t.id === id)?.name || '—';

  const selectedType = () => types.find((t) => t.id === form.leave_type_id) || null;
  const quoteAmount = () => {
    const t = selectedType();
    return t ? (Number(form.days) || 0) * (t.encashment_rate_per_day || 0) : 0;
  };

  const handleCreate = async () => {
    const t = selectedType();
    if (!t || !form.days || Number(form.days) <= 0) {
      toast.error('Select an encashable leave type and a positive number of days');
      return;
    }
    if (!t.encashable) {
      toast.error('This leave type does not allow encashment');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.from('leave_encashment_requests').insert({
        employee_id: employee?.id,
        leave_type_id: form.leave_type_id,
        days: Number(form.days),
        rate_per_day: t.encashment_rate_per_day,
        reason: form.reason || null,
        requested_by: employee?.id,
        status: 'SUBMITTED',
      }).select().single();
      if (error) throw error;
      const row = data as unknown as Encashment;
      const instanceId = await startWorkflow('leave.encashment', row.id, row.requested_by || employee?.id);
      if (!instanceId) {
        await supabase.from('leave_encashment_requests').update({ status: 'SUBMITTED' }).eq('id', row.id);
        toast.warning('No approval workflow enabled — request stays submitted');
      } else {
        toast.success('Encashment request submitted for approval');
      }
      await enqueueAndProcess({
        eventKey: 'leave.encashment_submitted',
        recipientEmail: employee?.email || '',
        recipientName: employee ? `${employee.first_name} ${employee.last_name}` : '',
        subject: 'Leave encashment request submitted',
        bodyHtml: `<p>Hi ${employee?.first_name || ''},</p><p>Your encashment request for <strong>${Number(form.days)} days</strong> of ${typeName(form.leave_type_id)} was submitted for approval.</p>`,
        metadata: { leave_type: typeName(form.leave_type_id), days: String(Number(form.days)), amount: String(quoteAmount()) },
      });
      setCreateOpen(false);
      setForm({ leave_type_id: '', days: '', reason: '' });
      setQuoted(null);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cancelRequest = async (row: Encashment) => {
    try {
      const { error } = await supabase.from('leave_encashment_requests').update({ status: 'CANCELLED' }).eq('id', row.id);
      if (error) throw error;
      toast.success('Request cancelled');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Requests', value: rows.length, icon: Receipt, color: 'primary' },
    { label: 'Submitted', value: rows.filter((r) => r.status === 'SUBMITTED').length, icon: Clock, color: 'warning' },
    { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length, icon: CheckCircle, color: 'success' },
    { label: 'Rejected', value: rows.filter((r) => r.status === 'REJECTED').length, icon: XCircle, color: 'destructive' },
  ];

  const columns: Column<Encashment>[] = [
    { key: 'employee_id', label: 'Employee', render: (r) => employeeName(r.employee_id), searchText: (r) => [employeeName(r.employee_id)] },
    { key: 'leave_type_id', label: 'Leave Type', render: (r) => typeName(r.leave_type_id) },
    { key: 'days', label: 'Days', render: (r) => <span className="font-medium">{r.days}</span> },
    { key: 'rate_per_day', label: 'Rate/Day', render: (r) => <span className="font-medium">${Number(r.rate_per_day).toLocaleString()}</span> },
    { key: 'estimated_amount', label: 'Est. Payout', render: (r) => <span className="font-bold">${Number(r.estimated_amount).toLocaleString()}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={STATUS_COLORS[r.status] || ''}>{r.status}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Leave Encashment"
        description="Payout unused leave days for eligible types"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search requests..."
        statusKey="status"
        createLabel="New Request"
        onCreate={() => setCreateOpen(true)}
        rowActions={(r) =>
          r.status === 'SUBMITTED' ? (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancelRequest(r)}>Cancel</Button>
          ) : null
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Encashment Request</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Leave Type</Label>
              <Select value={form.leave_type_id} onValueChange={(v) => { setForm({ ...form, leave_type_id: v }); setQuoted(types.find((t) => t.id === v) || null); }}>
                <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
                <SelectContent>
                  {types.filter((t) => t.encashable).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} — ${t.encashment_rate_per_day}/day</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Number of Days</Label>
              <Input type="number" min={1} step="0.5" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder="e.g. 5" />
            </div>
            {quoted && Number(form.days) > 0 && (
              <p className="rounded-lg bg-primary/5 p-3 text-sm">
                Estimated payout: <span className="font-bold text-primary">${quoteAmount().toLocaleString()}</span>
                <span className="text-muted-foreground"> ({form.days} days × ${quoted.encashment_rate_per_day}/day)</span>
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} placeholder="Optional justification" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.leave_type_id || !form.days || Number(form.days) <= 0}>
              {saving ? 'Submitting...' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}