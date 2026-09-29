'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { UserPlus, Users, CheckCircle, Clock, Briefcase, Star, Calendar, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { enqueueAndProcess } from '@/lib/notifications';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAccess } from '@/lib/access';

interface Candidate {
  id: string;
  job_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  resume_url: string | null;
  current_stage: string;
  rating: number | null;
  notes: string | null;
  created_at: string;
}

interface Job { id: string; title: string }
interface Interview {
  id: string;
  candidate_id: string;
  round: string;
  scheduled_at: string;
  mode: string;
  status: string;
  feedback: string | null;
  rating: number | null;
  interviewers: { name: string }[] | null;
}
interface Assessment {
  id: string;
  candidate_id: string;
  type: string;
  score: number | null;
  max_score: number | null;
  notes: string | null;
  taken_at: string | null;
}
interface Offer {
  id: string;
  candidate_id: string;
  job_id: string | null;
  offered_salary: number | null;
  offer_date: string | null;
  expiry_date: string | null;
  status: string;
  notes: string | null;
}
interface OnboardingTemplate { id: string; name: string }

const STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
const INTERVIEW_ROUNDS = ['FIRST', 'SECOND', 'TECHNICAL', 'PANEL', 'FINAL', 'HR'];
const INTERVIEW_MODES = ['IN_PERSON', 'VIDEO', 'PHONE'];
const INTERVIEW_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const ASSESSMENT_TYPES = ['TECHNICAL', 'APTITUDE', 'BEHAVIORAL', 'CODING', 'WRITTEN', 'OTHER'];
const OFFER_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'];

export default function CandidatesPage() {
  const { employee } = useAccess();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ job_id: '', first_name: '', last_name: '', email: '', phone: '', notes: '' });

  const [detailCandidate, setDetailCandidate] = useState<Candidate | null>(null);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [detailTab, setDetailTab] = useState('interviews');
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [siForm, setSiForm] = useState({ round: 'FIRST', scheduled_at: '', mode: 'IN_PERSON', interviewers: '', feedback: '', rating: '' });
  const [saForm, setSaForm] = useState({ type: 'TECHNICAL', score: '', max_score: '', notes: '' });
  const [soForm, setSoForm] = useState({ offered_salary: '', expiry_date: '', notes: '' });
  const [hireForm, setHireForm] = useState({ template_id: '', employee_id: '', hire_date: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, jRes, tRes] = await Promise.all([
        supabase.from('candidates').select('*').order('created_at', { ascending: false }),
        supabase.from('recruitment_jobs').select('id, title'),
        supabase.from('onboarding_templates').select('id, name').eq('is_active', true).order('name'),
      ]);
      setCandidates((cRes.data || []) as unknown as Candidate[]);
      setJobs((jRes.data || []) as unknown as Job[]);
      setTemplates((tRes.data || []) as unknown as OnboardingTemplate[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const jobTitle = (id: string) => jobs.find((j) => j.id === id)?.title || '—';

  const handleCreate = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
      toast.error('Please enter a valid email address');
      return;
    }
    try {
      const { error } = await supabase.from('candidates').insert({
        job_id: form.job_id,
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone || null,
        notes: form.notes || null,
        current_stage: 'APPLIED',
      });
      if (error) throw error;
      toast.success('Candidate added');
      setCreateOpen(false);
      setForm({ job_id: '', first_name: '', last_name: '', email: '', phone: '', notes: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openDetail = async (c: Candidate) => {
    setDetailCandidate(c);
    setDetailTab('interviews');
    await Promise.all([
      supabase.from('interviews').select('*').eq('candidate_id', c.id).order('scheduled_at', { ascending: true })
        .then(({ data }) => setInterviews((data || []) as unknown as Interview[])),
      supabase.from('candidate_assessments').select('*').eq('candidate_id', c.id).order('taken_at', { ascending: false })
        .then(({ data }) => setAssessments((data || []) as unknown as Assessment[])),
      supabase.from('job_offers').select('*').eq('candidate_id', c.id).order('created_at', { ascending: false })
        .then(({ data }) => setOffers((data || []) as unknown as Offer[])),
    ]);
  };

  const advanceStage = async (c: Candidate, next: string) => {
    try {
      const { error } = await supabase.from('candidates').update({ current_stage: next }).eq('id', c.id);
      if (error) throw error;
      toast.success(`Moved to ${next}`);
      await enqueueAndProcess({
        eventKey: 'candidate.stage_changed',
        recipientEmail: c.email,
        recipientName: `${c.first_name} ${c.last_name}`,
        subject: `Application status update: ${next}`,
        bodyHtml: `<p>Hi ${c.first_name},</p><p>Your application status has been updated to <strong>${next}</strong>.</p>`,
        metadata: { candidate_name: `${c.first_name} ${c.last_name}`, stage: next },
      });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const setRating = async (c: Candidate, rating: number) => {
    try {
      const { error } = await supabase.from('candidates').update({ rating }).eq('id', c.id);
      if (error) throw error;
      toast.success(`Rated ${rating}/5`);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const saveInterview = async () => {
    if (!detailCandidate) return;
    if (!siForm.scheduled_at) {
      toast.error('Scheduled date/time is required');
      return;
    }
    try {
      const interviewers = siForm.interviewers
        ? siForm.interviewers.split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name }))
        : [];
      const { error } = await supabase.from('interviews').insert({
        candidate_id: detailCandidate.id,
        round: siForm.round,
        scheduled_at: new Date(siForm.scheduled_at).toISOString(),
        mode: siForm.mode,
        interviewers: interviewers,
        status: 'SCHEDULED',
        feedback: siForm.feedback || null,
        rating: siForm.rating === '' ? null : Number(siForm.rating),
      });
      if (error) throw error;
      toast.success('Interview scheduled');
      setInterviewOpen(false);
      setSiForm({ round: 'FIRST', scheduled_at: '', mode: 'IN_PERSON', interviewers: '', feedback: '', rating: '' });
      if (detailCandidate.current_stage === 'APPLIED' || detailCandidate.current_stage === 'SCREENING') {
        await advanceStage(detailCandidate, 'INTERVIEW');
      }
      openDetail(detailCandidate);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const completeInterview = async (iv: Interview) => {
    try {
      const { error } = await supabase.from('interviews').update({ status: 'COMPLETED' }).eq('id', iv.id);
      if (error) throw error;
      toast.success('Interview marked complete');
      if (detailCandidate) openDetail(detailCandidate);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const saveAssessment = async () => {
    if (!detailCandidate) return;
    try {
      const { error } = await supabase.from('candidate_assessments').insert({
        candidate_id: detailCandidate.id,
        type: saForm.type,
        score: saForm.score === '' ? null : Number(saForm.score),
        max_score: saForm.max_score === '' ? null : Number(saForm.max_score),
        notes: saForm.notes || null,
        taken_at: new Date().toISOString().slice(0, 10),
        created_by: employee?.id || null,
      });
      if (error) throw error;
      toast.success('Assessment recorded');
      setAssessmentOpen(false);
      setSaForm({ type: 'TECHNICAL', score: '', max_score: '', notes: '' });
      openDetail(detailCandidate);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const saveOffer = async () => {
    if (!detailCandidate) return;
    try {
      const { error } = await supabase.from('job_offers').insert({
        candidate_id: detailCandidate.id,
        job_id: detailCandidate.job_id,
        offered_salary: soForm.offered_salary === '' ? null : Number(soForm.offered_salary),
        offer_date: new Date().toISOString().slice(0, 10),
        expiry_date: soForm.expiry_date || null,
        status: 'PENDING',
        notes: soForm.notes || null,
        offered_by: employee?.id || null,
      });
      if (error) throw error;
      toast.success('Offer created');
      setOfferOpen(false);
      setSoForm({ offered_salary: '', expiry_date: '', notes: '' });
      if (detailCandidate.current_stage === 'INTERVIEW' || detailCandidate.current_stage === 'SCREENING') {
        await advanceStage(detailCandidate, 'OFFER');
      }
      openDetail(detailCandidate);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const setOfferStatus = async (o: Offer, status: string) => {
    try {
      const { error } = await supabase.from('job_offers').update({ status }).eq('id', o.id);
      if (error) throw error;
      const msg = status === 'ACCEPTED' ? 'Offer accepted' : status === 'DECLINED' ? 'Offer declined' : `Offer ${status.toLowerCase()}`;
      toast.success(msg);
      if (status === 'ACCEPTED' && detailCandidate) {
        await advanceStage(detailCandidate, 'OFFER');
      }
      if (detailCandidate) openDetail(detailCandidate);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const hireCandidate = async () => {
    if (!detailCandidate) return;
    try {
      const { data: newEmployeeId, error } = await supabase.rpc('hire_candidate', {
        p_candidate_id: detailCandidate.id,
        p_onboarding_template_id: hireForm.template_id || null,
        p_employee_id_text: hireForm.employee_id || null,
        p_hire_date: hireForm.hire_date || undefined,
      });
      if (error) throw error;
      toast.success('Candidate hired and employee record created');
      setHireOpen(false);
      setHireForm({ template_id: '', employee_id: '', hire_date: '' });
      enqueueAndProcess({
        eventKey: 'employee.created',
        recipientEmail: detailCandidate.email,
        recipientName: `${detailCandidate.first_name} ${detailCandidate.last_name}`,
        subject: 'Welcome to the team!',
        bodyHtml: `<p>Hi ${detailCandidate.first_name},</p><p>Congratulations! Your employee onboarding has been initiated. Please sign in to complete your onboarding steps.</p>`,
        metadata: { employee_id: newEmployeeId, candidate_name: `${detailCandidate.first_name} ${detailCandidate.last_name}` },
      }).catch((err) => console.error('Welcome email failed:', err));
      await load();
      setDetailCandidate(null);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const stageColors: Record<string, string> = {
    APPLIED: 'bg-muted text-muted-foreground',
    SCREENING: 'bg-info/10 text-info',
    INTERVIEW: 'bg-warning/10 text-warning',
    OFFER: 'bg-primary/10 text-primary',
    HIRED: 'bg-success/10 text-success',
    REJECTED: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Candidates', value: candidates.length, icon: Users, color: 'primary' },
    { label: 'Applied', value: candidates.filter((c) => c.current_stage === 'APPLIED').length, icon: Clock, color: 'warning' },
    { label: 'Interview', value: candidates.filter((c) => c.current_stage === 'INTERVIEW').length, icon: UserPlus, color: 'info' },
    { label: 'Hired', value: candidates.filter((c) => c.current_stage === 'HIRED').length, icon: CheckCircle, color: 'success' },
  ];

  const columns: Column<Candidate>[] = [
    { key: 'name', label: 'Name', render: (c) => `${c.first_name} ${c.last_name}` },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone', render: (c) => c.phone || '—' },
    { key: 'job', label: 'Position', render: (c) => jobTitle(c.job_id) },
    { key: 'rating', label: 'Rating', render: (c) => (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={(e) => { e.stopPropagation(); setRating(c, n); }} className="p-0.5" title={`${n} star`}>
            <Star className={`h-3.5 w-3.5 ${(c.rating || 0) >= n ? 'fill-warning text-warning' : 'text-muted-foreground'}`} />
          </button>
        ))}
      </div>
    ) },
    {
      key: 'current_stage', label: 'Stage',
      render: (c) => <Badge variant="outline" className={stageColors[c.current_stage] || ''}>{c.current_stage}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Candidates"
        description="Track applicants through your hiring pipeline"
        summaryCards={summaryCards}
        columns={columns}
        data={candidates}
        loading={loading}
        searchPlaceholder="Search candidates..."
        statusKey="current_stage"
        createLabel="Add Candidate"
        onCreate={() => setCreateOpen(true)}
        onRowClick={openDetail}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Candidate</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Job Posting</Label>
              <Select value={form.job_id} onValueChange={(v) => setForm({ ...form, job_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
                <SelectContent>
                  {jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>First Name *</Label>
                <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Last Name *</Label>
                <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.job_id || !form.first_name || !form.last_name || !form.email}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailCandidate} onOpenChange={(o) => { if (!o) setDetailCandidate(null); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto">
          {detailCandidate && (
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {detailCandidate.first_name} {detailCandidate.last_name}
                <Badge variant="outline" className={stageColors[detailCandidate.current_stage] || ''}>{detailCandidate.current_stage}</Badge>
              </DialogTitle>
              <div className="text-sm text-muted-foreground">{detailCandidate.email} · {jobTitle(detailCandidate.job_id)}</div>
            </DialogHeader>
          )}
          {detailCandidate && (
            <div className="space-y-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                {detailCandidate.resume_url && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={detailCandidate.resume_url} target="_blank" rel="noreferrer">
                      <FileText className="mr-2 h-4 w-4" /> View Resume
                    </a>
                  </Button>
                )}
                {detailCandidate.current_stage !== 'HIRED' && detailCandidate.current_stage !== 'REJECTED' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setInterviewOpen(true); }}>
                      <Calendar className="mr-2 h-4 w-4" /> Interview
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setAssessmentOpen(true); }}>
                      <FileText className="mr-2 h-4 w-4" /> Assessment
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setOfferOpen(true); }}>
                      <Briefcase className="mr-2 h-4 w-4" /> Offer
                    </Button>
                    <Button size="sm" variant="default" onClick={() => { setHireForm({ template_id: '', employee_id: '', hire_date: new Date().toISOString().slice(0, 10) }); setHireOpen(true); }}>
                      Hire
                    </Button>
                  </>
                )}
                {detailCandidate.current_stage === 'OFFER' && (
                  <Button size="sm" variant="outline" onClick={() => { setHireForm({ template_id: '', employee_id: '', hire_date: new Date().toISOString().slice(0, 10) }); setHireOpen(true); }}>
                    Hire
                  </Button>
                )}
              </div>

              <Tabs value={detailTab} onValueChange={setDetailTab}>
                <TabsList>
                  <TabsTrigger value="interviews">Interviews</TabsTrigger>
                  <TabsTrigger value="assessments">Assessments</TabsTrigger>
                  <TabsTrigger value="offers">Offers</TabsTrigger>
                </TabsList>

                <TabsContent value="interviews" className="space-y-3">
                  {interviews.length === 0 && (
                    <p className="py-4 text-sm text-muted-foreground">No interviews scheduled yet.</p>
                  )}
                  {interviews.map((iv) => (
                    <div key={iv.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{iv.round}</Badge>
                          <span className="text-sm font-medium">{new Date(iv.scheduled_at).toLocaleString()}</span>
                          <Badge variant="outline">{iv.mode}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={iv.status === 'COMPLETED' ? 'bg-success/10 text-success' : iv.status === 'CANCELLED' ? 'bg-destructive/10 text-destructive' : ''}>{iv.status}</Badge>
                          {iv.status === 'SCHEDULED' && (
                            <Button size="sm" variant="ghost" onClick={() => completeInterview(iv)}>Complete</Button>
                          )}
                        </div>
                      </div>
                      {iv.interviewers && (iv.interviewers as { name: string }[]).length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Panel: {(iv.interviewers as { name: string }[]).map((p) => p.name).join(', ')}
                        </p>
                      )}
                      {iv.rating !== null && <p className="mt-1 text-xs">Rating: {iv.rating}/5</p>}
                      {iv.feedback && <p className="mt-1 text-sm">{iv.feedback}</p>}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="assessments" className="space-y-3">
                  {assessments.length === 0 && (
                    <p className="py-4 text-sm text-muted-foreground">No assessments recorded.</p>
                  )}
                  {assessments.map((a) => (
                    <div key={a.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">{a.type}</Badge>
                        <span className="text-sm font-medium">
                          {a.score === null ? '—' : a.max_score === null ? `${a.score}/5` : `${a.score}/${a.max_score}`}
                        </span>
                      </div>
                      {a.notes && <p className="mt-1 text-sm">{a.notes}</p>}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="offers" className="space-y-3">
                  {offers.length === 0 && (
                    <p className="py-4 text-sm text-muted-foreground">No offers made yet.</p>
                  )}
                  {offers.map((o) => (
                    <div key={o.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {o.offered_salary !== null && (
                            <span className="text-sm font-medium">${Number(o.offered_salary).toLocaleString()}</span>
                          )}
                          <Badge variant="outline" className={o.status === 'ACCEPTED' ? 'bg-success/10 text-success' : o.status === 'DECLINED' ? 'bg-destructive/10 text-destructive' : ''}>{o.status}</Badge>
                        </div>
                        {o.status === 'PENDING' && (
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => setOfferStatus(o, 'ACCEPTED')}>Accept</Button>
                            <Button size="sm" variant="outline" onClick={() => setOfferStatus(o, 'DECLINED')}>Decline</Button>
                          </div>
                        )}
                      </div>
                      {o.notes && <p className="mt-1 text-sm">{o.notes}</p>}
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailCandidate(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={interviewOpen} onOpenChange={setInterviewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Interview</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Round</Label>
                <Select value={siForm.round} onValueChange={(v) => setSiForm({ ...siForm, round: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INTERVIEW_ROUNDS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select value={siForm.mode} onValueChange={(v) => setSiForm({ ...siForm, mode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INTERVIEW_MODES.map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Scheduled Date/Time *</Label>
              <Input type="datetime-local" value={siForm.scheduled_at} onChange={(e) => setSiForm({ ...siForm, scheduled_at: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Panel (comma-separated names)</Label>
              <Input value={siForm.interviewers} onChange={(e) => setSiForm({ ...siForm, interviewers: e.target.value })} placeholder="Jane Doe, John Smith" />
            </div>
            <div className="space-y-1.5">
              <Label>Feedback</Label>
              <Textarea value={siForm.feedback} onChange={(e) => setSiForm({ ...siForm, feedback: e.target.value })} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Rating</Label>
              <Input type="number" min={1} max={5} value={siForm.rating} onChange={(e) => setSiForm({ ...siForm, rating: e.target.value })} placeholder="1–5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInterviewOpen(false)}>Cancel</Button>
            <Button onClick={saveInterview}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assessmentOpen} onOpenChange={setAssessmentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Assessment</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={saForm.type} onValueChange={(v) => setSaForm({ ...saForm, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSESSMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Score</Label>
                <Input type="number" step="any" value={saForm.score} onChange={(e) => setSaForm({ ...saForm, score: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Score</Label>
                <Input type="number" step="any" value={saForm.max_score} onChange={(e) => setSaForm({ ...saForm, max_score: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={saForm.notes} onChange={(e) => setSaForm({ ...saForm, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssessmentOpen(false)}>Cancel</Button>
            <Button onClick={saveAssessment}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={offerOpen} onOpenChange={setOfferOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Offer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Offered Salary</Label>
              <Input type="number" step="0.01" value={soForm.offered_salary} onChange={(e) => setSoForm({ ...soForm, offered_salary: e.target.value })} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label>Offer Expiry</Label>
              <Input type="date" value={soForm.expiry_date} onChange={(e) => setSoForm({ ...soForm, expiry_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={soForm.notes} onChange={(e) => setSoForm({ ...soForm, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferOpen(false)}>Cancel</Button>
            <Button onClick={saveOffer}>Create Offer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={hireOpen} onOpenChange={setHireOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Hire Candidate</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Employee ID (optional)</Label>
              <Input value={hireForm.employee_id} onChange={(e) => setHireForm({ ...hireForm, employee_id: e.target.value })} placeholder="EMP-2026-001" />
            </div>
            <div className="space-y-1.5">
              <Label>Hire Date</Label>
              <Input type="date" value={hireForm.hire_date} onChange={(e) => setHireForm({ ...hireForm, hire_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Onboarding Template</Label>
              <Select value={hireForm.template_id} onValueChange={(v) => setHireForm({ ...hireForm, template_id: v })}>
                <SelectTrigger><SelectValue placeholder="Auto (department default)" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              Hires will create an employee record with <strong>ONBOARDING</strong> status and seed onboarding steps.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHireOpen(false)}>Cancel</Button>
            <Button onClick={hireCandidate}>Confirm Hire</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}