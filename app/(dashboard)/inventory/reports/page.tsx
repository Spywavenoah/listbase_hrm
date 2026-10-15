'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DollarSign, Boxes, AlertTriangle, Warehouse as WarehouseIcon, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { downloadCsv, csvFileName } from '@/lib/export/csv';
import { fmtMoney, fmtQty, movementLabel } from '@/lib/inventory';

interface StockLite {
  quantity: number;
  reserved_quantity: number;
  item: { name: string; sku: string | null; uom: string; unit_cost: number; reorder_level: number } | null;
  warehouse: { name: string } | null;
}

interface MovementRow {
  movement_type: string;
  quantity: number;
  total_cost: number | null;
  movement_date: string;
}

const colorClasses: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
};

export default function InventoryReportsPage() {
  const [stock, setStock] = useState<StockLite[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, mv] = await Promise.all([
        supabase
          .from('inventory_stock')
          .select('quantity, reserved_quantity, item:inventory_items(name,sku,uom,unit_cost,reorder_level), warehouse:inventory_warehouses(name)'),
        supabase
          .from('inventory_movements')
          .select('movement_type, quantity, total_cost, movement_date')
          .gte('movement_date', new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10)),
      ]);
      setStock((st.data || []) as unknown as StockLite[]);
      setMovements((mv.data || []) as unknown as MovementRow[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const valuation = useMemo(() => {
    const map: Record<string, { name: string; sku: string | null; uom: string; qty: number; value: number; unitCost: number }> = {};
    for (const s of stock) {
      if (!s.item) continue;
      const key = s.item.name;
      const e = (map[key] = map[key] || { name: s.item.name, sku: s.item.sku, uom: s.item.uom, qty: 0, value: 0, unitCost: Number(s.item.unit_cost) });
      e.qty += Number(s.quantity);
      e.value += Number(s.quantity) * Number(s.item.unit_cost);
    }
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [stock]);

  const byWarehouse = useMemo(() => {
    const map: Record<string, { name: string; qty: number; value: number }> = {};
    for (const s of stock) {
      const name = s.warehouse?.name || 'Unknown';
      const e = (map[name] = map[name] || { name, qty: 0, value: 0 });
      e.qty += Number(s.quantity);
      e.value += Number(s.quantity) * Number(s.item?.unit_cost || 0);
    }
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [stock]);

  const byType = useMemo(() => {
    const map: Record<string, { type: string; count: number; inQty: number; outQty: number; value: number }> = {};
    for (const m of movements) {
      const e = (map[m.movement_type] = map[m.movement_type] || { type: m.movement_type, count: 0, inQty: 0, outQty: 0, value: 0 });
      e.count += 1;
      const q = Number(m.quantity);
      if (q >= 0) e.inQty += q; else e.outQty += Math.abs(q);
      e.value += Number(m.total_cost || 0);
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [movements]);

  const totalValue = valuation.reduce((a, v) => a + v.value, 0);
  const totalUnits = valuation.reduce((a, v) => a + v.qty, 0);
  const lowCount = stock.filter((s) => s.item && Number(s.quantity) <= Number(s.item.reorder_level)).length;

  const cards = [
    { label: 'Stock Value', value: fmtMoney(totalValue), icon: DollarSign, color: 'success' },
    { label: 'Units On Hand', value: fmtQty(totalUnits), icon: Boxes, color: 'primary' },
    { label: 'Low Stock Rows', value: lowCount, icon: AlertTriangle, color: lowCount ? 'warning' : 'success' },
    { label: 'Warehouses', value: byWarehouse.length, icon: WarehouseIcon, color: 'info' },
  ];

  const exportValuation = () => {
    downloadCsv(
      csvFileName('inventory-valuation'),
      ['Item', 'SKU', 'UOM', 'Quantity', 'Unit Cost', 'Value'],
      valuation.map((v) => [v.name, v.sku || '', v.uom, v.qty, v.unitCost, v.value])
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Inventory Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Valuation, movement activity and warehouse breakdown</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportValuation} disabled={loading}>
          <Download className="mr-2 h-4 w-4" /> Export Valuation
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardContent className="p-5">
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', colorClasses[card.color])}>
                  <Icon className="h-5 w-5" />
                </div>
                {loading ? (
                  <div className="mt-3 h-7 w-20 animate-pulse rounded bg-muted" />
                ) : (
                  <p className="mt-3 text-2xl font-bold">{card.value}</p>
                )}
                <p className="text-sm text-muted-foreground">{card.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock Value by Warehouse</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}</div>
            ) : byWarehouse.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byWarehouse.map((w) => (
                    <TableRow key={w.name}>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell className="text-right">{fmtQty(w.qty)}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(w.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movement Activity (last 90 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}</div>
            ) : byType.length === 0 ? (
              <p className="text-sm text-muted-foreground">No movements in the last 90 days.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byType.map((t) => (
                    <TableRow key={t.type}>
                      <TableCell className="font-medium">{movementLabel(t.type)}</TableCell>
                      <TableCell className="text-right">{t.count}</TableCell>
                      <TableCell className="text-right text-success">{t.inQty ? `+${fmtQty(t.inQty)}` : '—'}</TableCell>
                      <TableCell className="text-right text-destructive">{t.outQty ? `-${fmtQty(t.outQty)}` : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stock Valuation</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">On Hand</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {[0, 1, 2, 3, 4].map((c) => (
                        <TableCell key={c}><div className="h-5 w-full animate-pulse rounded bg-muted" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : valuation.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                      No stock to value yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  valuation.map((v) => (
                    <TableRow key={v.name}>
                      <TableCell className="font-medium">{v.name}</TableCell>
                      <TableCell>{v.sku || '—'}</TableCell>
                      <TableCell className="text-right">{fmtQty(v.qty)} {v.uom}</TableCell>
                      <TableCell className="text-right">{fmtMoney(v.unitCost)}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(v.value)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {lowCount > 0 && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" /> Items At or Below Reorder Level
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border rounded-lg border border-border">
              {stock
                .filter((s) => s.item && Number(s.quantity) <= Number(s.item.reorder_level))
                .slice(0, 12)
                .map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{s.item?.name}</p>
                      <p className="text-xs text-muted-foreground">{s.warehouse?.name}</p>
                    </div>
                    <Badge variant="outline" className="bg-warning/10 text-warning">
                      {fmtQty(Number(s.quantity))} / {fmtQty(Number(s.item?.reorder_level || 0))} {s.item?.uom}
                    </Badge>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
