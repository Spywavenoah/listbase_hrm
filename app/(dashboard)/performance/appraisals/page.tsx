'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Target, CheckCircle, Clock, Gavel, FileSignature } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  fetchAppraisals,
  createAppraisal,
  employeeName,
  APPRAISAL_STATUS_LABELS,
  APPRAISAL_STATUS_COLORS,
  type AppraisalWithPeople,
} from '@/lib/appraisal';
import type { AppraisalStatus } from '@/lib/types';
import { useAccess } from '@/lib/access';

interface Person { id: string; first_name: string; last_name: string }

export default function AppraisalsPage() {
  const router = useRouter();
  const { can } = useAccess();
  const canManage = can('performance.appraisal');
  const [rows, setRows] = useState<AppraisalWithPeople[]>([]);
  const [employees, setEmployees] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    review_cycle: '',
    period_start: '',
    period_end: '',
    reporting_manager_id: '',
    md_id: '',
    allow_edit_areas: false,
    notes: '',
  });

  const load = useCallback(async () => {
    try {
      const [aRes, eRes] = await Promise.all([
        fetchAppraisals(),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE').order('first_name'),
      ]);
      setRows(aRes);
      setEmployees((eRes.data || []) as Person[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-fill the reporting manager from the selected employee.
  const onPickEmployee = async (id: string) => {
    setForm((f) => ({ ...f, employee_id: id }));
    try {
      const { data } = await supabase.from('employees').select('reporting_manager_id').eq('id', id).maybeSingle();
      const mgr = (data as { reporting_manager_id: string | null } | null)?.reporting_manager_id || '';
      setForm((f) => ({ ...f, reporting_manager_id: mgr }));
    } catch { /* ignore */ }
  };

  const handleCreate = async () => {
    if (!form.employee_id || !form.review_cycle.trim()) return;
    setSaving(true);
    try {
      const id = await createAppraisal({
        employee_id: form.employee_id,
        review_cycle: form.review_cycle.trim(),
        period_start: form.period_start || null,
        period_end: form.period_end || null,
        reporting_manager_id: form.reporting_manager_id || null,
        md_id: form.md_id || null,
        allow_edit_areas: form.allow_edit_areas,
        notes: form.notes || null,
      });
      toast.success('Appraisal created');
      setCreateOpen(false);
      setForm({ employee_id: '', review_cycle: '', period_start: '', period_end: '', reporting_manager_id: '', md_id: '', allow_edit_areas: false, notes: '' });
      router.push(`/performance/appraisals/${id}`);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Appraisals', value: rows.length, icon: FileSignature, color: 'primary' },
    { label: 'Scoring', value: rows.filter((r) => r.status === 'SCORING').length, icon: Clock, color: 'info' },
    { label: 'Pending MD', value: rows.filter((r) => r.status === 'PENDING_MD').length, icon: Gavel, color: 'warning' },
    { label: 'Completed', value: rows.filter((r) => r.status === 'COMPLETED').length, icon: CheckCircle, color: 'success' },
  ];

  const columns: Column<AppraisalWithPeople>[] = [
    { key: 'employee', label: 'Employee', render: (r) => employeeName(r.employee), searchText: (r) => [employeeName(r.employee)] },
    { key: 'review_cycle', label: 'Cycle' },
    { key: 'manager', label: 'Reporting Manager', render: (r) => employeeName(r.manager) },
    { key: 'md', label: 'MD', render: (r) => employeeName(r.md) },
    {
      key: 'progress', label: 'Scores',
      render: (r) => (
        <div className="flex items-center gap-1.5 text-xs">
          <Badge variant="outline" className={r.employee_submitted_at ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>Emp</Badge>
          <Badge variant="outline" className={r.manager_submitted_at ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>Mgr</Badge>
        </div>
      ),
    },
    {
      key: 'final_rating', label: 'Final',
      render: (r) => r.final_rating != null ? <span className="font-medium">{r.final_rating}</span> : '—',
    },
    {
      key: 'status', label: 'Status',
      render: (r) => (
        <Badge variant="outline" className={APPRAISAL_STATUS_COLORS[r.status] || ''}>
          {APPRAISAL_STATUS_LABELS[r.status] || r.status}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Employee Appraisals"
        description="Create appraisals, define areas, and drive them to a final MD verdict"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search appraisals..."
        createLabel="New Appraisal"
        onCreate={canManage ? () => setCreateOpen(true) : undefined}
        onRowClick={(r) => router.push(`/performance/appraisals/${r.id}`)}
        statusKey="status"
        statusValue={(r) => APPRAISAL_STATUS_LABELS[r.status] || r.status}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Appraisal</DialogTitle>
            <DialogDescription>
              Creates the appraisal and opens the scoring form. The employee and their reporting manager are notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Employee *</Label>
              <Select value={form.employee_id} onValueChange={onPickEmployee}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Review Cycle *</Label>
              <Input value={form.review_cycle} onChange={(e) => setForm({ ...form, review_cycle: e.target.value })} placeholder="e.g. Q1 2026 or Annual 2026" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Period Start</Label>
                <Input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Period End</Label>
                <Input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reporting Manager (HOD)</Label>
              <Select value={form.reporting_manager_id || '__none__'} onValueChange={(v) => setForm({ ...form, reporting_manager_id: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Use employee's reporting manager" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None / use default —</SelectItem>
                  {employees.filter((e) => e.id !== form.employee_id).map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Managing Director (final verdict)</Label>
              <Select value={form.md_id || '__none__'} onValueChange={(v) => setForm({ ...form, md_id: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Select MD (can be set later)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Set later —</SelectItem>
                  {employees.filter((e) => e.id !== form.employee_id).map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label className="cursor-pointer">Allow employee &amp; manager to add/edit areas</Label>
                <p className="text-xs text-muted-foreground">When enabled, both parties may add and edit the appraisal areas while scoring.</p>
              </div>
              <Switch checked={form.allow_edit_areas} onCheckedChange={(v) => setForm({ ...form, allow_edit_areas: v })} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.employee_id || !form.review_cycle.trim()}>
              {saving ? 'Creating...' : 'Create Appraisal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
