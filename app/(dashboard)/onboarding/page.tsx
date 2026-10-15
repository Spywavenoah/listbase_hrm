'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, CheckCircle2, Circle, ClipboardList, ExternalLink,
  FileText, PartyPopper, Plus, Trash2, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAccess } from '@/lib/access';
import type { EmployeeEmergencyContact } from '@/lib/types';

interface TemplateStep {
  progressId: string;
  stepId: string;
  sortOrder: number;
  stepType: string;
  title: string;
  description: string | null;
  isRequired: boolean;
  documentUrl: string | null;
  moduleKey: string | null;
  status: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
}

const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENOTYPES = ['AA', 'AS', 'SS', 'AC'];
const RELATIONSHIPS = ['Spouse', 'Parent', 'Sibling', 'Child', 'Relative', 'Friend', 'Other'];
const STATE_LIST = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

const STEP_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning border-warning/20',
  IN_PROGRESS: 'bg-info/10 text-info border-info/20',
  COMPLETED: 'bg-success/10 text-success border-success/20',
};

// module_key -> employee sub-route, used for CUSTOM_FORM / linked steps.
const MODULE_ROUTES: Record<string, string> = {
  personal: 'personal',
  documents: 'documents',
  guarantor: 'guarantor',
  medical: 'medical',
  qualifications: 'qualifications',
};

// Fields HR owns — never shown to the employee during onboarding.
const HR_ONLY_MODULES = new Set(['employment']);

type StepKind = 'biodata' | 'qualification' | 'medical' | 'document' | 'link' | 'ack';

function resolveKind(step: TemplateStep): StepKind {
  switch (step.stepType) {
    case 'BIODATA':
      return 'biodata';
    case 'QUALIFICATION':
      return 'qualification';
    case 'MEDICAL':
      return 'medical';
    case 'DOCUMENT_ACK':
      return 'document';
    case 'CUSTOM_FORM':
      return step.moduleKey && MODULE_ROUTES[step.moduleKey] ? 'link' : 'ack';
    default:
      return step.moduleKey && MODULE_ROUTES[step.moduleKey] ? 'link' : 'ack';
  }
}

export default function OnboardingPage() {
  const router = useRouter();
  const { employee } = useAccess();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [steps, setSteps] = useState<TemplateStep[]>([]);
  const [active, setActive] = useState(0);
  const [savingBio, setSavingBio] = useState(false);

  const [bio, setBio] = useState({
    first_name: '', last_name: '', email: '', phone: '', date_of_birth: '',
    gender: '', marital_status: '', nationality: '', state_of_origin: '', lga: '',
    residential_address: '', permanent_address: '', city: '', state: '', country: '',
    postal_code: '', blood_group: '', genotype: '',
  });
  const [contacts, setContacts] = useState<EmployeeEmergencyContact[]>([]);
  const [contactDraft, setContactDraft] = useState({
    name: '', relationship: '', phone: '', email: '', is_primary: false,
  });
  const [addingContact, setAddingContact] = useState(false);

  const employeeId = employee?.id || '';
  const isOnboarding =
    !!employee && (employee.employment_status === 'ONBOARDING' || employee.employment_status === 'PENDING_VERIFICATION');

  const visibles = useMemo(
    () => steps.filter((s) => !(s.moduleKey && HR_ONLY_MODULES.has(s.moduleKey))),
    [steps]
  );

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const [empRes, progressRes, contactRes, qualRes, medRes] = await Promise.all([
        supabase.from('employees').select('*').eq('id', employeeId).maybeSingle(),
        supabase
          .from('employee_onboarding_progress')
          .select('id, step_id, status, acknowledged_at, completed_at, onboarding_steps(sort_order, step_type, title, description, is_required, document_url, module_key)')
          .eq('employee_id', employeeId),
        supabase.from('employee_emergency_contacts').select('*').eq('employee_id', employeeId).order('is_primary', { ascending: false }),
        supabase.from('employee_qualifications').select('id').eq('employee_id', employeeId).limit(1),
        supabase.from('employee_medical').select('id').eq('employee_id', employeeId).maybeSingle(),
      ]);

      if (empRes.data) {
        const d = empRes.data;
        setBio({
          first_name: d.first_name || '', last_name: d.last_name || '', email: d.email || '',
          phone: d.phone || '', date_of_birth: d.date_of_birth || '', gender: d.gender || '',
          marital_status: d.marital_status || '', nationality: d.nationality || '',
          state_of_origin: d.state_of_origin || '', lga: d.lga || '',
          residential_address: d.residential_address || d.address || '',
          permanent_address: d.permanent_address || '', city: d.city || '', state: d.state || '',
          country: d.country || '', postal_code: d.postal_code || '',
          blood_group: d.blood_group || '', genotype: d.genotype || '',
        });
      }
      setContacts((contactRes.data || []) as unknown as EmployeeEmergencyContact[]);

      type ProgressRow = {
        id: string;
        step_id: string;
        status: string;
        acknowledged_at: string | null;
        completed_at: string | null;
        onboarding_steps: {
          sort_order: number; step_type: string; title: string; description: string | null;
          is_required: boolean; document_url: string | null; module_key: string | null;
        } | null;
      };

      const mapRows = (input: ProgressRow[]): TemplateStep[] =>
        input
          .filter((r) => r.onboarding_steps)
          .map((r) => ({
            progressId: r.id,
            stepId: r.step_id,
            sortOrder: r.onboarding_steps!.sort_order,
            stepType: r.onboarding_steps!.step_type,
            title: r.onboarding_steps!.title,
            description: r.onboarding_steps!.description,
            isRequired: r.onboarding_steps!.is_required,
            documentUrl: r.onboarding_steps!.document_url,
            moduleKey: r.onboarding_steps!.module_key,
            status: r.status,
            acknowledgedAt: r.acknowledged_at,
            completedAt: r.completed_at,
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder);

      let mapped = mapRows((progressRes.data || []) as unknown as ProgressRow[]);

      const empData = empRes.data;
      const canSelfSeed =
        !!empData &&
        (empData.employment_status === 'ONBOARDING' || empData.employment_status === 'PENDING_VERIFICATION');
      if (mapped.length === 0 && canSelfSeed) {
        let templateId = (empData.onboarding_template_id as string | null) || null;
        if (!templateId) {
          const { data: tpl } = await supabase
            .from('onboarding_templates')
            .select('id')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          templateId = tpl?.id || null;
        }
        if (templateId) {
          const tplId = templateId;
          const { data: tplSteps } = await supabase
            .from('onboarding_steps')
            .select('id')
            .eq('template_id', tplId)
            .order('sort_order', { ascending: true });
          const seedRows = ((tplSteps || []) as Array<{ id: string }>).map((s) => ({
            employee_id: employeeId,
            template_id: tplId,
            step_id: s.id,
            status: 'PENDING',
          }));
          if (seedRows.length > 0) {
            const { error: seedErr } = await supabase
              .from('employee_onboarding_progress')
              .insert(seedRows);
            if (seedErr) {
              console.error('Failed to seed onboarding progress:', seedErr);
            } else {
              const { data: reProgress } = await supabase
                .from('employee_onboarding_progress')
                .select('id, step_id, status, acknowledged_at, completed_at, onboarding_steps(sort_order, step_type, title, description, is_required, document_url, module_key)')
                .eq('employee_id', employeeId);
              mapped = mapRows((reProgress || []) as unknown as ProgressRow[]);
            }
          }
        }
      }

      const hasQuals = (qualRes.data?.length || 0) > 0;
      const hasMedical = !!medRes.data;

      const now = new Date().toISOString();
      const toAuto = mapped.filter((s) => {
        if (s.status === 'COMPLETED') return false;
        const kind = resolveKind(s);
        if (kind === 'qualification') return hasQuals;
        if (kind === 'medical') return hasMedical;
        return false;
      });
      if (toAuto.length > 0) {
        await supabase
          .from('employee_onboarding_progress')
          .update({ status: 'COMPLETED', completed_at: now, acknowledged_at: now })
          .in('id', toAuto.map((s) => s.progressId));
        for (const s of toAuto) s.status = 'COMPLETED';
      }

      setSteps(mapped);
    } catch (err) {
      console.error('Failed to load onboarding:', err);
      toast.error('Could not load your onboarding steps.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const markComplete = async (step: TemplateStep, complete = true) => {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = complete
      ? { status: 'COMPLETED', completed_at: step.completedAt || now, acknowledged_at: step.acknowledgedAt || now }
      : { status: 'IN_PROGRESS' };
    const { error } = await supabase
      .from('employee_onboarding_progress')
      .update(patch)
      .eq('id', step.progressId);
    if (error) { toast.error('Failed: ' + (error as Error).message); return; }
    setSteps((prev) => prev.map((s) => s.progressId === step.progressId
      ? { ...s, status: complete ? 'COMPLETED' : 'IN_PROGRESS', completedAt: complete ? (s.completedAt || now) : s.completedAt, acknowledgedAt: complete ? (s.acknowledgedAt || now) : s.acknowledgedAt }
      : s));
  };

  const saveBio = async (): Promise<boolean> => {
    if (!bio.first_name.trim() || !bio.last_name.trim() || !bio.email.trim()) {
      toast.error('First name, last name and email are required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bio.email)) {
      toast.error('Please enter a valid email address');
      return false;
    }
    setSavingBio(true);
    try {
      const { error } = await supabase
        .from('employees')
        .update({
          first_name: bio.first_name.trim(),
          last_name: bio.last_name.trim(),
          email: bio.email.trim(),
          phone: bio.phone || null,
          date_of_birth: bio.date_of_birth || null,
          gender: bio.gender || null,
          marital_status: bio.marital_status || null,
          nationality: bio.nationality || null,
          state_of_origin: bio.state_of_origin || null,
          lga: bio.lga || null,
          residential_address: bio.residential_address || null,
          permanent_address: bio.permanent_address || null,
          city: bio.city || null,
          state: bio.state || null,
          country: bio.country || null,
          postal_code: bio.postal_code || null,
          blood_group: bio.blood_group || null,
          genotype: bio.genotype || null,
        })
        .eq('id', employeeId);
      if (error) throw error;
      toast.success('Bio-data saved');
      return true;
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
      return false;
    } finally {
      setSavingBio(false);
    }
  };

  const addContact = async () => {
    if (!contactDraft.name.trim()) { toast.error('Contact name is required'); return; }
    setAddingContact(true);
    try {
      const { error } = await supabase.rpc('upsert_my_emergency_contact', {
        p_name: contactDraft.name.trim(),
        p_relationship: contactDraft.relationship || null,
        p_phone: contactDraft.phone || null,
        p_email: contactDraft.email || null,
        p_is_primary: contactDraft.is_primary,
      });
      if (error) throw error;
      toast.success('Emergency contact added');
      setContactDraft({ name: '', relationship: '', phone: '', email: '', is_primary: false });
      const { data } = await supabase.from('employee_emergency_contacts').select('*').eq('employee_id', employeeId).order('is_primary', { ascending: false });
      setContacts((data || []) as unknown as EmployeeEmergencyContact[]);
    } catch (err) {
      toast.error('Failed to add contact: ' + (err as Error).message);
    } finally {
      setAddingContact(false);
    }
  };

  const removeContact = async (id: string) => {
    try {
      const { error } = await supabase.rpc('delete_my_emergency_contact', { p_id: id });
      if (error) throw error;
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      toast.error('Failed to remove: ' + (err as Error).message);
    }
  };

  const completeBioStep = async (step: TemplateStep) => {
    if (contacts.length === 0) { toast.error('Add at least one emergency contact'); return; }
    const ok = await saveBio();
    if (!ok) return;
    await markComplete(step, true);
    toast.success('Step completed');
    if (active < visibles.length - 1) setActive(active + 1);
  };

  const current = visibles[active];
  const currentKind = current ? resolveKind(current) : 'ack';

  const requiredSteps = visibles.filter((s) => s.isRequired);
  const completedRequired = requiredSteps.filter((s) => s.status === 'COMPLETED').length;
  const progressPct = requiredSteps.length ? Math.round((completedRequired / requiredSteps.length) * 100) : 100;
  const allDone = requiredSteps.every((s) => s.status === 'COMPLETED');

  const handleFinish = async () => {
    if (!employeeId) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('complete_onboarding', { p_employee_id: employeeId });
      if (error) { toast.error((error as Error).message); return; }
      if (!data) { toast.error('Onboarding is incomplete — finish all required steps first.'); return; }
      setFinished(true);
      setTimeout(() => window.location.assign('/dashboard'), 2500);
    } catch (err) {
      toast.error('Failed to complete onboarding: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (finished) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Card className="w-full max-w-md animate-in fade-in zoom-in-95">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <PartyPopper className="h-8 w-8 text-success" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Onboarding complete!</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Welcome aboard! Your profile is all set up. Taking you to your dashboard...
              </p>
            </div>
            <Button onClick={() => window.location.assign('/dashboard')} className="mt-2">
              Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Complete your onboarding</h1>
          <Badge variant="outline">{isOnboarding ? 'In Progress' : 'Review'}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {employee ? `Welcome, ${employee.first_name}!` : 'Welcome!'} Work through the steps below to activate your
          account. You will not be able to use the rest of the system until the required steps are done.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              {allDone ? <CheckCircle2 className="h-5 w-5 text-success" /> : <ClipboardList className="h-5 w-5 text-primary" />}
              Your onboarding progress
            </CardTitle>
            <div className="shrink-0 text-right">
              <p className="text-2xl font-bold text-primary">{loading ? '–' : `${progressPct}%`}</p>
              <p className="text-xs text-muted-foreground">{completedRequired} of {requiredSteps.length} required done</p>
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : visibles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <ClipboardList className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">No onboarding steps have been assigned to you yet.</p>
            <Button className="mt-4" disabled={submitting} onClick={handleFinish}>
              {submitting ? 'Completing…' : 'Complete Onboarding'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <ol className="space-y-2">
            {visibles.map((s, idx) => {
              const done = s.status === 'COMPLETED';
              const isActive = idx === active;
              return (
                <li key={s.progressId}>
                  <button
                    type="button"
                    onClick={() => setActive(idx)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      isActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40',
                      done && !isActive ? 'border-success/30 bg-success/5' : ''
                    )}
                  >
                    {done
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{idx + 1}. {s.title}</span>
                      {s.isRequired && <span className="text-[11px] text-muted-foreground">Required</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {current && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg">{current.title}</CardTitle>
                  <Badge variant="outline" className={STEP_STATUS_COLORS[current.status] || ''}>
                    {current.status.replace(/_/g, ' ')}
                  </Badge>
                  {current.isRequired && <Badge variant="outline" className="text-[10px]">Required</Badge>}
                </div>
                {current.description && <CardDescription>{current.description}</CardDescription>}
                {current.documentUrl && (
                  <a href={current.documentUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    <FileText className="h-3.5 w-3.5" /> View attached document
                  </a>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                {currentKind === 'biodata' && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>First Name *</Label>
                        <Input value={bio.first_name} onChange={(e) => setBio({ ...bio, first_name: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Last Name *</Label>
                        <Input value={bio.last_name} onChange={(e) => setBio({ ...bio, last_name: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Email *</Label>
                        <Input type="email" value={bio.email} onChange={(e) => setBio({ ...bio, email: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Phone</Label>
                        <Input value={bio.phone} onChange={(e) => setBio({ ...bio, phone: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Date of Birth</Label>
                        <Input type="date" value={bio.date_of_birth} onChange={(e) => setBio({ ...bio, date_of_birth: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Gender</Label>
                        <Select value={bio.gender} onValueChange={(v) => setBio({ ...bio, gender: v })}>
                          <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Marital Status</Label>
                        <Select value={bio.marital_status} onValueChange={(v) => setBio({ ...bio, marital_status: v })}>
                          <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                          <SelectContent>
                            {MARITAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Nationality</Label>
                        <Input value={bio.nationality} onChange={(e) => setBio({ ...bio, nationality: e.target.value })} placeholder="e.g. Nigerian" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>State of Origin</Label>
                        <Select value={bio.state_of_origin} onValueChange={(v) => setBio({ ...bio, state_of_origin: v })}>
                          <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {STATE_LIST.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>LGA</Label>
                        <Input value={bio.lga} onChange={(e) => setBio({ ...bio, lga: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Blood Group</Label>
                        <Select value={bio.blood_group} onValueChange={(v) => setBio({ ...bio, blood_group: v })}>
                          <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                          <SelectContent>
                            {BLOOD_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Genotype</Label>
                        <Select value={bio.genotype} onValueChange={(v) => setBio({ ...bio, genotype: v })}>
                          <SelectTrigger><SelectValue placeholder="Select genotype" /></SelectTrigger>
                          <SelectContent>
                            {GENOTYPES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-4">
                      <div className="space-y-1.5">
                        <Label>Residential Address</Label>
                        <Textarea rows={2} value={bio.residential_address} onChange={(e) => setBio({ ...bio, residential_address: e.target.value })} />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label>City</Label>
                          <Input value={bio.city} onChange={(e) => setBio({ ...bio, city: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>State</Label>
                          <Select value={bio.state} onValueChange={(v) => setBio({ ...bio, state: v })}>
                            <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                            <SelectContent className="max-h-72">
                              {STATE_LIST.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Postal Code</Label>
                          <Input value={bio.postal_code} onChange={(e) => setBio({ ...bio, postal_code: e.target.value })} />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-border pt-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        <h4 className="text-sm font-semibold">Emergency Contacts</h4>
                      </div>
                      {contacts.length === 0 ? (
                        <p className="mb-3 text-sm text-muted-foreground">Add at least one emergency contact.</p>
                      ) : (
                        <div className="mb-3 space-y-2">
                          {contacts.map((c) => (
                            <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium">
                                  {c.name}
                                  {c.is_primary && <Badge variant="outline" className="ml-2 text-[10px]">Primary</Badge>}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {[c.relationship, c.phone, c.email].filter(Boolean).join(' · ') || '—'}
                                </p>
                              </div>
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeContact(c.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="space-y-1.5">
                          <Label>Full Name *</Label>
                          <Input value={contactDraft.name} onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Relationship</Label>
                          <Select value={contactDraft.relationship} onValueChange={(v) => setContactDraft({ ...contactDraft, relationship: v })}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              {RELATIONSHIPS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Phone</Label>
                          <Input value={contactDraft.phone} onChange={(e) => setContactDraft({ ...contactDraft, phone: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Email</Label>
                          <Input value={contactDraft.email} onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })} />
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input"
                            checked={contactDraft.is_primary}
                            onChange={(e) => setContactDraft({ ...contactDraft, is_primary: e.target.checked })}
                          />
                          Set as primary contact
                        </label>
                        <Button size="sm" variant="outline" onClick={addContact} disabled={addingContact}>
                          <Plus className="mr-1 h-4 w-4" /> {addingContact ? 'Adding…' : 'Add Contact'}
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {currentKind === 'qualification' && (
                  <div className="flex flex-col items-start gap-3">
                    <p className="text-sm text-muted-foreground">
                      Add your education and qualification records on the qualifications page, then mark this step complete.
                    </p>
                    <Button variant="outline" onClick={() => router.push(`/employees/${employeeId}/qualifications`)}>
                      <ExternalLink className="mr-1.5 h-4 w-4" /> Open qualifications
                    </Button>
                    <Button disabled={current.status === 'COMPLETED'} onClick={() => markComplete(current, true)}>
                      {current.status === 'COMPLETED' ? 'Completed' : 'Mark as complete'}
                    </Button>
                  </div>
                )}

                {currentKind === 'medical' && (
                  <div className="flex flex-col items-start gap-3">
                    <p className="text-sm text-muted-foreground">
                      Provide your medical information on the medical page, then mark this step complete.
                    </p>
                    <Button variant="outline" onClick={() => router.push(`/employees/${employeeId}/medical`)}>
                      <ExternalLink className="mr-1.5 h-4 w-4" /> Open medical records
                    </Button>
                    <Button disabled={current.status === 'COMPLETED'} onClick={() => markComplete(current, true)}>
                      {current.status === 'COMPLETED' ? 'Completed' : 'Mark as complete'}
                    </Button>
                  </div>
                )}

                {currentKind === 'link' && current.moduleKey && MODULE_ROUTES[current.moduleKey] && (
                  <div className="flex flex-col items-start gap-3">
                    <p className="text-sm text-muted-foreground">This step is completed on its dedicated page.</p>
                    <Button variant="outline" onClick={() => router.push(`/employees/${employeeId}/${MODULE_ROUTES[current.moduleKey as string]}`)}>
                      <ExternalLink className="mr-1.5 h-4 w-4" /> Open {current.title}
                    </Button>
                    <Button disabled={current.status === 'COMPLETED'} onClick={() => markComplete(current, true)}>
                      {current.status === 'COMPLETED' ? 'Completed' : 'Mark as complete'}
                    </Button>
                  </div>
                )}

                {(currentKind === 'document' || currentKind === 'ack') && (
                  <div className="flex flex-col items-start gap-3">
                    <p className="text-sm text-muted-foreground">
                      {currentKind === 'document'
                        ? 'Please review the document above, then acknowledge it to continue.'
                        : 'Acknowledge this step to continue.'}
                    </p>
                    <Button disabled={current.status === 'COMPLETED'} onClick={() => markComplete(current, true)}>
                      {current.status === 'COMPLETED' ? 'Acknowledged' : 'Acknowledge & continue'}
                    </Button>
                  </div>
                )}
              </CardContent>
              <div className="flex items-center justify-between gap-2 border-t border-border p-4">
                <Button variant="outline" disabled={active === 0} onClick={() => setActive(Math.max(active - 1, 0))}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                </Button>
                <div className="flex items-center gap-2">
                  {currentKind === 'biodata' && (
                    <>
                      <Button variant="outline" disabled={savingBio} onClick={saveBio}>
                        {savingBio ? 'Saving…' : 'Save'}
                      </Button>
                      <Button onClick={() => completeBioStep(current)} disabled={savingBio}>
                        Save &amp; mark complete
                      </Button>
                    </>
                  )}
                  {active < visibles.length - 1 && currentKind !== 'biodata' && (
                    <Button onClick={() => setActive(active + 1)}>
                      Next <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Button>
                  )}
                  {active === visibles.length - 1 && !allDone && (
                    <Button variant="ghost" onClick={() => setActive(0)}>Back to start</Button>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button size="lg" disabled={!allDone || submitting || loading} onClick={handleFinish}>
          {submitting ? 'Completing…' : 'Complete Onboarding'}
        </Button>
      </div>
      {!allDone && !loading && visibles.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Finish all required steps above to activate your account.
        </p>
      )}
    </div>
  );
}


