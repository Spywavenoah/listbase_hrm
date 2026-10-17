'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { UserPlus, CheckCircle, Clock, GraduationCap, Award } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Enrollment {
  id: string;
  course_id: string;
  employee_id: string;
  status: string;
  enrolled_at: string;
  completed_at: string | null;
  progress: number;
  certificate_id: string | null;
  certificate_expires_at: string | null;
  certificate_pdf_url: string | null;
  cycle: number;
  due_date: string | null;
  reminder_sent_at: string | null;
  overdue_action_at: string | null;
  overdue_action_result: string | null;
  quiz_best_score: number | null;
  quiz_passed: boolean;
  quiz_attempts: number;
}

type RenewalBadge = { label: string; cls: string };

function renewalBadge(expiresAt: string): RenewalBadge {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  if (!Number.isFinite(days)) return { label: '—', cls: 'bg-muted text-muted-foreground' };
  if (days <= 0) return { label: 'Renewal due', cls: 'bg-destructive/10 text-destructive' };
  if (days <= 30) return { label: `Renews in ${days}d`, cls: 'bg-warning/10 text-warning' };
  return { label: `Renews in ${days}d`, cls: 'bg-info/10 text-info' };
}

export default function EnrollmentsPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: '', course_id: '' });

  const load = useCallback(async () => {
    try {
      const [eRes, empRes, cRes] = await Promise.all([
        supabase.from('training_enrollments').select('*').order('enrolled_at', { ascending: false }),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE'),
        supabase.from('training_courses').select('id, title'),
      ]);
      setEnrollments((eRes.data || []) as unknown as Enrollment[]);
      setEmployees(empRes.data || []);
      setCourses(cRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('training_enrollments').insert({
        employee_id: form.employee_id,
        course_id: form.course_id,
        status: 'ENROLLED',
        progress: 0,
      });
      if (error) throw error;
      toast.success('Enrollment created');
      setCreateOpen(false);
      setForm({ employee_id: '', course_id: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const empName = (id: string) => {
    const e = employees.find((e) => e.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };
  const courseTitle = (id: string) => courses.find((c) => c.id === id)?.title || '—';

  const statusColors: Record<string, string> = {
    ENROLLED: 'bg-info/10 text-info',
    IN_PROGRESS: 'bg-warning/10 text-warning',
    COMPLETED: 'bg-success/10 text-success',
    CANCELLED: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Enrollments', value: enrollments.length, icon: GraduationCap, color: 'primary' },
    { label: 'Enrolled', value: enrollments.filter((e) => e.status === 'ENROLLED').length, icon: Clock, color: 'info' },
    { label: 'Completed', value: enrollments.filter((e) => e.status === 'COMPLETED').length, icon: CheckCircle, color: 'success' },
    { label: 'In Progress', value: enrollments.filter((e) => e.status === 'IN_PROGRESS').length, icon: UserPlus, color: 'warning' },
  ];

  const columns: Column<Enrollment>[] = [
    { key: 'employee', label: 'Employee', render: (e) => empName(e.employee_id) },
    { key: 'course', label: 'Course', render: (e) => courseTitle(e.course_id) },
    {
      key: 'enrolled_at', label: 'Enrolled',
      render: (e) => e.enrolled_at ? new Date(e.enrolled_at).toLocaleDateString() : '—',
    },
    {
      key: 'due_date', label: 'Due',
      searchText: (e) => [e.due_date || ''],
      render: (e) => {
        if (!e.due_date) return <span className="text-muted-foreground">—</span>;
        const due = new Date(e.due_date);
        const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
        const done = e.status === 'COMPLETED';
        let cls = 'bg-info/10 text-info';
        let label = due.toLocaleDateString();
        if (!done && days < 0) cls = 'bg-destructive/10 text-destructive';
        else if (!done && days === 0) { cls = 'bg-destructive/10 text-destructive'; label = 'Today'; }
        else if (!done && days <= 7) { cls = 'bg-warning/10 text-warning'; label = `${days}d left`; }
        return <Badge variant="outline" className={cls}>{label}</Badge>;
      },
    },
    {
      key: 'completed_at', label: 'Completed',
      render: (e) => e.completed_at ? new Date(e.completed_at).toLocaleDateString() : '—',
    },
    {
      key: 'progress', label: 'Progress',
      render: (e) => <div className="flex items-center gap-2"><div className="h-2 w-20 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${e.progress}%` }} /></div><span className="text-xs text-muted-foreground">{e.progress}%</span></div>,
    },
    {
      key: 'status', label: 'Status',
      render: (e) => <Badge variant="outline" className={statusColors[e.status] || ''}>{e.status}</Badge>,
    },
    {
      key: 'quiz_best_score', label: 'Quiz',
      searchText: (e) => [e.quiz_best_score != null ? String(e.quiz_best_score) : ''],
      render: (e) => {
        if (e.quiz_best_score == null) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className={e.quiz_passed ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}>
            {Math.round(e.quiz_best_score)}%{e.quiz_attempts > 1 ? ` · ${e.quiz_attempts} tries` : ''}
          </Badge>
        );
      },
    },
    {
      key: 'certificate_id', label: 'Certificate',
      searchText: (e) => [e.certificate_id || ''],
      render: (e) => e.certificate_id
        ? (
          <span className="inline-flex items-center gap-1 text-xs">
            <Award className="h-3.5 w-3.5 text-success" />
            <a
              href={e.certificate_pdf_url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
              onClick={(ev) => { if (!e.certificate_pdf_url) ev.stopPropagation(); }}
            >
              {e.certificate_id}
            </a>
          </span>
        )
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'certificate_expires_at', label: 'Renewal',
      searchText: (e) => [e.certificate_expires_at || ''],
      render: (e) => {
        if (!e.certificate_expires_at) return <span className="text-muted-foreground">—</span>;
        const r = renewalBadge(e.certificate_expires_at);
        return <Badge variant="outline" className={r.cls}>{r.label}</Badge>;
      },
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Training Enrollments"
        description="Read-only compliance view of course enrollments and completion tracking"
        summaryCards={summaryCards}
        columns={columns}
        data={enrollments}
        searchPlaceholder="Search enrollments..."
        createLabel="Enroll Employee"
        onCreate={() => setCreateOpen(true)}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enroll Employee</DialogTitle></DialogHeader>
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
              <Label>Course</Label>
              <Select value={form.course_id} onValueChange={(v) => setForm({ ...form, course_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.employee_id || !form.course_id}>Enroll</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
