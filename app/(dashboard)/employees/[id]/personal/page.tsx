'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Users, Lock, Send, ClipboardList, Upload, Eye, FileText, X } from 'lucide-react';
import type { EmployeeEmergencyContact } from '@/lib/types';
import { useAccess } from '@/lib/access';
import { CustomFieldsBlock } from '@/components/field-engine/custom-fields';
import { fetchFieldValues, saveFieldValues } from '@/lib/field-engine/client';

interface ChangeRequestRow {
  id: string;
  field_name: string;
  new_value: unknown;
  reason: string | null;
  status: string;
  requested_at: string;
  review_note: string | null;
}

const CHANGE_REQUEST_STATUS: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-destructive/10 text-destructive',
};

const CHANGE_REQUEST_FIELDS: { value: string; label: string }[] = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'gender', label: 'Gender' },
  { value: 'date_of_birth', label: 'Date of birth' },
  { value: 'marital_status', label: 'Marital status' },
  { value: 'nationality', label: 'Nationality' },
  { value: 'state_of_origin', label: 'State of origin' },
  { value: 'lga', label: 'LGA' },
  { value: 'residential_address', label: 'Residential address' },
  { value: 'permanent_address', label: 'Permanent address' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'country', label: 'Country' },
  { value: 'postal_code', label: 'Postal code' },
  { value: 'blood_group', label: 'Blood group' },
  { value: 'genotype', label: 'Genotype' },
  { value: 'disability_status', label: 'Disability status' },
  { value: 'disability_details', label: 'Disability details' },
  { value: 'emergency_contact_name', label: 'Emergency contact name' },
  { value: 'emergency_contact_phone', label: 'Emergency contact phone' },
  { value: 'bank_name', label: 'Bank name' },
  { value: 'bank_account_number', label: 'Bank account number' },
  { value: 'bank_routing_number', label: 'Bank sort code / routing number' },
];

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

export default function PersonalPage() {
  const params = useParams();
  const id = params.id as string;
  const { can, employeeId: myId } = useAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    secondary_phone: '',
    date_of_birth: '',
    gender: '',
    marital_status: '',
    nationality: '',
    state_of_origin: '',
    lga: '',
    national_id: '',
    passport_number: '',
    passport_issue_date: '',
    passport_expiry_date: '',
    passport_file_path: '',
    passport_file_name: '',
    residential_address: '',
    permanent_address: '',
    city: '',
    state: '',
    country: '',
    postal_code: '',
    blood_group: '',
    genotype: '',
    disability_status: 'NONE',
    disability_details: '',
  });
  const [contacts, setContacts] = useState<EmployeeEmergencyContact[]>([]);
  const [contactDraft, setContactDraft] = useState({
    name: '',
    relationship: '',
    phone: '',
    email: '',
    is_primary: false,
  });
  const [empCustom, setEmpCustom] = useState<Record<string, unknown>>({});
  const [contactCustom, setContactCustom] = useState<Record<string, unknown>>({});
  const setEmpCustomValue = (fieldKey: string, value: unknown) =>
    setEmpCustom((prev) => ({ ...prev, [fieldKey]: value }));
  const setContactCustomValue = (fieldKey: string, value: unknown) =>
    setContactCustom((prev) => ({ ...prev, [fieldKey]: value }));
  const [changeOpen, setChangeOpen] = useState(false);
  const [crField, setCrField] = useState(CHANGE_REQUEST_FIELDS[0].value);
  const [crValue, setCrValue] = useState('');
  const [crReason, setCrReason] = useState('');
  const [submittingChange, setSubmittingChange] = useState(false);
  const [myRequests, setMyRequests] = useState<ChangeRequestRow[]>([]);
  const passportInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPassport, setUploadingPassport] = useState(false);

  const canWrite = can('employees.manage');
  const isSelf = myId === id;
  const locked = isSelf && status === 'ACTIVE' && !canWrite;

  const load = useCallback(async () => {
    try {
      const [empRes, contactRes, customRes] = await Promise.all([
        supabase.from('employees').select('*').eq('id', id).maybeSingle(),
        supabase.from('employee_emergency_contacts').select('*').eq('employee_id', id).order('is_primary', { ascending: false }),
        fetchFieldValues('employee', id).catch(() => ({} as Record<string, unknown>)),
      ]);
      if (empRes.error) throw empRes.error;
      setEmpCustom(customRes);
      if (empRes.data) {
        const d = empRes.data;
        setStatus(d.employment_status || '');
        setForm({
          first_name: d.first_name || '',
          last_name: d.last_name || '',
          email: d.email || '',
          phone: d.phone || '',
          secondary_phone: d.secondary_phone || '',
          date_of_birth: d.date_of_birth || '',
          gender: d.gender || '',
          marital_status: d.marital_status || '',
          nationality: d.nationality || '',
          state_of_origin: d.state_of_origin || '',
          lga: d.lga || '',
          national_id: d.national_id || '',
          passport_number: d.passport_number || '',
          passport_issue_date: d.passport_issue_date || '',
          passport_expiry_date: d.passport_expiry_date || '',
          passport_file_path: d.passport_file_path || '',
          passport_file_name: d.passport_file_name || '',
          residential_address: d.residential_address || d.address || '',
          permanent_address: d.permanent_address || '',
          city: d.city || '',
          state: d.state || '',
          country: d.country || '',
          postal_code: d.postal_code || '',
          blood_group: d.blood_group || '',
          genotype: d.genotype || '',
          disability_status: d.disability_status || 'NONE',
          disability_details: d.disability_details || '',
        });
      }
      setContacts((contactRes.data || []) as unknown as EmployeeEmergencyContact[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const loadChangeRequests = useCallback(async () => {
    if (!isSelf) return;
    try {
      const { data } = await supabase
        .from('employee_change_requests')
        .select('id, field_name, new_value, reason, status, requested_at, review_note')
        .eq('employee_id', id)
        .order('requested_at', { ascending: false })
        .limit(20);
      setMyRequests((data || []) as unknown as ChangeRequestRow[]);
    } catch (err) {
      console.error(err);
    }
  }, [isSelf, id]);

  useEffect(() => { loadChangeRequests(); }, [loadChangeRequests]);

  const handleAddContact = async () => {
    if (!contactDraft.name.trim()) {
      toast.error('Contact name is required');
      return;
    }
    try {
      const { data: cRow, error } = await supabase.from('employee_emergency_contacts').insert({
        employee_id: id,
        name: contactDraft.name.trim(),
        relationship: contactDraft.relationship || null,
        phone: contactDraft.phone || null,
        email: contactDraft.email || null,
        is_primary: contactDraft.is_primary,
      }).select().single();
      if (error) throw error;
      const customValues = Object.fromEntries(
        Object.entries(contactCustom).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      if (Object.keys(customValues).length > 0) {
        await saveFieldValues('employee_emergency_contacts', cRow.id as string, customValues);
      }
      toast.success('Emergency contact added');
      setContactDraft({ name: '', relationship: '', phone: '', email: '', is_primary: false });
      setContactCustom({});
      load();
    } catch (err) {
      toast.error('Failed to add contact: ' + (err as Error).message);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    try {
      const { error } = await supabase.from('employee_emergency_contacts').delete().eq('id', contactId);
      if (error) throw error;
      toast.success('Contact removed');
      load();
    } catch (err) {
      toast.error('Failed to remove contact: ' + (err as Error).message);
    }
  };

  const uploadPassport = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error('File exceeds 15 MB limit');
      return;
    }
    setUploadingPassport(true);
    try {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `passports/${id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('employee-documents')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { error } = await supabase
        .from('employees')
        .update({ passport_file_path: path, passport_file_name: file.name })
        .eq('id', id);
      if (error) throw error;
      setForm((f) => ({ ...f, passport_file_path: path, passport_file_name: file.name }));
      toast.success('Passport uploaded');
    } catch (err) {
      toast.error('Failed to upload: ' + (err as Error).message);
    } finally {
      setUploadingPassport(false);
    }
  };

  const viewPassport = async () => {
    if (!form.passport_file_path) return;
    try {
      const { data, error } = await supabase.storage
        .from('employee-documents')
        .createSignedUrl(form.passport_file_path, 3600);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error('Failed to open: ' + (err as Error).message);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('employees')
        .update({
          first_name: form.first_name || null,
          last_name: form.last_name || null,
          email: form.email || null,
          phone: form.phone || null,
          secondary_phone: form.secondary_phone || null,
          date_of_birth: form.date_of_birth || null,
          gender: form.gender || null,
          marital_status: form.marital_status || null,
          nationality: form.nationality || null,
          state_of_origin: form.state_of_origin || null,
          lga: form.lga || null,
          national_id: form.national_id || null,
          passport_number: form.passport_number || null,
          passport_issue_date: form.passport_issue_date || null,
          passport_expiry_date: form.passport_expiry_date || null,
          passport_file_path: form.passport_file_path || null,
          passport_file_name: form.passport_file_name || null,
          residential_address: form.residential_address || null,
          permanent_address: form.permanent_address || null,
          city: form.city || null,
          state: form.state || null,
          country: form.country || null,
          postal_code: form.postal_code || null,
          blood_group: form.blood_group || null,
          genotype: form.genotype || null,
          disability_status: form.disability_status || null,
          disability_details: form.disability_details || null,
        })
        .eq('id', id);
      if (error) throw error;

      const customValues = Object.fromEntries(
        Object.entries(empCustom).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      if (Object.keys(customValues).length > 0) {
        await saveFieldValues('employee', id, customValues);
      }

      toast.success('Personal information saved');
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitChange = async () => {
    if (!crValue.trim()) {
      toast.error('Please enter the new value');
      return;
    }
    setSubmittingChange(true);
    try {
      const { error } = await supabase.rpc('submit_employee_change_request', {
        p_field_name: crField,
        p_new_value: crValue.trim(),
        p_reason: crReason.trim() || null,
      });
      if (error) throw error;
      toast.success('Change request submitted for HR review');
      setChangeOpen(false);
      setCrValue('');
      setCrReason('');
      loadChangeRequests();
    } catch (err) {
      toast.error('Failed to submit: ' + (err as Error).message);
    } finally {
      setSubmittingChange(false);
    }
  };

  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Passport Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset disabled={locked} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Passport Number</Label>
                <Input value={form.passport_number} onChange={(e) => setForm({ ...form, passport_number: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Issue Date</Label>
                <Input type="date" value={form.passport_issue_date} onChange={(e) => setForm({ ...form, passport_issue_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Date</Label>
                <Input type="date" value={form.passport_expiry_date} onChange={(e) => setForm({ ...form, passport_expiry_date: e.target.value })} />
              </div>
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">Passport Document</p>
                <p className="text-xs text-muted-foreground">
                  {form.passport_file_name || 'No passport file uploaded'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {form.passport_file_path && (
                <Button variant="outline" size="sm" onClick={viewPassport}>
                  <Eye className="mr-2 h-4 w-4" /> Preview
                </Button>
              )}
              {(canWrite || isSelf) && !locked && (
                <>
                  <input
                    ref={passportInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadPassport(f);
                      e.target.value = '';
                    }}
                  />
                  <Button size="sm" onClick={() => passportInputRef.current?.click()} disabled={uploadingPassport}>
                    <Upload className="mr-2 h-4 w-4" />
                    {uploadingPassport ? 'Uploading...' : form.passport_file_path ? 'Replace' : 'Upload'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Identity & Personal Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <fieldset disabled={locked} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5 sm:max-w-xs">
            <Label>Secondary phone</Label>
            <Input
              value={form.secondary_phone}
              onChange={(e) => setForm({ ...form, secondary_phone: e.target.value })}
              placeholder="Alternate / WhatsApp number"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Date of Birth</Label>
              <Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
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
              <Select value={form.marital_status} onValueChange={(v) => setForm({ ...form, marital_status: v })}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {MARITAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Origin & Identity</h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Nationality</Label>
                <Input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} placeholder="e.g. Nigerian" />
              </div>
              <div className="space-y-1.5">
                <Label>State of Origin</Label>
                <Select value={form.state_of_origin} onValueChange={(v) => setForm({ ...form, state_of_origin: v })}>
                  <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {STATE_LIST.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>LGA</Label>
                <Input value={form.lga} onChange={(e) => setForm({ ...form, lga: e.target.value })} placeholder="e.g. Ikeja" />
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              <Label>National ID / NIN</Label>
              <Input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Addresses</h4>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Residential Address</Label>
                <Textarea rows={2} value={form.residential_address} onChange={(e) => setForm({ ...form, residential_address: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Permanent Address</Label>
                <Textarea rows={2} value={form.permanent_address} onChange={(e) => setForm({ ...form, permanent_address: e.target.value })} />
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Select value={form.state} onValueChange={(v) => setForm({ ...form, state: v })}>
                  <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {STATE_LIST.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Postal Code</Label>
                <Input value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Medical</h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Blood Group</Label>
                <Select value={form.blood_group} onValueChange={(v) => setForm({ ...form, blood_group: v })}>
                  <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                  <SelectContent>
                    {BLOOD_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Genotype</Label>
                <Select value={form.genotype} onValueChange={(v) => setForm({ ...form, genotype: v })}>
                  <SelectTrigger><SelectValue placeholder="Select genotype" /></SelectTrigger>
                  <SelectContent>
                    {GENOTYPES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Disability Status</Label>
                <Select value={form.disability_status} onValueChange={(v) => setForm({ ...form, disability_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No disability</SelectItem>
                    <SelectItem value="DISABLED">Person with disability</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.disability_status === 'DISABLED' && (
                <div className="sm:col-span-3 space-y-1.5">
                  <Label>Disability Details</Label>
                  <Input value={form.disability_details} onChange={(e) => setForm({ ...form, disability_details: e.target.value })} placeholder="Nature of disability / accommodation needs" />
                </div>
              )}
            </div>
          </div>

          <CustomFieldsBlock
            moduleKey="employee"
            values={empCustom}
            onChange={setEmpCustomValue}
            disabled={locked}
          />
          </fieldset>

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            {locked ? (
              <>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4" />
                  Your profile is locked — request a change and HR will review it.
                </p>
                <Button onClick={() => setChangeOpen(true)} disabled={submittingChange}>
                  <Send className="mr-1.5 h-4 w-4" />
                  Request a change
                </Button>
              </>
            ) : (
              <div className="ml-auto">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Emergency Contacts</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">Multiple contacts with primary designation</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-4.5 w-4.5" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-muted-foreground">
              <p className="text-sm font-medium">No emergency contacts</p>
              <p className="text-xs">Add emergency contacts below.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{c.name}</p>
                      {c.is_primary && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">Primary</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[c.relationship, c.phone, c.email].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {canWrite && !locked && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => handleDeleteContact(c.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canWrite && !locked && (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-sm font-medium">Add emergency contact</p>
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
                  <Input type="email" value={contactDraft.email} onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })} />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={contactDraft.is_primary}
                    onChange={(e) => setContactDraft({ ...contactDraft, is_primary: e.target.checked })}
                  />
                  Mark as primary
                </label>
                <Button size="sm" onClick={handleAddContact}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add Contact
                </Button>
              </div>
              <div className="mt-4">
                <CustomFieldsBlock
                  moduleKey="employee_emergency_contacts"
                  values={contactCustom}
                  onChange={setContactCustomValue}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isSelf && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">My Change Requests</CardTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">Track profile change requests you submitted for HR review</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ClipboardList className="h-4.5 w-4.5" />
            </div>
          </CardHeader>
          <CardContent>
            {myRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-muted-foreground">
                <ClipboardList className="mb-2 h-8 w-8 opacity-40" />
                <p className="text-sm font-medium">No change requests yet</p>
                <p className="text-xs">Use the “Request a change” button above when your profile is locked.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {myRequests.map((r) => (
                  <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium capitalize">{r.field_name.replace(/_/g, ' ')}</p>
                        <Badge variant="outline" className={CHANGE_REQUEST_STATUS[r.status] || ''}>{r.status}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        New value: <span className="font-medium text-foreground">{String(r.new_value ?? '') || '—'}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(r.requested_at).toLocaleString()}
                        {r.reason ? ` · “${r.reason}”` : ''}
                        {r.review_note ? ` · Review note: ${r.review_note}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a profile change</DialogTitle>
            <DialogDescription>
              Your profile is locked because you are an active employee. Submit the change and HR will review and approve it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Field</Label>
              <Select value={crField} onValueChange={setCrField}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {CHANGE_REQUEST_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>New value *</Label>
              <Input value={crValue} onChange={(e) => setCrValue(e.target.value)} placeholder="Enter the updated value" />
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea rows={2} value={crReason} onChange={(e) => setCrReason(e.target.value)} placeholder="Why is this changing?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmitChange} disabled={submittingChange}>
              {submittingChange ? 'Submitting...' : 'Submit request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}