'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { GraduationCap, BookOpen, Award, Users, Upload, Video, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const VIDEO_BUCKET = 'training-videos';
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'application/mp4'];

interface Course {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  is_mandatory: boolean;
  duration_hours: number | null;
  instructor: string | null;
  video_url: string | null;
  video_path: string | null;
  video_duration_seconds: number | null;
  is_repetitive: boolean;
  reassessment_interval_months: number | null;
  renewal_months: number | null;
  due_in_days: number | null;
  missed_action: string;
  missed_action_grace_days: number;
  missed_action_config: { message?: string } | null;
  pass_pct: number;
  completion_enforced: boolean;
}

const emptyForm = {
  title: '',
  category: '',
  description: '',
  instructor: '',
  is_mandatory: false,
  video_url: '',
  video_path: '',
  video_duration_seconds: '',
  is_repetitive: false,
  reassessment_interval_months: '',
  due_in_days: '',
  missed_action: 'NONE',
  missed_action_grace_days: '7',
  missed_message: '',
  pass_pct: '95',
};

type CourseForm = typeof emptyForm;

function toForm(c?: Course): CourseForm {
  if (!c) return { ...emptyForm };
  return {
    title: c.title || '',
    category: c.category || '',
    description: c.description || '',
    instructor: c.instructor || '',
    is_mandatory: Boolean(c.is_mandatory),
    video_url: c.video_url || '',
    video_path: c.video_path || '',
    video_duration_seconds: c.video_duration_seconds ? String(c.video_duration_seconds) : '',
    is_repetitive: Boolean(c.is_repetitive),
    reassessment_interval_months:
      c.reassessment_interval_months !== null && c.reassessment_interval_months !== undefined
        ? String(c.reassessment_interval_months)
        : c.renewal_months !== null && c.renewal_months !== undefined ? String(c.renewal_months) : '',
    due_in_days: c.due_in_days !== null && c.due_in_days !== undefined ? String(c.due_in_days) : '',
    missed_action: c.missed_action || 'NONE',
    missed_action_grace_days:
      c.missed_action_grace_days !== null && c.missed_action_grace_days !== undefined
        ? String(c.missed_action_grace_days)
        : '7',
    missed_message: c.missed_action_config?.message || '',
    pass_pct: c.pass_pct ? String(c.pass_pct) : '95',
  };
}

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the video length'));
    };
    video.src = url;
  });
}

const missedActionOptions = [
  { value: 'NONE', label: 'No action' },
  { value: 'LOCK_ACCOUNT', label: 'Lock account (web login)' },
  { value: 'AUTO_ISSUE_QUERY', label: 'Raise query for employee' },
  { value: 'CUSTOM', label: 'Custom message' },
];

function missedActionBadge(action: string): { label: string; cls: string } {
  switch (action) {
    case 'LOCK_ACCOUNT': return { label: 'Lock', cls: 'bg-destructive/10 text-destructive' };
    case 'AUTO_ISSUE_QUERY': return { label: 'Raise query', cls: 'bg-warning/10 text-warning' };
    case 'CUSTOM': return { label: 'Custom', cls: 'bg-info/10 text-info' };
    default: return { label: '—', cls: 'bg-muted text-muted-foreground' };
  }
}

export default function TrainingPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<{ course_id: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [form, setForm] = useState<CourseForm>({ ...emptyForm });
  const [strict, setStrict] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleVideoFile = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_VIDEO_TYPES.includes(file.type)) {
      toast.error('Unsupported format — use MP4, WebM, OGG or MOV');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error('Video too large — maximum 50 MB');
      return;
    }
    setUploading(true);
    try {
      const duration = await readVideoDuration(file);
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `course-${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from(VIDEO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      setForm((f) => ({
        ...f,
        video_path: path,
        video_duration_seconds: duration > 0 ? String(Math.round(duration)) : '',
      }));
      toast.success(`Video uploaded${duration > 0 ? ` · ${fmtDuration(duration)}` : ''}`);
    } catch (err) {
      toast.error('Upload failed: ' + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const removeVideo = () => {
    setForm((f) => ({ ...f, video_path: '', video_duration_seconds: '' }));
  };

  const coursePayload = () => {
    const seconds = form.video_duration_seconds ? parseInt(form.video_duration_seconds, 10) : null;
    const interval = form.reassessment_interval_months ? parseInt(form.reassessment_interval_months, 10) : null;
    const hasVideo = Boolean(form.video_path || form.video_url);
    return {
      title: form.title,
      category: form.category || null,
      description: form.description || null,
      instructor: form.instructor || null,
      is_mandatory: form.is_mandatory,
      video_url: form.video_url || null,
      video_path: form.video_path || null,
      video_duration_seconds: seconds && Number.isFinite(seconds) ? seconds : null,
      duration_hours: seconds && seconds > 0
        ? Math.max(1, Math.ceil(seconds / 3600))
        : hasVideo ? null : editing?.duration_hours ?? null,
      is_repetitive: form.is_repetitive,
      reassessment_interval_months: interval,
      renewal_months: interval,
      due_in_days: form.due_in_days ? parseInt(form.due_in_days, 10) : null,
      missed_action: form.missed_action,
      missed_action_grace_days: form.missed_action_grace_days ? parseInt(form.missed_action_grace_days, 10) : 7,
      missed_action_config: form.missed_action === 'CUSTOM' ? { message: form.missed_message } : {},
      pass_pct: form.pass_pct ? (parseInt(form.pass_pct) || 95) : 95,
    };
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const payload = coursePayload();
      const { data, error } = editing
        ? await supabase.from('training_courses').update(payload).eq('id', editing.id).select('id').single()
        : await supabase.from('training_courses').insert(payload).select('id').single();
      if (error) throw error;

      if (editing && editing.video_path && editing.video_path !== payload.video_path) {
        await supabase.storage.from(VIDEO_BUCKET).remove([editing.video_path]);
      }

      let assigned = 0;
      if (payload.is_mandatory && data?.id) {
        const { data: result, error: assignError } = await supabase.rpc('assign_training_course', {
          p_course_id: data.id,
        });
        if (assignError) {
          toast.warning('Course saved but auto-assign failed: ' + assignError.message);
        } else {
          assigned = Number((result as { enrolled?: number } | null)?.enrolled || 0);
          toast.success(`Assigned to ${assigned} active employee${assigned === 1 ? '' : 's'} and notified them`);
        }
      }

      toast.success(editing ? 'Course updated' : 'Course created');
      setCreateOpen(false);
      setEditing(null);
      setForm({ ...emptyForm });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
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
    {
      key: 'duration_hours', label: 'Duration',
      searchText: (c) => [fmtDuration(c.video_duration_seconds || 0), c.duration_hours ? `${c.duration_hours}h` : ''],
      render: (c) => c.video_duration_seconds
        ? fmtDuration(c.video_duration_seconds)
        : c.duration_hours ? `${c.duration_hours}h` : '—',
    },
    {
      key: 'video_path', label: 'Lesson',
      searchText: (c) => [c.video_path || '', c.video_url || ''],
      render: (c) => {
        if (c.video_path) {
          return (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <Video className="h-3.5 w-3.5" />
              Uploaded{c.video_duration_seconds ? ` · ${fmtDuration(c.video_duration_seconds)}` : ''}
            </span>
          );
        }
        if (c.video_url) {
          return (
            <a href={c.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Video className="h-3.5 w-3.5" />
              Video
            </a>
          );
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
    {
      key: 'reassessment_interval_months', label: 'Repeats',
      searchText: (c) => [c.is_repetitive ? String(c.reassessment_interval_months || c.renewal_months || '') : (c.renewal_months ? String(c.renewal_months) : '')],
      render: (c) => {
        const months = c.reassessment_interval_months ?? c.renewal_months;
        if (c.is_repetitive && months) return <Badge variant="outline" className="bg-warning/10 text-warning">Every {months} mo</Badge>;
        if (c.is_repetitive) return <Badge variant="outline" className="bg-warning/10 text-warning">Repetitive</Badge>;
        if (months) return <Badge variant="outline" className="bg-info/10 text-info">Renews {months} mo</Badge>;
        return <span className="text-muted-foreground">—</span>;
      },
    },
    {
      key: 'due_in_days', label: 'Deadline',
      searchText: (c) => [c.due_in_days ? `${c.due_in_days}d` : ''],
      render: (c) => c.due_in_days
        ? <Badge variant="outline" className="bg-muted text-muted-foreground">{c.due_in_days} days</Badge>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'missed_action', label: 'If missed',
      searchText: (c) => [c.missed_action || ''],
      render: (c) => {
        const b = missedActionBadge(c.missed_action);
        if (c.missed_action === 'NONE') return <span className="text-muted-foreground">—</span>;
        return (
          <span className="inline-flex items-center gap-1">
            <Badge variant="outline" className={b.cls}>{b.label}</Badge>
            <span className="text-xs text-muted-foreground">+{c.missed_action_grace_days}d</span>
          </span>
        );
      },
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

  const videoFileName = form.video_path ? form.video_path.split('/').pop() || form.video_path : '';

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
        <DialogContent className="sm:max-w-xl">
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
                <Label>Instructor</Label>
                <Input value={form.instructor} onChange={(e) => setForm({ ...form, instructor: e.target.value })} placeholder="John Doe" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Lesson video</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_VIDEO_TYPES.join(',')}
                className="hidden"
                onChange={(e) => { void handleVideoFile(e.target.files?.[0]); e.target.value = ''; }}
              />
              {form.video_path ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-xs">
                    <Video className="h-4 w-4 shrink-0 text-success" />
                    <span className="truncate">{videoFileName}</span>
                    {form.video_duration_seconds ? (
                      <Badge variant="outline" className="shrink-0 bg-muted text-muted-foreground">
                        {fmtDuration(parseInt(form.video_duration_seconds, 10))}
                      </Badge>
                    ) : null}
                  </span>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={removeVideo}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" className="w-full" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  {uploading ? 'Uploading…' : 'Upload video (MP4, WebM, OGG — max 50 MB)'}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Length is detected automatically and used as the course duration.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Complete within (days)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.due_in_days}
                  onChange={(e) => setForm({ ...form, due_in_days: e.target.value })}
                  placeholder="e.g. 14"
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
              <div className="space-y-1.5">
                <Label>Grace days</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.missed_action_grace_days}
                  onChange={(e) => setForm({ ...form, missed_action_grace_days: e.target.value })}
                  disabled={form.missed_action === 'NONE'}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>If not completed by deadline</Label>
              <Select
                value={form.missed_action}
                onValueChange={(v) => setForm({ ...form, missed_action: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {missedActionOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Applied after the grace period: lock blocks web login only (clock in/out stays available),
                raise query opens a query for the employee, or send your own message.
              </p>
            </div>

            {form.missed_action === 'CUSTOM' && (
              <div className="space-y-1.5">
                <Label>Custom message</Label>
                <Textarea
                  value={form.missed_message}
                  onChange={(e) => setForm({ ...form, missed_message: e.target.value })}
                  rows={2}
                  placeholder="Please complete {course} today. Contact your supervisor. ({employee})"
                />
                <p className="text-xs text-muted-foreground">Placeholders: {'{course}'}, {'{employee}'}</p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Switch checked={form.is_mandatory} onCheckedChange={(v) => setForm({ ...form, is_mandatory: v })} />
              <Label className="cursor-pointer" onClick={() => setForm({ ...form, is_mandatory: !form.is_mandatory })}>
                Mandatory course — everyone is enrolled and notified
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_repetitive} onCheckedChange={(v) => setForm({ ...form, is_repetitive: v })} />
              <Label className="cursor-pointer" onClick={() => setForm({ ...form, is_repetitive: !form.is_repetitive })}>
                Repetitive course — requires reassessment
              </Label>
            </div>
            {form.is_repetitive && (
              <div className="space-y-1.5">
                <Label>Reassessment interval (months)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.reassessment_interval_months}
                  onChange={(e) => setForm({ ...form, reassessment_interval_months: e.target.value })}
                  placeholder="12"
                />
                <p className="text-xs text-muted-foreground">
                  Certificates expire after this period; the next cycle opens automatically and reminders are sent.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={!form.title || uploading || saving}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
