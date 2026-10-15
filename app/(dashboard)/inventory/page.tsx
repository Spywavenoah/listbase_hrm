'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Package,
  Warehouse as WarehouseIcon,
  Boxes,
  DollarSign,
  AlertTriangle,
  Tags,
  ArrowRightLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarClock,
  TrendingUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useAccess } from '@/lib/access';
import { fmtDate, fmtMoney, fmtQty, movementLabel, movementSign } from '@/lib/inventory';

interface StockLite {
  item_id: string;
  warehouse_id: string;
  quantity: number;
  expiry_date: string | null;
  item: { name: string; uom: string; unit_cost: number; reorder_level: number; max_stock_level: number | null; expiry_warning_days: number } | null;
  warehouse: { name: string } | null;
}

interface MovementRow {
  id: string;
  movement_type: string;
  quantity: number;
  movement_date: string;
  reference: string | null;
  item: { name: string; uom: string } | null;
  warehouse: { name: string } | null;
  dest_warehouse: { name: string } | null;
}

const colorClasses: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
};

export default function InventoryDashboard() {
  const router = useRouter();
  const { employee } = useAccess();
  const [stock, setStock] = useState<StockLite[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [counts, setCounts] = useState({ items: 0, warehouses: 0, categories: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, mv, items, wh, cats] = await Promise.all([
        supabase
          .from('inventory_stock')
          .select('item_id, warehouse_id, quantity, expiry_date, item:inventory_items(name,uom,unit_cost,reorder_level,max_stock_level,expiry_warning_days), warehouse:inventory_warehouses(name)'),
        supabase
          .from('inventory_movements')
          .select('id, movement_type, quantity, movement_date, reference, item:inventory_items(name,uom), warehouse:inventory_warehouses!inventory_movements_warehouse_id_fkey(name), dest_warehouse:inventory_warehouses!inventory_movements_dest_warehouse_id_fkey(name)')
          .order('created_at', { ascending: false })
          .limit(8),
        supabase.from('inventory_items').select('id', { count: 'exact', head: true }),
        supabase.from('inventory_warehouses').select('id', { count: 'exact', head: true }),
        supabase.from('inventory_categories').select('id', { count: 'exact', head: true }),
      ]);
      setStock((st.data || []) as unknown as StockLite[]);
      setMovements((mv.data || []) as unknown as MovementRow[]);
      setCounts({ items: items.count || 0, warehouses: wh.count || 0, categories: cats.count || 0 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    let units = 0;
    let value = 0;
    const byWarehouse: Record<string, { name: string; value: number; units: number }> = {};
    const low: { name: string; uom: string; qty: number; reorder: number; warehouse: string }[] = [];
    const over: { name: string; uom: string; qty: number; max: number; warehouse: string }[] = [];
    const expiring: { name: string; uom: string; qty: number; expiry: string; days: number; warehouse: string }[] = [];
    for (const s of stock) {
      const qty = Number(s.quantity);
      const cost = Number(s.item?.unit_cost || 0);
      const reorder = Number(s.item?.reorder_level || 0);
      const maxLevel = s.item?.max_stock_level != null ? Number(s.item.max_stock_level) : null;
      units += qty;
      value += qty * cost;
      const key = s.warehouse_id;
      const name = s.warehouse?.name || 'Unknown';
      byWarehouse[key] = byWarehouse[key] || { name, value: 0, units: 0 };
      byWarehouse[key].value += qty * cost;
      byWarehouse[key].units += qty;
      if (s.item && qty <= reorder) {
        low.push({ name: s.item.name, uom: s.item.uom, qty, reorder, warehouse: name });
      }
      if (s.item && maxLevel != null && qty >= maxLevel) {
        over.push({ name: s.item.name, uom: s.item.uom, qty, max: maxLevel, warehouse: name });
      }
      if (s.item && s.expiry_date) {
        const days = Math.ceil((new Date(s.expiry_date).getTime() - Date.now()) / 86400000);
        const warn = Number(s.item.expiry_warning_days ?? 30);
        if (days <= warn) {
          expiring.push({ name: s.item.name, uom: s.item.uom, qty, expiry: s.expiry_date, days, warehouse: name });
        }
      }
    }
    return {
      units,
      value,
      byWarehouse: Object.values(byWarehouse).sort((a, b) => b.value - a.value),
      low,
      over,
      expiring: expiring.sort((a, b) => a.days - b.days),
    };
  }, [stock]);

  const maxWarehouseValue = Math.max(1, ...totals.byWarehouse.map((w) => w.value));

  const cards = [
    { label: 'Items', value: counts.items, icon: Package, color: 'primary', href: '/inventory/items' },
    { label: 'Warehouses', value: counts.warehouses, icon: WarehouseIcon, color: 'info', href: '/inventory/warehouses' },
    { label: 'Units On Hand', value: fmtQty(totals.units), icon: Boxes, color: 'primary', href: '/inventory/stock' },
    { label: 'Stock Value', value: fmtMoney(totals.value), icon: DollarSign, color: 'success', href: '/inventory/reports' },
    { label: 'Low Stock', value: totals.low.length, icon: AlertTriangle, color: totals.low.length ? 'warning' : 'success', href: '/inventory/stock' },
    { label: 'Over-stocked', value: totals.over.length, icon: TrendingUp, color: totals.over.length ? 'warning' : 'success', href: '/inventory/stock' },
    { label: 'Expiring Soon', value: totals.expiring.length, icon: CalendarClock, color: totals.expiring.length ? 'destructive' : 'success', href: '/inventory/expiry' },
    { label: 'Categories', value: counts.categories, icon: Tags, color: 'info', href: '/inventory/categories' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Inventory Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Multi-warehouse stock overview · {employee?.first_name ? `Welcome, ${employee.first_name}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(card.href)}>
              <CardContent className="p-4 sm:p-5">
                <div className={cn('flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg', colorClasses[card.color])}>
                  <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                {loading ? (
                  <div className="mt-3 h-7 w-16 animate-pulse rounded bg-muted" />
                ) : (
                  <p className="mt-3 text-lg sm:text-2xl font-bold">{card.value}</p>
                )}
                <p className="text-xs sm:text-sm text-muted-foreground">{card.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-primary" /> Stock Value by Warehouse
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}
              </div>
            ) : totals.byWarehouse.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock recorded yet.</p>
            ) : (
              <div className="space-y-4">
                {totals.byWarehouse.map((w) => (
                  <div key={w.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">{w.name}</span>
                      <span className="text-muted-foreground">{fmtMoney(w.value)} · {fmtQty(w.units)} units</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(w.value / maxWarehouseValue) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" /> Low Stock Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}
              </div>
            ) : totals.low.length === 0 ? (
              <p className="text-sm text-muted-foreground">All items are above their reorder levels.</p>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {totals.low.slice(0, 8).map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{l.warehouse}</p>
                    </div>
                    <Badge variant="outline" className="bg-warning/10 text-warning">
                      {fmtQty(l.qty)} / {fmtQty(l.reorder)} {l.uom}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-destructive" /> Expiring Soon
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}
              </div>
            ) : totals.expiring.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock is approaching its expiry date.</p>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {totals.expiring.slice(0, 8).map((e, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{e.name}</p>
                      <p className="text-xs text-muted-foreground">{e.warehouse} · {fmtQty(e.qty)} {e.uom}</p>
                    </div>
                    <Badge variant="outline" className={e.days < 0 ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}>
                      {e.days < 0 ? `Expired ${Math.abs(e.days)}d ago` : `${e.days}d left`}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-4 w-4 text-primary" /> Recent Movements
          </CardTitle>
          <button className="text-xs text-primary hover:underline" onClick={() => router.push('/inventory/movements')}>
            View all
          </button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}
            </div>
          ) : movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock movements recorded yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {movements.map((m) => {
                const sign = movementSign(m.movement_type);
                const Icon = sign === 'in' ? ArrowDownToLine : sign === 'out' ? ArrowUpFromLine : ArrowRightLeft;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <Icon className={cn('h-4 w-4 shrink-0', sign === 'in' ? 'text-success' : sign === 'out' ? 'text-warning' : 'text-primary')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {m.item?.name || '—'} · {movementLabel(m.movement_type)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.warehouse?.name}{m.movement_type === 'TRANSFER' ? ` → ${m.dest_warehouse?.name || ''}` : ''}
                        {m.reference ? ` · ${m.reference}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn('text-sm font-medium', Number(m.quantity) < 0 ? 'text-destructive' : 'text-success')}>
                        {Number(m.quantity) > 0 ? '+' : ''}{fmtQty(Number(m.quantity))} {m.item?.uom}
                      </p>
                      <p className="text-xs text-muted-foreground">{fmtDate(m.movement_date)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
