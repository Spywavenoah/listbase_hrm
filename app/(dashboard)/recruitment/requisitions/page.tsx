'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { ClipboardList, CheckCircle, Clock, XCircle, UserPlus, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { startWorkflow, WORKFLOW_MODULE_LABELS } from '@/lib/workflow/engine';
import { useAccess } from '@/lib/access';

interface Requisition {
  id: string;
  title: string;
  department_id: string | null;
  position_id: string | null;
  headcount: number;
  employment_type: string;
  budget_min: number | null;
  budget_max: number | null;
  justification: string | null;
  requested_by: string | null;
  status: string;
  approved_at: string | null;
  created_at: string;
}

interface Department { id: string; name: string }
interface Position { id: string; title: string }

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'];

export default function RecruitmentRequisitionsPage() {
  const { employee } = useAccess();
  const [rows, setRows] = useState<Requisition[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingReq, setEditingReq] = useState<Requisition | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: '',
    department_id: '',
    position_id: '',
    headcount: 1,
    employment_type: 'FULL_TIME',
    budget_min: '',
    budget_max: '',
    justification: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, dRes, pRes, empRes] = await Promise.all([
        supabase.from('recruitment_requisitions').select('*').order('created_at', { ascending: false }),
        supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
        supabase.from('positions').select('id, title').eq('is_active', true).order('title'),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      setRows((rRes.data || []) as unknown as Requisition[]);
      setDepartments(dRes.data || []);
      setPositions((pRes.data || []).map((p) => ({ id: p.id, title: p.title })));
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

  const requesterName = (id: string | null) => (id ? employeeNames[id] || 'Unknown' : '—');

  const resetForm = () => {
    setForm({
      title: '',
      department_id: '',
      position_id: '',
      headcount: 1,
      employment_type: 'FULL_TIME',
      budget_min: '',
      budget_max: '',
      justification: '',
    });
  };

  const openEdit = (row: Requisition) => {
    setEditingReq(row);
    setForm({
      title: row.title,
      department_id: row.department_id || '',
      position_id: row.position_id || '',
      headcount: row.headcount,
      employment_type: row.employment_type,
      budget_min: row.budget_min === null ? '' : String(row.budget_min),
      budget_max: row.budget_max === null ? '' : String(row.budget_max),
      justification: row.justification || '',
    });
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setEditingReq(null);
  };

  const handleCreate = async () => {
    if (!form.title || form.headcount < 1) {
      toast.error('Provide a title and at least one headcount');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        department_id: form.department_id || null,
        position_id: form.position_id || null,
        headcount: form.headcount,
        employment_type: form.employment_type,
        budget_min: form.budget_min === '' ? null : Number(form.budget_min),
        budget_max: form.budget_max === '' ? null : Number(form.budget_max),
        justification: form.justification || null,
        requested_by: employee?.id,
      };
      if (editingReq) {
        const { error } = await supabase.from('recruitment_requisitions')
          .update(payload)
          .eq('id', editingReq.id);
        if (error) throw error;
        toast.success('Requisition updated');
      } else {
        const { error } = await supabase.from('recruitment_requisitions')
          .insert({ ...payload, status: 'DRAFT' });
        if (error) throw error;
        toast.success('Requisition created');
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

  const submitRequisition = async (row: Requisition) => {
    try {
      const { error } = await supabase.from('recruitment_requisitions')
        .update({ status: 'SUBMITTED' })
        .eq('id', row.id);
      if (error) throw error;
      const instanceId = await startWorkflow('recruitment.requisition', row.id, row.requested_by || employee?.id);
      if (!instanceId) {
        await supabase.from('recruitment_requisitions')
          .update({ status: 'DRAFT' })
          .eq('id', row.id);
        toast.warning('No approval workflow is enabled for requisitions — request returned to draft');
        load();
        return;
      }
      toast.success('Requisition submitted for approval');
      load();
    } catch (err) {
      await supabase.from('recruitment_requisitions')
        .update({ status: 'DRAFT' })
        .eq('id', row.id);
      toast.error('Failed: ' + (err as Error).message);
      load();
    }
  };

  const cancelRequisition = async (row: Requisition) => {
    try {
      const { error } = await supabase.from('recruitment_requisitions').update({ status: 'CANCELLED' }).eq('id', row.id);
      if (error) throw error;
      toast.success('Requisition cancelled');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const createJob = async (row: Requisition) => {
    try {
      const { error } = await supabase.from('recruitment_jobs').insert({
        position_id: row.position_id,
        department_id: row.department_id,
        title: row.title,
        status: 'DRAFT',
        employment_type: row.employment_type,
        requisition_id: row.id,
        description: row.justification,
      });
      if (error) throw error;
      toast.success('Job posting created from requisition');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    SUBMITTED: 'bg-warning/10 text-warning',
    APPROVED: 'bg-success/10 text-success',
    REJECTED: 'bg-destructive/10 text-destructive',
    CANCELLED: 'bg-muted text-muted-foreground line-through',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Requisitions', value: rows.length, icon: ClipboardList, color: 'primary' },
    { label: 'Draft', value: rows.filter((r) => r.status === 'DRAFT').length, icon: Clock, color: 'info' },
    { label: 'Pending Approval', value: rows.filter((r) => r.status === 'SUBMITTED').length, icon: Clock, color: 'warning' },
    { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length, icon: CheckCircle, color: 'success' },
    { label: 'Rejected', value: rows.filter((r) => r.status === 'REJECTED').length, icon: XCircle, color: 'destructive' },
  ];

  const columns: Column<Requisition>[] = [
    { key: 'title', label: 'Title', render: (r) => <span className="font-medium">{r.title}</span> },
    { key: 'department_id', label: 'Department', render: (r) => departments.find((d) => d.id === r.department_id)?.name || '—' },
    { key: 'position_id', label: 'Position', render: (r) => positions.find((p) => p.id === r.position_id)?.title || '—' },
    { key: 'headcount', label: 'Headcount', render: (r) => r.headcount },
    { key: 'employment_type', label: 'Type', render: (r) => <Badge variant="outline">{r.employment_type.replace(/_/g, ' ')}</Badge> },
    { key: 'requested_by', label: 'Requested by', render: (r) => requesterName(r.requested_by), searchText: (r) => [requesterName(r.requested_by)] },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={statusColors[r.status] || ''}>{r.status}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Recruitment Requisitions"
        description="Plan hiring needs and route headcount requests through approval"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search requisitions..."
        statusKey="status"
        createLabel="New Requisition"
        onCreate={() => { setEditingReq(null); resetForm(); setCreateOpen(true); }}
        rowActions={(r) => (
          <div className="flex items-center gap-1">
            {(r.status === 'DRAFT' || r.status === 'REJECTED') && (
              <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
            )}
            {(r.status === 'DRAFT' || r.status === 'REJECTED') && (
              <Button size="sm" variant="ghost" onClick={() => submitRequisition(r)}>{r.status === 'REJECTED' ? 'Resubmit' : 'Submit'}</Button>
            )}
            {r.status === 'APPROVED' && (
              <Button size="sm" variant="ghost" onClick={() => createJob(r)}>Create Job</Button>
            )}
            {(r.status === 'DRAFT' || r.status === 'SUBMITTED') && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancelRequisition(r)}>Cancel</Button>
            )}
          </div>
        )}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) closeCreate(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingReq ? 'Edit Requisition' : 'New Recruitment Requisition'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Requisition Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Senior Frontend Engineer" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Position</Label>
                <Select value={form.position_id} onValueChange={(v) => setForm({ ...form, position_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select position" /></SelectTrigger>
                  <SelectContent>
                    {positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Headcount *</Label>
                <Input type="number" min={1} value={form.headcount} onChange={(e) => setForm({ ...form, headcount: Number(e.target.value) || 1 })} />
              </div>
              <div className="space-y-1.5">
                <Label>Employment Type</Label>
                <Select value={form.employment_type} onValueChange={(v) => setForm({ ...form, employment_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Budget Min</Label>
                <Input type="number" step="0.01" value={form.budget_min} onChange={(e) => setForm({ ...form, budget_min: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Budget Max</Label>
                <Input type="number" step="0.01" value={form.budget_max} onChange={(e) => setForm({ ...form, budget_max: e.target.value })} placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Justification</Label>
              <Textarea rows={3} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} placeholder="Why is this hire needed?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title}>
              {saving ? 'Saving...' : editingReq ? 'Save Changes' : 'Create Requisition'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}