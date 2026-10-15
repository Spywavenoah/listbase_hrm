'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { CalendarClock, AlertTriangle, ShieldCheck, Ban } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { fmtDate, fmtQty, type InventoryItem } from '@/lib/inventory';

interface ExpiryRow {
  id: string;
  item_id: string;
  warehouse_id: string;
  quantity: number;
  expiry_date: string;
  bin_location: string | null;
  item?: InventoryItem | null;
  warehouse?: { name: string } | null;
}

const daysLeft = (date: string) => Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);

export default function InventoryExpiryPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ExpiryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('inventory_stock')
        .select('id, item_id, warehouse_id, quantity, expiry_date, bin_location, item:inventory_items(*), warehouse:inventory_warehouses(name)')
        .not('expiry_date', 'is', null)
        .order('expiry_date', { ascending: true });
      setRows((data || []) as unknown as ExpiryRow[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const classify = (r: ExpiryRow) => {
    const d = daysLeft(r.expiry_date);
    const warn = Number(r.item?.expiry_warning_days ?? 30);
    if (d < 0) return 'expired';
    if (d <= warn) return 'soon';
    return 'ok';
  };

  const counts = useMemo(() => {
    let expired = 0, soon = 0, ok = 0;
    for (const r of rows) {
      const c = classify(r);
      if (c === 'expired') expired++;
      else if (c === 'soon') soon++;
      else ok++;
    }
    return { expired, soon, ok };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const summaryCards: SummaryCard[] = [
    { label: 'Tracked batches', value: rows.length, icon: CalendarClock, color: 'primary' },
    { label: 'Expired', value: counts.expired, icon: Ban, color: 'destructive' },
    { label: 'Expiring soon', value: counts.soon, icon: AlertTriangle, color: 'warning' },
    { label: 'Within safe window', value: counts.ok, icon: ShieldCheck, color: 'success' },
  ];

  const columns: Column<ExpiryRow>[] = [
    { key: 'item', label: 'Item', render: (r) => <span className="font-medium">{r.item?.name || '—'}</span>, searchText: (r) => [r.item?.name || '', r.item?.sku || ''] },
    { key: 'warehouse', label: 'Warehouse', render: (r) => r.warehouse?.name || '—' },
    { key: 'bin_location', label: 'Rack / Bin', render: (r) => r.bin_location || '—' },
    { key: 'quantity', label: 'On hand', render: (r) => fmtQty(r.quantity) },
    { key: 'expiry_date', label: 'Expiry', render: (r) => fmtDate(r.expiry_date) },
    {
      key: 'status',
      label: 'Warning',
      render: (r) => {
        const d = daysLeft(r.expiry_date);
        const c = classify(r);
        if (c === 'expired') return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Expired {Math.abs(d)}d ago</Badge>;
        if (c === 'soon') return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">Expires in {d}d</Badge>;
        return <Badge variant="outline" className="bg-success/10 text-success border-success/30">{d}d left</Badge>;
      },
      exportValue: (r) => String(daysLeft(r.expiry_date)),
    },
  ];

  return (
    <ModuleListPage
      title="Expiry Alerts"
      description="Early warning for stock batches approaching or past their expiry date"
      summaryCards={summaryCards}
      columns={columns}
      data={rows}
      loading={loading}
      searchPlaceholder="Search items..."
      onRowClick={(r) => router.push(`/inventory/items/${r.item_id}`)}
      emptyMessage="No expiry-tracked stock"
      emptyDescription="Record a receipt with an expiry date to track it here."
    />
  );
}
