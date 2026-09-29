'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Package, CheckCircle, ArrowRightLeft, Archive } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Asset {
  id: string;
  asset_tag: string | null;
  name: string;
  asset_type: string | null;
  serial_number: string | null;
  condition_status: string;
  status: string;
  assigned_to: string | null;
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', asset_tag: '', asset_type: '', serial_number: '', condition_status: 'GOOD' });

  const load = useCallback(async () => {
    try {
      const [aRes, eRes] = await Promise.all([
        supabase.from('assets').select('*').order('created_at', { ascending: false }),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE'),
      ]);
      setAssets((aRes.data || []) as unknown as Asset[]);
      setEmployees(eRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('assets').insert({
        name: form.name,
        asset_tag: form.asset_tag || null,
        asset_type: form.asset_type || null,
        serial_number: form.serial_number || null,
        condition_status: form.condition_status,
        status: 'AVAILABLE',
      });
      if (error) throw error;
      toast.success('Asset added');
      setCreateOpen(false);
      setForm({ name: '', asset_tag: '', asset_type: '', serial_number: '', condition_status: 'GOOD' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const empName = (id: string | null) => {
    if (!id) return '—';
    const e = employees.find((e) => e.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };

  const statusColors: Record<string, string> = {
    AVAILABLE: 'bg-success/10 text-success',
    ASSIGNED: 'bg-primary/10 text-primary',
    IN_REPAIR: 'bg-warning/10 text-warning',
    RETIRED: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Assets', value: assets.length, icon: Package, color: 'primary' },
    { label: 'Available', value: assets.filter((a) => a.status === 'AVAILABLE').length, icon: CheckCircle, color: 'success' },
    { label: 'Assigned', value: assets.filter((a) => a.status === 'ASSIGNED').length, icon: ArrowRightLeft, color: 'info' },
    { label: 'Retired', value: assets.filter((a) => a.status === 'RETIRED').length, icon: Archive, color: 'destructive' },
  ];

  const columns: Column<Asset>[] = [
    { key: 'asset_tag', label: 'Tag', render: (a) => a.asset_tag || '—' },
    { key: 'name', label: 'Name' },
    { key: 'asset_type', label: 'Type', render: (a) => a.asset_type || '—' },
    { key: 'serial_number', label: 'Serial', render: (a) => a.serial_number || '—' },
    { key: 'assigned_to', label: 'Assigned To', render: (a) => empName(a.assigned_to) },
    {
      key: 'status', label: 'Status',
      render: (a) => <Badge variant="outline" className={statusColors[a.status] || ''}>{a.status}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Assets"
        description="Track and manage company assets and their assignments"
        summaryCards={summaryCards}
        columns={columns}
        data={assets}
        searchPlaceholder="Search assets..."
        createLabel="Add Asset"
        onCreate={() => setCreateOpen(true)}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Asset</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Asset Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="MacBook Pro 16" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Asset Tag</Label>
                <Input value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} placeholder="IT-001" />
              </div>
              <div className="space-y-1.5">
                <Label>Asset Type</Label>
                <Input value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })} placeholder="Laptop" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Serial Number</Label>
                <Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <Select value={form.condition_status} onValueChange={(v) => setForm({ ...form, condition_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GOOD">Good</SelectItem>
                    <SelectItem value="FAIR">Fair</SelectItem>
                    <SelectItem value="POOR">Poor</SelectItem>
                    <SelectItem value="DAMAGED">Damaged</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
