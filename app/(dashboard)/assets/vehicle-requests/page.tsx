'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { Car, Clock, CheckCircle, XCircle, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { refNumber } from '@/lib/procurement';
import { startWorkflow, setWorkflowActors } from '@/lib/workflow/engine';
import { WorkflowSubmitDialog } from '@/components/workflow/workflow-submit-dialog';
import { fmtDateTime, requestStatusClass, type Asset, type VehicleRequest } from '@/lib/assets';

const MODULE_KEY = 'assets.vehicle_request';

const EMPTY = {
  vehicle_id: '',
  purpose: '',
  destination: '',
  departure_at: '',
  return_at: '',
  passengers: '1',
  driver_id: '',
  notes: '',
};

interface Line { name: string }

export default function VehicleRequestsPage() {
  const { can, employee } = useAccess();
  const canRequest = can('assets.request') || can('assets.manage') || can('admin.settings');
  const canManage = can('assets.manage') || can('admin.settings');

  const [rows, setRows] = useState<VehicleRequest[]>([]);
  const [vehicles, setVehicles] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [passengers, setPassengers] = useState<Line[]>([]);
  const [submitOpen, setSubmitOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rRes, vRes, eRes] = await Promise.all([
        supabase.from('vehicle_requests').select('*, vehicle:assets(name, asset_tag)').order('created_at', { ascending: false }),
        supabase.from('assets').select('id, name, asset_tag, category_ref:asset_categories(asset_class)').order('name'),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE'),
      ]);
      setRows((rRes.data || []) as unknown as VehicleRequest[]);
      setVehicles(((vRes.data || []) as unknown as Asset[]).filter((a) => a.category_ref?.asset_class === 'AUTOMOBILE'));
      const emps = eRes.data || [];
      setEmployees(emps);
      const map: Record<string, string> = {};
      for (const e of emps) map[e.id] = `${e.first_name} ${e.last_name}`;
      setNames(map);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ ...EMPTY });
    setPassengers([]);
    setOpen(true);
  };

  const beginSubmit = () => {
    if (!form.purpose.trim()) { toast.error('Describe the purpose of the trip'); return; }
    setSubmitOpen(true);
  };

  const submit = async (authorizerId: string | null, approverId: string | null) => {
    try {
      const number = refNumber('VR');
      const { data, error } = await supabase.from('vehicle_requests').insert({
        request_number: number,
        requested_by: employee?.id || null,
        created_by: employee?.id || null,
        vehicle_id: form.vehicle_id || null,
        purpose: form.purpose.trim(),
        destination: form.destination || null,
        departure_at: form.departure_at ? new Date(form.departure_at).toISOString() : null,
        return_at: form.return_at ? new Date(form.return_at).toISOString() : null,
        passengers: Number(form.passengers) || 1,
        driver_id: form.driver_id || null,
        status: 'PENDING',
        notes: form.notes || null,
      }).select().single();
      if (error) throw error;
      const request = data as unknown as VehicleRequest;

      const namesToAdd = passengers.map((p) => p.name.trim()).filter(Boolean);
      if (namesToAdd.length > 0) {
        const { error: pe } = await supabase.from('vehicle_request_passengers').insert(
          namesToAdd.map((name) => ({ request_id: request.id, name }))
        );
        if (pe) throw pe;
      }

      const instanceId = await startWorkflow(MODULE_KEY, request.id, employee?.id || '');
      if (!instanceId) {
        await supabase.from('vehicle_requests').update({ status: 'CANCELLED' }).eq('id', request.id);
        toast.warning('No approval workflow is enabled for vehicle requests — request was not submitted');
        setSubmitOpen(false);
        setOpen(false);
        load();
        return;
      }
      await setWorkflowActors(MODULE_KEY, request.id, authorizerId, approverId);

      toast.success(`Vehicle request ${number} submitted for approval`);
      setSubmitOpen(false);
      setOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const cancel = async (r: VehicleRequest) => {
    try {
      const { error } = await supabase.from('vehicle_requests').update({ status: 'CANCELLED' }).eq('id', r.id);
      if (error) throw error;
      toast.success('Request cancelled');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (r: VehicleRequest) => {
    try {
      const { error } = await supabase.from('vehicle_requests').delete().eq('id', r.id);
      if (error) throw error;
      toast.success('Request deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Requests', value: rows.length, icon: Car, color: 'primary' },
    { label: 'Pending', value: rows.filter((r) => r.status === 'PENDING').length, icon: Clock, color: 'warning' },
    { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED' || r.status === 'ASSIGNED').length, icon: CheckCircle, color: 'success' },
    { label: 'Completed', value: rows.filter((r) => r.status === 'COMPLETED').length, icon: CheckCircle, color: 'info' },
  ];

  const columns: Column<VehicleRequest>[] = [
    { key: 'request_number', label: 'Ref', render: (r) => r.request_number ? <span className="font-mono text-xs">{r.request_number}</span> : '—' },
    { key: 'purpose', label: 'Purpose', render: (r) => <span className="font-medium">{r.purpose}</span> },
    { key: 'vehicle', label: 'Vehicle', render: (r) => r.vehicle ? `${r.vehicle.name}${r.vehicle.asset_tag ? ` (${r.vehicle.asset_tag})` : ''}` : '—', searchText: (r) => [r.vehicle?.name || ''] },
    { key: 'destination', label: 'Destination', render: (r) => r.destination || '—' },
    { key: 'departure_at', label: 'Departure', render: (r) => fmtDateTime(r.departure_at) },
    { key: 'passengers', label: 'Pax', render: (r) => r.passengers, searchable: false },
    { key: 'requested_by', label: 'Requested By', render: (r) => (r.requested_by ? names[r.requested_by] || '—' : '—'), searchable: false },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={requestStatusClass(r.status)}>{r.status}</Badge> },
  ];

  if (!canRequest && !can('assets.view')) return null;

  return (
    <>
      <ModuleListPage
        title="Vehicle Requests"
        description="Book a vehicle; you choose who authorizes and who gives final approval"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search requests..."
        statusKey="status"
        createLabel="New Request"
        onCreate={canRequest ? openCreate : undefined}
        onDelete={canManage ? remove : undefined}
        rowActions={(r) => {
          const isMine = r.requested_by === employee?.id;
          if (canRequest && isMine && r.status === 'PENDING') {
            return <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel(r)}>Cancel</Button>;
          }
          return null;
        }}
        emptyMessage="No vehicle requests yet."
        emptyDescription="Raise a request to book a company vehicle."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : setOpen(false))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Vehicle Request</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Purpose *</Label>
              <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Client site visit" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Preferred Vehicle</Label>
                <Select value={form.vehicle_id || '__none__'} onValueChange={(v) => setForm({ ...form, vehicle_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Any vehicle" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Any available</SelectItem>
                    {vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}{v.asset_tag ? ` · ${v.asset_tag}` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Destination</Label>
                <Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="Nairobi CBD" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Departure</Label>
                <Input type="datetime-local" value={form.departure_at} onChange={(e) => setForm({ ...form, departure_at: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Return</Label>
                <Input type="datetime-local" value={form.return_at} onChange={(e) => setForm({ ...form, return_at: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Passengers</Label>
                <Input type="number" min="1" value={form.passengers} onChange={(e) => setForm({ ...form, passengers: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Driver</Label>
                <Select value={form.driver_id || '__none__'} onValueChange={(v) => setForm({ ...form, driver_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Assign later" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Assign later</SelectItem>
                    {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Additional passengers</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setPassengers([...passengers, { name: '' }])}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add
                </Button>
              </div>
              {passengers.length === 0 && <p className="text-xs text-muted-foreground">Optional — list the names of everyone travelling.</p>}
              {passengers.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={p.name}
                    placeholder="Passenger name"
                    onChange={(e) => { const n = [...passengers]; n[idx] = { name: e.target.value }; setPassengers(n); }}
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setPassengers(passengers.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={beginSubmit} disabled={!form.purpose.trim()}>Submit for approval</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WorkflowSubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title="Route vehicle request for approval"
        description="Choose who should authorize and who should give final approval for this vehicle request."
        confirmLabel="Submit request"
        onConfirm={submit}
      />
    </>
  );
}
