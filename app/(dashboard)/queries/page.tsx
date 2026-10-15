'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { MessageSquare, Inbox, CalendarClock, CheckCircle, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

interface QueryRow {
  id: string;
  employee_id: string;
  subject: string;
  category: string;
  status: 'OPEN' | 'RESPONDED' | 'CLOSED';
  reply_deadline: string | null;
  last_message_at: string | null;
  last_message_by: string | null;
  raised_at: string;
  employees: { first_name: string; last_name: string; employee_id: string | null } | null;
}

interface EmployeeOption { id: string; name: string }

const CATEGORIES = ['GENERAL', 'PAYROLL', 'LEAVE', 'ATTENDANCE', 'BENEFITS', 'OTHER'];

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-warning/10 text-warning border-warning/20',
  RESPONDED: 'bg-info/10 text-info border-info/20',
  CLOSED: 'bg-success/10 text-success border-success/20',
};

export default function QueriesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<QueryRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    subject: '',
    category: 'GENERAL',
    details: '',
    reply_deadline: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, eRes] = await Promise.all([
        supabase.from('employee_queries').select('*, employees!employee_queries_employee_id_fkey(first_name, last_name, employee_id)').order('raised_at', { ascending: false }),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      if (qRes.error) throw qRes.error;
      setRows((qRes.data || []) as unknown as QueryRow[]);
      setEmployees(((eRes.data || []) as EmployeeOption[]).slice().sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      console.error(err);
      toast.error('Failed to load queries: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.rpc('notify_query_deadlines').then(() => {}, () => {});
  }, []);

  const openCreate = () => {
    setForm({ employee_id: '', subject: '', category: 'GENERAL', details: '', reply_deadline: '' });
    setCreateOpen(true);
  };

  const submit = async () => {
    if (!form.employee_id) { toast.error('Select an employee'); return; }
    if (!form.subject.trim()) { toast.error('Subject is required'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('employee_queries').insert({
        employee_id: form.employee_id,
        subject: form.subject.trim(),
        category: form.category,
        details: form.details.trim() || null,
        reply_deadline: form.reply_deadline || null,
      });
      if (error) throw error;
      toast.success('Query created');
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Queries', value: rows.length, icon: MessageSquare, color: 'primary' },
    { label: 'Open', value: rows.filter((r) => r.status === 'OPEN').length, icon: Inbox, color: 'warning' },
    { label: 'Responded', value: rows.filter((r) => r.status === 'RESPONDED').length, icon: MessageSquare, color: 'info' },
    { label: 'Closed', value: rows.filter((r) => r.status === 'CLOSED').length, icon: CheckCircle, color: 'success' },
  ];

  const columns: Column<QueryRow>[] = [
    { key: 'subject', label: 'Subject' },
    {
      key: 'employee', label: 'Employee',
      render: (r) => r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : '—',
    },
    { key: 'category', label: 'Category', render: (r) => <Badge variant="outline" className="text-muted-foreground">{r.category}</Badge> },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={STATUS_COLORS[r.status] || ''}>{r.status}</Badge> },
    {
      key: 'deadline', label: 'Reply Deadline',
      render: (r) => r.reply_deadline ? (
        <span className={r.status !== 'CLOSED' && new Date(r.reply_deadline).getTime() < Date.now() && r.last_message_by !== 'EMPLOYEE' ? 'text-destructive' : ''}>
          {new Date(r.reply_deadline).toLocaleString()}
        </span>
      ) : '—',
    },
    {
      key: 'raised_at', label: 'Opened',
      render: (r) => r.raised_at ? new Date(r.raised_at).toLocaleString() : '—',
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Employee Queries"
        description="Raise queries against employees, set reply deadlines and follow the conversation"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search queries..."
        statusKey="status"
        createLabel="New Query"
        onCreate={openCreate}
        rowActions={(r) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.push(`/employees/${r.employee_id}/queries`)}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
          </Button>
        )}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { if (!saving) setCreateOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Query</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Employee *</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Subject *</Label>
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Brief summary" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reply deadline</Label>
                <Input type="datetime-local" value={form.reply_deadline} onChange={(e) => setForm({ ...form, reply_deadline: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Details</Label>
              <Textarea rows={4} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Describe the query..." />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" /> The employee is notified now and reminded as the deadline approaches.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving || !form.employee_id || !form.subject}>{saving ? 'Submitting...' : 'Create Query'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
