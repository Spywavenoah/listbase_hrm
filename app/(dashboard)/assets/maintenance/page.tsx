'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { CalendarClock, AlertTriangle, XCircle, CheckCircle, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import {
  MAINTENANCE_TYPES,
  MAINTENANCE_RECURRENCES,
  fmtMoney,
  fmtDate,
  fmtQty,
  maintenanceDueInfo,
  dueStateClass,
  type Asset,
  type MaintenanceSchedule,
} from '@/lib/assets';

const EMPTY = {
  asset_id: '',
  title: '',
  description: '',
  schedule_type: 'PREVENTIVE',
  recurrence: 'RECURRING',
  interval_days: '',
  interval_meter: '',
  lead_days: '7',
  next_due_date: '',
  next_due_meter: '',
  estimated_cost: '',
  notes: '',
};

const COMPLETE_EMPTY = {
  performed_date: '',
  cost: '',
  meter: '',
  description: '',
  vendor: '',
};

export default function AssetMaintenancePage() {
  const { can, employee } = useAccess();
  const canManage = can('assets.maintenance') || can('assets.manage') || can('admin.settings');
  const canView = can('assets.view') || canManage;

  const [rows, setRows] = useState<MaintenanceSchedule[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [completeTarget, setCompleteTarget] = useState<MaintenanceSchedule | null>(null);
  const [complete, setComplete] = useState({ ...COMPLETE_EMPTY });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sRes, aRes] = await Promise.all([
        supabase.from('asset_maintenance_schedules').select('*, asset:assets(name, asset_tag)').order('next_due_date', { ascending: true, nullsFirst: false }),
        supabase.from('assets').select('id, name, asset_tag').order('name'),
      ]);
      setRows((sRes.data || []) as unknown as MaintenanceSchedule[]);
      setAssets((aRes.data || []) as unknown as Asset[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const validate = (): string | null => {
    if (!form.asset_id) return 'Select an asset';
    if (!form.title.trim()) return 'Enter a title';
    if (form.recurrence === 'RECURRING') {
      if (!Number(form.interval_days) || Number(form.interval_days) <= 0) return 'Enter the recurring interval in days';
      if (!form.next_due_date) return 'Set the next due date';
    } else if (form.recurrence === 'INTERVAL') {
      if (!Number(form.interval_meter) || Number(form.interval_meter) <= 0) return 'Enter the meter interval';
      if (!Number(form.next_due_meter) || Number(form.next_due_meter) <= 0) return 'Set the next due meter reading';
    } else {
      if (!form.next_due_date) return 'Set the specific due date';
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    try {
      const { error } = await supabase.from('asset_maintenance_schedules').insert({
        asset_id: form.asset_id,
        title: form.title.trim(),
        description: form.description || null,
        schedule_type: form.schedule_type,
        recurrence: form.recurrence,
        interval_days: form.interval_days === '' ? null : Number(form.interval_days),
        interval_meter: form.interval_meter === '' ? null : Number(form.interval_meter),
        lead_days: Number(form.lead_days) || 7,
        next_due_date: form.next_due_date || null,
        next_due_meter: form.next_due_meter === '' ? null : Number(form.next_due_meter),
        estimated_cost: form.estimated_cost === '' ? null : Number(form.estimated_cost),
        notes: form.notes || null,
        created_by: employee?.id || null,
      });
      if (error) throw error;
      toast.success('Maintenance schedule created');
      setOpen(false);
      setForm({ ...EMPTY });
      load();
    } catch (e) {
      toast.error('Failed: ' + (e as Error).message);
    }
  };

  const toggleActive = async (s: MaintenanceSchedule) => {
    try {
      const { error } = await supabase.from('asset_maintenance_schedules')
        .update({ is_active: !s.is_active }).eq('id', s.id);
      if (error) throw error;
      load();
    } catch (e) {
      toast.error('Failed: ' + (e as Error).message);
    }
  };

  const remove = async (s: MaintenanceSchedule) => {
    try {
      const { error } = await supabase.from('asset_maintenance_schedules').delete().eq('id', s.id);
      if (error) throw error;
      toast.success('Schedule deleted');
      load();
    } catch (e) {
      toast.error('Failed: ' + (e as Error).message);
    }
  };

  const startComplete = (s: MaintenanceSchedule) => {
    setCompleteTarget(s);
    setComplete({ ...COMPLETE_EMPTY, performed_date: new Date().toISOString().slice(0, 10) });
  };

  const doComplete = async () => {
    if (!completeTarget) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('complete_maintenance', {
        p_schedule_id: completeTarget.id,
        p_performed_date: complete.performed_date || null,
        p_cost: complete.cost === '' ? 0 : Number(complete.cost),
        p_meter: complete.meter === '' ? null : Number(complete.meter),
        p_description: complete.description || null,
        p_vendor: complete.vendor || null,
      });
      if (error) throw error;
      toast.success(`Maintenance completed for "${completeTarget.title}"`);
      setCompleteTarget(null);
      load();
    } catch (e) {
      toast.error('Failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dueInfo = (s: MaintenanceSchedule) => maintenanceDueInfo(s);
  const attention = rows.filter((s) => {
    const st = dueInfo(s).state;
    return s.is_active && (st === 'OVERDUE' || st === 'DUE_SOON');
  });

  const summaryCards: SummaryCard[] = [
    { label: 'Schedules', value: rows.length, icon: CalendarClock, color: 'primary' },
    { label: 'Active', value: rows.filter((s) => s.is_active).length, icon: CheckCircle, color: 'success' },
    { label: 'Due Soon', value: attention.filter((s) => dueInfo(s).state === 'DUE_SOON').length, icon: AlertTriangle, color: 'warning' },
    { label: 'Overdue', value: attention.filter((s) => dueInfo(s).state === 'OVERDUE').length, icon: XCircle, color: 'destructive' },
  ];

  const columns: Column<MaintenanceSchedule>[] = [
    { key: 'asset', label: 'Asset', render: (s) => <span className="font-medium">{s.asset ? `${s.asset.name}${s.asset.asset_tag ? ` (${s.asset.asset_tag})` : ''}` : '—'}</span>, searchText: (s) => [s.asset?.name || ''] },
    { key: 'title', label: 'Schedule' },
    { key: 'schedule_type', label: 'Type', render: (s) => MAINTENANCE_TYPES.find((t) => t.value === s.schedule_type)?.label || s.schedule_type },
    {
      key: 'recurrence',
      label: 'Repeats',
      render: (s) => {
        const base = MAINTENANCE_RECURRENCES.find((r) => r.value === s.recurrence)?.label || s.recurrence;
        if (s.recurrence === 'RECURRING' && s.interval_days) return `Every ${s.interval_days} days`;
        if (s.recurrence === 'INTERVAL' && s.interval_meter) return `Every ${fmtQty(s.interval_meter, 0)} km`;
        return base;
      },
      searchText: (s) => [s.recurrence],
    },
    {
      key: 'next_due_date',
      label: 'Next Due',
      render: (s) => {
        const info = dueInfo(s);
        if (s.recurrence === 'INTERVAL' && s.next_due_meter != null && !s.next_due_date) return `at ${fmtQty(s.next_due_meter, 0)} km`;
        return <Badge variant="outline" className={dueStateClass(info.state)}>{fmtDate(s.next_due_date)}</Badge>;
      },
      searchText: (s) => [s.next_due_date || '', String(s.next_due_meter ?? '')],
    },
    { key: 'lead_days', label: 'Alert', render: (s) => `${s.lead_days} d early`, searchable: false },
    {
      key: 'due',
      label: 'Status',
      searchable: false,
      render: (s) => {
        const info = dueInfo(s);
        if (!s.is_active) return <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>;
        return <Badge variant="outline" className={dueStateClass(info.state)}>{info.label}</Badge>;
      },
    },
    {
      key: 'estimated_cost', label: 'Est. Cost',
      render: (s) => s.estimated_cost != null ? fmtMoney(s.estimated_cost) : '—',
      searchable: false,
    },
  ];

  if (!canView) return null;

  return (
    <>
      <ModuleListPage
        title="Preventive Maintenance"
        description="Recurring, meter-interval and one-time schedules with early alerts before the due date"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search schedules, assets..."
        createLabel="Add Schedule"
        onCreate={canManage ? openCreate : undefined}
        onDelete={canManage ? remove : undefined}
        rowActions={(s) => (canManage && s.is_active
          ? <Button size="sm" variant="outline" onClick={() => startComplete(s)}><Wrench className="mr-1.5 h-4 w-4" /> Done</Button>
          : null)}
        emptyMessage="No maintenance schedules yet."
        emptyDescription="Create a schedule to get alerts before service dates."
      />

      {attention.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4" /> Upcoming & overdue maintenance
            </CardTitle>
            <CardDescription>Early alerts are raised ahead of the due date (lead time configured per schedule).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.map((s) => {
              const info = dueInfo(s);
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-background p-3 text-sm">
                  <div>
                    <p className="font-medium">{s.title} — {s.asset ? `${s.asset.name}${s.asset.asset_tag ? ` (${s.asset.asset_tag})` : ''}` : 'Asset'}</p>
                    <p className="text-muted-foreground">{s.recurrence === 'INTERVAL' ? `Due at ${fmtQty(s.next_due_meter ?? 0, 0)} km` : `Due ${fmtDate(s.next_due_date)}`}</p>
                  </div>
                  <Badge variant="outline" className={dueStateClass(info.state)}>{info.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : setOpen(false))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Maintenance Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Asset *</Label>
              <Select value={form.asset_id || '__none__'} onValueChange={(v) => setForm({ ...form, asset_id: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select asset</SelectItem>
                  {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.asset_tag ? ` · ${a.asset_tag}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Title *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Engine oil change" />
              </div>
              <div className="space-y-1.5">
                <Label>Schedule Type</Label>
                <Select value={form.schedule_type} onValueChange={(v) => setForm({ ...form, schedule_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MAINTENANCE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Recurrence</Label>
              <Select value={form.recurrence} onValueChange={(v) => setForm({ ...form, recurrence: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_RECURRENCES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {form.recurrence === 'RECURRING' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Interval (days) *</Label>
                  <Input type="number" min="1" step="1" value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: e.target.value })} placeholder="90" />
                </div>
                <div className="space-y-1.5">
                  <Label>Next Due Date *</Label>
                  <Input type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} />
                </div>
              </div>
            )}

            {form.recurrence === 'INTERVAL' && (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Meter Interval (km) *</Label>
                  <Input type="number" min="1" value={form.interval_meter} onChange={(e) => setForm({ ...form, interval_meter: e.target.value })} placeholder="10000" />
                </div>
                <div className="space-y-1.5">
                  <Label>Next Due Meter *</Label>
                  <Input type="number" min="0" value={form.next_due_meter} onChange={(e) => setForm({ ...form, next_due_meter: e.target.value })} placeholder="130000" />
                </div>
                <div className="space-y-1.5">
                  <Label>Also due by date</Label>
                  <Input type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} />
                </div>
              </div>
            )}

            {form.recurrence === 'ONE_TIME' && (
              <div className="space-y-1.5">
                <Label>Specific Due Date *</Label>
                <Input type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Early alert (days)</Label>
                <Input type="number" min="0" step="1" value={form.lead_days} onChange={(e) => setForm({ ...form, lead_days: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Estimated Cost</Label>
                <Input type="number" min="0" step="0.01" value={form.estimated_cost} onChange={(e) => setForm({ ...form, estimated_cost: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Create Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!completeTarget} onOpenChange={(o) => !o && setCompleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log completed maintenance</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {completeTarget?.title} — this rolls the schedule to its next due date.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Performed Date</Label>
                <Input type="date" value={complete.performed_date} onChange={(e) => setComplete({ ...complete, performed_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Cost</Label>
                <Input type="number" min="0" step="0.01" value={complete.cost} onChange={(e) => setComplete({ ...complete, cost: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Meter (km)</Label>
                <Input type="number" min="0" value={complete.meter} onChange={(e) => setComplete({ ...complete, meter: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Vendor</Label>
                <Input value={complete.vendor} onChange={(e) => setComplete({ ...complete, vendor: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Work done</Label>
              <Textarea rows={2} value={complete.description} onChange={(e) => setComplete({ ...complete, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={doComplete} disabled={busy}>{busy ? 'Saving...' : 'Mark Completed'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  function openCreate() {
    setForm({ ...EMPTY });
    setOpen(true);
  }
}
