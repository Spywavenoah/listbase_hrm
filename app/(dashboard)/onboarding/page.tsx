'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { CheckCircle2, Circle, ArrowRight, PartyPopper, AlertTriangle, FileText, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';

const REQUIRED_PERSONAL_FIELDS: { key: string; label: string }[] = [
  { key: 'phone', label: 'Phone number' },
  { key: 'date_of_birth', label: 'Date of birth' },
  { key: 'gender', label: 'Gender' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'emergency_contact_name', label: 'Emergency contact' },
];

interface StepState {
  key: string;
  label: string;
  href: string;
  description: string;
  done: boolean;
  missing?: { key: string; label: string }[];
}

interface TemplateStep {
  id: string;
  progressId: string;
  sort_order: number;
  step_type: string;
  title: string;
  description: string | null;
  is_required: boolean;
  document_url: string | null;
  module_key: string | null;
  status: string;
  acknowledged_at: string | null;
  completed_at: string | null;
}

const MODULE_MAP: Record<string, string> = {
  personal: 'personal',
  employment: 'employment',
  documents: 'documents',
  guarantor: 'guarantor',
  medical: 'medical',
  qualifications: 'qualifications',
};

const TEMPLATE_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning border-warning/20',
  IN_PROGRESS: 'bg-info/10 text-info border-info/20',
  COMPLETED: 'bg-success/10 text-success border-success/20',
};

export default function OnboardingPage() {
  const router = useRouter();
  const { employee } = useAccess();
  const [steps, setSteps] = useState<StepState[]>([]);
  const [templateSteps, setTemplateSteps] = useState<TemplateStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);

  const employeeId = employee?.id || '';
  const isOnboarding =
    !!employee && (employee.employment_status === 'ONBOARDING' || employee.employment_status === 'PENDING_VERIFICATION');

  useEffect(() => {
    if (!employeeId) return;
    let active = true;

    async function checkProgress() {
      try {
        const [personal, employment, documents, guarantor, medical, qualifications, progress] = await Promise.all([
          supabase.from('employees').select('phone, date_of_birth, gender, address, city, state, country, emergency_contact_name, emergency_contact_phone').eq('id', employeeId).maybeSingle(),
          supabase.from('employee_employment').select('id').eq('employee_id', employeeId).maybeSingle(),
          supabase.from('employee_documents').select('id').eq('employee_id', employeeId).limit(1),
          supabase.from('employee_guarantors').select('id').eq('employee_id', employeeId).maybeSingle(),
          supabase.from('employee_medical').select('id').eq('employee_id', employeeId).maybeSingle(),
          supabase.from('employee_qualifications').select('id').eq('employee_id', employeeId).limit(1),
          supabase
            .from('employee_onboarding_progress')
            .select('id, step_id, template_id, status, acknowledged_at, completed_at, onboarding_steps(sort_order, step_type, title, description, is_required, document_url, module_key)')
            .eq('employee_id', employeeId),
        ]);

        if (!active) return;

        const bio = (personal.data || {}) as Record<string, unknown>;
        const missing = REQUIRED_PERSONAL_FIELDS.filter((f) => !bio[f.key]);

        const base: StepState[] = [
          {
            key: 'personal',
            label: 'Personal Information',
            href: `/employees/${employeeId}/personal`,
            description: 'Your contact details and personal profile.',
            done: missing.length === 0,
            missing,
          },
          {
            key: 'employment',
            label: 'Employment Details',
            href: `/employees/${employeeId}/employment`,
            description: 'Your job title, department and employment terms.',
            done: !!employment.data,
          },
          {
            key: 'documents',
            label: 'Upload Documents',
            href: `/employees/${employeeId}/documents`,
            description: 'At least one document (e.g. ID, certificate, contract).',
            done: (documents.data?.length || 0) > 0,
          },
          {
            key: 'guarantor',
            label: 'Guarantor Information',
            href: `/employees/${employeeId}/guarantor`,
            description: 'A guarantor reference for your record.',
            done: !!guarantor.data,
          },
          {
            key: 'medical',
            label: 'Medical Records',
            href: `/employees/${employeeId}/medical`,
            description: 'Your medical information and allergies.',
            done: !!medical.data,
          },
          {
            key: 'qualifications',
            label: 'Qualifications & Education',
            href: `/employees/${employeeId}/qualifications`,
            description: 'Your education, institutions and qualifications.',
            done: (qualifications.data?.length || 0) > 0,
          },
        ];

        setSteps(base);

        const doneByModule = Object.fromEntries(
          base.map((s) => [s.key, s.done])
        );

        const rawProgress = (progress.data || []) as unknown as Array<{
          id: string;
          step_id: string;
          status: string;
          acknowledged_at: string | null;
          completed_at: string | null;
          onboarding_steps: {
            sort_order: number;
            step_type: string;
            title: string;
            description: string | null;
            is_required: boolean;
            document_url: string | null;
            module_key: string | null;
          } | null;
        }>;

        const rendered = rawProgress
          .filter((p) => p.onboarding_steps)
          .map((p) => ({
            id: p.step_id,
            progressId: p.id,
            sort_order: p.onboarding_steps!.sort_order,
            step_type: p.onboarding_steps!.step_type,
            title: p.onboarding_steps!.title,
            description: p.onboarding_steps!.description,
            is_required: p.onboarding_steps!.is_required,
            document_url: p.onboarding_steps!.document_url,
            module_key: p.onboarding_steps!.module_key,
            status: p.status,
            acknowledged_at: p.acknowledged_at,
            completed_at: p.completed_at,
          }))
          .sort((a, b) => a.sort_order - b.sort_order);

        const toAutoComplete = rendered.filter(
          (t) =>
            t.status !== 'COMPLETED' &&
            t.module_key &&
            doneByModule[MODULE_MAP[t.module_key]] === true
        );

        if (toAutoComplete.length > 0) {
          const now = new Date().toISOString();
          await supabase
            .from('employee_onboarding_progress')
            .update({ status: 'COMPLETED', completed_at: now, acknowledged_at: now })
            .in('id', toAutoComplete.map((t) => t.progressId));
          for (const t of toAutoComplete) t.status = 'COMPLETED';
        }

        setTemplateSteps(rendered);
      } catch (err) {
        console.error('Failed to load onboarding progress:', err);
        toast.error('Could not load your onboarding progress.');
      } finally {
        if (active) setLoading(false);
      }
    }

    checkProgress();
    return () => {
      active = false;
    };
  }, [employeeId]);

  const toggleTemplateStep = async (t: TemplateStep) => {
    const now = new Date().toISOString();
    const nextStatus = t.status === 'PENDING' ? 'IN_PROGRESS' : t.status === 'IN_PROGRESS' ? 'COMPLETED' : 'IN_PROGRESS';
    const patch: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === 'IN_PROGRESS' && !t.acknowledged_at) patch.acknowledged_at = now;
    if (nextStatus === 'COMPLETED' && !t.completed_at) patch.completed_at = now;
    const { error } = await supabase
      .from('employee_onboarding_progress')
      .update(patch)
      .eq('id', t.progressId);
    if (error) {
      toast.error('Failed: ' + (error as Error).message);
      return;
    }
    setTemplateSteps((prev) =>
      prev.map((st) =>
        st.id === t.id
          ? {
              ...st,
              status: nextStatus,
              acknowledged_at: nextStatus === 'IN_PROGRESS' ? now : st.acknowledged_at,
              completed_at: nextStatus === 'COMPLETED' ? now : st.completed_at,
            }
          : st
      )
    );
  };

  const completedCount = steps.filter((s) => s.done).length;
  const templateCompleted = templateSteps.filter((t) => t.status === 'COMPLETED').length;
  const totalStepCount = steps.length + templateSteps.length;
  const totalCompleted = completedCount + templateCompleted;
  const progressPct = totalStepCount ? Math.round((totalCompleted / totalStepCount) * 100) : 0;
  const allDone =
    steps.length > 0 &&
    completedCount === steps.length &&
    templateSteps.filter((t) => t.is_required).every((t) => t.status === 'COMPLETED');

  const handleFinish = async () => {
    if (!employeeId) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('complete_onboarding', {
        p_employee_id: employeeId,
      });
      if (error) {
        toast.error((error as Error).message);
        return;
      }
      if (!data) {
        toast.error('Onboarding is incomplete — finish all required steps first.');
        return;
      }

      setFinished(true);
      setTimeout(() => {
        window.location.assign('/dashboard');
      }, 2500);
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
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Complete your onboarding</h1>
          <Badge variant="outline">{isOnboarding ? 'In Progress' : 'Review'}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {employee ? `Welcome, ${employee.first_name}!` : 'Welcome!'} Please complete all the required steps below to
          activate your account. You will not be able to use the rest of the system until this is done.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              {allDone ? <CheckCircle2 className="h-5 w-5 text-success" /> : <AlertTriangle className="h-5 w-5 text-primary" />}
              Your progress
            </CardTitle>
            <div className="shrink-0 text-right">
              <p className="text-2xl font-bold text-primary">{loading ? '–' : `${progressPct}%`}</p>
              <p className="text-xs text-muted-foreground">{totalCompleted} of {totalStepCount} done</p>
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">Checking your progress…</div>
          ) : (
            <ol className="space-y-3">
              {steps.map((step) => (
                <li
                  key={step.key}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border p-4 transition-all sm:flex-row sm:items-center sm:gap-3',
                    step.done ? 'border-success/30 bg-success/5' : 'border-border bg-card'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {step.done ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{step.label}</p>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                      {!step.done && step.missing && step.missing.length > 0 && (
                        <p className="mt-1 text-xs text-destructive">
                          Missing: {step.missing.map((m) => m.label).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant={step.done ? 'outline' : 'default'}
                    size="sm"
                    className="shrink-0 sm:ml-auto"
                    onClick={() => router.push(step.href)}
                  >
                    {step.done ? 'Review' : 'Complete'} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}

              {templateSteps.length > 0 && (
                <li className="rounded-lg border border-dashed bg-muted/30 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <ClipboardList className="h-3.5 w-3.5" /> Your onboarding checklist
                  </p>
                  <ol className="space-y-2">
                    {templateSteps.map((t) => (
                      <li
                        key={t.id}
                        className={cn(
                          'flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-3',
                          t.status === 'COMPLETED' ? 'border-success/30 bg-success/5' : 'border-border bg-card'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          {t.status === 'COMPLETED' ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                          ) : (
                            <ClipboardList className="h-5 w-5 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">{t.title}</p>
                              {t.document_url && (
                                <a
                                  href={t.document_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  <FileText className="h-3 w-3" /> View
                                </a>
                              )}
                            </div>
                            {t.description && (
                              <p className="text-xs text-muted-foreground">{t.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:ml-auto">
                          <Badge variant="outline" className={TEMPLATE_STATUS_COLORS[t.status] || ''}>
                            {t.status.replace(/_/g, ' ')}
                          </Badge>
                          <Button
                            variant={t.status === 'COMPLETED' ? 'outline' : 'default'}
                            size="sm"
                            disabled={t.status === 'COMPLETED'}
                            onClick={() => toggleTemplateStep(t)}
                          >
                            {t.status === 'PENDING' ? 'Start' : t.status === 'IN_PROGRESS' ? 'Mark Complete' : 'Done'}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </li>
              )}
            </ol>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" disabled={!allDone || submitting} onClick={handleFinish}>
          {submitting ? 'Completing…' : 'Complete Onboarding'}
        </Button>
      </div>
      {!allDone && !loading && (
        <p className="text-center text-xs text-muted-foreground">
          Finish all required steps above to activate your account.
        </p>
      )}
    </div>
  );
}