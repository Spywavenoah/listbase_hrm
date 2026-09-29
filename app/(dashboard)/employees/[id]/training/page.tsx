'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Award, BookMarked, Plus } from 'lucide-react';

interface Enrollment {
  id: string;
  course_id: string;
  status: string;
  progress: number;
  completed_at: string | null;
  course_title?: string;
}
interface Certification {
  id: string;
  title: string;
  issuing_body: string | null;
  issued_at: string | null;
  expiry_date: string | null;
}
interface Assessment {
  id: string;
  competency_id: string;
  proficiency: number;
  assessed_at: string;
  competency_name?: string;
}

function certStatus(expiry: string | null) {
  if (!expiry) return { label: 'No Expiry', cls: 'bg-muted text-muted-foreground' };
  const exp = new Date(expiry + 'T00:00:00');
  if (exp < new Date()) return { label: 'Expired', cls: 'bg-destructive/10 text-destructive' };
  const soon = new Date(Date.now() + 30 * 86400000);
  if (exp <= soon) return { label: 'Expiring Soon', cls: 'bg-warning/10 text-warning' };
  return { label: 'Active', cls: 'bg-success/10 text-success' };
}

const enrollColors: Record<string, string> = {
  ENROLLED: 'bg-info/10 text-info',
  IN_PROGRESS: 'bg-warning/10 text-warning',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

const levelLabel = (n: number) => ['', 'Novice', 'Basic', 'Proficient', 'Advanced', 'Expert'][n] || String(n);

export default function EmployeeTrainingPage() {
  const params = useParams();
  const id = params.id as string;
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [certs, setCerts] = useState<Certification[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [certOpen, setCertOpen] = useState(false);
  const [certForm, setCertForm] = useState({ title: '', issuing_body: '', issued_at: '', expiry_date: '' });

  const load = useCallback(async () => {
    try {
      const [eRes, cRes, aRes, courseRes, compRes] = await Promise.all([
        supabase.from('training_enrollments').select('*').eq('employee_id', id).order('enrolled_at', { ascending: false }),
        supabase.from('employee_certifications').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
        supabase.from('employee_competencies').select('*').eq('employee_id', id).order('assessed_at', { ascending: false }),
        supabase.from('training_courses').select('id, title'),
        supabase.from('competencies').select('id, name'),
      ]);
      const courseMap = new Map((courseRes.data || []).map((c) => [c.id, c.title]));
      const compMap = new Map((compRes.data || []).map((c) => [c.id, c.name]));
      setEnrollments(((eRes.data || []) as Enrollment[]).map((e) => ({ ...e, course_title: courseMap.get(e.course_id) || '—' })));
      setCerts((cRes.data || []) as Certification[]);
      setAssessments(((aRes.data || []) as Assessment[]).map((a) => ({ ...a, competency_name: compMap.get(a.competency_id) || '—' })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleAddCert = async () => {
    try {
      const { error } = await supabase.from('employee_certifications').insert({
        employee_id: id,
        title: certForm.title,
        issuing_body: certForm.issuing_body || null,
        issued_at: certForm.issued_at || null,
        expiry_date: certForm.expiry_date || null,
      });
      if (error) throw error;
      toast.success('Certification added');
      setCertOpen(false);
      setCertForm({ title: '', issuing_body: '', issued_at: '', expiry_date: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Course Enrollments</CardTitle>
          <span className="text-sm text-muted-foreground">{enrollments.length} total</span>
        </CardHeader>
        <CardContent>
          {enrollments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No course enrollments yet.</p>
          ) : (
            <div className="space-y-3">
              {enrollments.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{e.course_title}</p>
                    {e.completed_at && <p className="text-xs text-muted-foreground">Completed {new Date(e.completed_at).toLocaleDateString()}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="hidden sm:flex items-center gap-2">
                      <div className="h-2 w-20 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${e.progress}%` }} /></div>
                      <span className="text-xs text-muted-foreground">{e.progress}%</span>
                    </div>
                    <Badge variant="outline" className={enrollColors[e.status] || ''}>{e.status.replace(/_/g, ' ')}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg flex items-center gap-2"><Award className="h-4 w-4" /> Certifications</CardTitle>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setCertOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
          </Button>
        </CardHeader>
        <CardContent>
          {certs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No certifications recorded.</p>
          ) : (
            <div className="space-y-3">
              {certs.map((c) => {
                const s = certStatus(c.expiry_date);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{c.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.issuing_body || '—'}{c.issued_at ? ` · Issued ${c.issued_at}` : ''}{c.expiry_date ? ` · Expires ${c.expiry_date}` : ''}
                      </p>
                    </div>
                    <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg flex items-center gap-2"><BookMarked className="h-4 w-4" /> Competencies</CardTitle>
          <span className="text-sm text-muted-foreground">{assessments.length} assessed</span>
        </CardHeader>
        <CardContent>
          {assessments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No competency assessments yet.</p>
          ) : (
            <div className="space-y-3">
              {assessments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{a.competency_name}</p>
                    <p className="text-xs text-muted-foreground">Assessed {a.assessed_at}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="hidden sm:flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={`h-1.5 w-5 rounded-full ${n <= a.proficiency ? 'bg-primary' : 'bg-muted'}`} />
                      ))}
                    </div>
                    <Badge variant="outline" className="bg-info/10 text-info">{a.proficiency}/5 · {levelLabel(a.proficiency)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={certOpen} onOpenChange={setCertOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Certification</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={certForm.title} onChange={(e) => setCertForm({ ...certForm, title: e.target.value })} placeholder="PMP" />
            </div>
            <div className="space-y-1.5">
              <Label>Issuing Body</Label>
              <Input value={certForm.issuing_body} onChange={(e) => setCertForm({ ...certForm, issuing_body: e.target.value })} placeholder="PMI" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Issued Date</Label>
                <Input type="date" value={certForm.issued_at} onChange={(e) => setCertForm({ ...certForm, issued_at: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Date</Label>
                <Input type="date" value={certForm.expiry_date} onChange={(e) => setCertForm({ ...certForm, expiry_date: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCertOpen(false)}>Cancel</Button>
            <Button onClick={handleAddCert} disabled={!certForm.title}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}