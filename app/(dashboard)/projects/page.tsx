'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { FolderKanban, MapPin, Waves, Users } from 'lucide-react';
import {
  PROJECT_STATUSES,
  labelFor,
  projectStatusClass,
  fmtDate,
  fmtCoord,
  fmtMeters,
  mapsUrl,
  type Project,
} from '@/lib/projects';

const EMPTY = {
  code: '',
  name: '',
  client_name: '',
  description: '',
  location_name: '',
  latitude: '',
  longitude: '',
  geofence_radius_m: '',
  is_offshore: true,
  start_date: '',
  end_date: '',
  status: 'PLANNING',
};

type Form = typeof EMPTY;

export default function ProjectsPage() {
  const router = useRouter();
  const { can } = useAccess();
  const canManage = can('projects.manage') || can('admin.settings');

  const [rows, setRows] = useState<Project[]>([]);
  const [workforceCounts, setWorkforceCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);

  const load = useCallback(async () => {
    try {
      const [projects, workforce] = await Promise.all([
        supabase.from('projects').select('*').order('created_at', { ascending: false }),
        supabase.from('project_workforce').select('project_id, end_date'),
      ]);
      setRows((projects.data || []) as unknown as Project[]);
      const counts: Record<string, number> = {};
      for (const w of (workforce.data || []) as { project_id: string; end_date: string | null }[]) {
        if (!w.end_date) counts[w.project_id] = (counts[w.project_id] || 0) + 1;
      }
      setWorkforceCounts(counts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => { setOpen(false); setEditing(null); setForm(EMPTY); };
  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (p: Project) => {
    setEditing(p);
    setForm({
      code: p.code || '',
      name: p.name,
      client_name: p.client_name || '',
      description: p.description || '',
      location_name: p.location_name || '',
      latitude: p.latitude == null ? '' : String(p.latitude),
      longitude: p.longitude == null ? '' : String(p.longitude),
      geofence_radius_m: p.geofence_radius_m == null ? '' : String(p.geofence_radius_m),
      is_offshore: p.is_offshore,
      start_date: p.start_date || '',
      end_date: p.end_date || '',
      status: p.status,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Project name is required'); return; }
    const lat = form.latitude.trim();
    const lng = form.longitude.trim();
    const radius = form.geofence_radius_m.trim();
    if ((lat && !lng) || (!lat && lng)) {
      toast.error('Provide both latitude & longitude, or leave both empty');
      return;
    }
    if (lat && (Number(lat) < -90 || Number(lat) > 90)) { toast.error('Latitude must be between -90 and 90'); return; }
    if (lng && (Number(lng) < -180 || Number(lng) > 180)) { toast.error('Longitude must be between -180 and 180'); return; }
    if (radius && (!lat || !lng)) {
      toast.error('Set the project coordinates before adding a geofence radius');
      return;
    }
    if (radius && Number(radius) < 0) { toast.error('Geofence radius cannot be negative'); return; }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      toast.error('End date cannot be before the start date');
      return;
    }
    try {
      const payload = {
        code: form.code.trim() ? form.code.trim().toUpperCase() : null,
        name: form.name.trim(),
        client_name: form.client_name.trim() || null,
        description: form.description.trim() || null,
        location_name: form.location_name.trim() || null,
        latitude: lat ? Number(lat) : null,
        longitude: lng ? Number(lng) : null,
        geofence_radius_m: radius && lat && lng ? Number(radius) : null,
        is_offshore: form.is_offshore,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        status: form.status,
      };
      const { error } = editing
        ? await supabase.from('projects').update(payload).eq('id', editing.id)
        : await supabase.from('projects').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Project updated' : 'Project created');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (p: Project) => {
    try {
      const { error } = await supabase.from('projects').delete().eq('id', p.id);
      if (error) throw error;
      toast.success('Project deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const totalDeployed = Object.values(workforceCounts).reduce((a, b) => a + b, 0);

  const summaryCards: SummaryCard[] = [
    { label: 'Projects', value: rows.length, icon: FolderKanban, color: 'primary' },
    { label: 'Active', value: rows.filter((r) => r.status === 'ACTIVE').length, icon: Waves, color: 'success' },
    { label: 'Offshore', value: rows.filter((r) => r.is_offshore).length, icon: MapPin, color: 'info' },
    { label: 'Staff Deployed', value: totalDeployed, icon: Users, color: 'warning' },
  ];

  const columns: Column<Project>[] = [
    { key: 'code', label: 'Code', render: (p) => p.code ? <span className="font-mono text-xs">{p.code}</span> : '—' },
    { key: 'name', label: 'Project', render: (p) => <span className="font-medium">{p.name}</span> },
    { key: 'client_name', label: 'Client', render: (p) => p.client_name || '—' },
    {
      key: 'location_name',
      label: 'Location',
      render: (p) => {
        const url = mapsUrl(p.latitude, p.longitude);
        return (
          <div className="flex flex-col">
            <span>{p.location_name || '—'}</span>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                {fmtCoord(p.latitude, p.longitude)}
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">No coordinates</span>
            )}
          </div>
        );
      },
      searchText: (p) => [p.location_name || '', fmtCoord(p.latitude, p.longitude)],
    },
    {
      key: 'geofence',
      label: 'Geofence',
      render: (p) => p.geofence_radius_m != null
        ? <span className="text-xs">{fmtMeters(p.geofence_radius_m)}</span>
        : <span className="text-xs text-muted-foreground">Off</span>,
      searchable: false,
    },
    {
      key: 'is_offshore',
      label: 'Type',
      render: (p) => p.is_offshore
        ? <Badge variant="outline" className="bg-info/10 text-info">Offshore</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Onshore</Badge>,
    },
    {
      key: 'workforce',
      label: 'Crew',
      render: (p) => <Badge variant="outline">{workforceCounts[p.id] || 0}</Badge>,
      searchable: false,
    },
    {
      key: 'dates',
      label: 'Window',
      render: (p) => <span className="text-xs text-muted-foreground">{fmtDate(p.start_date)} → {fmtDate(p.end_date)}</span>,
      sortable: false,
      searchable: false,
    },
    {
      key: 'status',
      label: 'Status',
      render: (p) => <Badge variant="outline" className={projectStatusClass(p.status)}>{labelFor(PROJECT_STATUSES, p.status)}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Projects"
        description="Set up projects with their location coordinates and track offshore deployments."
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search projects, clients or locations..."
        createLabel="New Project"
        onCreate={canManage ? openCreate : undefined}
        onEdit={canManage ? openEdit : undefined}
        onDelete={canManage ? remove : undefined}
        rowActions={(p) => (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => router.push(`/projects/workforce?project=${p.id}`)}>
            <Users className="mr-1 h-4 w-4" /> Crew
          </Button>
        )}
        emptyMessage="No projects yet."
        emptyDescription="Create a project to start tracking its workforce and offshore allowance."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? 'Edit Project' : 'New Project'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Alpha Platform Upgrade" />
              </div>
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="AUTO (PRJ-00001)" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Client</Label>
                <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} placeholder="Acme Energy" />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Location name</Label>
              <Input value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })} placeholder="Block B7, Offshore Lagos" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Latitude</Label>
                <Input type="number" step="0.000001" min={-90} max={90} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="6.428055" />
              </div>
              <div className="space-y-1.5">
                <Label>Longitude</Label>
                <Input type="number" step="0.000001" min={-180} max={180} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="3.421999" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Attendance geofence radius (metres)</Label>
              <Input
                type="number"
                min={0}
                step="1"
                value={form.geofence_radius_m}
                onChange={(e) => setForm({ ...form, geofence_radius_m: e.target.value })}
                placeholder="e.g. 150 (leave blank to disable geofenced clock-in)"
                disabled={!form.latitude.trim() || !form.longitude.trim()}
              />
              <p className="text-xs text-muted-foreground">
                Staff deployed here may clock in/out within this radius of the project coordinates.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_offshore} onCheckedChange={(v) => setForm({ ...form, is_offshore: v })} />
              <span className="text-sm text-muted-foreground">Offshore project (earns offshore allowance)</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.name.trim()}>{editing ? 'Save Changes' : 'Create Project'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
