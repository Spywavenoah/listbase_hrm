'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { CalendarClock, Coffee, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_minutes: number;
  max_break_minutes: number | null;
  early_clock_out_minutes: number;
  is_active: boolean;
}

const emptyForm = {
  name: '',
  start_time: '08:00',
  end_time: '17:00',
  break_start: '13:00',
  break_minutes: '60',
  max_break_minutes: '90',
  early_clock_out_minutes: '30',
  is_active: true,
};

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—');

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('shifts').select('*').order('name');
      if (error) throw error;
      setShifts((data || []) as unknown as Shift[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (s: Shift) => {
    setEditing(s);
    setForm({
      name: s.name,
      start_time: hhmm(s.start_time) === '—' ? '' : hhmm(s.start_time),
      end_time: hhmm(s.end_time) === '—' ? '' : hhmm(s.end_time),
      break_start: s.break_start ? hhmm(s.break_start) : '',
      break_minutes: String(s.break_minutes ?? 0),
      max_break_minutes: s.max_break_minutes != null ? String(s.max_break_minutes) : '',
      early_clock_out_minutes: String(s.early_clock_out_minutes ?? 30),
      is_active: s.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.start_time || !form.end_time) {
      toast.error('Name, resumption time and closing time are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        start_time: form.start_time,
        end_time: form.end_time,
        break_start: form.break_start || null,
        break_minutes: form.break_minutes ? parseInt(form.break_minutes, 10) : 0,
        max_break_minutes: form.max_break_minutes ? parseInt(form.max_break_minutes, 10) : null,
        early_clock_out_minutes: form.early_clock_out_minutes ? parseInt(form.early_clock_out_minutes, 10) : 30,
        is_active: form.is_active,
      };
      const { error } = editing
        ? await supabase.from('shifts').update(payload).eq('id', editing.id)
        : await supabase.from('shifts').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Shift updated' : 'Shift created');
      setDialogOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: Shift) => {
    try {
      const { error } = await supabase.from('shifts').delete().eq('id', s.id);
      if (error) throw error;
      toast.success('Shift deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Shifts', value: shifts.length, icon: CalendarClock, color: 'primary' },
    { label: 'Active', value: shifts.filter((s) => s.is_active).length, icon: CheckCircle, color: 'success' },
    { label: 'With Breaks', value: shifts.filter((s) => s.break_minutes > 0).length, icon: Coffee, color: 'info' },
  ];

  const columns: Column<Shift>[] = [
    { key: 'name', label: 'Shift' },
    { key: 'start_time', label: 'Resumption', render: (s) => hhmm(s.start_time) },
    { key: 'end_time', label: 'Closing', render: (s) => hhmm(s.end_time) },
    {
      key: 'break', label: 'Break',
      render: (s) => (
        <span className="text-sm">
          {s.break_minutes > 0 ? `${s.break_minutes} min` : '—'}
          {s.max_break_minutes != null && s.break_minutes > 0 ? ` (max ${s.max_break_minutes})` : ''}
          {s.break_start ? ` @ ${hhmm(s.break_start)}` : ''}
        </span>
      ),
    },
    { key: 'early_clock_out_minutes', label: 'Clock-out opens', render: (s) => `${s.early_clock_out_minutes} min before close` },
    {
      key: 'is_active', label: 'Status',
      render: (s) => (
        <Badge variant="outline" className={s.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>
          {s.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Shifts"
        description="Define resumption, closing and break rules, then assign shifts to employees"
        summaryCards={summaryCards}
        columns={columns}
        data={shifts}
        loading={loading}
        searchPlaceholder="Search shifts..."
        createLabel="Add Shift"
        onCreate={openCreate}
        onEdit={openEdit}
        onDelete={handleDelete}
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit Shift' : 'Add Shift'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Shift Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Standard (8:00 - 17:00)" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Resumption Time *</Label>
                <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Closing Time *</Label>
                <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Break Time</Label>
                <Input type="time" value={form.break_start} onChange={(e) => setForm({ ...form, break_start: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Break Duration (min)</Label>
                <Input type="number" min={0} value={form.break_minutes} onChange={(e) => setForm({ ...form, break_minutes: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Max Break Duration (min)</Label>
                <Input type="number" min={0} value={form.max_break_minutes} onChange={(e) => setForm({ ...form, max_break_minutes: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Clock-out opens (min before close)</Label>
                <Input type="number" min={0} value={form.early_clock_out_minutes} onChange={(e) => setForm({ ...form, early_clock_out_minutes: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <Label className="cursor-pointer" onClick={() => setForm({ ...form, is_active: !form.is_active })}>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.start_time || !form.end_time}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
