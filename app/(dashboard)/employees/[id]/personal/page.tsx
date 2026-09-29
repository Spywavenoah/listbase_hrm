'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Users } from 'lucide-react';
import type { EmployeeEmergencyContact } from '@/lib/types';
import { useAccess } from '@/lib/access';

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
  const { can } = useAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    date_of_birth: '',
    gender: '',
    marital_status: '',
    nationality: '',
    state_of_origin: '',
    lga: '',
    national_id: '',
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

  const canWrite = can('employees.manage');

  const load = useCallback(async () => {
    try {
      const [empRes, contactRes] = await Promise.all([
        supabase.from('employees').select('*').eq('id', id).maybeSingle(),
        supabase.from('employee_emergency_contacts').select('*').eq('employee_id', id).order('is_primary', { ascending: false }),
      ]);
      if (empRes.error) throw empRes.error;
      if (empRes.data) {
        const d = empRes.data;
        setForm({
          first_name: d.first_name || '',
          last_name: d.last_name || '',
          email: d.email || '',
          phone: d.phone || '',
          date_of_birth: d.date_of_birth || '',
          gender: d.gender || '',
          marital_status: d.marital_status || '',
          nationality: d.nationality || '',
          state_of_origin: d.state_of_origin || '',
          lga: d.lga || '',
          national_id: d.national_id || '',
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

  const handleAddContact = async () => {
    if (!contactDraft.name.trim()) {
      toast.error('Contact name is required');
      return;
    }
    try {
      const { error } = await supabase.from('employee_emergency_contacts').insert({
        employee_id: id,
        name: contactDraft.name.trim(),
        relationship: contactDraft.relationship || null,
        phone: contactDraft.phone || null,
        email: contactDraft.email || null,
        is_primary: contactDraft.is_primary,
      });
      if (error) throw error;
      toast.success('Emergency contact added');
      setContactDraft({ name: '', relationship: '', phone: '', email: '', is_primary: false });
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

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('employees')
        .update({
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          phone: form.phone,
          date_of_birth: form.date_of_birth || null,
          gender: form.gender || null,
          marital_status: form.marital_status || null,
          nationality: form.nationality || null,
          state_of_origin: form.state_of_origin || null,
          lga: form.lga || null,
          national_id: form.national_id || null,
          residential_address: form.residential_address || null,
          permanent_address: form.permanent_address || null,
          city: form.city || null,
          state: form.state || null,
          country: form.country || null,
          postal_code: form.postal_code || null,
          blood_group: form.blood_group || null,
          genotype: form.genotype || null,
          disability_status: form.disability_status || 'NONE',
          disability_details: form.disability_status === 'DISABLED' ? (form.disability_details || null) : null,
        })
        .eq('id', id);
      if (error) throw error;
      toast.success('Personal information saved');
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
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

          <div className="flex justify-end border-t border-border pt-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
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
                  {canWrite && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => handleDeleteContact(c.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canWrite && (
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}