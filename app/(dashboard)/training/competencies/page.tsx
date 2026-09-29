'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookMarked, Users, Award, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface Competency {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  is_active: boolean;
}

interface Assessment {
  id: string;
  employee_id: string;
  competency_id: string;
  proficiency: number;
  assessed_at: string;
  notes: string | null;
}

export default function CompetenciesPage() {
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [compOpen, setCompOpen] = useState(false);
  const [compForm, setCompForm] = useState({ name: '', category: '', description: '', is_active: true });

  const [assessOpen, setAssessOpen] = useState(false);
  const [assessForm, setAssessForm] = useState({ employee_id: '', competency_id: '', proficiency: '3', notes: '' });

  const load = useCallback(async () => {
    try {
      const [compRes, aRes, empRes] = await Promise.all([
        supabase.from('competencies').select('*').order('name'),
        supabase.from('employee_competencies').select('*').order('assessed_at', { ascending: false }),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE'),
      ]);
      setCompetencies((compRes.data || []) as unknown as Competency[]);
      setAssessments((aRes.data || []) as unknown as Assessment[]);
      setEmployees(empRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreateCompetency = async () => {
    try {
      const { error } = await supabase.from('competencies').insert({
        name: compForm.name,
        category: compForm.category || null,
        description: compForm.description || null,
        is_active: compForm.is_active,
      });
      if (error) throw error;
      toast.success('Competency added');
      setCompOpen(false);
      setCompForm({ name: '', category: '', description: '', is_active: true });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const handleAssess = async () => {
    try {
      const { error } = await supabase.from('employee_competencies').upsert(
        {
          employee_id: assessForm.employee_id,
          competency_id: assessForm.competency_id,
          proficiency: parseInt(assessForm.proficiency),
          assessed_at: new Date().toISOString().slice(0, 10),
          notes: assessForm.notes || null,
        },
        { onConflict: 'employee_id,competency_id' }
      );
      if (error) throw error;
      toast.success('Assessment saved');
      setAssessOpen(false);
      setAssessForm({ employee_id: '', competency_id: '', proficiency: '3', notes: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const empName = (id: string) => employees.find((e) => e.id === id) ? `${employees.find((e) => e.id === id)!.first_name} ${employees.find((e) => e.id === id)!.last_name}` : '—';
  const compName = (id: string) => competencies.find((c) => c.id === id)?.name || '—';

  const levelLabel = (n: number) => {
    const labels = ['', 'Novice', 'Basic', 'Proficient', 'Advanced', 'Expert'];
    return labels[n] || String(n);
  };

  const compColumns: Column<Competency>[] = [
    { key: 'name', label: 'Competency' },
    { key: 'category', label: 'Category', render: (c) => c.category || '—' },
    { key: 'description', label: 'Description', render: (c) => c.description?.slice(0, 70) || '—' },
    {
      key: 'assessed', label: 'Assessed',
      render: (c) => assessments.filter((a) => a.competency_id === c.id).length,
    },
    {
      key: 'is_active', label: 'Status',
      render: (c) => <Badge variant="outline" className={c.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{c.is_active ? 'Active' : 'Inactive'}</Badge>,
    },
  ];

  const assessColumns: Column<Assessment>[] = [
    { key: 'employee', label: 'Employee', render: (a) => empName(a.employee_id) },
    { key: 'competency', label: 'Competency', render: (a) => compName(a.competency_id) },
    {
      key: 'proficiency', label: 'Level',
      render: (a) => <Badge variant="outline" className="bg-info/10 text-info">{a.proficiency}/5 · {levelLabel(a.proficiency)}</Badge>,
    },
    { key: 'assessed_at', label: 'Assessed', render: (a) => a.assessed_at || '—' },
    { key: 'notes', label: 'Notes', render: (a) => a.notes?.slice(0, 50) || '—' },
  ];

  const compSummary: SummaryCard[] = [
    { label: 'Competencies', value: competencies.length, icon: BookMarked, color: 'primary' },
    { label: 'Active', value: competencies.filter((c) => c.is_active).length, icon: CheckCircle2, color: 'success' },
    { label: 'Assessments', value: assessments.length, icon: Users, color: 'info' },
    { label: 'Avg Level', value: (assessments.length ? (assessments.reduce((s, a) => s + a.proficiency, 0) / assessments.length) : 0).toFixed(1), icon: Award, color: 'warning' },
  ];

  return (
    <div className="space-y-6">
      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">Competency Catalog</TabsTrigger>
          <TabsTrigger value="assessments">Assessments ({assessments.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="mt-4">
          <ModuleListPage
            title="Competencies"
            description="Define the skills and knowledge framework used across the organization"
            summaryCards={compSummary}
            columns={compColumns}
            data={competencies}
            searchPlaceholder="Search competencies..."
            createLabel="Add Competency"
            onCreate={() => setCompOpen(true)}
          />
        </TabsContent>
        <TabsContent value="assessments" className="mt-4">
          <ModuleListPage
            title="Assessments"
            description="Record employee proficiency levels against the competency framework"
            summaryCards={[]}
            columns={assessColumns}
            data={assessments}
            searchPlaceholder="Search assessments..."
            createLabel="Assess Employee"
            onCreate={() => setAssessOpen(true)}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={compOpen} onOpenChange={setCompOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Competency</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={compForm.name} onChange={(e) => setCompForm({ ...compForm, name: e.target.value })} placeholder="Data Analysis" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input value={compForm.category} onChange={(e) => setCompForm({ ...compForm, category: e.target.value })} placeholder="Technical" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={compForm.description} onChange={(e) => setCompForm({ ...compForm, description: e.target.value })} rows={2} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={compForm.is_active} onCheckedChange={(v) => setCompForm({ ...compForm, is_active: v })} />
              <Label className="cursor-pointer" onClick={() => setCompForm({ ...compForm, is_active: !compForm.is_active })}>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCompetency} disabled={!compForm.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assessOpen} onOpenChange={setAssessOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assess Proficiency</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={assessForm.employee_id} onValueChange={(v) => setAssessForm({ ...assessForm, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Competency</Label>
              <Select value={assessForm.competency_id} onValueChange={(v) => setAssessForm({ ...assessForm, competency_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select competency" /></SelectTrigger>
                <SelectContent>
                  {competencies.filter((c) => c.is_active).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Proficiency (1–5)</Label>
              <Select value={assessForm.proficiency} onValueChange={(v) => setAssessForm({ ...assessForm, proficiency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} — {levelLabel(n)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={assessForm.notes} onChange={(e) => setAssessForm({ ...assessForm, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssessOpen(false)}>Cancel</Button>
            <Button onClick={handleAssess} disabled={!assessForm.employee_id || !assessForm.competency_id}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}