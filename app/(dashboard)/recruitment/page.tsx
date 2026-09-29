'use client';

import { useState, useCallback } from 'react';
import { useEffect } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Briefcase, CheckCircle, Clock, Users, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Job {
  id: string;
  title: string;
  department_id: string | null;
  position_id: string | null;
  description: string | null;
  requirements: string | null;
  status: string;
  employment_type: string | null;
  posted_date: string | null;
  closing_date: string | null;
  requisition_id: string | null;
}

interface Department { id: string; name: string }
interface Position { id: string; title: string }

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'];

export default function RecruitmentPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [form, setForm] = useState({
    title: '',
    department_id: '',
    position_id: '',
    description: '',
    requirements: '',
    employment_type: 'FULL_TIME',
    closing_date: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jRes, dRes, pRes, cRes] = await Promise.all([
        supabase.from('recruitment_jobs').select('*').order('created_at', { ascending: false }),
        supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
        supabase.from('positions').select('id, title').eq('is_active', true).order('title'),
        supabase.from('candidates').select('job_id'),
      ]);
      setJobs((jRes.data || []) as unknown as Job[]);
      setDepartments(dRes.data || []);
      setPositions((pRes.data || []).map((p) => ({ id: p.id, title: p.title })));
      const counts: Record<string, number> = {};
      for (const c of (cRes.data || []) as { job_id: string }[]) {
        counts[c.job_id] = (counts[c.job_id] || 0) + 1;
      }
      setCandidateCounts(counts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({
      title: '',
      department_id: '',
      position_id: '',
      description: '',
      requirements: '',
      employment_type: 'FULL_TIME',
      closing_date: '',
    });
  };

  const openCreate = () => {
    setEditingJob(null);
    resetForm();
    setCreateOpen(true);
  };

  const openEdit = (job: Job) => {
    setEditingJob(job);
    setForm({
      title: job.title,
      department_id: job.department_id || '',
      position_id: job.position_id || '',
      description: job.description || '',
      requirements: job.requirements || '',
      employment_type: job.employment_type || 'FULL_TIME',
      closing_date: job.closing_date || '',
    });
    setCreateOpen(true);
  };

  const handleSave = async () => {
    if (!form.title) {
      toast.error('Job title is required');
      return;
    }
    try {
      const payload = {
        title: form.title,
        department_id: form.department_id || null,
        position_id: form.position_id || null,
        description: form.description || null,
        requirements: form.requirements || null,
        employment_type: form.employment_type,
        closing_date: form.closing_date || null,
      };
      if (editingJob) {
        const { error } = await supabase.from('recruitment_jobs').update(payload).eq('id', editingJob.id);
        if (error) throw error;
        toast.success('Job updated');
      } else {
        const { error } = await supabase.from('recruitment_jobs').insert({
          ...payload,
          status: 'DRAFT',
          requisition_id: null,
        });
        if (error) throw error;
        toast.success('Job created as draft');
      }
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const publishJob = async (job: Job) => {
    try {
      const { error } = await supabase.from('recruitment_jobs').update({
        status: 'OPEN',
        posted_date: new Date().toISOString(),
      }).eq('id', job.id);
      if (error) throw error;
      toast.success('Job published');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const closeJob = async (job: Job) => {
    try {
      const { error } = await supabase.from('recruitment_jobs').update({
        status: 'CLOSED',
        closing_date: job.closing_date || new Date().toISOString().slice(0, 10),
      }).eq('id', job.id);
      if (error) throw error;
      toast.success('Job closed');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const reopenJob = async (job: Job) => {
    try {
      const { error } = await supabase.from('recruitment_jobs').update({
        status: 'OPEN',
        closing_date: null,
      }).eq('id', job.id);
      if (error) throw error;
      toast.success('Job reopened');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    OPEN: 'bg-success/10 text-success',
    CLOSED: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Jobs', value: jobs.length, icon: Briefcase, color: 'primary' },
    { label: 'Open', value: jobs.filter((j) => j.status === 'OPEN').length, icon: CheckCircle, color: 'success' },
    { label: 'Draft', value: jobs.filter((j) => j.status === 'DRAFT').length, icon: Clock, color: 'warning' },
    { label: 'Candidates', value: Object.values(candidateCounts).reduce((s, c) => s + c, 0), icon: Users, color: 'info' },
  ];

  const columns: Column<Job>[] = [
    { key: 'title', label: 'Job Title' },
    { key: 'department_id', label: 'Department', render: (j) => departments.find((d) => d.id === j.department_id)?.name || '—' },
    { key: 'position_id', label: 'Position', render: (j) => positions.find((p) => p.id === j.position_id)?.title || '—' },
    { key: 'employment_type', label: 'Type', render: (j) => (j.employment_type || '—').replace(/_/g, ' ') },
    { key: 'applicants', label: 'Applicants', render: (j) => <Badge variant="secondary">{candidateCounts[j.id] || 0}</Badge> },
    { key: 'posted_date', label: 'Posted', render: (j) => j.posted_date ? new Date(j.posted_date).toLocaleDateString() : '—' },
    { key: 'closing_date', label: 'Closing', render: (j) => j.closing_date || '—' },
    {
      key: 'status', label: 'Status',
      render: (j) => <Badge variant="outline" className={statusColors[j.status] || ''}>{j.status}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Job Postings"
        description="Manage job postings through the publishing lifecycle"
        summaryCards={summaryCards}
        columns={columns}
        data={jobs}
        loading={loading}
        searchPlaceholder="Search jobs..."
        statusKey="status"
        createLabel="New Job"
        onCreate={openCreate}
        rowActions={(j) => (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => openEdit(j)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {j.status === 'DRAFT' && (
              <Button size="sm" variant="ghost" onClick={() => publishJob(j)}>Publish</Button>
            )}
            {j.status === 'OPEN' && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => closeJob(j)}>Close</Button>
            )}
            {j.status === 'CLOSED' && (
              <Button size="sm" variant="ghost" onClick={() => reopenJob(j)}>Reopen</Button>
            )}
          </div>
        )}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingJob ? 'Edit Job' : 'Create Job'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Job Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Senior Frontend Engineer" />
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
                <Label>Employment Type</Label>
                <Select value={form.employment_type} onValueChange={(v) => setForm({ ...form, employment_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Closing Date</Label>
                <Input type="date" value={form.closing_date} onChange={(e) => setForm({ ...form, closing_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>Requirements</Label>
              <Textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.title}>{editingJob ? 'Save Changes' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}