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
import { Users, UserPlus, Repeat, CalendarClock, CheckCircle } from 'lucide-react';
import {
  WORKFORCE_SOURCES,
  labelFor,
  employeeName,
  fmtDate,
  inclusiveDays,
  todayIso,
  addDaysIso,
  type Project,
  type ProjectWorkforce,
  type ProjectShuffle,
  type EmployeeLite,
} from '@/lib/projects';

type WorkforceRow = ProjectWorkforce & { employee?: EmployeeLite };
type ShuffleRow = ProjectShuffle & { replaced?: EmployeeLite; replacement?: EmployeeLite };

function WorkforceContent() {
  const params = useSearchParams();
  const { can } = useAccess();
  const canManage = can('projects.manage') || can('admin.settings');

  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [workforce, setWorkforce] = useState<ProjectWorkforce[]>([]);
  const [shuffles, setShuffles] = useState<ProjectShuffle[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const [appendOpen, setAppendOpen] = useState(false);
  const [appendSearch, setAppendSearch] = useState('');
  const [appendIds, setAppendIds] = useState<string[]>([]);
  const [appendRole, setAppendRole] = useState('');
  const [appendStart, setAppendStart] = useState(todayIso());

  const [shuffleOpen, setShuffleOpen] = useState(false);
  const [shuffleReplaced, setShuffleReplaced] = useState<WorkforceRow | null>(null);
  const [shuffleEnd, setShuffleEnd] = useState(todayIso());
  const [shuffleNewId, setShuffleNewId] = useState('');
  const [shuffleStart, setShuffleStart] = useState(todayIso());
  const [shuffleRole, setShuffleRole] = useState('');
  const [shuffleNotes, setShuffleNotes] = useState('');

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
    if (!projectId) { setWorkforce([]); setShuffles([]); return; }
    const [w, s] = await Promise.all([
      supabase.from('project_workforce').select('*').eq('project_id', projectId).order('start_date', { ascending: false }),
      supabase.from('project_shuffles').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    ]);
    setWorkforce((w.data || []) as unknown as ProjectWorkforce[]);
    setShuffles((s.data || []) as unknown as ProjectShuffle[]);
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

  const shuffleRows: ShuffleRow[] = useMemo(
    () => shuffles.map((s) => ({
      ...s,
      replaced: employeeMap[s.replaced_employee_id],
      replacement: employeeMap[s.new_employee_id],
    })),
    [shuffles, employeeMap]
  );

  const activeEmployeeIds = useMemo(
    () => new Set(workforce.filter((w) => !w.end_date).map((w) => w.employee_id)),
    [workforce]
  );

  const openAppend = () => {
    if (!selected) { toast.error('Select a project first'); return; }
    setAppendIds([]); setAppendRole(''); setAppendStart(todayIso()); setAppendSearch(''); setAppendOpen(true);
  };

  const saveAppend = async () => {
    if (!appendIds.length) { toast.error('Select at least one employee'); return; }
    if (!appendStart) { toast.error('Start date is required'); return; }
    try {
      const payload = appendIds.map((employee_id) => ({
        project_id: selected,
        employee_id,
        role: appendRole.trim() || null,
        start_date: appendStart,
        end_date: null,
        source: 'APPEND',
      }));
      const { error } = await supabase.from('project_workforce').insert(payload);
      if (error) throw error;
      toast.success(`${appendIds.length} employee${appendIds.length > 1 ? 's' : ''} appended`);
      setAppendOpen(false);
      loadRoster(selected);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openShuffle = (row: WorkforceRow) => {
    setShuffleReplaced(row);
    setShuffleEnd(row.end_date || todayIso());
    setShuffleNewId('');
    setShuffleStart(addDaysIso(row.end_date || todayIso(), 1));
    setShuffleRole(row.role || '');
    setShuffleNotes('');
    setShuffleOpen(true);
  };

  const saveShuffle = async () => {
    if (!shuffleReplaced) return;
    if (!shuffleNewId) { toast.error('Select the replacement employee'); return; }
    if (shuffleNewId === shuffleReplaced.employee_id) { toast.error('Replacement must differ from the replaced employee'); return; }
    if (activeEmployeeIds.has(shuffleNewId)) { toast.error('Replacement is already deployed on this project'); return; }
    if (shuffleEnd < shuffleReplaced.start_date) { toast.error('Replacement end date is before the original start date'); return; }
    if (shuffleStart < shuffleEnd) { toast.error('New start date must be on or after the replacement end date'); return; }
    try {
      const { data: newRow, error: insErr } = await supabase
        .from('project_workforce')
        .insert({
          project_id: selected,
          employee_id: shuffleNewId,
          role: shuffleRole.trim() || shuffleReplaced.role || null,
          start_date: shuffleStart,
          end_date: null,
          source: 'SHUFFLE',
        })
        .select('id')
        .single();
      if (insErr) throw insErr;

      const { error: updErr } = await supabase
        .from('project_workforce')
        .update({ end_date: shuffleEnd, source: 'SHUFFLE' })
        .eq('id', shuffleReplaced.id);
      if (updErr) throw updErr;

      const { error: audErr } = await supabase.from('project_shuffles').insert({
        project_id: selected,
        replaced_workforce_id: shuffleReplaced.id,
        replaced_employee_id: shuffleReplaced.employee_id,
        replace_start_date: shuffleReplaced.start_date,
        replace_end_date: shuffleEnd,
        new_employee_id: shuffleNewId,
        new_workforce_id: (newRow as { id: string } | null)?.id ?? null,
        new_start_date: shuffleStart,
        notes: shuffleNotes.trim() || null,
      });
      if (audErr) throw audErr;

      toast.success('Workforce shuffled');
      setShuffleOpen(false);
      setShuffleReplaced(null);
      loadRoster(selected);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
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

  const replacementOptions = useMemo(
    () => employees.filter((e) => !activeEmployeeIds.has(e.id) && e.id !== shuffleReplaced?.employee_id),
    [employees, activeEmployeeIds, shuffleReplaced]
  );

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
    <Select value={selected} onValueChange={setSelected}>
      <SelectTrigger className="w-56"><SelectValue placeholder="Select project" /></SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
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
        rowActions={canManage ? (r) => (
          (!r.end_date) ? (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => openShuffle(r)}>
              <Repeat className="mr-1 h-4 w-4" /> Shuffle
            </Button>
          ) : null
        ) : undefined}
        statusValue={(r) => (r.end_date ? 'Completed' : 'Ongoing')}
        emptyMessage={selected ? 'No crew deployed yet.' : 'No projects available.'}
        emptyDescription={selected ? 'Append employees to build the crew, or shuffle to replace someone.' : 'Create a project first.'}
      />

      {selected && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Repeat className="h-4 w-4" /> Shuffle history
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {shuffleRows.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No shuffles recorded for this project.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Replaced</th>
                      <th className="px-4 py-2 font-medium">Replacement window</th>
                      <th className="px-4 py-2 font-medium">Replacement</th>
                      <th className="px-4 py-2 font-medium">New window</th>
                      <th className="px-4 py-2 font-medium">Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shuffleRows.map((s) => (
                      <tr key={s.id} className="border-b border-border/60">
                        <td className="px-4 py-2">{employeeName(s.replaced)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{fmtDate(s.replace_start_date)} → {fmtDate(s.replace_end_date)}</td>
                        <td className="px-4 py-2 font-medium">{employeeName(s.replacement)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{fmtDate(s.new_start_date)} → Ongoing</td>
                        <td className="px-4 py-2 text-muted-foreground">{fmtDate(s.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppendOpen(false)}>Cancel</Button>
            <Button onClick={saveAppend} disabled={!appendIds.length}><UserPlus className="mr-2 h-4 w-4" /> Append</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shuffleOpen} onOpenChange={setShuffleOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Shuffle Workforce</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <span className="text-muted-foreground">Replacing </span>
              <span className="font-medium">{employeeName(shuffleReplaced?.employee)}</span>
              <span className="text-muted-foreground"> (deployed {fmtDate(shuffleReplaced?.start_date)})</span>
            </div>
            <div className="space-y-1.5">
              <Label>Replacement end date *</Label>
              <Input type="date" value={shuffleEnd} min={shuffleReplaced?.start_date} onChange={(e) => setShuffleEnd(e.target.value)} />
              <p className="text-xs text-muted-foreground">Last day the replaced employee is counted on this project.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Replacement employee *</Label>
              <Select value={shuffleNewId} onValueChange={setShuffleNewId}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {replacementOptions.length === 0 ? (
                    <SelectItem value="__none__" disabled>No available employees</SelectItem>
                  ) : replacementOptions.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{employeeName(e)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>New start date *</Label>
                <Input type="date" value={shuffleStart} min={shuffleEnd} onChange={(e) => setShuffleStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Input value={shuffleRole} onChange={(e) => setShuffleRole(e.target.value)} placeholder="Defaults to replaced role" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={shuffleNotes} onChange={(e) => setShuffleNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShuffleOpen(false)}>Cancel</Button>
            <Button onClick={saveShuffle} disabled={!shuffleNewId}><Repeat className="mr-2 h-4 w-4" /> Shuffle</Button>
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
