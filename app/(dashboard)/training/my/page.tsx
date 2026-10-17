'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { GraduationCap, BookOpen, Award, Users, Play } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VideoPlayer } from '@/components/training/video-player';
import { toast } from 'sonner';
import Link from 'next/link';

interface Course {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  is_mandatory: boolean;
  video_path: string | null;
  video_url: string | null;
  quiz_generation_status: string;
  quiz_question_count: number;
  quiz_pass_pct: number;
}

interface Enrollment {
  id: string;
  course_id: string;
  status: string;
  progress: number;
  enrolled_at: string;
  due_date: string | null;
  completed_at: string | null;
  quiz_passed: boolean;
  quiz_best_score: number | null;
  training_courses: Course | null;
}

export default function MyTrainingPage() {
  const { employeeId } = useAccess();
  const [myEnrollments, setMyEnrollments] = useState<Enrollment[]>([]);
  const [available, setAvailable] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [watchTarget, setWatchTarget] = useState<Enrollment | null>(null);
  const [enrolling, setEnrolling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!employeeId) return;
    try {
      const [enr, courses] = await Promise.all([
        supabase
          .from('training_enrollments')
          .select('*, training_courses(*)')
          .eq('employee_id', employeeId)
          .order('enrolled_at', { ascending: false }),
        supabase.from('training_courses').select('*').order('title'),
      ]);
      const enrs = (enr.data || []) as Enrollment[];
      setMyEnrollments(enrs);
      const enrolledIds = new Set(enrs.map((e) => e.course_id));
      const avail = (courses.data || []) as Course[];
      setAvailable(avail.filter((c) => !enrolledIds.has(c.id)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const selfEnroll = async (courseId: string) => {
    setEnrolling(courseId);
    try {
      const { error } = await supabase.rpc('self_enroll_training', { p_course_id: courseId });
      if (error) throw error;
      toast.success('Enrolled successfully');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setEnrolling(null);
    }
  };

  const statusColors: Record<string, string> = {
    ENROLLED: 'bg-info/10 text-info',
    IN_PROGRESS: 'bg-warning/10 text-warning',
    COMPLETED: 'bg-success/10 text-success',
    CANCELLED: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'My Enrollments', value: myEnrollments.length, icon: BookOpen, color: 'primary' },
    { label: 'In Progress', value: myEnrollments.filter((e) => e.status === 'IN_PROGRESS' || e.status === 'ENROLLED').length, icon: Play, color: 'warning' },
    { label: 'Completed', value: myEnrollments.filter((e) => e.status === 'COMPLETED').length, icon: Award, color: 'success' },
    { label: 'Available', value: available.length, icon: GraduationCap, color: 'info' },
  ];

  const columns: Column<Enrollment>[] = [
    { key: 'course', label: 'Course', render: (e) => e.training_courses?.title || '—' },
    { key: 'category', label: 'Category', render: (e) => e.training_courses?.category || '—' },
    {
      key: 'enrolled_at', label: 'Enrolled',
      render: (e) => e.enrolled_at ? new Date(e.enrolled_at).toLocaleDateString() : '—',
    },
    {
      key: 'due_date', label: 'Due',
      render: (e) => {
        if (!e.due_date) return <span className="text-muted-foreground">—</span>;
        const due = new Date(e.due_date);
        const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
        const done = e.status === 'COMPLETED';
        if (done) return due.toLocaleDateString();
        if (days < 0) return <Badge variant="outline" className="bg-destructive/10 text-destructive">Overdue</Badge>;
        if (days <= 7) return <Badge variant="outline" className="bg-warning/10 text-warning">{days}d left</Badge>;
        return <Badge variant="outline" className="bg-info/10 text-info">{due.toLocaleDateString()}</Badge>;
      },
    },
    {
      key: 'progress', label: 'Progress',
      render: (e) => (
        <div className="flex items-center gap-2">
          <div className="h-2 w-20 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${e.progress}%` }} />
          </div>
          <span className="text-xs text-muted-foreground">{e.progress}%</span>
        </div>
      ),
    },
    {
      key: 'status', label: 'Status',
      render: (e) => <Badge variant="outline" className={statusColors[e.status] || ''}>{e.status}</Badge>,
    },
    {
      key: 'quiz', label: 'Quiz',
      render: (e) => {
        if (e.quiz_best_score == null) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className={e.quiz_passed ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}>
            {Math.round(e.quiz_best_score)}%
          </Badge>
        );
      },
    },
  ];

  const availableCols: Column<Course>[] = [
    { key: 'title', label: 'Course' },
    { key: 'category', label: 'Category', render: (c) => c.category || '—' },
    {
      key: 'mandatory', label: 'Type',
      render: (c) => <Badge variant="outline" className={c.is_mandatory ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'}>
        {c.is_mandatory ? 'Mandatory' : 'Optional'}
      </Badge>,
    },
    {
      key: 'assessment', label: 'Assessment',
      render: (c) => {
        if (c.quiz_generation_status === 'READY') {
          return <Badge variant="outline" className="bg-success/10 text-success">{c.quiz_question_count} Q · {c.quiz_pass_pct}%</Badge>;
        }
        return <span className="text-xs text-muted-foreground">—</span>;
      },
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Training</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enrol in courses and complete your own training</p>
        </div>
        {available.length > 0 && (
          <Badge variant="outline" className="bg-info/10 text-info">{available.length} course{available.length === 1 ? '' : 's'} available</Badge>
        )}
      </div>

      <ModuleListPage
        title="My Enrollments"
        description="Your active and completed enrollments"
        summaryCards={summaryCards}
        columns={columns}
        data={myEnrollments}
        searchPlaceholder="Search my enrollments..."
        emptyMessage="No enrollments yet"
        emptyDescription="Enrol in a course from the available list below"
        rowActions={(e) => (
          <Button size="sm" variant="outline" className="h-7 text-primary" onClick={() => setWatchTarget(e)}>
            <Play className="mr-1 h-3 w-3" />
            {e.status === 'COMPLETED' ? 'View' : 'Start'}
          </Button>
        )}
      />

      {available.length > 0 && (
        <ModuleListPage
          title="Available Courses"
          description="Courses you can self-enrol into"
          columns={availableCols}
          data={available}
          searchPlaceholder="Search courses..."
          rowActions={(c) => (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-primary"
              disabled={enrolling === c.id}
              onClick={() => selfEnroll(c.id)}
            >
              {enrolling === c.id ? 'Enrolling…' : 'Enrol'}
            </Button>
          )}
        />
      )}

      <Dialog open={!!watchTarget} onOpenChange={(o) => { if (!o) { setWatchTarget(null); load(); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {watchTarget ? (watchTarget.training_courses?.title || 'Training lesson') : 'Training lesson'}
            </DialogTitle>
          </DialogHeader>
          {watchTarget && (
            <VideoPlayer key={watchTarget.id} enrollmentId={watchTarget.id} onCompleted={() => { setWatchTarget(null); load(); }} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
