'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { UserPlus, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { enqueueAndProcess } from '@/lib/notifications';

interface OnboardingProgress {
  id: string;
  employee_id: string;
  template_id: string;
  step_id: string;
  status: string;
  completed_at: string | null;
  step_title?: string;
  step_required?: boolean;
}

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  employment_status: string;
}

export default function OnboardingPage() {
  const [progress, setProgress] = useState<OnboardingProgress[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: '', template_id: '' });

  const load = useCallback(async () => {
    try {
      const [pRes, eRes, tRes] = await Promise.all([
        supabase
          .from('employee_onboarding_progress')
          .select('id, employee_id, template_id, step_id, status, completed_at, onboarding_steps(title, is_required)')
          .in('status', ['PENDING', 'IN_PROGRESS', 'COMPLETED'])
          .order('created_at', { ascending: false }),
        supabase
          .from('employees')
          .select('id, first_name, last_name, email, employment_status')
          .in('employment_status', ['PENDING_VERIFICATION', 'ONBOARDING', 'ACTIVE'])
          .order('created_at'),
        supabase.from('onboarding_templates').select('id, name').eq('is_active', true),
      ]);
      setProgress((pRes.data || []).map((p) => ({
        ...(p as unknown as OnboardingProgress),
        step_title: (p as unknown as { onboarding_steps: { title: string; is_required: boolean } | null }).onboarding_steps?.title,
        step_required: (p as unknown as { onboarding_steps: { title: string; is_required: boolean } | null }).onboarding_steps?.is_required,
      })));
      setEmployees((eRes.data || []) as unknown as Employee[]);
      setTemplates(tRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAssign = async () => {
    try {
      const { data: steps } = await supabase
        .from('onboarding_steps')
        .select('id')
        .eq('template_id', form.template_id)
        .order('sort_order');
      if (!steps || steps.length === 0) {
        toast.error('Template has no steps');
        return;
      }
      const rows = steps.map((s) => ({
        employee_id: form.employee_id,
        template_id: form.template_id,
        step_id: s.id,
        status: 'PENDING',
      }));
      const { error } = await supabase.from('employee_onboarding_progress').insert(rows);
      if (error) throw error;
      toast.success('Onboarding assigned');
      setAssignOpen(false);
      setForm({ employee_id: '', template_id: '' });
      load();

      const emp = employees.find((e) => e.id === form.employee_id);
      const tmpl = templates.find((t) => t.id === form.template_id);
      if (emp) {
        await enqueueAndProcess({
          eventKey: 'onboarding.checklist',
          recipientEmail: emp.email,
          recipientName: `${emp.first_name} ${emp.last_name}`,
          subject: 'Your onboarding checklist is ready',
          bodyHtml: `<p>Hi ${emp.first_name},</p><p>Your onboarding template "${tmpl?.name || ''}" has been assigned. Please complete all required steps.</p>`,
          metadata: {
            employee_name: `${emp.first_name} ${emp.last_name}`,
            template_name: tmpl?.name || '',
          },
        });
      }
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const empName = (id: string) => {
    const e = employees.find((e) => e.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };

  const statusColors: Record<string, string> = {
    PENDING: 'bg-warning/10 text-warning',
    IN_PROGRESS: 'bg-info/10 text-info',
    COMPLETED: 'bg-success/10 text-success',
    SKIPPED: 'bg-muted text-muted-foreground',
  };

  const onboardingEmployees = employees.filter((e) => e.employment_status === 'ONBOARDING' || e.employment_status === 'PENDING_VERIFICATION');
  const summaryCards: SummaryCard[] = [
    { label: 'Pending Verification', value: employees.filter((e) => e.employment_status === 'PENDING_VERIFICATION').length, icon: UserPlus, color: 'primary' },
    { label: 'Onboarding', value: employees.filter((e) => e.employment_status === 'ONBOARDING').length, icon: AlertCircle, color: 'info' },
    { label: 'Pending Steps', value: progress.filter((p) => p.status === 'PENDING').length, icon: Clock, color: 'warning' },
    { label: 'Completed Steps', value: progress.filter((p) => p.status === 'COMPLETED').length, icon: CheckCircle, color: 'success' },
  ];

  const columns: Column<OnboardingProgress>[] = [
    { key: 'employee', label: 'Employee', render: (p) => empName(p.employee_id), searchText: (p) => [empName(p.employee_id)] },
    { key: 'template_id', label: 'Template', render: (p) => templates.find((t) => t.id === p.template_id)?.name || '—' },
    { key: 'step_title', label: 'Step', render: (p) => (
      <span className="inline-flex items-center gap-1.5">
        {p.step_title || (p.step_id || '').slice(0, 8)}
        {p.step_required && <Badge variant="outline" className="text-[10px]">Required</Badge>}
      </span>
    ) },
    {
      key: 'completed_at', label: 'Completed',
      render: (p) => p.completed_at ? new Date(p.completed_at).toLocaleString() : '—',
    },
    {
      key: 'status', label: 'Status',
      render: (p) => <Badge variant="outline" className={statusColors[p.status] || ''}>{p.status.replace(/_/g, ' ')}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Employee Onboarding"
        description="Track onboarding progress for new hires"
        summaryCards={summaryCards}
        columns={columns}
        data={progress}
        loading={loading}
        searchPlaceholder="Search onboarding records..."
        statusKey="status"
        createLabel="Assign Template"
        onCreate={() => setAssignOpen(true)}
      />
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Onboarding Template</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {onboardingEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employment_status})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select value={form.template_id} onValueChange={(v) => setForm({ ...form, template_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={!form.employee_id || !form.template_id}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}