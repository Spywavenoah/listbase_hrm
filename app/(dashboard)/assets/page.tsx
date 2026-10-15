/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { Package, CheckCircle, Wrench, Car, ImagePlus, X, MapPin } from 'lucide-react';
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
import { PrintBarcodeButton } from '@/components/inventory/barcode';
import {
  ASSET_STATUSES,
  CONDITION_STATUSES,
  DEPRECIATION_METHODS,
  FUEL_TYPES,
  fmtMoney,
  type Asset,
  type AssetCategory,
} from '@/lib/assets';

const IMAGE_BUCKET = 'asset-images';

const EMPTY = {
  name: '',
  asset_type: '',
  serial_number: '',
  category_id: '',
  location: '',
  condition_status: 'GOOD',
  status: 'AVAILABLE',
  purchase_date: '',
  purchase_value: '',
  salvage_value: '',
  useful_life_years: '',
  depreciation_method: 'STRAIGHT_LINE',
  depreciation_rate: '',
  notes: '',
};

const EMPTY_VEHICLE = {
  plate_number: '',
  make: '',
  model: '',
  manufacture_year: '',
  fuel_type: 'PETROL',
  engine_capacity_cc: '',
  num_plugs: '',
  tank_capacity: '',
  odometer: '',
};

function depreciationPreview(f: typeof EMPTY) {
  const cost = Number(f.purchase_value) || 0;
  if (!cost || !f.purchase_date) return { dep: 0, book: cost, date: '' };
  const start = new Date(f.purchase_date + 'T00:00:00').getTime();
  const years = Math.max((Date.now() - start) / (365.25 * 24 * 3600 * 1000), 0);
  const salvage = Number(f.salvage_value) || 0;
  const life = Number(f.useful_life_years) || 0;
  const rate = Number(f.depreciation_rate) || 0;
  let dep = 0;
  let book = cost;
  if (f.depreciation_method === 'STRAIGHT_LINE' && life > 0) {
    const annual = Math.max(cost - salvage, 0) / life;
    dep = Math.min(annual * years, Math.max(cost - salvage, 0));
    book = cost - dep;
  } else if (f.depreciation_method === 'REDUCING_BALANCE' && rate > 0) {
    book = Math.max(cost * Math.pow(1 - rate / 100, years), salvage);
    dep = cost - book;
  }
  return { dep, book, date: new Date().toLocaleDateString() };
}

export default function AssetsPage() {
  const { can } = useAccess();
  const router = useRouter();
  const canManage = can('assets.manage') || can('admin.settings');

  const [rows, setRows] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [vehicle, setVehicle] = useState({ ...EMPTY_VEHICLE });
  const [showVehicle, setShowVehicle] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [aRes, cRes, eRes] = await Promise.all([
        supabase.from('assets').select('*, category_ref:asset_categories(name, code, asset_class)').order('created_at', { ascending: false }),
        supabase.from('asset_categories').select('*').order('name'),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE'),
      ]);
      setRows((aRes.data || []) as unknown as Asset[]);
      setCategories((cRes.data || []) as unknown as AssetCategory[]);
      setEmployees(eRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reset = () => {
    setForm({ ...EMPTY });
    setVehicle({ ...EMPTY_VEHICLE });
    setImageFile(null);
    setImagePreview(null);
    setShowVehicle(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const close = () => { setOpen(false); setEditing(null); reset(); };
  const openCreate = () => { setEditing(null); reset(); setOpen(true); };

  const openEdit = (a: Asset) => {
    setEditing(a);
    setForm({
      name: a.name,
      asset_type: a.asset_type || '',
      serial_number: a.serial_number || '',
      category_id: a.category_id || '',
      location: a.location || '',
      condition_status: a.condition_status || 'GOOD',
      status: a.status || 'AVAILABLE',
      purchase_date: a.purchase_date || '',
      purchase_value: a.purchase_value != null ? String(a.purchase_value) : '',
      salvage_value: a.salvage_value != null ? String(a.salvage_value) : '',
      useful_life_years: a.useful_life_years != null ? String(a.useful_life_years) : '',
      depreciation_method: a.depreciation_method || 'STRAIGHT_LINE',
      depreciation_rate: a.depreciation_rate != null ? String(a.depreciation_rate) : '',
      notes: a.notes || '',
    });
    setImageFile(null);
    setImagePreview(a.image_url || null);
    const cat = categories.find((c) => c.id === a.category_id);
    setShowVehicle(cat?.asset_class === 'AUTOMOBILE');
    supabase.from('asset_vehicle_profiles').select('*').eq('asset_id', a.id).maybeSingle().then(({ data }) => {
      const v = data as Record<string, unknown> | null;
      if (v) {
        setVehicle({
          plate_number: (v.plate_number as string) || '',
          make: (v.make as string) || '',
          model: (v.model as string) || '',
          manufacture_year: v.manufacture_year != null ? String(v.manufacture_year) : '',
          fuel_type: (v.fuel_type as string) || 'PETROL',
          engine_capacity_cc: v.engine_capacity_cc != null ? String(v.engine_capacity_cc) : '',
          num_plugs: v.num_plugs != null ? String(v.num_plugs) : '',
          tank_capacity: v.tank_capacity != null ? String(v.tank_capacity) : '',
          odometer: v.odometer != null ? String(v.odometer) : '',
        });
      }
    });
    setOpen(true);
  };

  const pickImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be 5 MB or smaller'); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async (assetId: string, file: File) => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${assetId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, path };
  };

  const selectedClass = () => categories.find((c) => c.id === form.category_id)?.asset_class;
  const isAuto = () => showVehicle || selectedClass() === 'AUTOMOBILE';

  const save = async () => {
    if (!form.name.trim()) { toast.error('Asset name is required'); return; }
    try {
      const payload = {
        name: form.name.trim(),
        asset_type: form.asset_type || null,
        serial_number: form.serial_number || null,
        category_id: form.category_id || null,
        location: form.location || null,
        condition_status: form.condition_status,
        status: form.status,
        purchase_date: form.purchase_date || null,
        purchase_value: form.purchase_value === '' ? null : Number(form.purchase_value),
        salvage_value: form.salvage_value === '' ? 0 : Number(form.salvage_value),
        useful_life_years: form.useful_life_years === '' ? null : Number(form.useful_life_years),
        depreciation_method: form.depreciation_method,
        depreciation_rate: form.depreciation_rate === '' ? null : Number(form.depreciation_rate),
        notes: form.notes || null,
      };

      let assetId = editing?.id;
      if (editing) {
        const { error } = await supabase.from('assets').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('assets').insert(payload).select('id').single();
        if (error) throw error;
        assetId = (data as { id: string }).id;
      }

      if (imageFile && assetId) {
        const up = await uploadImage(assetId, imageFile);
        const { error } = await supabase.from('assets').update({ image_url: up.url, image_path: up.path }).eq('id', assetId);
        if (error) throw error;
        if (editing?.image_path && editing.image_path !== up.path) {
          await supabase.storage.from(IMAGE_BUCKET).remove([editing.image_path]);
        }
      }

      if (isAuto() && assetId) {
        const profile = {
          asset_id: assetId,
          plate_number: vehicle.plate_number || null,
          make: vehicle.make || null,
          model: vehicle.model || null,
          manufacture_year: vehicle.manufacture_year ? Number(vehicle.manufacture_year) : null,
          fuel_type: vehicle.fuel_type,
          engine_capacity_cc: vehicle.engine_capacity_cc === '' ? null : Number(vehicle.engine_capacity_cc),
          num_plugs: vehicle.num_plugs === '' ? null : Number(vehicle.num_plugs),
          tank_capacity: vehicle.tank_capacity === '' ? null : Number(vehicle.tank_capacity),
          odometer: Number(vehicle.odometer) || 0,
        };
        const { error } = await supabase.from('asset_vehicle_profiles').upsert(profile, { onConflict: 'asset_id' });
        if (error) throw error;
      }

      toast.success(editing ? 'Asset updated' : 'Asset added');
      close();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const remove = async (a: Asset) => {
    try {
      const { error } = await supabase.from('assets').delete().eq('id', a.id);
      if (error) throw error;
      if (a.image_path) await supabase.storage.from(IMAGE_BUCKET).remove([a.image_path]);
      toast.success('Asset deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const empName = (id: string | null) => {
    if (!id) return '—';
    const e = employees.find((x) => x.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };

  const statusColors: Record<string, string> = {
    AVAILABLE: 'bg-success/10 text-success',
    ASSIGNED: 'bg-primary/10 text-primary',
    IN_REPAIR: 'bg-warning/10 text-warning',
    RETIRED: 'bg-destructive/10 text-destructive',
  };

  const isVehicle = (a: Asset) => a.category_ref?.asset_class === 'AUTOMOBILE';
  const preview = depreciationPreview(form);

  const summaryCards: SummaryCard[] = [
    { label: 'Total Assets', value: rows.length, icon: Package, color: 'primary' },
    { label: 'Vehicles', value: rows.filter(isVehicle).length, icon: Car, color: 'info' },
    { label: 'Available', value: rows.filter((a) => a.status === 'AVAILABLE').length, icon: CheckCircle, color: 'success' },
    { label: 'In Repair', value: rows.filter((a) => a.status === 'IN_REPAIR').length, icon: Wrench, color: 'warning' },
  ];

  const columns: Column<Asset>[] = [
    {
      key: 'image',
      label: '',
      searchable: false,
      exportValue: () => '',
      render: (a) => a.image_url
        ? <img src={a.image_url} alt={a.name} className="h-9 w-9 rounded-md border border-border object-cover" />
        : <div className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground"><ImagePlus className="h-4 w-4" /></div>,
    },
    { key: 'asset_tag', label: 'Asset No.', render: (a) => a.asset_tag ? <span className="font-mono text-xs">{a.asset_tag}</span> : '—' },
    { key: 'name', label: 'Name', render: (a) => <span className="font-medium">{a.name}</span> },
    { key: 'category', label: 'Category', render: (a) => a.category_ref?.name || '—', searchText: (a) => [a.category_ref?.name || ''] },
    { key: 'location', label: 'Location', render: (a) => a.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{a.location}</span> : '—' },
    { key: 'purchase_value', label: 'Cost', render: (a) => fmtMoney(a.purchase_value) },
    { key: 'book_value', label: 'Book Value', render: (a) => fmtMoney(a.book_value ?? a.current_value) },
    { key: 'assigned_to', label: 'Assigned To', render: (a) => empName(a.assigned_to), searchable: false },
    { key: 'status', label: 'Status', render: (a) => <Badge variant="outline" className={statusColors[a.status] || ''}>{a.status}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Asset Register"
        description="Automobiles, plant & machinery, ICT equipment and other company assets"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search assets, tags, locations..."
        createLabel="Add Asset"
        onCreate={canManage ? openCreate : undefined}
        onEdit={canManage ? openEdit : undefined}
        onDelete={canManage ? remove : undefined}
        onRowClick={(a) => router.push(`/assets/${a.id}`)}
        rowActions={(a) => (a.barcode ? <PrintBarcodeButton value={a.barcode} label={a.name} /> : null)}
        emptyMessage="No assets yet."
        emptyDescription="Add your first asset to start tracking its lifecycle."
      />

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit Asset' : 'Add Asset'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="space-y-1.5">
                <Label>Asset Picture</Label>
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
                <Label>Asset Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Toyota Hilux" />
                <Label className="pt-2">Asset Type</Label>
                <Input value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })} placeholder="Pickup truck" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category_id || '__none__'} onValueChange={(v) => {
                  setForm({ ...form, category_id: v === '__none__' ? '' : v });
                  const cls = categories.find((c) => c.id === v)?.asset_class;
                  if (cls === 'AUTOMOBILE') setShowVehicle(true);
                }}>
                  <SelectTrigger><SelectValue placeholder="Uncategorised" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Uncategorised</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.asset_class === 'AUTOMOBILE' ? ' · vehicle' : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Serial Number</Label>
                <Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Head Office / Yard" />
              </div>
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <Select value={form.condition_status} onValueChange={(v) => setForm({ ...form, condition_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONDITION_STATUSES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Purchase Cost</Label>
                <Input type="number" min="0" step="0.01" value={form.purchase_value} onChange={(e) => setForm({ ...form, purchase_value: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Purchase Date</Label>
                <Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Salvage Value</Label>
                <Input type="number" min="0" step="0.01" value={form.salvage_value} onChange={(e) => setForm({ ...form, salvage_value: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Depreciation Method</Label>
                <Select value={form.depreciation_method} onValueChange={(v) => setForm({ ...form, depreciation_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEPRECIATION_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Useful Life (years)</Label>
                <Input type="number" min="0" step="0.5" value={form.useful_life_years} onChange={(e) => setForm({ ...form, useful_life_years: e.target.value })} placeholder="8" />
              </div>
              <div className="space-y-1.5">
                <Label>Rate (%)</Label>
                <Input type="number" min="0" step="0.5" value={form.depreciation_rate} onChange={(e) => setForm({ ...form, depreciation_rate: e.target.value })} placeholder="25" />
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Asset number and barcode are generated automatically on save.
              {form.purchase_value && form.depreciation_method !== 'NONE' && (
                <span className="block pt-1">
                  Depreciation to date: <span className="font-medium text-foreground">{fmtMoney(preview.dep)}</span>
                  {' · '}Book value: <span className="font-medium text-foreground">{fmtMoney(preview.book)}</span>
                  {' · '}Valuation date {preview.date || '—'}
                </span>
              )}
            </div>

            {(isAuto() || selectedClass() === 'AUTOMOBILE') && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Vehicle Details</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowVehicle(!showVehicle)}>
                    {showVehicle ? 'Hide' : 'Show'}
                  </Button>
                </div>
                {showVehicle && (
                  <div className="space-y-3">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Plate Number</Label>
                        <Input value={vehicle.plate_number} onChange={(e) => setVehicle({ ...vehicle, plate_number: e.target.value })} placeholder="ABC-123" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Make</Label>
                        <Input value={vehicle.make} onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })} placeholder="Toyota" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Model</Label>
                        <Input value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} placeholder="Hilux" />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <div className="space-y-1.5">
                        <Label>Year</Label>
                        <Input type="number" value={vehicle.manufacture_year} onChange={(e) => setVehicle({ ...vehicle, manufacture_year: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Fuel</Label>
                        <Select value={vehicle.fuel_type} onValueChange={(v) => setVehicle({ ...vehicle, fuel_type: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FUEL_TYPES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Engine (cc)</Label>
                        <Input type="number" value={vehicle.engine_capacity_cc} onChange={(e) => setVehicle({ ...vehicle, engine_capacity_cc: e.target.value })} placeholder="1500" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Plugs</Label>
                        <Input type="number" value={vehicle.num_plugs} onChange={(e) => setVehicle({ ...vehicle, num_plugs: e.target.value })} placeholder="4" />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Tank Capacity (L)</Label>
                        <Input type="number" value={vehicle.tank_capacity} onChange={(e) => setVehicle({ ...vehicle, tank_capacity: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Odometer (km)</Label>
                        <Input type="number" value={vehicle.odometer} onChange={(e) => setVehicle({ ...vehicle, odometer: e.target.value })} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button onClick={save} disabled={!form.name.trim()}>{editing ? 'Save Changes' : 'Add Asset'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
