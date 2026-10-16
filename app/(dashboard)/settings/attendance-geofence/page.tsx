'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { MapPin, MapPinned, Crosshair, Radius } from 'lucide-react';
import { fmtCoord, fmtMeters, mapsUrl, DEFAULT_GEOFENCE_RADIUS_M } from '@/lib/projects';

interface Facility {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  is_active: boolean;
  notes: string | null;
  created_at?: string | null;
}

const EMPTY = {
  name: '',
  latitude: '',
  longitude: '',
  radius_m: String(DEFAULT_GEOFENCE_RADIUS_M),
  is_active: true,
  notes: '',
};

type Form = typeof EMPTY;

export default function AttendanceGeofencePage() {
  const { can } = useAccess();
  const canManage = can('attendance.manage') || can('admin.settings');

  const [rows, setRows] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Facility | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('attendance_facilities').select('*').order('name');
      setRows((data || []) as unknown as Facility[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => { setOpen(false); setEditing(null); setForm(EMPTY); };
  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (f: Facility) => {
    setEditing(f);
    setForm({
      name: f.name,
      latitude: String(f.latitude),
      longitude: String(f.longitude),
      radius_m: String(f.radius_m),
      is_active: f.is_active,
      notes: f.notes || '',
    });
    setOpen(true);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocation is not available in this browser'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        setLocating(false);
        toast.success('Captured current location');
      },
      (err) => {
        setLocating(false);
        toast.error('Could not get location: ' + err.message);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Facility name is required'); return; }
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    const radius = Number(form.radius_m);
    if (!form.latitude.trim() || !form.longitude.trim() || isNaN(lat) || isNaN(lng)) {
      toast.error('Latitude and longitude are required');
      return;
    }
    if (lat < -90 || lat > 90) { toast.error('Latitude must be between -90 and 90'); return; }
    if (lng < -180 || lng > 180) { toast.error('Longitude must be between -180 and 180'); return; }
    if (isNaN(radius) || radius < 0) { toast.error('Radius must be zero or more'); return; }
    try {
      const payload = {
        name: form.name.trim(),
        latitude: lat,
        longitude: lng,
        radius_m: radius,
        is_active: form.is_active,
        notes: form.notes.trim() || null,
      };
      const { error } = editing
        ? await supabase.from('attendance_facilities').update(payload).eq('id', editing.id)
        : await supabase.from('attendance_facilities').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Facility updated' : 'Facility added');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (f: Facility) => {
    try {
      const { error } = await supabase.from('attendance_facilities').delete().eq('id', f.id);
      if (error) throw error;
      toast.success('Facility removed');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const active = rows.filter((r) => r.is_active).length;

  const summaryCards: SummaryCard[] = [
    { label: 'Facilities', value: rows.length, icon: MapPin, color: 'primary' },
    { label: 'Active', value: active, icon: MapPinned, color: 'success' },
    { label: 'Inactive', value: rows.length - active, icon: Radius, color: 'warning' },
  ];

  const columns: Column<Facility>[] = [
    { key: 'name', label: 'Facility', render: (f) => <span className="font-medium">{f.name}</span> },
    {
      key: 'coords',
      label: 'Coordinates',
      render: (f) => {
        const url = mapsUrl(f.latitude, f.longitude);
        return url
          ? <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{fmtCoord(f.latitude, f.longitude)}</a>
          : <span className="text-xs text-muted-foreground">—</span>;
      },
      searchText: (f) => [fmtCoord(f.latitude, f.longitude)],
    },
    { key: 'radius_m', label: 'Radius', render: (f) => fmtMeters(f.radius_m), searchable: false },
    {
      key: 'is_active',
      label: 'Status',
      render: (f) => f.is_active
        ? <Badge variant="outline" className="bg-success/10 text-success">Active</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>,
    },
    { key: 'notes', label: 'Notes', render: (f) => <span className="text-muted-foreground">{f.notes || '—'}</span> },
  ];

  const geo = typeof navigator !== 'undefined' && navigator.geolocation;

  return (
    <>
      <ModuleListPage
        title="Attendance Geofences"
        description="Approved facilities where staff who are not on a project may clock in/out. Project-specific geofences are set on each project."
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search facilities..."
        createLabel="Add Facility"
        onCreate={canManage ? openCreate : undefined}
        onEdit={canManage ? openEdit : undefined}
        onDelete={canManage ? remove : undefined}
        emptyMessage="No facilities configured."
        emptyDescription="Add an office or site so staff can clock in when they are not deployed on a project."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit Facility' : 'Add Facility'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Facility name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Head Office — Lagos" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Latitude *</Label>
                <Input type="number" step="0.000001" min={-90} max={90} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="6.428055" />
              </div>
              <div className="space-y-1.5">
                <Label>Longitude *</Label>
                <Input type="number" step="0.000001" min={-180} max={180} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="3.421999" />
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={useMyLocation} disabled={!geo || locating}>
              <Crosshair className="mr-1.5 h-4 w-4" /> {locating ? 'Locating...' : 'Use my current location'}
            </Button>
            <div className="space-y-1.5">
              <Label>Radius (metres)</Label>
              <Input type="number" min={0} step="1" value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <span className="text-sm text-muted-foreground">Active</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.name.trim()}>{editing ? 'Save Changes' : 'Add Facility'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
