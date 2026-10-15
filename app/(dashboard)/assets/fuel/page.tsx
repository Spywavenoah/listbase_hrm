'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { Fuel, Droplet, DollarSign, AlertTriangle, Car } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { FUEL_TYPES, fmtMoney, fmtDate, fmtQty, type Asset, type FuelLog } from '@/lib/assets';

const EMPTY = {
  asset_id: '',
  log_date: '',
  odometer: '',
  litres: '',
  unit_cost: '',
  fuel_type: 'PETROL',
  station: '',
  receipt_no: '',
};

export default function AssetFuelPage() {
  const { can, employee } = useAccess();
  const canManage = can('assets.fleet') || can('assets.manage') || can('admin.settings');
  const canView = can('assets.view') || canManage;

  const [rows, setRows] = useState<FuelLog[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const load = useCallback(async () => {
    try {
      const [fRes, aRes] = await Promise.all([
        supabase.from('asset_fuel_logs').select('*, asset:assets(name, asset_tag)').order('log_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('assets').select('*, category_ref:asset_categories(name, asset_class)').order('name'),
      ]);
      setRows((fRes.data || []) as unknown as FuelLog[]);
      const vehicles = ((aRes.data || []) as unknown as Asset[]).filter(
        (a) => a.category_ref?.asset_class === 'AUTOMOBILE'
      );
      setAssets(vehicles);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const vehicleLabel = (a: Asset) => `${a.name}${a.asset_tag ? ` · ${a.asset_tag}` : ''}`;

  const save = async () => {
    if (!form.asset_id) { toast.error('Select a vehicle'); return; }
    if (!Number(form.litres) || Number(form.litres) <= 0) { toast.error('Enter the litres filled'); return; }
    if (!Number(form.odometer) || Number(form.odometer) <= 0) { toast.error('Enter the odometer reading'); return; }
    try {
      const total = form.unit_cost !== '' ? Number(form.unit_cost) * Number(form.litres) : null;
      const { data, error } = await supabase.from('asset_fuel_logs').insert({
        asset_id: form.asset_id,
        log_date: form.log_date || new Date().toISOString().slice(0, 10),
        odometer: Number(form.odometer),
        litres: Number(form.litres),
        unit_cost: form.unit_cost === '' ? null : Number(form.unit_cost),
        total_cost: total,
        fuel_type: form.fuel_type,
        station: form.station || null,
        receipt_no: form.receipt_no || null,
        issued_to: employee?.id || null,
        recorded_by: employee?.id || null,
      }).select().single();
      if (error) throw error;

      const created = data as unknown as FuelLog;
      await supabase.from('asset_vehicle_profiles')
        .update({ odometer: Number(form.odometer) })
        .eq('asset_id', form.asset_id);

      if (created?.anomaly_flag) {
        toast.warning(`Fuel anomaly: ${created.anomaly_reason || 'This vehicle is consuming more fuel than expected'}`);
      } else {
        toast.success('Fuel entry recorded');
      }
      setOpen(false);
      setForm({ ...EMPTY });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (l: FuelLog) => {
    try {
      const { error } = await supabase.from('asset_fuel_logs').delete().eq('id', l.id);
      if (error) throw error;
      toast.success('Fuel entry deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openCreate = () => {
    setForm({ ...EMPTY, log_date: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  };

  const anomalies = rows.filter((r) => r.anomaly_flag);
  const totalLitres = rows.reduce((a, r) => a + Number(r.litres || 0), 0);
  const totalCost = rows.reduce((a, r) => a + Number(r.total_cost || 0), 0);

  const summaryCards: SummaryCard[] = [
    { label: 'Fuel Entries', value: rows.length, icon: Fuel, color: 'primary' },
    { label: 'Vehicles', value: assets.length, icon: Car, color: 'info' },
    { label: 'Litres Dispensed', value: fmtQty(totalLitres), icon: Droplet, color: 'success' },
    { label: 'Consumption Flags', value: anomalies.length, icon: AlertTriangle, color: 'warning' },
  ];

  const columns: Column<FuelLog>[] = [
    { key: 'log_date', label: 'Date', render: (l) => fmtDate(l.log_date) },
    { key: 'asset', label: 'Vehicle', render: (l) => <span className="font-medium">{l.asset ? `${l.asset.name}${l.asset.asset_tag ? ` (${l.asset.asset_tag})` : ''}` : '—'}</span>, searchText: (l) => [l.asset?.name || ''] },
    { key: 'odometer', label: 'Odometer', render: (l) => `${fmtQty(l.odometer, 0)} km` },
    { key: 'litres', label: 'Litres', render: (l) => fmtQty(l.litres) },
    { key: 'efficiency', label: 'km/L', render: (l) => l.efficiency != null ? <span className="font-medium">{fmtQty(l.efficiency)}</span> : '—' },
    { key: 'expected_efficiency', label: 'Expected', render: (l) => l.expected_efficiency != null ? fmtQty(l.expected_efficiency) : '—' },
    { key: 'total_cost', label: 'Cost', render: (l) => (l.total_cost != null ? fmtMoney(l.total_cost) : '—') },
    {
      key: 'anomaly_flag',
      label: 'Health',
      searchText: (l) => [l.anomaly_reason || ''],
      render: (l) => l.anomaly_flag
        ? <Badge variant="outline" className="bg-destructive/10 text-destructive">High consumption</Badge>
        : <Badge variant="outline" className="bg-success/10 text-success">Normal</Badge>,
    },
  ];

  if (!canView) return null;

  return (
    <>
      <ModuleListPage
        title="Fuel & Petrol Tracking"
        description="Log fuel purchases and automatically detect vehicles consuming above expected"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search vehicles, stations, receipts..."
        createLabel="Log Fuel"
        onCreate={canManage ? openCreate : undefined}
        onDelete={canManage ? remove : undefined}
        emptyMessage="No fuel entries yet."
        emptyDescription="Log a fill-up to start measuring consumption."
      />

      {anomalies.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> High consumption warnings
            </CardTitle>
            <CardDescription>
              Vehicles using significantly more fuel than comparable vehicles (same plugs / engine size / odometer band) or their own trend.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {anomalies.map((a) => (
              <div key={a.id} className="rounded-lg border border-destructive/20 bg-background p-3 text-sm">
                <p className="font-medium">{a.asset ? `${a.asset.name}${a.asset.asset_tag ? ` (${a.asset.asset_tag})` : ''}` : 'Vehicle'} · {fmtDate(a.log_date)}</p>
                <p className="mt-1 text-muted-foreground">{a.anomaly_reason || 'Consumption above expected benchmark'}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : setOpen(false))}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Fuel</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Vehicle *</Label>
              <Select value={form.asset_id || '__none__'} onValueChange={(v) => setForm({ ...form, asset_id: v === '__none__' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select vehicle</SelectItem>
                  {assets.map((a) => <SelectItem key={a.id} value={a.id}>{vehicleLabel(a)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={form.log_date} onChange={(e) => setForm({ ...form, log_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Odometer (km) *</Label>
                <Input type="number" min="0" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} placeholder="120000" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Litres *</Label>
                <Input type="number" min="0" step="0.01" value={form.litres} onChange={(e) => setForm({ ...form, litres: e.target.value })} placeholder="40" />
              </div>
              <div className="space-y-1.5">
                <Label>Unit Cost ($/L)</Label>
                <Input type="number" min="0" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Fuel Type</Label>
                <Select value={form.fuel_type} onValueChange={(v) => setForm({ ...form, fuel_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FUEL_TYPES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Station</Label>
                <Input value={form.station} onChange={(e) => setForm({ ...form, station: e.target.value })} placeholder="Station name" />
              </div>
              <div className="space-y-1.5">
                <Label>Receipt No.</Label>
                <Input value={form.receipt_no} onChange={(e) => setForm({ ...form, receipt_no: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!form.asset_id || !Number(form.litres)}>Save Entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
