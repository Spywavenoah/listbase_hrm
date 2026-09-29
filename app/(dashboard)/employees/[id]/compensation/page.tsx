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
import type { GradeLevel, EmployeeHistoryEntry } from '@/lib/types';
import { useAccess } from '@/lib/access';

const EVENT_COLORS: Record<string, string> = {
  SALARY_CHANGE: 'bg-success/10 text-success',
  PROMOTION: 'bg-primary/10 text-primary',
  TRANSFER: 'bg-info/10 text-info',
  STATUS_CHANGE: 'bg-warning/10 text-warning',
  CONTRACT_CHANGE: 'bg-muted text-muted-foreground',
  HIRE: 'bg-primary/10 text-primary',
};

export default function CompensationPage() {
  const params = useParams();
  const id = params.id as string;
  const { can } = useAccess();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [grades, setGrades] = useState<GradeLevel[]>([]);
  const [history, setHistory] = useState<EmployeeHistoryEntry[]>([]);
  const [form, setForm] = useState({
    grade_level_id: '',
    compensation_grade: '',
    monthly_salary: '',
    bank_name: '',
    bank_account_number: '',
    bank_routing_number: '',
  });

  const canWrite = can('employees.manage');

  const load = useCallback(async () => {
    try {
      const [empRes, gradeRes, histRes] = await Promise.all([
        supabase.from('employees').select('compensation_grade, monthly_salary, grade_level_id, bank_name, bank_account_number, bank_routing_number').eq('id', id).maybeSingle(),
        supabase.from('grade_levels').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
        supabase.from('employee_history').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(20),
      ]);
      if (empRes.error) throw empRes.error;
      if (empRes.data) {
        setForm({
          grade_level_id: empRes.data.grade_level_id || '',
          compensation_grade: empRes.data.compensation_grade || '',
          monthly_salary: empRes.data.monthly_salary != null && empRes.data.monthly_salary > 0 ? String(empRes.data.monthly_salary) : '',
          bank_name: empRes.data.bank_name || '',
          bank_account_number: empRes.data.bank_account_number || '',
          bank_routing_number: empRes.data.bank_routing_number || '',
        });
      }
      setGrades((gradeRes.data || []) as unknown as GradeLevel[]);
      setHistory((histRes.data || []) as unknown as EmployeeHistoryEntry[]);
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
      const selectedGrade = grades.find((g) => g.id === form.grade_level_id);
      const { error } = await supabase
        .from('employees')
        .update({
          grade_level_id: form.grade_level_id || null,
          compensation_grade: selectedGrade?.name || form.compensation_grade || null,
          monthly_salary: form.monthly_salary ? Number(form.monthly_salary) : null,
          bank_name: form.bank_name || null,
          bank_account_number: form.bank_account_number || null,
          bank_routing_number: form.bank_routing_number || null,
        })
        .eq('id', id);
      if (error) throw error;
      toast.success('Compensation information saved');
      load();
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Compensation & Banking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Grade Level</Label>
              <Select value={form.grade_level_id} onValueChange={(v) => setForm({ ...form, grade_level_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select grade" /></SelectTrigger>
                <SelectContent>
                  {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Compensation Grade (text)</Label>
              <Input value={form.compensation_grade} onChange={(e) => setForm({ ...form, compensation_grade: e.target.value })} placeholder="e.g. Level 5, Band B" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Monthly Salary</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.monthly_salary}
              onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })}
              placeholder="e.g. 250000"
            />
            <p className="text-xs text-muted-foreground">Used by the payroll engine to generate payslips. Changes are versioned in the employment history automatically.</p>
          </div>

          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Bank Details</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Bank Name</Label>
                <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Account Number</Label>
                <Input value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} />
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              <Label>Routing Number</Label>
              <Input value={form.bank_routing_number} onChange={(e) => setForm({ ...form, bank_routing_number: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button onClick={handleSave} disabled={saving || !canWrite}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Salary & Grade History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <p className="text-sm">No salary or grade changes recorded yet.</p>
            </div>
          ) : (
            <div className="relative space-y-4 before:absolute before:left-2 before:top-0 before:h-full before:w-px before:bg-border">
              {history
                .filter((h) => ['SALARY_CHANGE', 'PROMOTION', 'TRANSFER', 'STATUS_CHANGE', 'CONTRACT_CHANGE', 'HIRE'].includes(h.event_type))
                .map((h) => (
                  <div key={h.id} className="relative pl-8">
                    <div className={`absolute left-0 top-1 h-4 w-4 rounded-full border-2 border-card ${EVENT_COLORS[h.event_type] || 'bg-muted'}`} />
                    <p className="text-sm font-medium">{h.title}</p>
                    {h.description && (
                      <p className="text-xs text-muted-foreground">{h.description}</p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {h.effective_date || new Date(h.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}