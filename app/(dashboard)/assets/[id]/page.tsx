/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Barcode, PrintBarcodeButton } from '@/components/inventory/barcode';
import { ArrowLeft, ImagePlus, AlertTriangle, Car, Wrench, CalendarClock, MapPin } from 'lucide-react';
import {
  fmtDate,
  fmtMoney,
  fmtQty,
  maintenanceDueInfo,
  dueStateClass,
  labelFor,
  DEPRECIATION_METHODS,
  CONDITION_STATUSES,
  type Asset,
  type AssetRepair,
  type FuelLog,
  type MaintenanceSchedule,
  type VehicleProfile,
} from '@/lib/assets';

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const assetId = params?.id as string;

  const [asset, setAsset] = useState<Asset | null>(null);
  const [vehicle, setVehicle] = useState<VehicleProfile | null>(null);
  const [repairs, setRepairs] = useState<AssetRepair[]>([]);
  const [fuel, setFuel] = useState<FuelLog[]>([]);
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [assignee, setAssignee] = useState<string>('—');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    try {
      const aRes = await supabase.from('assets').select('*, category_ref:asset_categories(name, code, asset_class)').eq('id', assetId).single();
      const a = (aRes.data || null) as unknown as Asset | null;
      setAsset(a);

      const [vRes, rRes, fRes, sRes] = await Promise.all([
        supabase.from('asset_vehicle_profiles').select('*').eq('asset_id', assetId).maybeSingle(),
        supabase.from('asset_repairs').select('*').eq('asset_id', assetId).order('repair_date', { ascending: false }),
        supabase.from('asset_fuel_logs').select('*').eq('asset_id', assetId).order('log_date', { ascending: false }),
        supabase.from('asset_maintenance_schedules').select('*').eq('asset_id', assetId).order('next_due_date', { ascending: true, nullsFirst: false }),
      ]);
      setVehicle((vRes.data || null) as unknown as VehicleProfile | null);
      setRepairs((rRes.data || []) as unknown as AssetRepair[]);
      setFuel((fRes.data || []) as unknown as FuelLog[]);
      setSchedules((sRes.data || []) as unknown as MaintenanceSchedule[]);

      if (a?.assigned_to) {
        const { data } = await supabase.from('employees').select('first_name, last_name').eq('id', a.assigned_to).maybeSingle();
        const e = data as { first_name: string; last_name: string } | null;
        setAssignee(e ? `${e.first_name} ${e.last_name}` : '—');
      } else {
        setAssignee('—');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading asset...</div>;
  if (!asset) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Asset not found.</p>
        <Button variant="outline" onClick={() => router.push('/assets')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to assets
        </Button>
      </div>
    );
  }

  const repairCost = repairs.reduce((a, r) => a + Number(r.cost || 0), 0);
  const fuelCost = fuel.reduce((a, f) => a + Number(f.total_cost || 0), 0);
  const anomalies = fuel.filter((f) => f.anomaly_flag);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push('/assets')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Assets
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{labelFor(CONDITION_STATUSES, asset.condition_status)}</Badge>
          <Badge variant="outline">{asset.status.replace('_', ' ')}</Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="flex flex-col gap-6 pt-6 sm:flex-row">
            <div className="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
              {asset.image_url
                ? <img src={asset.image_url} alt={asset.name} className="h-full w-full object-cover" />
                : <div className="flex flex-col items-center gap-1 text-muted-foreground"><ImagePlus className="h-8 w-8" /><span className="text-xs">No picture</span></div>}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h1 className="text-xl font-semibold">{asset.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {asset.category_ref?.name || 'Uncategorised'}
                  {asset.asset_type ? ` · ${asset.asset_type}` : ''}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Detail label="Asset No." value={asset.asset_tag || '—'} mono />
                <Detail label="Serial" value={asset.serial_number || '—'} />
                <Detail label="Location" value={asset.location || '—'} />
                <Detail label="Assigned to" value={assignee} />
                <Detail label="Purchased" value={fmtDate(asset.purchase_date)} />
                <Detail label="Purchase cost" value={fmtMoney(asset.purchase_value)} />
              </div>
              {asset.notes && <p className="text-sm text-muted-foreground">{asset.notes}</p>}
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3">
                {asset.barcode
                  ? <Barcode value={asset.barcode} label={asset.name} height={56} moduleWidth={2} />
                  : <span className="text-sm text-muted-foreground">No barcode</span>}
                {asset.barcode && <PrintBarcodeButton value={asset.barcode} label={asset.name} />}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Valuation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-3xl font-semibold">{fmtMoney(asset.book_value ?? asset.current_value)}</p>
              <p className="text-sm text-muted-foreground">Current book value</p>
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Depreciation to date" value={fmtMoney(asset.depreciation_value)} />
              <Row label="Valuation date" value={fmtDate(asset.depreciation_date)} />
              <Row label="Method" value={labelFor(DEPRECIATION_METHODS, asset.depreciation_method)} />
              <Row label="Useful life" value={asset.useful_life_years != null ? `${asset.useful_life_years} yrs` : '—'} />
              <Row label="Salvage value" value={fmtMoney(asset.salvage_value)} />
            </div>
          </CardContent>
        </Card>
      </div>

      {vehicle && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Car className="h-4 w-4" /> Vehicle Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Detail label="Plate" value={vehicle.plate_number || '—'} />
            <Detail label="Make / Model" value={`${vehicle.make || '—'}${vehicle.model ? ` ${vehicle.model}` : ''}`} />
            <Detail label="Year" value={vehicle.manufacture_year != null ? String(vehicle.manufacture_year) : '—'} />
            <Detail label="Fuel" value={vehicle.fuel_type} />
            <Detail label="Engine" value={vehicle.engine_capacity_cc != null ? `${fmtQty(vehicle.engine_capacity_cc, 0)} cc` : '—'} />
            <Detail label="Plugs" value={vehicle.num_plugs != null ? String(vehicle.num_plugs) : '—'} />
            <Detail label="Tank" value={vehicle.tank_capacity != null ? `${fmtQty(vehicle.tank_capacity)} L` : '—'} />
            <Detail label="Odometer" value={`${fmtQty(vehicle.odometer, 0)} km`} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Repairs" value={repairs.length} sub={fmtMoney(repairCost)} icon={Wrench} />
        <StatCard label="Fuel entries" value={fuel.length} sub={fmtMoney(fuelCost)} icon={Car} />
        <StatCard label="Consumption flags" value={anomalies.length} sub={anomalies.length ? 'Needs review' : 'All normal'} icon={AlertTriangle} />
      </div>

      <ListCard
        title="Maintenance schedules"
        icon={<CalendarClock className="h-4 w-4" />}
        empty="No maintenance scheduled."
        head={['Schedule', 'Type', 'Next Due', 'Status']}
        rows={schedules.map((s) => {
          const info = maintenanceDueInfo(s);
          return [
            s.title,
            s.schedule_type,
            s.recurrence === 'INTERVAL' && s.next_due_meter != null && !s.next_due_date
              ? `at ${fmtQty(s.next_due_meter, 0)} km`
              : fmtDate(s.next_due_date),
            <Badge key={s.id} variant="outline" className={s.is_active ? dueStateClass(info.state) : 'bg-muted text-muted-foreground'}>
              {s.is_active ? info.label : 'Inactive'}
            </Badge>,
          ];
        })}
      />

      <ListCard
        title="Repair history"
        icon={<Wrench className="h-4 w-4" />}
        empty="No repairs recorded."
        head={['Date', 'Description', 'Vendor', 'Cost', 'Status']}
        rows={repairs.map((r) => [
          fmtDate(r.repair_date),
          r.description,
          r.vendor || '—',
          fmtMoney(r.cost),
          <Badge key={r.id} variant="outline">{r.status.replace('_', ' ')}</Badge>,
        ])}
      />

      <ListCard
        title="Fuel history"
        icon={<Car className="h-4 w-4" />}
        empty="No fuel entries."
        head={['Date', 'Odometer', 'Litres', 'km/L', 'Cost', 'Health']}
        rows={fuel.map((f) => [
          fmtDate(f.log_date),
          `${fmtQty(f.odometer, 0)} km`,
          fmtQty(f.litres),
          f.efficiency != null ? fmtQty(f.efficiency) : '—',
          f.total_cost != null ? fmtMoney(f.total_cost) : '—',
          f.anomaly_flag
            ? <Badge key={f.id} variant="outline" className="bg-destructive/10 text-destructive" title={f.anomaly_reason || ''}>High consumption</Badge>
            : <Badge key={f.id} variant="outline" className="bg-success/10 text-success">Normal</Badge>,
        ])}
      />
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? 'font-mono text-sm font-medium' : 'font-medium'}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xl font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{label} · {sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ListCard({
  title,
  icon,
  empty,
  head,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  empty: string;
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base">{icon} {title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {head.map((h) => <TableHead key={h}>{h}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={head.length} className="text-center text-sm text-muted-foreground">{empty}</TableCell></TableRow>
            )}
            {rows.map((cells, i) => (
              <TableRow key={i}>
                {cells.map((c, j) => <TableCell key={j}>{c}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
