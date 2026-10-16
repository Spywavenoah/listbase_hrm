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
  video_url: string | null;
  video_duration_seconds: number | null;
  renewal_months: number | null;
  pass_pct: number;
  completion_enforced: boolean;
}

const emptyForm = {
  title: '',
  category: '',
  description: '',
  duration_hours: '',
  instructor: '',
  is_mandatory: false,
  video_url: '',
  video_duration_seconds: '',
  renewal_months: '',
  pass_pct: '95',
};

type CourseForm = typeof emptyForm;

function toForm(c?: Course): CourseForm {
  if (!c) return { ...emptyForm };
  return {
    title: c.title || '',
    category: c.category || '',
    description: c.description || '',
    duration_hours: c.duration_hours ? String(c.duration_hours) : '',
    instructor: c.instructor || '',
    is_mandatory: Boolean(c.is_mandatory),
    video_url: c.video_url || '',
    video_duration_seconds: c.video_duration_seconds ? String(c.video_duration_seconds) : '',
    renewal_months: c.renewal_months !== null && c.renewal_months !== undefined ? String(c.renewal_months) : '',
    pass_pct: c.pass_pct ? String(c.pass_pct) : '95',
  };
}

export default function TrainingPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<{ course_id: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [form, setForm] = useState<CourseForm>({ ...emptyForm });
  const [strict, setStrict] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cRes, eRes, sRes] = await Promise.all([
        supabase.from('training_courses').select('*').order('created_at', { ascending: false }),
        supabase.from('training_enrollments').select('course_id, status'),
        supabase.from('system_settings').select('value')
          .eq('group_name', 'training')
          .eq('key', 'completion_enforcement')
          .maybeSingle(),
      ]);
      setCourses((cRes.data || []) as unknown as Course[]);
      setEnrollments((eRes.data || []) as unknown as { course_id: string; status: string }[]);
      const raw = sRes.data?.value;
      const parsed = typeof raw === 'string'
        ? (() => { try { return JSON.parse(raw); } catch { return raw.replace(/^"|"$/g, ''); } })()
        : raw;
      setStrict(parsed === 'ENFORCED');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleStrict = async (next: boolean) => {
    setStrict(next);
    try {
      const { error } = await supabase.from('system_settings').upsert(
        { group_name: 'training', key: 'completion_enforcement', value: JSON.stringify(next ? 'ENFORCED' : 'SHADOW') },
        { onConflict: 'group_name,key' }
      );
      if (error) throw error;
      toast.success(next ? 'Strict completion enabled' : 'Tracking only (shadow mode)');
    } catch (err) {
      setStrict(!next);
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const coursePayload = () => ({
    title: form.title,
    category: form.category || null,
    description: form.description || null,
    duration_hours: form.duration_hours ? parseInt(form.duration_hours) : null,
    instructor: form.instructor || null,
    is_mandatory: form.is_mandatory,
    video_url: form.video_url || null,
    video_duration_seconds: form.video_duration_seconds ? parseInt(form.video_duration_seconds) : null,
    renewal_months: form.renewal_months ? parseInt(form.renewal_months) : null,
    pass_pct: form.pass_pct ? (parseInt(form.pass_pct) || 95) : 95,
  });

  const handleCreate = async () => {
    try {
      const { error } = editing
        ? await supabase.from('training_courses').update(coursePayload()).eq('id', editing.id)
        : await supabase.from('training_courses').insert(coursePayload());
      if (error) throw error;
      toast.success(editing ? 'Course updated' : 'Course created');
      setCreateOpen(false);
      setEditing(null);
      setForm({ ...emptyForm });
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
      key: 'video_url', label: 'Lesson',
      searchText: (c) => [c.video_url || ''],
      render: (c) => c.video_url
        ? (
          <a href={c.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Video {c.video_duration_seconds ? `· ${Math.round(c.video_duration_seconds / 60)}m` : ''}
          </a>
        )
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'renewal_months', label: 'Renewal',
      render: (c) => c.renewal_months
        ? <Badge variant="outline" className="bg-info/10 text-info">{c.renewal_months} mo</Badge>
        : <span className="text-muted-foreground">—</span>,
    },
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
        onCreate={() => { setEditing(null); setForm({ ...emptyForm }); setCreateOpen(true); }}
        onEdit={(c) => { setEditing(c); setForm(toForm(c)); setCreateOpen(true); }}
        toolbarActions={
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={strict} onCheckedChange={(v) => void toggleStrict(v)} />
            Strict completion
          </label>
        }
      />
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit Course' : 'Add Course'}</DialogTitle></DialogHeader>
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
              <Label>Video URL</Label>
              <Input
                value={form.video_url}
                onChange={(e) => setForm({ ...form, video_url: e.target.value })}
                placeholder="https://cdn.example.com/lessons/onboarding.mp4"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Video length (sec)</Label>
                <Input
                  type="number"
                  value={form.video_duration_seconds}
                  onChange={(e) => setForm({ ...form, video_duration_seconds: e.target.value })}
                  placeholder="600"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Renewal (months)</Label>
                <Input
                  type="number"
                  value={form.renewal_months}
                  onChange={(e) => setForm({ ...form, renewal_months: e.target.value })}
                  placeholder="12"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pass %</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={form.pass_pct}
                  onChange={(e) => setForm({ ...form, pass_pct: e.target.value })}
                />
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
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.title}>{editing ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
