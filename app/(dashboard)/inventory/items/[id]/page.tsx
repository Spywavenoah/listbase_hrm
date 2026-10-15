/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Barcode, PrintBarcodeButton } from '@/components/inventory/barcode';
import { ArrowLeft, ImagePlus, AlertTriangle, Package } from 'lucide-react';
import { fmtDate, fmtMoney, fmtQty, movementLabel, movementSign, type InventoryItem, type Movement, type StockRow } from '@/lib/inventory';

export default function InventoryItemDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const itemId = params?.id as string;
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const [iRes, sRes, mRes, empRes] = await Promise.all([
        supabase.from('inventory_items').select('*, category:inventory_categories(name)').eq('id', itemId).single(),
        supabase.from('inventory_stock').select('*, warehouse:inventory_warehouses(name)').eq('item_id', itemId).order('quantity', { ascending: false }),
        supabase.from('inventory_movements').select('*, warehouse:inventory_warehouses!inventory_movements_warehouse_id_fkey(name)').eq('item_id', itemId).order('created_at', { ascending: false }).limit(50),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      setItem((iRes.data || null) as unknown as InventoryItem | null);
      setStock((sRes.data || []) as unknown as StockRow[]);
      setMovements((mRes.data || []) as unknown as Movement[]);
      const map: Record<string, string> = {};
      for (const e of (empRes.data || []) as { id: string; name: string }[]) map[e.id] = e.name;
      setNames(map);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { load(); }, [load]);

  const totalOnHand = useMemo(() => stock.reduce((s, r) => s + Number(r.quantity), 0), [stock]);
  const totalValue = useMemo(() => totalOnHand * Number(item?.unit_cost || 0), [totalOnHand, item]);

  const expiryAlerts = useMemo(() => {
    if (!item) return [];
    const warnDays = Number(item.expiry_warning_days ?? 30);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + warnDays);
    return stock
      .filter((r) => r.expiry_date)
      .map((r) => ({
        row: r,
        expired: new Date(r.expiry_date as string) < new Date(),
        days: Math.ceil((new Date(r.expiry_date as string).getTime() - Date.now()) / 86400000),
      }))
      .filter((a) => new Date(a.row.expiry_date as string) <= cutoff)
      .sort((a, b) => String(a.row.expiry_date).localeCompare(String(b.row.expiry_date)));
  }, [stock, item]);

  const lowStock = item ? totalOnHand <= Number(item.reorder_level || 0) : false;
  const overStock = item?.max_stock_level != null && totalOnHand >= Number(item.max_stock_level);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading item...</div>;
  }
  if (!item) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Item not found.</p>
        <Button variant="outline" onClick={() => router.push('/inventory/items')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to items
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push('/inventory/items')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Items
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {lowStock && <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Low stock</Badge>}
          {overStock && <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">Over-stocked</Badge>}
          {item.is_active
            ? <Badge variant="outline" className="bg-success/10 text-success">Active</Badge>
            : <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="flex flex-col gap-6 pt-6 sm:flex-row">
            <div className="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
              {item.image_url
                ? <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
                : <div className="flex flex-col items-center gap-1 text-muted-foreground"><ImagePlus className="h-8 w-8" /><span className="text-xs">No picture</span></div>}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h1 className="text-xl font-semibold">{item.name}</h1>
                <p className="text-sm text-muted-foreground">{item.category?.name || 'Uncategorised'} · {item.uom}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Detail label="SKU" value={item.sku || '—'} />
                <Detail label="Unit cost" value={fmtMoney(item.unit_cost)} />
                <Detail label="Low-stock threshold" value={fmtQty(item.reorder_level)} />
                <Detail label="Over-stock threshold" value={item.max_stock_level != null ? fmtQty(item.max_stock_level) : '—'} />
                <Detail label="Reorder qty" value={fmtQty(item.reorder_quantity)} />
                <Detail label="Tracked" value={item.is_tracked ? 'Batch / serial' : 'No'} />
              </div>
              {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3">
                {item.barcode
                  ? <Barcode value={item.barcode} label={item.name} height={56} moduleWidth={2} />
                  : <span className="text-sm text-muted-foreground">No barcode</span>}
                {item.barcode && <PrintBarcodeButton value={item.barcode} label={item.name} />}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Balance</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              <p className="text-3xl font-semibold">{fmtQty(totalOnHand)} <span className="text-base font-normal text-muted-foreground">{item.uom}</span></p>
              <p className="text-sm text-muted-foreground">Value on hand: {fmtMoney(totalValue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Expiry alerts</CardTitle></CardHeader>
            <CardContent>
              {expiryAlerts.length === 0
                ? <p className="text-sm text-muted-foreground">No upcoming expiries.</p>
                : (
                  <ul className="space-y-2">
                    {expiryAlerts.map((a) => (
                      <li key={a.row.id} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle className={`h-4 w-4 ${a.expired ? 'text-destructive' : 'text-warning'}`} />
                          {a.row.warehouse?.name || 'Warehouse'}
                        </span>
                        <span className={a.expired ? 'text-destructive' : 'text-muted-foreground'}>
                          {fmtDate(a.row.expiry_date)} {a.expired ? '(expired)' : `(${a.days}d)`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Stock by warehouse (rack balance)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Warehouse</TableHead>
                <TableHead>Rack / Bin</TableHead>
                <TableHead>On hand</TableHead>
                <TableHead>Reserved</TableHead>
                <TableHead>Expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No stock recorded.</TableCell></TableRow>
              )}
              {stock.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.warehouse?.name || '—'}</TableCell>
                  <TableCell>{r.bin_location || '—'}</TableCell>
                  <TableCell>{fmtQty(r.quantity)}</TableCell>
                  <TableCell>{fmtQty(r.reserved_quantity)}</TableCell>
                  <TableCell>{fmtDate(r.expiry_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Item history</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">No movements yet.</TableCell></TableRow>
              )}
              {movements.map((m) => {
                const sign = movementSign(m.movement_type);
                return (
                  <TableRow key={m.id}>
                    <TableCell>{fmtDate(m.movement_date || m.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="flex w-fit items-center gap-1">
                        <Package className="h-3 w-3" /> {movementLabel(m.movement_type)}
                      </Badge>
                    </TableCell>
                    <TableCell>{m.warehouse?.name || '—'}</TableCell>
                    <TableCell className={sign === 'out' ? 'text-destructive' : sign === 'in' ? 'text-success' : ''}>
                      {sign === 'out' ? '-' : sign === 'in' ? '+' : ''}{fmtQty(Math.abs(Number(m.quantity)))}
                    </TableCell>
                    <TableCell>{fmtQty(m.resulting_quantity)}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs">{m.reference || '—'}</TableCell>
                    <TableCell className="text-xs">{m.performed_by ? names[m.performed_by] || '—' : '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
