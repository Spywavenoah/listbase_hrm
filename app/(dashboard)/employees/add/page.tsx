'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { cn } from '@/lib/utils';
import { saveFieldValues } from '@/lib/field-engine/client';
import { CustomFieldsBlock } from '@/components/field-engine/custom-fields';
import { enqueueAndProcess } from '@/lib/notifications';
import {
  ChevronRight, ChevronLeft, Send, Plus, Trash2, Loader2, FileText,
} from 'lucide-react';

type WizardKey = 'personal' | 'emergency_contacts' | 'guarantor' | 'qualifications' | 'medical' | 'documents';

interface WizardStep {
  key: string;
  label: string;
  description?: string | null;
  isRequired?: boolean;
  templateStepId?: string;
  documentUrl?: string | null;
  customOnly?: boolean;
}

const STEP_LABELS: Record<WizardKey, string> = {
  personal: 'Personal',
  emergency_contacts: 'Emergency Contacts',
  guarantor: 'Guarantor',
  qualifications: 'Qualifications',
  medical: 'Medical',
  documents: 'Documents',
};

// field_definitions module_key per wizard step.
const STEP_FIELD_MODULES: Record<WizardKey, string> = {
  personal: 'employee',
  emergency_contacts: 'employee_emergency_contacts',
  guarantor: 'employee_guarantor',
  qualifications: 'employee_qualifications',
  medical: 'employee_medical',
  documents: 'employee_documents',
};

const DEFAULT_STEP_KEYS: WizardKey[] = [
  'personal',
  'guarantor',
  'qualifications',
  'medical',
  'documents',
];

// onboarding_steps.step_type -> wizard step
const STEP_TYPE_TO_KEY: Record<string, WizardKey> = {
  BIODATA: 'personal',
  GUARANTOR: 'guarantor',
  QUALIFICATION: 'qualifications',
  MEDICAL: 'medical',
  DOCUMENT_ACK: 'documents',
};

// onboarding_steps.module_key (custom forms) -> wizard step
const MODULE_KEY_TO_STEP: Record<string, WizardKey> = {
  employee: 'personal',
  employee_guarantor: 'guarantor',
  employee_qualifications: 'qualifications',
  employee_medical: 'medical',
  employee_documents: 'documents',
  employee_emergency_contacts: 'personal',
};

const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENOTYPES = ['AA', 'AS', 'SS', 'AC'];
const STATE_LIST = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

const BUCKET = 'employee-documents';
const MAX_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const EMPTY_DOC = { title: '', document_type: '', expiry_date: '', file: null as File | null };
interface ContactRow { _uid: string; name: string; relationship: string; phone: string; email: string; is_primary: boolean }
const EMPTY_CONTACT: Omit<ContactRow, '_uid'> = { name: '', relationship: '', phone: '', email: '', is_primary: false };

const str = (v: string) => (v.trim() ? v.trim() : null);
const makeId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const sanitizeFileName = (name: string) => {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned || 'document';
};

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const packValues = (values: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) if (!isEmpty(v)) out[k] = v;
  return out;
};

function defaultSteps(): WizardStep[] {
  return DEFAULT_STEP_KEYS.map((key) => ({ key, label: STEP_LABELS[key], isRequired: key === 'personal' }));
}

interface TemplateStep {
  id: string;
  step_type: string;
  title: string;
  description: string | null;
  is_required: boolean;
  document_url: string | null;
  module_key: string | null;
}

function buildSteps(tplSteps: TemplateStep[]): WizardStep[] {
  const seen = new Set<string>();
  const out: WizardStep[] = [];
  for (const s of tplSteps) {
    let key = STEP_TYPE_TO_KEY[s.step_type];
    if (!key && s.step_type === 'CUSTOM_FORM') key = MODULE_KEY_TO_STEP[s.module_key || ''];
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        label: STEP_LABELS[key],
        description: s.description,
        isRequired: s.is_required,
        templateStepId: s.id,
        documentUrl: s.document_url || null,
      });
    } else {
      // Informational custom-form step (no data entry).
      out.push({
        key: `custom_${s.id}`,
        label: s.title || 'Custom Step',
        description: s.description,
        isRequired: s.is_required,
        templateStepId: s.id,
        documentUrl: s.document_url || null,
        customOnly: true,
      });
    }
  }
  if (out.length === 0) return defaultSteps();
  // Bio-data is always required to create the employee record.
  if (!seen.has('personal')) {
    out.unshift({ key: 'personal', label: STEP_LABELS.personal, isRequired: true });
    seen.add('personal');
  }
  return out;
}


export default function AddEmployeePage() {
  const router = useRouter();
  const { can } = useAccess();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [steps, setSteps] = useState<WizardStep[]>(() => defaultSteps());
  const [template, setTemplate] = useState<{ id: string; name: string } | null>(null);
  const [templateSteps, setTemplateSteps] = useState<TemplateStep[] | null>(null);

  const [form, setForm] = useState({
    personal: {
      employee_id: '', first_name: '', last_name: '', email: '', phone: '',
      gender: '', date_of_birth: '', marital_status: '', nationality: '',
      state_of_origin: '', lga: '', residential_address: '', permanent_address: '',
      city: '', state: '', country: '', postal_code: '',
    },
    emergency_contacts: [{ ...EMPTY_CONTACT, _uid: makeId() }] as ContactRow[],
    guarantor: {
      name: '', relationship: '', phone: '', email: '', address: '', occupation: '', employer: '',
    },
    qualifications: {
      highest_qualification: '', institution: '', graduation_year: '', field_of_study: '', grade_class: '',
    },
    medical: {
      blood_group: '', genotype: '', allergies: '', chronic_conditions: '', emergency_medical_contact: '',
    },
    documents: [EMPTY_DOC] as typeof EMPTY_DOC[],
  });

  // Custom field values per step (keyed by wizard step key).
  const [custom, setCustom] = useState<Record<string, Record<string, unknown>>>({});
  const [docCustom, setDocCustom] = useState<Record<number, Record<string, unknown>>>({});
  const [contactCustom, setContactCustom] = useState<Record<string, Record<string, unknown>>>({});

  const setCustomValue = (key: string, fieldKey: string, value: unknown) =>
    setCustom((prev) => ({ ...prev, [key]: { ...prev[key], [fieldKey]: value } }));
  const setDocCustomValue = (index: number, fieldKey: string, value: unknown) =>
    setDocCustom((prev) => ({ ...prev, [index]: { ...prev[index], [fieldKey]: value } }));
  const setContactCustomValue = (uid: string, fieldKey: string, value: unknown) =>
    setContactCustom((prev) => ({ ...prev, [uid]: { ...prev[uid], [fieldKey]: value } }));

  const loadTemplate = useCallback(async () => {
    try {
      const { data: tpl } = await supabase
        .from('onboarding_templates')
        .select('id, name')
        .eq('is_active', true)
        .order('name')
        .limit(1)
        .maybeSingle();
      if (tpl) {
        const { data: tSteps } = await supabase
          .from('onboarding_steps')
          .select('*')
          .eq('template_id', (tpl as { id: string }).id)
          .order('sort_order');
        const built = buildSteps((tSteps || []) as TemplateStep[]);
        if (built.length > 0) {
          setSteps(built);
          setTemplate(tpl as { id: string; name: string });
          setTemplateSteps((tSteps || []) as TemplateStep[]);
          setStep(0);
        }
      }
    } catch (err) {
      console.error('Failed to load onboarding template:', err);
    }
  }, []);

  useEffect(() => { loadTemplate(); }, [loadTemplate]);

  const setP = (key: 'personal' | 'guarantor' | 'qualifications' | 'medical', field: string, value: string) =>
    setForm((f) => ({ ...f, [key]: { ...f[key], [field]: value } }));

  const validatePersonal = (): boolean => {
    const p = form.personal;
    if (!p.first_name.trim() || !p.last_name.trim()) { toast.error('First and last name are required'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) { toast.error('Please enter a valid email address'); return false; }
    return true;
  };

  const validateStep = (): boolean => {
    const idx = steps[step];
    if (idx && idx.key === 'personal') return validatePersonal();
    return true;
  };

  const next = () => { if (validateStep()) setStep((s) => Math.min(s + 1, steps.length - 1)); };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const uploadDocs = async (empId: string) => {
    const included = form.documents.filter((d) => d.file);
    for (let i = 0; i < included.length; i++) {
      const d = included[i];
      const file = d.file as File;
      if (!ALLOWED_TYPES.includes(file.type)) throw new Error(`"${d.title || file.name}" is not a PDF, JPEG or PNG`);
      if (file.size > MAX_SIZE) throw new Error(`"${d.title || file.name}" exceeds the 15 MB limit`);
      const docId = makeId();
      const path = `${empId}/${docId}-${sanitizeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type, cacheControl: '3600', upsert: false,
      });
      if (upErr) throw new Error(`Upload failed for "${d.title || file.name}": ${upErr.message}`);
      const { data: docRow, error: insErr } = await supabase.from('employee_documents').insert({
        employee_id: empId,
        title: d.title || file.name,
        document_type: str(d.document_type),
        file_path: path,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        expiry_date: d.expiry_date || null,
      }).select().single();
      if (insErr) throw new Error(`Failed to save document "${d.title || file.name}": ${insErr.message}`);

      const docValues = packValues(docCustom[form.documents.indexOf(d)] || {});
      if (Object.keys(docValues).length > 0) {
        await saveFieldValues('employee_documents', docRow.id as string, docValues);
      }
    }
  };

  const handleSubmit = async () => {
    if (!validatePersonal()) return;
    setSubmitting(true);
    try {
      const p = form.personal;

      const { data: empRow, error: empErr } = await supabase
        .from('employees')
        .insert({
          employee_id: str(p.employee_id),
          first_name: p.first_name.trim(),
          last_name: p.last_name.trim(),
          email: p.email.trim(),
          phone: str(p.phone),
          gender: str(p.gender),
          date_of_birth: p.date_of_birth || null,
          marital_status: str(p.marital_status),
          nationality: str(p.nationality),
          state_of_origin: str(p.state_of_origin),
          lga: str(p.lga),
          residential_address: str(p.residential_address),
          permanent_address: str(p.permanent_address),
          city: str(p.city),
          state: str(p.state),
          country: str(p.country),
          postal_code: str(p.postal_code),
          employment_status: 'PENDING_VERIFICATION',
          onboarding_template_id: template?.id || null,
          role: 'EMPLOYEE',
        })
        .select()
        .single();
      if (empErr) throw empErr;
      const empId = empRow.id as string;

      const empCustom = packValues(custom.personal || {});
      if (Object.keys(empCustom).length > 0) {
        await saveFieldValues('employee', empId, empCustom);
      }

      const contacts = form.emergency_contacts.filter((c) => c.name.trim());
      if (contacts.length > 0) {
        let primaryName: string | null = null;
        let primaryPhone: string | null = null;
        for (const c of contacts) {
          const { data: cRow, error: cErr } = await supabase.from('employee_emergency_contacts').insert({
            employee_id: empId,
            name: c.name.trim(),
            relationship: str(c.relationship),
            phone: str(c.phone),
            email: str(c.email),
            is_primary: c.is_primary,
          }).select().single();
          if (cErr) throw cErr;
          const cValues = packValues(contactCustom[c._uid] || {});
          if (Object.keys(cValues).length > 0) {
            await saveFieldValues('employee_emergency_contacts', cRow.id as string, cValues);
          }
          if (primaryName === null) {
            primaryName = c.name.trim();
            primaryPhone = str(c.phone);
          }
        }
        const { error: bcErr } = await supabase.from('employees').update({
          emergency_contact_name: primaryName,
          emergency_contact_phone: primaryPhone,
        }).eq('id', empId);
        if (bcErr) throw bcErr;
      }

      const g = form.guarantor;
      if (g.name.trim() || g.phone.trim()) {
        const { data: gRow, error: gErr } = await supabase.from('employee_guarantors').insert({
          employee_id: empId,
          name: str(g.name),
          relationship: str(g.relationship),
          phone: str(g.phone),
          email: str(g.email),
          address: str(g.address),
          occupation: str(g.occupation),
          employer: str(g.employer),
        }).select().single();
        if (gErr) throw gErr;
        const gValues = packValues(custom.guarantor || {});
        if (Object.keys(gValues).length > 0) {
          await saveFieldValues('employee_guarantor', gRow.id as string, gValues);
        }
      }

      const q = form.qualifications;
      if (q.highest_qualification.trim() || q.institution.trim()) {
        const { data: qRow, error: qErr } = await supabase.from('employee_qualifications').insert({
          employee_id: empId,
          title: str(q.highest_qualification),
          institution: str(q.institution),
          year: q.graduation_year ? parseInt(q.graduation_year, 10) || null : null,
          field_of_study: str(q.field_of_study),
          grade_class: str(q.grade_class),
        }).select().single();
        if (qErr) throw qErr;
        const qValues = packValues(custom.qualifications || {});
        if (Object.keys(qValues).length > 0) {
          await saveFieldValues('employee_qualifications', qRow.id as string, qValues);
        }
      }

      const m = form.medical;
      if (m.blood_group || m.genotype || m.allergies.trim() || m.chronic_conditions.trim() || m.emergency_medical_contact.trim()) {
        const { data: mRow, error: mErr } = await supabase.from('employee_medical').insert({
          employee_id: empId,
          allergies: str(m.allergies),
          conditions: str(m.chronic_conditions),
          emergency_medical_contact: str(m.emergency_medical_contact),
        }).select().single();
        if (mErr) throw mErr;
        const mValues = packValues(custom.medical || {});
        if (Object.keys(mValues).length > 0) {
          await saveFieldValues('employee_medical', mRow.id as string, mValues);
        }
        const { error: bErr } = await supabase.from('employees').update({
          blood_group: str(m.blood_group),
          genotype: str(m.genotype),
        }).eq('id', empId);
        if (bErr) throw bErr;
      }

      await uploadDocs(empId);

      if (template && templateSteps && templateSteps.length > 0) {
        const rows = templateSteps.map((s) => ({
          employee_id: empId,
          template_id: template.id,
          step_id: s.id,
          status: 'PENDING',
        }));
        const { error: prErr } = await supabase.from('employee_onboarding_progress').insert(rows);
        if (prErr) throw prErr;
      }

      const { data: token, error: tokenErr } = await supabase.rpc('create_setup_token', { p_employee_id: empId });
      if (tokenErr) throw tokenErr;
      const setupLink = `${window.location.origin}/setup-account?token=${token}`;

      await enqueueAndProcess({
        eventKey: 'welcome.new_employee',
        recipientEmail: p.email.trim(),
        recipientName: `${p.first_name.trim()} ${p.last_name.trim()}`,
        subject: `Welcome to the team, ${p.first_name}!`,
        bodyHtml: '',
        metadata: {
          employee_name: `${p.first_name} ${p.last_name}`,
          employee_email: p.email.trim(),
          first_name: p.first_name,
          company_name: 'HRM Flow',
          setup_link: setupLink,
        },
      });

      toast.success(`Employee created â€” invitation sent to ${p.email.trim()}`);
      router.push(`/employees/${empId}/personal`);
    } catch (err) {
      toast.error('Failed to create employee: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderPersonal = () => {
    const p = form.personal;
    const field = (f: string) => p[f as keyof typeof p];
    const set = (f: string, v: string) => setP('personal', f, v);
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>First Name *</Label>
            <Input value={field('first_name')} onChange={(e) => set('first_name', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Last Name *</Label>
            <Input value={field('last_name')} onChange={(e) => set('last_name', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Staff ID</Label>
            <Input value={field('employee_id')} onChange={(e) => set('employee_id', e.target.value)} placeholder="e.g. EMP-0001" /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Email *</Label>
            <Input type="email" value={field('email')} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Phone</Label>
            <Input value={field('phone')} onChange={(e) => set('phone', e.target.value)} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>Date of Birth</Label>
            <Input type="date" value={field('date_of_birth')} onChange={(e) => set('date_of_birth', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Gender</Label>
            <Select value={field('gender')} onValueChange={(v) => set('gender', v)}>
              <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>Marital Status</Label>
            <Select value={field('marital_status')} onValueChange={(v) => set('marital_status', v)}>
              <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                {MARITAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>Nationality</Label>
            <Input value={field('nationality')} onChange={(e) => set('nationality', e.target.value)} placeholder="e.g. Nigerian" /></div>
          <div className="space-y-1.5"><Label>State of Origin</Label>
            <Select value={field('state_of_origin')} onValueChange={(v) => set('state_of_origin', v)}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {STATE_LIST.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>LGA</Label>
            <Input value={field('lga')} onChange={(e) => set('lga', e.target.value)} /></div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Residential Address</Label>
            <Textarea rows={2} value={field('residential_address')} onChange={(e) => set('residential_address', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Permanent Address</Label>
            <Textarea rows={2} value={field('permanent_address')} onChange={(e) => set('permanent_address', e.target.value)} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>City</Label>
            <Input value={field('city')} onChange={(e) => set('city', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>State</Label>
            <Select value={field('state')} onValueChange={(v) => set('state', v)}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {STATE_LIST.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>Postal Code</Label>
            <Input value={field('postal_code')} onChange={(e) => set('postal_code', e.target.value)} /></div>
        </div>
        <CustomFieldsBlock
          moduleKey="employee"
          values={custom.personal || {}}
          onChange={(k, v) => setCustomValue('personal', k, v)}
        />
        <div className="border-t border-border pt-6">
          <h2 className="text-sm font-semibold">Emergency Contacts</h2>
          {renderEmergencyContacts()}
        </div>
      </div>
    );
  };

  const renderEmergencyContacts = () => {
    const contacts = form.emergency_contacts;
    const setContact = (uid: string, patch: Partial<Omit<ContactRow, '_uid'>>) =>
      setForm((f) => ({
        ...f,
        emergency_contacts: f.emergency_contacts.map((c) => (c._uid === uid ? { ...c, ...patch } : c)),
      }));
    const setPrimary = (uid: string) =>
      setForm((f) => ({
        ...f,
        emergency_contacts: f.emergency_contacts.map((c) => ({ ...c, is_primary: c._uid === uid })),
      }));
    const addContact = () =>
      setForm((f) => ({ ...f, emergency_contacts: [...f.emergency_contacts, { ...EMPTY_CONTACT, _uid: makeId() }] }));
    const removeContact = (uid: string) =>
      setForm((f) => ({ ...f, emergency_contacts: f.emergency_contacts.filter((c) => c._uid !== uid) }));

    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Add one or more emergency contacts for this employee. The primary contact is reflected on their record.
        </p>
        {contacts.map((c) => (
          <div key={c._uid} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Emergency Contact</p>
              {contacts.length > 1 && (
                <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => removeContact(c._uid)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Full Name</Label>
                <Input value={c.name} onChange={(e) => setContact(c._uid, { name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Relationship</Label>
                <Input value={c.relationship} onChange={(e) => setContact(c._uid, { relationship: e.target.value })} placeholder="e.g. Spouse, Parent" /></div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Phone</Label>
                <Input value={c.phone} onChange={(e) => setContact(c._uid, { phone: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Email</Label>
                <Input type="email" value={c.email} onChange={(e) => setContact(c._uid, { email: e.target.value })} /></div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Checkbox id={`primary_${c._uid}`} checked={c.is_primary} onCheckedChange={() => setPrimary(c._uid)} />
              <Label htmlFor={`primary_${c._uid}`} className="text-sm text-muted-foreground">Primary contact</Label>
            </div>
            <div className="mt-4">
              <CustomFieldsBlock
                moduleKey="employee_emergency_contacts"
                values={contactCustom[c._uid] || {}}
                onChange={(k, v) => setContactCustomValue(c._uid, k, v)}
              />
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addContact}>
          <Plus className="mr-1.5 h-4 w-4" /> Add emergency contact
        </Button>
      </div>
    );
  };

  const renderGuarantor = () => {
    const g = form.guarantor;
    const set = (f: string, v: string) => setP('guarantor', f, v);
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Guarantor Full Name</Label>
            <Input value={g.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Relationship to Employee</Label>
            <Input value={g.relationship} onChange={(e) => set('relationship', e.target.value)} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Phone Number</Label>
            <Input value={g.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Email Address</Label>
            <Input type="email" value={g.email} onChange={(e) => set('email', e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Home Address</Label>
          <Textarea rows={2} value={g.address} onChange={(e) => set('address', e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Occupation</Label>
            <Input value={g.occupation} onChange={(e) => set('occupation', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Employer Name</Label>
            <Input value={g.employer} onChange={(e) => set('employer', e.target.value)} /></div>
        </div>
        <CustomFieldsBlock
          moduleKey="employee_guarantor"
          values={custom.guarantor || {}}
          onChange={(k, v) => setCustomValue('guarantor', k, v)}
        />
      </div>
    );
  };

  const renderQualifications = () => {
    const q = form.qualifications;
    const set = (f: string, v: string) => setP('qualifications', f, v);
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Highest Qualification</Label>
            <Input value={q.highest_qualification} onChange={(e) => set('highest_qualification', e.target.value)} placeholder="e.g. B.Sc" /></div>
          <div className="space-y-1.5"><Label>Institution</Label>
            <Input value={q.institution} onChange={(e) => set('institution', e.target.value)} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label>Graduation Year</Label>
            <Input type="number" value={q.graduation_year} onChange={(e) => set('graduation_year', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Field of Study</Label>
            <Input value={q.field_of_study} onChange={(e) => set('field_of_study', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Grade/Class</Label>
            <Input value={q.grade_class} onChange={(e) => set('grade_class', e.target.value)} /></div>
        </div>
        <CustomFieldsBlock
          moduleKey="employee_qualifications"
          values={custom.qualifications || {}}
          onChange={(k, v) => setCustomValue('qualifications', k, v)}
        />
      </div>
    );
  };

  const renderMedical = () => {
    const m = form.medical;
    const set = (f: string, v: string) => setP('medical', f, v);
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Blood Group</Label>
            <Select value={m.blood_group} onValueChange={(v) => set('blood_group', v)}>
              <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
              <SelectContent>
                {BLOOD_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>Genotype</Label>
            <Select value={m.genotype} onValueChange={(v) => set('genotype', v)}>
              <SelectTrigger><SelectValue placeholder="Select genotype" /></SelectTrigger>
              <SelectContent>
                {GENOTYPES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Known Allergies</Label>
            <Input value={m.allergies} onChange={(e) => set('allergies', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Chronic Conditions</Label>
            <Input value={m.chronic_conditions} onChange={(e) => set('chronic_conditions', e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Emergency Medical Contact</Label>
          <Input value={m.emergency_medical_contact} onChange={(e) => set('emergency_medical_contact', e.target.value)} /></div>
        <CustomFieldsBlock
          moduleKey="employee_medical"
          values={custom.medical || {}}
          onChange={(k, v) => setCustomValue('medical', k, v)}
        />
      </div>
    );
  };

  const renderDocuments = () => {
    const docs = form.documents;
    const setDoc = (index: number, patch: Partial<(typeof EMPTY_DOC)>) =>
      setForm((f) => {
        const next = [...f.documents];
        next[index] = { ...next[index], ...patch };
        return { ...f, documents: next };
      });
    const addDoc = () => setForm((f) => ({ ...f, documents: [...f.documents, { ...EMPTY_DOC }] }));
    const removeDoc = (index: number) =>
      setForm((f) => ({ ...f, documents: f.documents.filter((_, i) => i !== index) }));

    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Optional â€” upload documents such as contracts, ID scans or certificates during the same process.
        </p>
        {docs.map((d, i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Document {i + 1}</p>
              {docs.length > 1 && (
                <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => removeDoc(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Title</Label>
                <Input value={d.title} onChange={(e) => setDoc(i, { title: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Document Type</Label>
                <Input value={d.document_type} onChange={(e) => setDoc(i, { document_type: e.target.value })} placeholder="e.g. Contract, ID Scan, Certificate" /></div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>File (PDF, JPEG, PNG)</Label>
                <Input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={(e) => setDoc(i, { file: e.target.files?.[0] ?? null })}
                />
              </div>
              <div className="space-y-1.5"><Label>Expiry Date</Label>
                <Input type="date" value={d.expiry_date} onChange={(e) => setDoc(i, { expiry_date: e.target.value })} /></div>
            </div>
            <div className="mt-4">
              <CustomFieldsBlock
                moduleKey="employee_documents"
                values={docCustom[i] || {}}
                onChange={(k, v) => setDocCustomValue(i, k, v)}
              />
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addDoc}>
          <Plus className="mr-1.5 h-4 w-4" /> Add another document
        </Button>
      </div>
    );
  };

  const STEP_RENDERERS: Record<string, () => ReactNode> = {
    personal: renderPersonal,
    guarantor: renderGuarantor,
    qualifications: renderQualifications,
    medical: renderMedical,
    documents: renderDocuments,
  };

  if (!can('employees.manage') && !can('employees.invite')) {
    return (
      <Card className="animate-fade-in">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
          <p className="text-sm">You do not have permission to add employees.</p>
        </CardContent>
      </Card>
    );
  }

  const activeStep = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add Employee</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the full employee profile. An invitation email is sent on completion.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {template ? <>Driven by template: <span className="font-medium">{template.name}</span></> : 'Default onboarding flow'}
            </Badge>
            {activeStep && activeStep.isRequired && <Badge variant="outline" className="text-xs bg-warning/10 text-warning">Required step</Badge>}
          </div>
        </div>
      </div>

      <ol className="flex flex-wrap gap-2">
        {steps.map((s, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => { if (i < step) setStep(i); }}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  active && 'border-primary bg-primary/10 text-primary',
                  done && 'cursor-pointer border-success/30 bg-success/5 text-success hover:bg-success/10',
                  !active && !done && 'border-border text-muted-foreground'
                )}
              >
                {s.label}
                {done && <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            </li>
          );
        })}
      </ol>

      <Card>
        <CardContent className="p-6">
          {activeStep?.customOnly ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {activeStep.description || 'This step is part of the assigned onboarding checklist and will be completed by the employee.'}
              </p>
              {activeStep.documentUrl && (
                <a
                  href={activeStep.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <FileText className="h-4 w-4" /> View required document
                </a>
              )}
            </div>
          ) : (
            <>
              {activeStep?.description && (
                <p className="mb-4 text-sm text-muted-foreground">{activeStep.description}</p>
              )}
              {activeStep?.documentUrl && activeStep.key === 'documents' && (
                <p className="mb-4 text-sm">
                  Related document:{' '}
                  <a href={activeStep.documentUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    View
                  </a>
                </p>
              )}
              {(STEP_RENDERERS[activeStep?.key || ''] ?? renderPersonal)()}
            </>
          )}

          <div className="mt-8 flex items-center justify-between border-t border-border pt-4">
            <Button variant="outline" onClick={back} disabled={step === 0 || submitting}>
              <ChevronLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
            {!isLast ? (
              <Button onClick={next}>
                Next <ChevronRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                {submitting ? 'Creating...' : 'Create & Send Invitation'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
