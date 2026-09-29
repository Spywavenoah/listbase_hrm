'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { UserPlus, CheckCircle, Clock, GraduationCap } from 'lucide-react';
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
  ];

  return (
    <>
      <ModuleListPage
        title="Training Enrollments"
        description="Manage course enrollments and completion tracking"
        summaryCards={summaryCards}
        columns={columns}
        data={enrollments}
        searchPlaceholder="Search enrollments..."
        createLabel="Enroll Employee"
        onCreate={() => setCreateOpen(true)}
        rowActions={(e) => (
          e.status !== 'COMPLETED' ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-success"
              onClick={async () => {
                await supabase.from('training_enrollments')
                  .update({ status: 'COMPLETED', progress: 100, completed_at: new Date().toISOString() })
                  .eq('id', e.id);
                toast.success('Marked complete');
                load();
              }}
            >
              Complete
            </Button>
          ) : null
        )}
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
