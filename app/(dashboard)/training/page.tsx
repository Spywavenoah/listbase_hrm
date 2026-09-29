'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { GraduationCap, BookOpen, Award, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface Course {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  is_mandatory: boolean;
  duration_hours: number | null;
  instructor: string | null;
}

export default function TrainingPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<{ course_id: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', category: '', description: '', duration_hours: '', instructor: '', is_mandatory: false });

  const load = useCallback(async () => {
    try {
      const [cRes, eRes] = await Promise.all([
        supabase.from('training_courses').select('*').order('created_at', { ascending: false }),
        supabase.from('training_enrollments').select('course_id, status'),
      ]);
      setCourses((cRes.data || []) as unknown as Course[]);
      setEnrollments((eRes.data || []) as unknown as { course_id: string; status: string }[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('training_courses').insert({
        title: form.title,
        category: form.category || null,
        description: form.description || null,
        duration_hours: form.duration_hours ? parseInt(form.duration_hours) : null,
        instructor: form.instructor || null,
        is_mandatory: form.is_mandatory,
      });
      if (error) throw error;
      toast.success('Course created');
      setCreateOpen(false);
      setForm({ title: '', category: '', description: '', duration_hours: '', instructor: '', is_mandatory: false });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const enrolledCount = (courseId: string) => enrollments.filter((e) => e.course_id === courseId).length;
  const completedCount = (courseId: string) => enrollments.filter((e) => e.course_id === courseId && e.status === 'COMPLETED').length;

  const summaryCards: SummaryCard[] = [
    { label: 'Total Courses', value: courses.length, icon: BookOpen, color: 'primary' },
    { label: 'Enrollments', value: enrollments.length, icon: Users, color: 'info' },
    { label: 'Completed', value: enrollments.filter((e) => e.status === 'COMPLETED').length, icon: Award, color: 'success' },
    { label: 'Mandatory', value: courses.filter((c) => c.is_mandatory).length, icon: GraduationCap, color: 'warning' },
  ];

  const columns: Column<Course>[] = [
    { key: 'title', label: 'Course Title' },
    { key: 'category', label: 'Category', render: (c) => c.category || '—' },
    { key: 'instructor', label: 'Instructor', render: (c) => c.instructor || '—' },
    { key: 'duration_hours', label: 'Duration', render: (c) => c.duration_hours ? `${c.duration_hours}h` : '—' },
    {
      key: 'enrolled', label: 'Enrolled',
      render: (c) => `${enrolledCount(c.id)}`,
    },
    {
      key: 'completed', label: 'Completed',
      render: (c) => `${completedCount(c.id)}`,
    },
    {
      key: 'is_mandatory', label: 'Type',
      render: (c) => <Badge variant="outline" className={c.is_mandatory ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'}>{c.is_mandatory ? 'Mandatory' : 'Optional'}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Learning & Development"
        description="Course catalog, enrollments, and training compliance"
        summaryCards={summaryCards}
        columns={columns}
        data={courses}
        searchPlaceholder="Search courses..."
        createLabel="Add Course"
        onCreate={() => setCreateOpen(true)}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Course</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Course Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Onboarding Orientation" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Compliance" />
              </div>
              <div className="space-y-1.5">
                <Label>Duration (hours)</Label>
                <Input type="number" value={form.duration_hours} onChange={(e) => setForm({ ...form, duration_hours: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Instructor</Label>
              <Input value={form.instructor} onChange={(e) => setForm({ ...form, instructor: e.target.value })} placeholder="John Doe" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_mandatory} onCheckedChange={(v) => setForm({ ...form, is_mandatory: v })} />
              <Label className="cursor-pointer" onClick={() => setForm({ ...form, is_mandatory: !form.is_mandatory })}>Mandatory course</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.title}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
