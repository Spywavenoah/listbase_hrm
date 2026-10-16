'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { Users, UserPlus, Repeat, CalendarClock, CheckCircle, Plus, Trash2, Layers } from 'lucide-react';
import {
  WORKFORCE_SOURCES,
  labelFor,
  employeeName,
  fmtDate,
  inclusiveDays,
  todayIso,
  type Project,
  type ProjectWorkforce,
  type WorkforceBatch,
  type ProjectShuffleRequest,
  type ProjectShuffleItem,
  type EmployeeLite,
} from '@/lib/projects';

type WorkforceRow = ProjectWorkforce & { employee?: EmployeeLite };
type ShuffleRequestRow = ProjectShuffleRequest & { items: (ProjectShuffleItem & { replaced?: EmployeeLite; replacement?: EmployeeLite })[] };

interface ShuffleLine {
  key: string;
  replacedWorkforceId: string;
  newEmployeeId: string;
  replaceEnd: string;
  newStart: string;
  role: string;
  notes: string;
}

const newLine = (): ShuffleLine => ({
  key: Math.random().toString(36).slice(2),
  replacedWorkforceId: '',
  newEmployeeId: '',
  replaceEnd: todayIso(),
  newStart: todayIso(),
  role: '',
  notes: '',
});

function WorkforceContent() {
  const params = useSearchParams();
  const { can, employee } = useAccess();
  const canManage = can('projects.manage') || can('admin.settings');

  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [workforce, setWorkforce] = useState<ProjectWorkforce[]>([]);
  const [batches, setBatches] = useState<WorkforceBatch[]>([]);
  const [requests, setRequests] = useState<ProjectShuffleRequest[]>([]);
  const [items, setItems] = useState<ProjectShuffleItem[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const [appendOpen, setAppendOpen] = useState(false);
  const [appendSearch, setAppendSearch] = useState('');
  const [appendIds, setAppendIds] = useState<string[]>([]);
  const [appendRole, setAppendRole] = useState('');
  const [appendStart, setAppendStart] = useState(todayIso());
  const [appendNotes, setAppendNotes] = useState('');

  const [shuffleOpen, setShuffleOpen] = useState(false);
  const [shuffleNotes, setShuffleNotes] = useState('');
  const [shuffleLines, setShuffleLines] = useState<ShuffleLine[]>([newLine()]);
  const [shuffleSaving, setShuffleSaving] = useState(false);

  const [editRow, setEditRow] = useState<WorkforceRow | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  const loadBase = useCallback(async () => {
    const [p, e] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE').order('first_name'),
    ]);
    const list = (p.data || []) as unknown as Project[];
    setProjects(list);
    setEmployees((e.data || []) as EmployeeLite[]);
    const fromUrl = params.get('project');
    setSelected((prev) => prev || (fromUrl && list.some((x) => x.id === fromUrl) ? fromUrl : list[0]?.id || ''));
    setLoading(false);
  }, [params]);

  const loadRoster = useCallback(async (projectId: string) => {
    if (!projectId) { setWorkforce([]); setBatches([]); setRequests([]); setItems([]); return; }
    const [w, b, req] = await Promise.all([
      supabase.from('project_workforce').select('*').eq('project_id', projectId).order('start_date', { ascending: false }),
      supabase.from('project_workforce_batches').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('project_shuffle_requests').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    ]);
    const reqList = (req.data || []) as unknown as ProjectShuffleRequest[];
    setWorkforce((w.data || []) as unknown as ProjectWorkforce[]);
    setBatches((b.data || []) as unknown as WorkforceBatch[]);
    setRequests(reqList);
    if (reqList.length) {
      const { data: itemData } = await supabase
        .from('project_shuffle_items')
        .select('*')
        .in('request_id', reqList.map((r) => r.id));
      setItems((itemData || []) as unknown as ProjectShuffleItem[]);
    } else {
      setItems([]);
    }
  }, []);

  useEffect(() => { loadBase(); }, [loadBase]);
  useEffect(() => { loadRoster(selected); }, [selected, loadRoster]);

  const employeeMap = useMemo(() => {
    const m: Record<string, EmployeeLite> = {};
    for (const e of employees) m[e.id] = e;
    return m;
  }, [employees]);

  const selectedProject = projects.find((p) => p.id === selected) || null;

  const rows: WorkforceRow[] = useMemo(
    () => workforce.map((w) => ({ ...w, employee: employeeMap[w.employee_id] })),
    [workforce, employeeMap]
  );

  const requestRows: ShuffleRequestRow[] = useMemo(() => {
    const byReq: Record<string, (ProjectShuffleItem & { replaced?: EmployeeLite; replacement?: EmployeeLite })[]> = {};
    for (const it of items) {
      (byReq[it.request_id] = byReq[it.request_id] || []).push({
        ...it,
        replaced: employeeMap[it.replaced_employee_id],
        replacement: employeeMap[it.new_employee_id],
      });
    }
    return requests.map((r) => ({ ...r, items: byReq[r.id] || [] }));
  }, [requests, items, employeeMap]);

  const activeRows = useMemo(() => rows.filter((r) => !r.end_date), [rows]);
  const activeEmployeeIds = useMemo(
    () => new Set(workforce.filter((w) => !w.end_date).map((w) => w.employee_id)),
    [workforce]
  );

  const openAppend = () => {
    if (!selected) { toast.error('Select a project first'); return; }
    setAppendIds([]); setAppendRole(''); setAppendStart(todayIso()); setAppendSearch(''); setAppendNotes(''); setAppendOpen(true);
  };

  const saveAppend = async () => {
    if (!appendIds.length) { toast.error('Select at least one employee'); return; }
    if (!appendStart) { toast.error('Start date is required'); return; }
    try {
      const { data: batch, error: bErr } = await supabase
        .from('project_workforce_batches')
        .insert({
          project_id: selected,
          batch_type: 'APPEND',
          notes: appendNotes.trim() || null,
          effective_date: appendStart,
          created_by: employee?.id || null,
        })
        .select('id')
        .single();
      if (bErr) throw bErr;
      const batchId = (batch as { id: string }).id;
      const payload = appendIds.map((employee_id) => ({
        project_id: selected,
        employee_id,
        role: appendRole.trim() || null,
        start_date: appendStart,
        end_date: null,
        source: 'APPEND',
        batch_id: batchId,
      }));
      const { error } = await supabase.from('project_workforce').insert(payload);
      if (error) throw error;
      toast.success(`${appendIds.length} employee${appendIds.length > 1 ? 's' : ''} appended as one batch`);
      setAppendOpen(false);
      loadRoster(selected);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openShuffle = () => {
    if (!selected) { toast.error('Select a project first'); return; }
    if (!activeRows.length) { toast.error('No active crew to shuffle'); return; }
    setShuffleNotes('');
    setShuffleLines([newLine()]);
    setShuffleOpen(true);
  };

  const updateLine = (key: string, patch: Partial<ShuffleLine>) => {
    setShuffleLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const saveShuffle = async () => {
    const clean = shuffleLines.filter((l) => l.replacedWorkforceId || l.newEmployeeId);
    if (!clean.length) { toast.error('Add at least one shuffle line'); return; }
    const chosenReplaced = new Set<string>();
    const chosenNew = new Set<string>();
    for (const l of clean) {
      const replacedRow = rows.find((r) => r.id === l.replacedWorkforceId);
      if (!replacedRow) { toast.error('Select the employee being replaced on every line'); return; }
      if (!l.newEmployeeId) { toast.error('Select a replacement on every line'); return; }
      if (l.newEmployeeId === replacedRow.employee_id) { toast.error('Replacement must differ from the replaced employee'); return; }
      if (activeEmployeeIds.has(l.newEmployeeId)) { toast.error(`${employeeName(employeeMap[l.newEmployeeId])} is already deployed on this project`); return; }
      if (chosenReplaced.has(l.replacedWorkforceId)) { toast.error('An employee is replaced more than once'); return; }
      if (chosenNew.has(l.newEmployeeId)) { toast.error('A replacement is used more than once'); return; }
      if (l.replaceEnd < replacedRow.start_date) { toast.error('Replacement end date is before the original start date'); return; }
      if (l.newStart < l.replaceEnd) { toast.error('New start date must be on or after the replacement end date'); return; }
      chosenReplaced.add(l.replacedWorkforceId);
      chosenNew.add(l.newEmployeeId);
    }
    setShuffleSaving(true);
    try {
      const effectiveDate = clean.map((l) => l.newStart).sort()[0];
      const { data: batch, error: bErr } = await supabase
        .from('project_workforce_batches')
        .insert({
          project_id: selected,
          batch_type: 'SHUFFLE',
          notes: shuffleNotes.trim() || null,
          effective_date: effectiveDate,
          created_by: employee?.id || null,
        })
        .select('id')
        .single();
      if (bErr) throw bErr;
      const batchId = (batch as { id: string }).id;

      const { data: req, error: rErr } = await supabase
        .from('project_shuffle_requests')
        .insert({
          project_id: selected,
          batch_id: batchId,
          notes: shuffleNotes.trim() || null,
          effective_date: effectiveDate,
          created_by: employee?.id || null,
        })
        .select('id')
        .single();
      if (rErr) throw rErr;
      const requestId = (req as { id: string }).id;

      for (const l of clean) {
        const replacedRow = rows.find((r) => r.id === l.replacedWorkforceId)!;
        const { data: newRow, error: insErr } = await supabase
          .from('project_workforce')
          .insert({
            project_id: selected,
            employee_id: l.newEmployeeId,
            role: l.role.trim() || replacedRow.role || null,
            start_date: l.newStart,
            end_date: null,
            source: 'SHUFFLE',
            batch_id: batchId,
          })
          .select('id')
          .single();
        if (insErr) throw insErr;

        const { error: updErr } = await supabase
          .from('project_workforce')
          .update({ end_date: l.replaceEnd, source: 'SHUFFLE' })
          .eq('id', replacedRow.id);
        if (updErr) throw updErr;

        const { error: itemErr } = await supabase.from('project_shuffle_items').insert({
          request_id: requestId,
          replaced_workforce_id: replacedRow.id,
          replaced_employee_id: replacedRow.employee_id,
          replace_start_date: replacedRow.start_date,
          replace_end_date: l.replaceEnd,
          new_employee_id: l.newEmployeeId,
          new_workforce_id: (newRow as { id: string } | null)?.id ?? null,
          new_start_date: l.newStart,
          notes: l.notes.trim() || null,
        });
        if (itemErr) throw itemErr;
      }

      toast.success(`Shuffle request recorded for ${clean.length} employee${clean.length > 1 ? 's' : ''}`);
      setShuffleOpen(false);
      loadRoster(selected);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setShuffleSaving(false);
    }
  };

  const openEdit = (row: WorkforceRow) => {
    setEditRow(row);
    setEditRole(row.role || '');
    setEditStart(row.start_date);
    setEditEnd(row.end_date || '');
  };

  const saveEdit = async () => {
    if (!editRow) return;
    if (editEnd && editEnd < editStart) { toast.error('End date cannot be before the start date'); return; }
    try {
      const { error } = await supabase.from('project_workforce').update({
        role: editRole.trim() || null,
        start_date: editStart,
        end_date: editEnd || null,
      }).eq('id', editRow.id);
      if (error) throw error;
      toast.success('Deployment updated');
      setEditRow(null);
      loadRoster(selected);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const removeRow = async (row: WorkforceRow) => {
    try {
      const { error } = await supabase.from('project_workforce').delete().eq('id', row.id);
      if (error) throw error;
      toast.success('Deployment removed');
      loadRoster(selected);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const filteredEmployees = useMemo(() => {
    const q = appendSearch.trim().toLowerCase();
    return employees.filter((e) => !q || employeeName(e).toLowerCase().includes(q));
  }, [employees, appendSearch]);

  const ongoing = rows.filter((r) => !r.end_date).length;
  const totalManDays = rows.reduce((sum, r) => sum + inclusiveDays(r.start_date, r.end_date), 0);

  const summaryCards: SummaryCard[] = [
    { label: 'Crew', value: rows.length, icon: Users, color: 'primary' },
    { label: 'On Deployment', value: ongoing, icon: CalendarClock, color: 'success' },
    { label: 'Completed', value: rows.length - ongoing, icon: CheckCircle, color: 'info' },
    { label: 'Man-days', value: totalManDays, icon: Repeat, color: 'warning' },
  ];

  const columns: Column<WorkforceRow>[] = [
    { key: 'employee', label: 'Employee', render: (r) => <span className="font-medium">{employeeName(r.employee)}</span>, searchText: (r) => [employeeName(r.employee)] },
    { key: 'role', label: 'Role', render: (r) => r.role || '—' },
    { key: 'start_date', label: 'Start', render: (r) => fmtDate(r.start_date) },
    {
      key: 'end_date',
      label: 'End',
      render: (r) => r.end_date ? fmtDate(r.end_date) : <Badge variant="outline" className="bg-success/10 text-success">Ongoing</Badge>,
    },
    { key: '_days', label: 'Days', render: (r) => inclusiveDays(r.start_date, r.end_date), searchable: false },
    {
      key: 'source',
      label: 'Source',
      render: (r) => <Badge variant="outline" className="text-xs">{labelFor(WORKFORCE_SOURCES, r.source)}</Badge>,
    },
  ];

  const toolbar = (
    <div className="flex items-center gap-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="w-56"><SelectValue placeholder="Select project" /></SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canManage && selected && (
        <Button variant="outline" size="sm" onClick={openShuffle} disabled={!activeRows.length}>
          <Repeat className="mr-1.5 h-4 w-4" /> Shuffle
        </Button>
      )}
    </div>
  );

  return (
    <>
      <ModuleListPage
        title="Workforce Deployment"
        description={selectedProject ? `Deploy, shuffle and append crew for ${selectedProject.name}.` : 'Select a project to manage its workforce.'}
        summaryCards={selectedProject ? summaryCards : []}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search crew..."
        createLabel="Append Crew"
        onCreate={canManage && selected ? openAppend : undefined}
        toolbarActions={toolbar}
        onEdit={canManage ? openEdit : undefined}
        onDelete={canManage ? removeRow : undefined}
        statusValue={(r) => (r.end_date ? 'Completed' : 'Ongoing')}
        emptyMessage={selected ? 'No crew deployed yet.' : 'No projects available.'}
        emptyDescription={selected ? 'Append employees to build the crew, or shuffle to replace someone.' : 'Create a project first.'}
      />

      {selected && requestRows.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Repeat className="h-4 w-4" /> Shuffle requests
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {requestRows.map((req) => (
              <div key={req.id} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-sm">
                  <span className="font-medium">
                    Request · {req.items.length} employee{req.items.length === 1 ? '' : 's'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Effective {fmtDate(req.effective_date)} · recorded {fmtDate(req.created_at)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Replaced</th>
                        <th className="px-4 py-2 font-medium">Replacement window</th>
                        <th className="px-4 py-2 font-medium">Replacement</th>
                        <th className="px-4 py-2 font-medium">New window</th>
                      </tr>
                    </thead>
                    <tbody>
                      {req.items.map((it) => (
                        <tr key={it.id} className="border-b border-border/60">
                          <td className="px-4 py-2">{employeeName(it.replaced)}</td>
                          <td className="px-4 py-2 text-muted-foreground">{fmtDate(it.replace_start_date)} → {fmtDate(it.replace_end_date)}</td>
                          <td className="px-4 py-2 font-medium">{employeeName(it.replacement)}</td>
                          <td className="px-4 py-2 text-muted-foreground">{fmtDate(it.new_start_date)} → Ongoing</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {req.notes && <p className="px-4 py-2 text-xs text-muted-foreground">{req.notes}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {selected && batches.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" /> Workforce batches
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Effective</th>
                    <th className="px-4 py-2 font-medium">Employees</th>
                    <th className="px-4 py-2 font-medium">Notes</th>
                    <th className="px-4 py-2 font-medium">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => {
                    const count = workforce.filter((w) => w.batch_id === b.id).length;
                    return (
                      <tr key={b.id} className="border-b border-border/60">
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="text-xs">{labelFor(WORKFORCE_SOURCES, b.batch_type)}</Badge>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{fmtDate(b.effective_date)}</td>
                        <td className="px-4 py-2">{count}</td>
                        <td className="px-4 py-2 text-muted-foreground">{b.notes || '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">{fmtDate(b.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={appendOpen} onOpenChange={setAppendOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Append Crew</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Input value={appendRole} onChange={(e) => setAppendRole(e.target.value)} placeholder="Rigger / Operator / Supervisor" />
            </div>
            <div className="space-y-1.5">
              <Label>Start date *</Label>
              <Input type="date" value={appendStart} onChange={(e) => setAppendStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Employees * <span className="text-muted-foreground">({appendIds.length} selected)</span></Label>
              <Input placeholder="Search employees..." value={appendSearch} onChange={(e) => setAppendSearch(e.target.value)} />
              <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {filteredEmployees.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No employees found.</p>
                ) : filteredEmployees.map((e) => {
                  const checked = appendIds.includes(e.id);
                  const active = activeEmployeeIds.has(e.id);
                  return (
                    <label key={e.id} className="flex items-center justify-between gap-2 p-2.5 text-sm hover:bg-accent/40 cursor-pointer">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(ev) => setAppendIds((prev) => ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id))}
                        />
                        {employeeName(e)}
                      </span>
                      {active && <Badge variant="outline" className="bg-warning/10 text-warning text-xs">Already deployed</Badge>}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Batch notes</Label>
              <Textarea rows={2} value={appendNotes} onChange={(e) => setAppendNotes(e.target.value)} placeholder="Where this batch of crew came from" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppendOpen(false)}>Cancel</Button>
            <Button onClick={saveAppend} disabled={!appendIds.length}><UserPlus className="mr-2 h-4 w-4" /> Append</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shuffleOpen} onOpenChange={setShuffleOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>New Shuffle Request</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Record one request that can replace several crew members at once. Each line ties a leaving
              deployment to its replacement and dates.
            </p>
            {shuffleLines.map((l, idx) => {
              const replacedRow = rows.find((r) => r.id === l.replacedWorkforceId) || null;
              const usedReplaced = new Set(shuffleLines.filter((x) => x.key !== l.key).map((x) => x.replacedWorkforceId).filter(Boolean));
              const usedNew = new Set(shuffleLines.filter((x) => x.key !== l.key).map((x) => x.newEmployeeId).filter(Boolean));
              const replacementOptions = employees.filter(
                (e) => !activeEmployeeIds.has(e.id) && e.id !== replacedRow?.employee_id && !usedNew.has(e.id)
              );
              return (
                <div key={l.key} className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Line {idx + 1}</span>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setShuffleLines((prev) => prev.filter((x) => x.key !== l.key))} disabled={shuffleLines.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Employee being replaced *</Label>
                      <Select value={l.replacedWorkforceId || undefined} onValueChange={(v) => updateLine(l.key, { replacedWorkforceId: v })}>
                        <SelectTrigger><SelectValue placeholder="Select active crew" /></SelectTrigger>
                        <SelectContent>
                          {activeRows.filter((r) => !usedReplaced.has(r.id)).map((r) => (
                            <SelectItem key={r.id} value={r.id}>{employeeName(r.employee)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Replacement employee *</Label>
                      <Select value={l.newEmployeeId || undefined} onValueChange={(v) => updateLine(l.key, { newEmployeeId: v })}>
                        <SelectTrigger><SelectValue placeholder="Select replacement" /></SelectTrigger>
                        <SelectContent>
                          {replacementOptions.length === 0 ? (
                            <SelectItem value="__none__" disabled>No available employees</SelectItem>
                          ) : replacementOptions.map((e) => (
                            <SelectItem key={e.id} value={e.id}>{employeeName(e)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label>Replacement end date *</Label>
                      <Input type="date" value={l.replaceEnd} min={replacedRow?.start_date} onChange={(e) => updateLine(l.key, { replaceEnd: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>New start date *</Label>
                      <Input type="date" value={l.newStart} min={l.replaceEnd} onChange={(e) => updateLine(l.key, { newStart: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Role</Label>
                      <Input value={l.role} onChange={(e) => updateLine(l.key, { role: e.target.value })} placeholder="Defaults to replaced role" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Line notes</Label>
                    <Input value={l.notes} onChange={(e) => updateLine(l.key, { notes: e.target.value })} />
                  </div>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setShuffleLines((prev) => [...prev, newLine()])}>
              <Plus className="mr-1.5 h-4 w-4" /> Add line
            </Button>
            <div className="space-y-1.5">
              <Label>Request notes</Label>
              <Textarea rows={2} value={shuffleNotes} onChange={(e) => setShuffleNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShuffleOpen(false)}>Cancel</Button>
            <Button onClick={saveShuffle} disabled={shuffleSaving}><Repeat className="mr-2 h-4 w-4" /> {shuffleSaving ? 'Saving...' : 'Submit Request'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editRow} onOpenChange={(o) => { if (!o) setEditRow(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Deployment</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-muted/50 p-3 text-sm font-medium">{employeeName(editRow?.employee)}</div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Input value={editRole} onChange={(e) => setEditRole(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Start date *</Label>
                <Input type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" value={editEnd} min={editStart} onChange={(e) => setEditEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={!editStart}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WorkforcePage() {
  return (
    <Suspense fallback={null}>
      <WorkforceContent />
    </Suspense>
  );
}
