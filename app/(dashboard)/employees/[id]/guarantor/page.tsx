'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, Eye, FileText, UserRound, Pencil, X } from 'lucide-react';
import { useAccess } from '@/lib/access';
import { isProfileLocked } from '@/lib/profile-lock';
import { ProfileLockBanner } from '@/components/profile-lock-banner';
import { CustomFieldsBlock } from '@/components/field-engine/custom-fields';
import { fetchFieldValues, saveFieldValues } from '@/lib/field-engine/client';

const BUCKET = 'employee-documents';
const MAX_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

interface Guarantor {
  id: string;
  employee_id: string;
  name: string | null;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  occupation: string | null;
  employer: string | null;
  passport_number: string | null;
  passport_issue_date: string | null;
  passport_expiry_date: string | null;
  passport_file_path: string | null;
  passport_file_name: string | null;
}

const EMPTY_DRAFT = {
  name: '',
  relationship: '',
  phone: '',
  email: '',
  address: '',
  occupation: '',
  employer: '',
  passport_number: '',
  passport_issue_date: '',
  passport_expiry_date: '',
};

type Draft = typeof EMPTY_DRAFT;

function str(v: string) {
  return v.trim() ? v.trim() : null;
}

function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned || 'passport';
}

export default function GuarantorPage() {
  const params = useParams();
  const id = params.id as string;
  const { employeeId: myId, can } = useAccess();
  const canWrite = can('employees.manage');
  const [status, setStatus] = useState<string | null>(null);
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [guarCustom, setGuarCustom] = useState<Record<string, unknown>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const setGuarCustomValue = (fieldKey: string, value: unknown) =>
    setGuarCustom((prev) => ({ ...prev, [fieldKey]: value }));

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('employees')
        .select('employment_status')
        .eq('id', id)
        .maybeSingle();
      setStatus(data?.employment_status ?? null);
    })().catch(() => setStatus(null));
  }, [id]);

  const locked = isProfileLocked(myId, id, status, canWrite);

  const loadGuarantors = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('employee_guarantors')
        .select('*')
        .eq('employee_id', id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setGuarantors((data || []) as unknown as Guarantor[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadGuarantors(); }, [loadGuarantors]);

  const openAdd = () => {
    setGuarCustom({});
    setEditing({ id: null, draft: { ...EMPTY_DRAFT } });
  };

  const openEdit = async (g: Guarantor) => {
    const custom = await fetchFieldValues('employee_guarantor', g.id).catch(() => ({}));
    setGuarCustom(custom as Record<string, unknown>);
    setEditing({
      id: g.id,
      draft: {
        name: g.name || '',
        relationship: g.relationship || '',
        phone: g.phone || '',
        email: g.email || '',
        address: g.address || '',
        occupation: g.occupation || '',
        employer: g.employer || '',
        passport_number: g.passport_number || '',
        passport_issue_date: g.passport_issue_date || '',
        passport_expiry_date: g.passport_expiry_date || '',
      },
    });
  };

  const saveGuarantor = async () => {
    if (!editing) return;
    const d = editing.draft;
    if (!d.name.trim()) {
      toast.error('Guarantor name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        employee_id: id,
        name: str(d.name),
        relationship: str(d.relationship),
        phone: str(d.phone),
        email: str(d.email),
        address: str(d.address),
        occupation: str(d.occupation),
        employer: str(d.employer),
        passport_number: str(d.passport_number),
        passport_issue_date: str(d.passport_issue_date),
        passport_expiry_date: str(d.passport_expiry_date),
      };

      let guarantorId = editing.id;
      if (editing.id) {
        const res = await supabase.from('employee_guarantors').update(payload).eq('id', editing.id).select('id');
        if (res.error) throw res.error;
        if ((res.data || []).length === 0) throw new Error('Not authorized to update this guarantor record');
      } else {
        const res = await supabase.from('employee_guarantors').insert(payload).select('id').single();
        if (res.error) throw res.error;
        guarantorId = res.data.id as string;
      }

      const customValues = Object.fromEntries(
        Object.entries(guarCustom).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      if (guarantorId && Object.keys(customValues).length > 0) {
        await saveFieldValues('employee_guarantor', guarantorId, customValues);
      }

      toast.success(editing.id ? 'Guarantor updated' : 'Guarantor added');
      setEditing(null);
      setGuarCustom({});
      loadGuarantors();
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteGuarantor = async (g: Guarantor) => {
    try {
      const { error } = await supabase.from('employee_guarantors').delete().eq('id', g.id);
      if (error) throw error;
      if (g.passport_file_path) {
        await supabase.storage.from(BUCKET).remove([g.passport_file_path]).catch(() => {});
      }
      toast.success('Guarantor removed');
      loadGuarantors();
    } catch (err) {
      toast.error('Failed to remove: ' + (err as Error).message);
    }
  };

  const uploadPassport = async (g: Guarantor, file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Only PDF, JPEG or PNG files are allowed.');
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error('File is too large. Maximum size is 15 MB.');
      return;
    }
    setUploadingFor(g.id);
    try {
      const path = `guarantor-passports/${id}/${g.id}-${sanitizeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
      if (upErr) throw upErr;
      const { error } = await supabase
        .from('employee_guarantors')
        .update({ passport_file_path: path, passport_file_name: file.name })
        .eq('id', g.id);
      if (error) throw error;
      toast.success('Passport uploaded');
      loadGuarantors();
    } catch (err) {
      toast.error('Failed to upload: ' + (err as Error).message);
    } finally {
      setUploadingFor(null);
    }
  };

  const viewPassport = async (g: Guarantor) => {
    if (!g.passport_file_path) return;
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(g.passport_file_path, 3600);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch (err) {
      toast.error('Could not open file: ' + (err as Error).message);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Guarantors</CardTitle>
          {canWrite && !locked && !editing && (
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" /> Add Guarantor
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {locked && <ProfileLockBanner />}

          {editing && (
            <div className="rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">
                  {editing.id ? 'Edit guarantor' : 'New guarantor'}
                </p>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setGuarCustom({}); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <fieldset disabled={saving} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Full Name *</Label>
                    <Input value={editing.draft.name} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Relationship</Label>
                    <Input value={editing.draft.relationship} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, relationship: e.target.value } })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input value={editing.draft.phone} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, phone: e.target.value } })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" value={editing.draft.email} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, email: e.target.value } })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Occupation</Label>
                    <Input value={editing.draft.occupation} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, occupation: e.target.value } })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Employer</Label>
                    <Input value={editing.draft.employer} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, employer: e.target.value } })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Home Address</Label>
                  <Textarea value={editing.draft.address} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, address: e.target.value } })} />
                </div>

                <p className="pt-1 text-sm font-medium">Passport Details</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Passport Number</Label>
                    <Input value={editing.draft.passport_number} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, passport_number: e.target.value } })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Issue Date</Label>
                    <Input type="date" value={editing.draft.passport_issue_date} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, passport_issue_date: e.target.value } })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Expiry Date</Label>
                    <Input type="date" value={editing.draft.passport_expiry_date} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, passport_expiry_date: e.target.value } })} />
                  </div>
                </div>

                <CustomFieldsBlock
                  moduleKey="employee_guarantor"
                  values={guarCustom}
                  onChange={setGuarCustomValue}
                  disabled={saving}
                />
              </fieldset>

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setEditing(null); setGuarCustom({}); }} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={saveGuarantor} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Guarantor'}
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : guarantors.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-muted-foreground">
              <UserRound className="mb-2 h-10 w-10 opacity-50" />
              <p className="text-sm font-medium">No guarantors added</p>
              <p className="text-xs">Add one or more guarantors with their passport details.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {guarantors.map((g) => (
                <div key={g.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <UserRound className="h-4.5 w-4.5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{g.name || '—'}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[g.relationship, g.phone, g.email].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                        {g.occupation && <p>Occupation: {g.occupation}</p>}
                        {g.employer && <p>Employer: {g.employer}</p>}
                        {g.address && <p>Address: {g.address}</p>}
                        {(g.passport_number || g.passport_expiry_date) && (
                          <p>
                            Passport: {g.passport_number || '—'}
                            {g.passport_expiry_date ? ` · expires ${g.passport_expiry_date}` : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {g.passport_file_path && (
                        <Button variant="outline" size="sm" onClick={() => viewPassport(g)}>
                          <Eye className="mr-2 h-4 w-4" /> Passport
                        </Button>
                      )}
                      {canWrite && !locked && (
                        <>
                          <input
                            ref={(el) => { fileInputs.current[g.id] = el; }}
                            type="file"
                            accept="application/pdf,image/jpeg,image/png"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadPassport(g, f);
                              e.target.value = '';
                            }}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputs.current[g.id]?.click()}
                            disabled={uploadingFor === g.id}
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            {uploadingFor === g.id ? 'Uploading...' : g.passport_file_path ? 'Replace' : 'Upload'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(g)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => deleteGuarantor(g)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {g.passport_file_name && (
                    <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" /> {g.passport_file_name}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
