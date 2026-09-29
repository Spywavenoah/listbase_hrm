'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { ArrowRightLeft, Package, CheckCircle, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  assigned_at: string | null;
}

export default function AssignmentsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

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

  const empName = (id: string | null) => {
    if (!id) return '—';
    const e = employees.find((e) => e.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };

  const handleAssign = async (asset: Asset, employeeId: string) => {
    try {
      const { error } = await supabase.from('assets').update({
        assigned_to: employeeId,
        assigned_at: new Date().toISOString(),
        status: 'ASSIGNED',
      }).eq('id', asset.id);
      if (error) throw error;
      toast.success('Asset assigned');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const handleReturn = async (asset: Asset) => {
    try {
      const { error } = await supabase.from('assets').update({
        assigned_to: null,
        assigned_at: null,
        status: 'AVAILABLE',
      }).eq('id', asset.id);
      if (error) throw error;
      toast.success('Asset returned');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const statusColors: Record<string, string> = {
    AVAILABLE: 'bg-success/10 text-success',
    ASSIGNED: 'bg-primary/10 text-primary',
    IN_REPAIR: 'bg-warning/10 text-warning',
    RETIRED: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Assets', value: assets.length, icon: Package, color: 'primary' },
    { label: 'Assigned', value: assets.filter((a) => a.status === 'ASSIGNED').length, icon: ArrowRightLeft, color: 'info' },
    { label: 'Available', value: assets.filter((a) => a.status === 'AVAILABLE').length, icon: CheckCircle, color: 'success' },
    { label: 'In Repair', value: assets.filter((a) => a.status === 'IN_REPAIR').length, icon: RotateCcw, color: 'warning' },
  ];

  const columns: Column<Asset>[] = [
    { key: 'asset_tag', label: 'Tag', render: (a) => a.asset_tag || '—' },
    { key: 'name', label: 'Asset Name' },
    { key: 'asset_type', label: 'Type', render: (a) => a.asset_type || '—' },
    { key: 'assigned_to', label: 'Assigned To', render: (a) => empName(a.assigned_to) },
    {
      key: 'assigned_at', label: 'Assigned On',
      render: (a) => a.assigned_at ? new Date(a.assigned_at).toLocaleDateString() : '—',
    },
    {
      key: 'status', label: 'Status',
      render: (a) => <Badge variant="outline" className={statusColors[a.status] || ''}>{a.status}</Badge>,
    },
  ];

  return (
    <ModuleListPage
      title="Asset Assignments"
      description="Assign and track company assets to employees"
      summaryCards={summaryCards}
      columns={columns}
      data={assets}
      searchPlaceholder="Search assignments..."
      rowActions={(a) => (
        a.status === 'ASSIGNED' ? (
          <Button size="sm" variant="outline" className="h-7" onClick={() => handleReturn(a)}>
            Return
          </Button>
        ) : a.status === 'AVAILABLE' ? (
          <Select onValueChange={(v) => handleAssign(a, v)}>
            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="Assign to" /></SelectTrigger>
            <SelectContent>
              {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null
      )}
    />
  );
}
