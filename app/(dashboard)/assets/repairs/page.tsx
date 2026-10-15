'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { Wrench, DollarSign, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
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
import { REPAIR_STATUSES, fmtMoney, fmtDate, fmtQty, type Asset, type AssetRepair } from '@/lib/assets';

const EMPTY = {
  asset_id: '',
  repair_date: '',
  description: '',
  vendor: '',
  cost: '',
  downtime_days: '',
  status: 'COMPLETED',
  odometer: '',
  notes: '',
};

const statusClass = (status: string) => {
  switch (status) {
    case 'COMPLETED': return 'bg-success/10 text-success';
    case 'OPEN': return 'bg-warning/10 text-warning';
    case 'IN_PROGRESS': return 'bg-info/10 text-info';
    default: return 'bg-muted text-muted-foreground';
  }
};

export default function AssetRepairsPage() {
  const { can, employee } = useAccess();
  const canManage = can('assets.repairs') || can('assets.manage') || can('admin.settings');
  const canView = can('assets.view') || canManage;

  const [rows, setRows] = useState<AssetRepair[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const load = useCallback(async () => {
    try {
      const [rRes, aRes] = await Promise.all([
        supabase.from('asset_repairs').select('*, asset:assets(name, asset_tag)').order('repair_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('assets').select('id, name, asset_tag').order('name'),
      ]);
      setRows((rRes.data || []) as unknown as AssetRepair[]);
      setAssets((aRes.data || []) as unknown as Asset[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.asset_id) { toast.error('Select an asset'); return; }
    if (!form.description.trim()) { toast.error('Describe the repair'); return; }
    if (form.cost !== '' && Number(form.cost) < 0) { toast.error('Cost cannot be negative'); return; }
    try {
      const { error } = await supabase.from('asset_repairs').insert({
        repair_number: refNumber('RP'),
        asset_id: form.asset_id,
        repair_date: form.repair_date || new Date().toISOString().slice(0, 10),
        description: form.description.trim(),
        vendor: form.vendor || null,
        cost: Number(form.cost) || 0,
        downtime_days: form.downtime_days === '' ? null : Number(form.downtime_days),
        status: form.status,
        odometer: form.odometer === '' ? null : Number(form.odometer),
        notes: form.notes || null,
        recorded_by: employee?.id || null,
      });
      if (error) throw error;
      toast.success('Repair recorded');
      setOpen(false);
      setForm({ ...EMPTY });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (r: AssetRepair) => {
    try {
      const { error } = await supabase.from('asset_repairs').delete().eq('id', r.id);
      if (error) throw error;
      toast.success('Repair deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openCreate = () => {
    setForm({ ...EMPTY, repair_date: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  };

  const assetLabel = (r: AssetRepair) => `${r.asset?.name || 'Asset'}${r.asset?.asset_tag ? ` (${r.asset.asset_tag})` : ''}`;
  const openCount = rows.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS').length;

  const summaryCards: SummaryCard[] = [
    { label: 'Repair Records', value: rows.length, icon: Wrench, color: 'primary' },
    { label: 'Total Cost', value: fmtMoney(rows.reduce((a, r) => a + Number(r.cost || 0), 0)), icon: DollarSign, color: 'info' },
    { label: 'Open / In Progress', value: openCount, icon: Clock, color: 'warning' },
    { label: 'Completed', value: rows.filter((r) => r.status === 'COMPLETED').length, icon: CheckCircle, color: 'success' },
  ];

  const columns: Column<AssetRepair>[] = [
    { key: 'repair_number', label: 'Ref', render: (r) => r.repair_number ? <span className="font-mono text-xs">{r.repair_number}</span> : '—' },
    { key: 'repair_date', label: 'Date', render: (r) => fmtDate(r.repair_date) },
    { key: 'asset', label: 'Asset', render: (r) => <span className="font-medium">{assetLabel(r)}</span>, searchText: (r) => [assetLabel(r)] },
    { key: 'description', label: 'Description' },
    { key: 'vendor', label: 'Vendor', render: (r) => r.vendor || '—' },
    { key: 'cost', label: 'Cost', render: (r) => <span className="font-medium">{fmtMoney(r.cost)}</span> },
    { key: 'downtime_days', label: 'Downtime', render: (r) => r.downtime_days != null ? `${r.downtime_days} d` : '—' },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={statusClass(r.status)}>{r.status.replace('_', ' ')}</Badge> },
  ];

  if (!canView) return null;

  return (
    <>
      <ModuleListPage
        title="Repairs & Cost"
        description="Record repair jobs, vendors, downtime and their cost implications"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search repairs, assets, vendors..."
        statusKey="status"
        createLabel="Record Repair"
        onCreate={canManage ? openCreate : undefined}
        onDelete={canManage ? remove : undefined}
        emptyMessage="No repairs recorded."
        emptyDescription="Log a repair to start tracking maintenance costs."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : setOpen(false))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record Repair</DialogTitle></DialogHeader>
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
                <Label>Repair Date</Label>
                <Input type="date" value={form.repair_date} onChange={(e) => setForm({ ...form, repair_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Vendor</Label>
                <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Workshop / supplier" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description *</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Replaced brake pads and discs" />
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Cost</Label>
                <Input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Downtime (days)</Label>
                <Input type="number" min="0" step="1" value={form.downtime_days} onChange={(e) => setForm({ ...form, downtime_days: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Odometer (km)</Label>
                <Input type="number" min="0" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REPAIR_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {openCount > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> {openCount} repair(s) are still open.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!form.asset_id || !form.description.trim()}>Save Repair</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
