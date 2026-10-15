'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { UOMS } from '@/lib/procurement';

export interface LineItem {
  id: string;
  item_name: string;
  description?: string;
  quantity: number;
  uom: string;
  unit_price: number;
  total: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  uom: string | null;
  unit_price: number;
  description: string | null;
}

export interface LineItemsEditorProps {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  showUom?: boolean;
  showPrice?: boolean;
  priceLabel?: string;
  catalog?: CatalogItem[];
  catalogListId?: string;
}

const parseNum = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

export function LineItemsEditor({
  items,
  onChange,
  showUom = true,
  showPrice = true,
  priceLabel = 'Unit price',
  catalog,
  catalogListId = 'master-items-list',
}: LineItemsEditorProps) {
  const [raw, setRaw] = useState<Record<string, { quantity?: string; unit_price?: string }>>({});

  const addItem = () => {
    onChange([
      ...items,
      { id: `tmp-${Date.now()}-${items.length}`, item_name: '', quantity: 1, uom: 'EA', unit_price: 0, total: 0 },
    ]);
  };

  const applyCatalog = (id: string, name: string) => {
    const match = catalog?.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!match) {
      updateItem(id, { item_name: name });
      return;
    }
    updateItem(id, {
      item_name: match.name,
      uom: match.uom || 'EA',
      unit_price: Number(match.unit_price) || 0,
      description: match.description || undefined,
    });
  };

  const updateItem = (id: string, patch: Partial<LineItem>) => {
    onChange(
      items.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        next.total = Number((Number(next.quantity) * Number(next.unit_price)).toFixed(2));
        return next;
      })
    );
  };

  const handleQty = (id: string, rawValue: string) => {
    setRaw((r) => ({ ...r, [id]: { ...r[id], quantity: rawValue } }));
    updateItem(id, { quantity: parseNum(rawValue) });
  };

  const handlePrice = (id: string, rawValue: string) => {
    setRaw((r) => ({ ...r, [id]: { ...r[id], unit_price: rawValue } }));
    updateItem(id, { unit_price: parseNum(rawValue) });
  };

  const clearRaw = (id: string, field: 'quantity' | 'unit_price') => {
    setRaw((r) => {
      const entry = r[id];
      if (!entry || !entry[field]) return r;
      const { [field]: _omit, ...rest } = entry;
      return { ...r, [id]: rest };
    });
  };

  const removeItem = (id: string) => onChange(items.filter((it) => it.id !== id));

  const gridCols = showUom && showPrice
    ? 'sm:grid-cols-[1fr_80px_110px_110px_36px]'
    : showUom
      ? 'sm:grid-cols-[1fr_80px_36px]'
      : showPrice
        ? 'sm:grid-cols-[1fr_80px_110px_36px]'
        : 'sm:grid-cols-[1fr_80px_36px]';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Line Items *</Label>
        <Button size="sm" variant="outline" onClick={addItem}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add Item
        </Button>
      </div>
      {items.map((it) => {
        const qtyValue = raw[it.id]?.quantity ?? String(it.quantity);
        const priceValue = raw[it.id]?.unit_price ?? String(it.unit_price);
        return (
          <div key={it.id} className={`grid gap-2 rounded-lg border border-border p-3 ${gridCols}`}>
            <div className="space-y-1">
              <Input
                placeholder="Item name"
                list={catalog ? catalogListId : undefined}
                value={it.item_name}
                onChange={(e) => (catalog ? applyCatalog(it.id, e.target.value) : updateItem(it.id, { item_name: e.target.value }))}
              />
              <Input
                placeholder="Description (optional)"
                value={it.description || ''}
                onChange={(e) => updateItem(it.id, { description: e.target.value })}
              />
            </div>
            <Input
              type="number"
              placeholder="Qty"
              value={qtyValue}
              onBlur={() => clearRaw(it.id, 'quantity')}
              onChange={(e) => handleQty(it.id, e.target.value)}
            />
            {showUom && (
              <Select value={it.uom} onValueChange={(v) => updateItem(it.id, { uom: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UOMS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {showPrice && (
              <Input
                type="number"
                step="0.01"
                placeholder={priceLabel}
                title={priceLabel}
                value={priceValue}
                onBlur={() => clearRaw(it.id, 'unit_price')}
                onChange={(e) => handlePrice(it.id, e.target.value)}
              />
            )}
            <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => removeItem(it.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">No items yet. Add at least one line item.</p>
      )}
      {catalog && catalog.length > 0 && (
        <datalist id={catalogListId}>
          {catalog.map((c) => (
            <option key={c.id} value={c.name}>
              {c.uom ? `(${c.uom}) ` : ''}
              {formatMoney(c.unit_price)}
            </option>
          ))}
        </datalist>
      )}
    </div>
  );
}

function formatMoney(n: number) {
  return `$${Number(n || 0).toLocaleString()}`;
}