'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Plus, Pencil, Trash2, Send, Gavel, Save, ClipboardList, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { toast } from 'sonner';
import {
  fetchAppraisal, fetchAppraisalAreas, addAppraisalArea, updateAppraisalArea,
  deleteAppraisalArea, setAppraisalEditAreas, submitAppraisalScores,
  pushAppraisalToMd, giveAppraisalVerdict, cancelAppraisal, employeeName, weightedAvg,
  APPRAISAL_STATUS_LABELS, APPRAISAL_STATUS_COLORS, type AppraisalWithPeople,
} from '@/lib/appraisal';
import type { AppraisalArea } from '@/lib/types';

interface Person { id: string; first_name: string; last_name: string }

export default function AppraisalDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { employeeId, can } = useAccess();

  const [appraisal, setAppraisal] = useState<AppraisalWithPeople | null>(null);
  const [areas, setAreas] = useState<AppraisalArea[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canManage = can('performance.appraisal');
  const canVerdict = can('performance.appraisal_verdict');

  const isEmployee = !!employeeId && appraisal?.employee_id === employeeId;
  const isManager = !!employeeId && appraisal?.reporting_manager_id === employeeId;
  const isMd = !!employeeId && appraisal?.md_id === employeeId;

  const load = useCallback(async () => {
    try {
      const [a, ar, p] = await Promise.all([
        fetchAppraisal(id),
        fetchAppraisalAreas(id),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE').order('first_name'),
      ]);
      setAppraisal(a);
      setAreas(ar);
      setPeople((p.data || []) as Person[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const empAvg = useMemo(() => weightedAvg(areas, 'employee'), [areas]);
  const mgrAvg = useMemo(() => weightedAvg(areas, 'manager'), [areas]);
  const overallAvg = useMemo(() => {
    const vals = [empAvg, mgrAvg].filter((v): v is number => v != null);
    if (!vals.length) return null;
    return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
  }, [empAvg, mgrAvg]);

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (!appraisal) return <div className="text-sm text-muted-foreground">Appraisal not found or you do not have access.</div>;

  const status = appraisal.status;
  const scoringOpen = status === 'SCORING';
  const canEditAreas = canManage || (appraisal.allow_edit_areas && scoringOpen && (isEmployee || isManager));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/performance/appraisals')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {employeeName(appraisal.employee)} — {appraisal.review_cycle}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className={APPRAISAL_STATUS_COLORS[status] || ''}>
                {APPRAISAL_STATUS_LABELS[status] || status}
              </Badge>
              {appraisal.period_start && <span>{appraisal.period_start} → {appraisal.period_end || '…'}</span>}
              <span>Manager: {employeeName(appraisal.manager)}</span>
              <span>MD: {employeeName(appraisal.md)}</span>
            </div>
          </div>
        </div>
        {canManage && status !== 'COMPLETED' && status !== 'CANCELLED' && (
          <Button
            variant="outline" size="sm"
            onClick={async () => {
              try { await cancelAppraisal(id); toast.success('Appraisal cancelled'); load(); }
              catch (e) { toast.error((e as Error).message); }
            }}
          >
            Cancel Appraisal
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryTile label="Employee Score Avg" value={empAvg} submitted={!!appraisal.employee_submitted_at} />
        <SummaryTile label="Manager Score Avg" value={mgrAvg} submitted={!!appraisal.manager_submitted_at} />
        <SummaryTile label="Final Rating" value={appraisal.final_rating} submitted={status === 'COMPLETED'} accent />
      </div>

      {status === 'COMPLETED' && appraisal.verdict && (
        <Card className="border-success/30 bg-success/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Gavel className="h-4 w-4" /> MD Final Verdict</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="font-semibold">Rating:</span> {appraisal.final_rating ?? '—'}</p>
            <p><span className="font-semibold">Verdict:</span> {appraisal.verdict}</p>
            {appraisal.md_comments && <p><span className="font-semibold">Comments:</span> {appraisal.md_comments}</p>}
          </CardContent>
        </Card>
      )}

      {/* Areas */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Appraisal Areas</CardTitle>
            <CardDescription>
              {canEditAreas
                ? 'Score each area from 1–5 with a justification. You can add or edit areas while this setting is enabled.'
                : 'Areas the employee is being appraised on.'}
            </CardDescription>
          </div>
          {(canManage || canEditAreas) && (
            <ManageAreasToolbar
              appraisalId={id}
              areas={areas}
              allowEdit={appraisal.allow_edit_areas}
              canManage={canManage}
              disabled={status === 'COMPLETED' || status === 'CANCELLED' || status === 'PENDING_MD'}
              onChanged={load}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {areas.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <ClipboardList className="h-8 w-8 opacity-40" />
              <p className="text-sm">No areas defined yet.</p>
              {canManage && <p className="text-xs">Use “Add Area” to define what the employee is appraised on.</p>}
            </div>
          ) : (
            areas.map((a, idx) => (
              <AreaRow
                key={a.id}
                index={idx + 1}
                area={a}
                canManage={canManage}
                canEditAreas={canEditAreas}
                disabled={!scoringOpen}
                onChanged={load}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Score submission: employee / manager */}
      {scoringOpen && (isEmployee || isManager) && (
        <ScoreSubmission
          party={isEmployee ? 'employee' : 'manager'}
          areas={areas}
          submitted={isEmployee ? !!appraisal.employee_submitted_at : !!appraisal.manager_submitted_at}
          appraisalId={id}
          onSubmitted={load}
        />
      )}

      {/* HR: push to MD */}
      {canManage && status === 'SCORING' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Send className="h-4 w-4" /> Push to Managing Director</CardTitle>
            <CardDescription>
              {appraisal.employee_submitted_at && appraisal.manager_submitted_at
                ? 'Both parties have submitted. Select the MD and push for a final verdict.'
                : 'Both the employee and reporting manager must submit their scores first.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PushToMd
              appraisalId={id}
              defaultMd={appraisal.md_id}
              people={people}
              employeeId={appraisal.employee_id}
              disabled={!appraisal.employee_submitted_at || !appraisal.manager_submitted_at}
              onDone={load}
            />
          </CardContent>
        </Card>
      )}

      {/* MD verdict */}
      {canVerdict && isMd && status === 'PENDING_MD' && (
        <Card className="border-warning/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Gavel className="h-4 w-4" /> Final Verdict</CardTitle>
            <CardDescription>Review both parties&apos; scores and give the final rating and verdict.</CardDescription>
          </CardHeader>
          <CardContent>
            <VerdictForm appraisalId={id} suggested={overallAvg} onDone={load} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryTile({ label, value, submitted, accent }: { label: string; value: number | null; submitted: boolean; accent?: boolean }) {
  return (
    <Card className={accent ? 'border-primary/30' : ''}>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value != null ? value : '—'}</p>
        <Badge variant="outline" className={submitted ? 'mt-2 bg-success/10 text-success' : 'mt-2 bg-muted text-muted-foreground'}>
          {submitted ? 'Submitted' : 'Pending'}
        </Badge>
      </CardContent>
    </Card>
  );
}

function ManageAreasToolbar({
  appraisalId, areas, allowEdit, canManage, disabled, onChanged,
}: {
  appraisalId: string; areas: AppraisalArea[]; allowEdit: boolean; canManage: boolean; disabled: boolean; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', weight: '1' });
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await addAppraisalArea(appraisalId, form.name.trim(), form.description || undefined, Number(form.weight) || 1);
      toast.success('Area added');
      setForm({ name: '', description: '', weight: '1' });
      setOpen(false);
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
      <div className="flex items-center gap-3">
      {canManage && (
        <div className="hidden items-center gap-2 sm:flex">
          <Label htmlFor="allowAreaEdit" className="text-xs text-muted-foreground">Allow emp/manager edits</Label>
          <Switch
            id="allowAreaEdit"
            checked={allowEdit}
            disabled={disabled}
            onCheckedChange={async (v) => {
              try { await setAppraisalEditAreas(appraisalId, v); toast.success('Updated'); onChanged(); }
              catch (e) { toast.error((e as Error).message); }
            }}
          />
        </div>
      )}
      <Button size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Add Area
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Appraisal Area</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Area Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Job Knowledge" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Weight</Label>
              <Input type="number" min="0" step="0.1" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add} disabled={saving || !form.name.trim()}>{saving ? 'Adding...' : 'Add Area'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AreaRow({
  index, area, canManage, canEditAreas, disabled, onChanged,
}: {
  index: number; area: AppraisalArea; canManage: boolean; canEditAreas: boolean; disabled: boolean; onChanged: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [form, setForm] = useState({ name: area.name, description: area.description || '', weight: String(area.weight) });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateAppraisalArea(area.id, form.name.trim(), form.description || undefined, Number(form.weight) || 1);
      toast.success('Area updated');
      setEditOpen(false);
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    try { await deleteAppraisalArea(area.id); toast.success('Area removed'); setDelOpen(false); onChanged(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">#{index}</span>
            <span className="font-medium">{area.name}</span>
            <Badge variant="outline" className="text-[10px]">weight {area.weight}</Badge>
            {area.is_mandatory && (
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary gap-1">
                <Lock className="h-2.5 w-2.5" /> Mandatory
              </Badge>
            )}
          </div>
          {area.description && <p className="mt-0.5 text-xs text-muted-foreground">{area.description}</p>}
        </div>
        {canEditAreas && !area.is_mandatory && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDelOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-muted/40 p-2.5">
          <p className="text-xs font-semibold text-muted-foreground">Employee</p>
          <p className="text-sm">{area.employee_score != null ? `${area.employee_score}/5` : '— not scored'}</p>
          {area.employee_justification && <p className="mt-1 text-xs italic text-muted-foreground">“{area.employee_justification}”</p>}
        </div>
        <div className="rounded-md bg-muted/40 p-2.5">
          <p className="text-xs font-semibold text-muted-foreground">Reporting Manager</p>
          <p className="text-sm">{area.manager_score != null ? `${area.manager_score}/5` : '— not scored'}</p>
          {area.manager_justification && <p className="mt-1 text-xs italic text-muted-foreground">“{area.manager_justification}”</p>}
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Appraisal Area</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Area Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Weight</Label>
              <Input type="number" min="0" step="0.1" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this area?</AlertDialogTitle>
            <AlertDialogDescription>Any scores recorded for this area will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={remove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ScoreSubmission({
  party, areas, submitted, appraisalId, onSubmitted,
}: {
  party: 'employee' | 'manager'; areas: AppraisalArea[]; submitted: boolean; appraisalId: string; onSubmitted: () => void;
}) {
  const [values, setValues] = useState<Record<string, { score: string; justification: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init: Record<string, { score: string; justification: string }> = {};
    for (const a of areas) {
      const sc = party === 'employee' ? a.employee_score : a.manager_score;
      const ju = party === 'employee' ? a.employee_justification : a.manager_justification;
      init[a.id] = { score: sc != null ? String(sc) : '', justification: ju || '' };
    }
    setValues(init);
  }, [areas, party]);

  const submit = async () => {
    const payload = areas.map((a) => ({
      area_id: a.id,
      score: values[a.id]?.score ? Number(values[a.id].score) : null,
      justification: values[a.id]?.justification || '',
    }));
    if (payload.some((p) => p.score == null)) {
      toast.error('Please score every area (1–5).');
      return;
    }
    setSaving(true);
    try {
      await submitAppraisalScores(appraisalId, party, payload);
      toast.success('Scores submitted');
      onSubmitted();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Your Scores ({party === 'employee' ? 'Employee' : 'Reporting Manager'})</CardTitle>
        <CardDescription>
          {submitted
            ? 'You have submitted your scores. Submitting again will update them while the appraisal is open for scoring.'
            : 'Score each area from 1–5 and give a justification.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {areas.length === 0 && <p className="text-sm text-muted-foreground">No areas to score yet.</p>}
        {areas.map((a, idx) => (
          <div key={a.id} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">#{idx + 1} {a.name}</p>
              <Textarea
                placeholder="Justification..."
                value={values[a.id]?.justification || ''}
                onChange={(e) => setValues((v) => ({ ...v, [a.id]: { ...v[a.id], justification: e.target.value } }))}
                rows={2}
              />
            </div>
            <div className="space-y-1.5 sm:w-28">
              <Label className="text-xs">Score (1–5)</Label>
              <Select
                value={values[a.id]?.score || ''}
                onValueChange={(v) => setValues((s) => ({ ...s, [a.id]: { ...s[a.id], score: v } }))}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        {areas.length > 0 && (
          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Submitting...' : submitted ? 'Resubmit Scores' : 'Submit Scores'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PushToMd({
  appraisalId, defaultMd, people, employeeId, disabled, onDone,
}: {
  appraisalId: string; defaultMd: string | null; people: Person[]; employeeId: string; disabled: boolean; onDone: () => void;
}) {
  const [md, setMd] = useState(defaultMd || '');
  const [saving, setSaving] = useState(false);

  const push = async () => {
    setSaving(true);
    try {
      await pushAppraisalToMd(appraisalId, md || null);
      toast.success('Pushed to MD for final verdict');
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1.5">
        <Label>Managing Director</Label>
        <Select value={md || '__none__'} onValueChange={(v) => setMd(v === '__none__' ? '' : v)}>
          <SelectTrigger><SelectValue placeholder="Select MD" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— Select —</SelectItem>
            {people.filter((p) => p.id !== employeeId).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={push} disabled={disabled || saving || !md}>
        <Send className="mr-2 h-4 w-4" /> {saving ? 'Pushing...' : 'Push to MD'}
      </Button>
    </div>
  );
}

function VerdictForm({ appraisalId, suggested, onDone }: { appraisalId: string; suggested: number | null; onDone: () => void }) {
  const [rating, setRating] = useState(suggested != null ? String(suggested) : '');
  const [verdict, setVerdict] = useState('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!rating || !verdict.trim()) { toast.error('Rating and verdict are required.'); return; }
    setSaving(true);
    try {
      await giveAppraisalVerdict(appraisalId, Number(rating), verdict.trim(), comments || undefined);
      toast.success('Final verdict recorded');
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Final Rating (1–5) *</Label>
          <Input type="number" min="1" max="5" step="0.01" value={rating} onChange={(e) => setRating(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Verdict *</Label>
          <Input value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="e.g. Satisfactory, Exceeds expectations, Needs improvement" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Comments</Label>
        <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} />
      </div>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={saving}>
          <Gavel className="mr-2 h-4 w-4" /> {saving ? 'Submitting...' : 'Submit Final Verdict'}
        </Button>
      </div>
    </div>
  );
}
