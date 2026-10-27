'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { isProfileLocked } from '@/lib/profile-lock';
import { ProfileLockBanner } from '@/components/profile-lock-banner';
import { CustomFieldsBlock } from '@/components/field-engine/custom-fields';
import { fetchFieldValues, saveFieldValues } from '@/lib/field-engine/client';
import type { GradeLevel } from '@/lib/types';

const STAFF_CATEGORIES = ['EXECUTIVE', 'MANAGEMENT', 'SENIOR_STAFF', 'JUNIOR_STAFF', 'CONTRACT', 'INTERN', 'ADVISOR'];
const CONTRACT_TYPES = ['PERMANENT', 'CONTRACT', 'PROBATION', 'CASUAL', 'INTERN'];

export default function EmploymentPage() {
  const params = useParams();
  const id = params.id as string;
  const { employeeId: myId, can } = useAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [positions, setPositions] = useState<{ id: string; title: string }[]>([]);
  const [managers, setManagers] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [shifts, setShifts] = useState<{ id: string; name: string; start_time: string; end_time: string }[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    employment_type: 'FULL_TIME',
    employment_status: 'PENDING_VERIFICATION',
    staff_category: '',
    grade_level_id: '',
    hire_date: '',
    confirmation_date: '',
    contract_type: '',
    contract_expiry_date: '',
    retirement_date: '',
    position_id: '',
    department_id: '',
    reporting_manager_id: '',
    compensation_grade: '',
    shift_id: '',
    location_id: '',
  });
  const [empCustom, setEmpCustom] = useState<Record<string, unknown>>({});
  const setEmpCustomValue = (fieldKey: string, value: unknown) =>
    setEmpCustom((prev) => ({ ...prev, [fieldKey]: value }));

  const canWrite = can('employees.manage');
  const locked = isProfileLocked(myId, id, form.employment_status, canWrite);

  const load = useCallback(async () => {
    try {
      const [empRes, deptRes, posRes, mgrRes, gradeRes, shiftRes, customRes, facRes] = await Promise.all([
        supabase.from('employees').select('*').eq('id', id).maybeSingle(),
        supabase.from('departments').select('id, name').eq('is_active', true),
        supabase.from('positions').select('id, title'),
        supabase.from('employees').select('id, first_name, last_name').neq('id', id),
        supabase.from('grade_levels').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
        supabase.from('shifts').select('id, name, start_time, end_time').eq('is_active', true).order('name'),
        supabase.from('attendance_facilities').select('id, name').eq('is_active', true).order('name'),
        fetchFieldValues('employee', id).catch(() => ({} as Record<string, unknown>)),
      ]);

      setEmpCustom(customRes);
      setShifts((shiftRes.data || []) as unknown as { id: string; name: string; start_time: string; end_time: string }[]);
      setFacilities((facRes.data || []) as unknown as { id: string; name: string }[]);

      if (empRes.data) {
        setForm({
          employment_type: empRes.data.employment_type || 'FULL_TIME',
          employment_status: empRes.data.employment_status || 'PENDING_VERIFICATION',
          staff_category: empRes.data.staff_category || '',
          grade_level_id: empRes.data.grade_level_id || '',
          hire_date: empRes.data.hire_date || '',
          confirmation_date: empRes.data.confirmation_date || '',
          contract_type: empRes.data.contract_type || '',
          contract_expiry_date: empRes.data.contract_expiry_date || '',
          retirement_date: empRes.data.retirement_date || '',
          position_id: empRes.data.position_id || '',
          department_id: empRes.data.department_id || '',
          reporting_manager_id: empRes.data.reporting_manager_id || '',
          compensation_grade: empRes.data.compensation_grade || '',
          shift_id: empRes.data.shift_id || '',
          location_id: empRes.data.location_id || '',
        });
      }
      setDepartments(deptRes.data || []);
      setPositions(posRes.data || []);
      setManagers(mgrRes.data || []);
      setGrades((gradeRes.data || []) as unknown as GradeLevel[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('employees')
        .update({
          employment_type: form.employment_type,
          employment_status: form.employment_status,
          staff_category: form.staff_category || null,
          grade_level_id: form.grade_level_id || null,
          hire_date: form.hire_date || null,
          confirmation_date: form.confirmation_date || null,
          contract_type: form.contract_type || null,
          contract_expiry_date: form.contract_expiry_date || null,
          retirement_date: form.retirement_date || null,
          position_id: form.position_id || null,
          department_id: form.department_id || null,
          reporting_manager_id: form.reporting_manager_id || null,
          shift_id: form.shift_id || null,
          location_id: form.location_id || null,
          compensation_grade: form.grade_level_id
            ? grades.find((g) => g.id === form.grade_level_id)?.name || form.compensation_grade
            : null,
        })
        .eq('id', id);
      if (error) throw error;

      const customValues = Object.fromEntries(
        Object.entries(empCustom).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      if (Object.keys(customValues).length > 0) {
        await saveFieldValues('employee', id, customValues);
      }

      toast.success('Employment information saved');
      load();
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="text-lg">Employment Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {locked && <ProfileLockBanner />}
        <fieldset disabled={locked} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Employment Type</Label>
            <Select value={form.employment_type} onValueChange={(v) => setForm({ ...form, employment_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FULL_TIME">Full Time</SelectItem>
                <SelectItem value="PART_TIME">Part Time</SelectItem>
                <SelectItem value="CONTRACT">Contract</SelectItem>
                <SelectItem value="INTERN">Intern</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Employment Status</Label>
            <Select value={form.employment_status} onValueChange={(v) => setForm({ ...form, employment_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING_VERIFICATION">Pending Verification</SelectItem>
                <SelectItem value="ONBOARDING">Onboarding</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="ON_LEAVE">On Leave</SelectItem>
                <SelectItem value="TERMINATED">Terminated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Staff Category</Label>
            <Select value={form.staff_category} onValueChange={(v) => setForm({ ...form, staff_category: v })}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {STAFF_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Grade Level</Label>
            <Select value={form.grade_level_id} onValueChange={(v) => setForm({ ...form, grade_level_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select grade" /></SelectTrigger>
              <SelectContent>
                {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Hire Date</Label>
            <Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Confirmation Date</Label>
            <Input
              type="date"
              value={form.confirmation_date}
              min={form.hire_date || undefined}
              onChange={(e) => setForm({ ...form, confirmation_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Retirement Date</Label>
            <Input type="date" value={form.retirement_date} onChange={(e) => setForm({ ...form, retirement_date: e.target.value })} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Contract Type</Label>
            <Select value={form.contract_type} onValueChange={(v) => setForm({ ...form, contract_type: v })}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {CONTRACT_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Contract Expiry</Label>
            <Input
              type="date"
              value={form.contract_expiry_date}
              min={form.hire_date || undefined}
              onChange={(e) => setForm({ ...form, contract_expiry_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Legacy Grade Text</Label>
            <Input value={form.compensation_grade} onChange={(e) => setForm({ ...form, compensation_grade: e.target.value })} placeholder="Override if needed" />
          </div>
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

        <div className="space-y-1.5">
          <Label>Reporting Manager</Label>
          <Select value={form.reporting_manager_id} onValueChange={(v) => setForm({ ...form, reporting_manager_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
            <SelectContent>
              {managers.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.first_name} {m.last_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Shift</Label>
          <Select value={form.shift_id} onValueChange={(v) => setForm({ ...form, shift_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
            <SelectContent>
              {shifts.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.start_time.slice(0, 5)} - {s.end_time.slice(0, 5)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Location / Facility</Label>
          <p className="text-xs text-muted-foreground">Determines the geofence used for clock-in/out when not assigned to an active project.</p>
          <Select value={form.location_id} onValueChange={(v) => setForm({ ...form, location_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger>
            <SelectContent>
              <SelectItem key="" value="">None (use project geofence only)</SelectItem>
              {facilities.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <CustomFieldsBlock
          moduleKey="employee"
          values={empCustom}
          onChange={setEmpCustomValue}
          disabled={locked}
        />

        {!locked && (
          <div className="flex justify-end border-t border-border pt-4">
            <Button onClick={handleSave} disabled={saving || !canWrite}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        )}
        </fieldset>
      </CardContent>
    </Card>
  );
}