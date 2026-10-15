/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { Package, CheckCircle, XCircle, DollarSign, ImagePlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { UOM_OPTIONS, fmtMoney, fmtQty, type InventoryCategory, type InventoryItem } from '@/lib/inventory';

const IMAGE_BUCKET = 'inventory-items';

const EMPTY = {
  name: '',
  sku: '',
  barcode: '',
  category_id: '',
  uom: 'EA',
  unit_cost: '',
  reorder_level: '0',
  reorder_quantity: '0',
  max_stock_level: '',
  expiry_warning_days: '30',
  description: '',
  is_tracked: false,
  is_active: true,
};

export default function InventoryItemsPage() {
  const { can } = useAccess();
  const router = useRouter();
  const canManage = can('inventory.manage');
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [items, cats] = await Promise.all([
        supabase.from('inventory_items').select('*, category:inventory_categories(name)').order('name'),
        supabase.from('inventory_categories').select('*').eq('is_active', true).order('name'),
      ]);
      setRows((items.data || []) as unknown as InventoryItem[]);
      setCategories((cats.data || []) as unknown as InventoryCategory[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => {
    setOpen(false);
    setEditing(null);
    setForm({ ...EMPTY });
    setImageFile(null);
    setImagePreview(null);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setImageFile(null);
    setImagePreview(null);
    setOpen(true);
  };

  const openEdit = (i: InventoryItem) => {
    setEditing(i);
    setForm({
      name: i.name,
      sku: i.sku || '',
      barcode: i.barcode || '',
      category_id: i.category_id || '',
      uom: i.uom || 'EA',
      unit_cost: String(i.unit_cost ?? ''),
      reorder_level: String(i.reorder_level ?? 0),
      reorder_quantity: String(i.reorder_quantity ?? 0),
      max_stock_level: i.max_stock_level != null ? String(i.max_stock_level) : '',
      expiry_warning_days: String(i.expiry_warning_days ?? 30),
      description: i.description || '',
      is_tracked: i.is_tracked,
      is_active: i.is_active,
    });
    setImageFile(null);
    setImagePreview(i.image_url || null);
    setOpen(true);
  };

  const pickImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be 5 MB or smaller'); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async (itemId: string, file: File) => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${itemId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Item name is required'); return; }
    const maxLevel = form.max_stock_level === '' ? null : Number(form.max_stock_level);
    const lowLevel = Number(form.reorder_level) || 0;
    if (maxLevel != null && maxLevel > 0 && maxLevel <= lowLevel) {
      toast.error('Over-stock threshold must be greater than the low-stock threshold');
      return;
    }
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku || null,
        barcode: form.barcode.trim() || null,
        category_id: form.category_id || null,
        uom: form.uom || 'EA',
        unit_cost: Number(form.unit_cost) || 0,
        reorder_level: lowLevel,
        reorder_quantity: Number(form.reorder_quantity) || 0,
        max_stock_level: maxLevel,
        expiry_warning_days: Number(form.expiry_warning_days) || 0,
        description: form.description || null,
        is_tracked: form.is_tracked,
        is_active: form.is_active,
      };

      let itemId = editing?.id;
      if (editing) {
        const { error } = await supabase.from('inventory_items').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('inventory_items').insert(payload).select('id').single();
        if (error) throw error;
        itemId = (data as { id: string }).id;
      }

      if (imageFile && itemId) {
        const url = await uploadImage(itemId, imageFile);
        const { error } = await supabase.from('inventory_items').update({ image_url: url }).eq('id', itemId);
        if (error) throw error;
      }

      toast.success(editing ? 'Item updated' : 'Item added');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (i: InventoryItem) => {
    try {
      const { error } = await supabase.from('inventory_items').delete().eq('id', i.id);
      if (error) throw error;
      toast.success('Item deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Items', value: rows.length, icon: Package, color: 'primary' },
    { label: 'Active', value: rows.filter((r) => r.is_active).length, icon: CheckCircle, color: 'success' },
    { label: 'Inactive', value: rows.filter((r) => !r.is_active).length, icon: XCircle, color: 'destructive' },
    { label: 'Avg Unit Cost', value: fmtMoney(rows.length ? rows.reduce((a, i) => a + Number(i.unit_cost), 0) / rows.length : 0), icon: DollarSign, color: 'info' },
  ];

  const columns: Column<InventoryItem>[] = [
    {
      key: 'image',
      label: '',
      searchable: false,
      exportValue: () => '',
      render: (i) => i.image_url
        ? <img src={i.image_url} alt={i.name} className="h-9 w-9 rounded-md border border-border object-cover" />
        : <div className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground"><ImagePlus className="h-4 w-4" /></div>,
    },
    { key: 'name', label: 'Item', render: (i) => <span className="font-medium">{i.name}</span> },
    { key: 'sku', label: 'SKU', render: (i) => i.sku ? <span className="font-mono text-xs">{i.sku}</span> : '—' },
    { key: 'barcode', label: 'Barcode', render: (i) => i.barcode ? <span className="font-mono text-xs">{i.barcode}</span> : '—' },
    { key: 'category', label: 'Category', render: (i) => i.category?.name || '—' },
    { key: 'uom', label: 'UOM', render: (i) => i.uom },
    { key: 'unit_cost', label: 'Unit Cost', render: (i) => fmtMoney(i.unit_cost) },
    { key: 'reorder_level', label: 'Low / Over', render: (i) => `${fmtQty(i.reorder_level)} / ${i.max_stock_level != null ? fmtQty(i.max_stock_level) : '—'}` },
    {
      key: 'is_active',
      label: 'Status',
      render: (i) => i.is_active
        ? <Badge variant="outline" className="bg-success/10 text-success">Active</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Inventory Items"
        description="Stockable items tracked across your warehouses"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search items..."
        createLabel="Add Item"
        onCreate={canManage ? openCreate : undefined}
        onEdit={canManage ? openEdit : undefined}
        onDelete={canManage ? remove : undefined}
        onRowClick={(i) => router.push(`/inventory/items/${i.id}`)}
        emptyMessage="No inventory items yet."
        emptyDescription="Add items to begin tracking stock."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit Item' : 'Add Item'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="space-y-1.5">
                <Label>Product Picture</Label>
                <div className="flex items-center gap-3">
                  <div className="relative h-24 w-24 overflow-hidden rounded-lg border border-border bg-muted">
                    {imagePreview
                      ? <img src={imagePreview} alt="preview" className="h-full w-full object-cover" />
                      : <div className="flex h-full w-full items-center justify-center text-muted-foreground"><ImagePlus className="h-6 w-6" /></div>}
                  </div>
                  <div className="space-y-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => pickImage(e.target.files?.[0] || null)}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                      <ImagePlus className="mr-1.5 h-4 w-4" /> Choose image
                    </Button>
                    {imagePreview && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setImageFile(null); setImagePreview(null); }}>
                        <X className="mr-1.5 h-4 w-4" /> Remove
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">PNG, JPG or WEBP · max 5 MB</p>
                  </div>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Item Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="A4 Paper Ream" />
                <Label className="pt-2">Description</Label>
                <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>SKU / Code</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="STA-0001" />
              </div>
              <div className="space-y-1.5">
                <Label>Barcode</Label>
                <Input
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  placeholder="Auto-generated if left blank"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category_id || '__none__'} onValueChange={(v) => setForm({ ...form, category_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Uncategorised" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Uncategorised</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Unit of Measure</Label>
                <Select value={form.uom} onValueChange={(v) => setForm({ ...form, uom: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UOM_OPTIONS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Unit Cost</Label>
                <Input type="number" min="0" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Reorder Qty</Label>
                <Input type="number" min="0" step="0.01" value={form.reorder_quantity} onChange={(e) => setForm({ ...form, reorder_quantity: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Low-stock threshold</Label>
                <Input type="number" min="0" step="0.01" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Over-stock threshold</Label>
                <Input type="number" min="0" step="0.01" value={form.max_stock_level} onChange={(e) => setForm({ ...form, max_stock_level: e.target.value })} placeholder="No limit" />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry warning (days)</Label>
                <Input type="number" min="0" step="1" value={form.expiry_warning_days} onChange={(e) => setForm({ ...form, expiry_warning_days: e.target.value })} />
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <span className="text-sm text-muted-foreground">Active</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_tracked} onCheckedChange={(v) => setForm({ ...form, is_tracked: v })} />
                <span className="text-sm text-muted-foreground">Batch / serial tracked</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.name.trim()}>{editing ? 'Save Changes' : 'Add Item'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
