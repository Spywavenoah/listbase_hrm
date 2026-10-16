'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { ClipboardList, Plus, Trash2, PackageCheck, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
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
import { startWorkflow, setWorkflowActors } from '@/lib/workflow/engine';
import {
  MATERIAL_PRIORITIES,
  MATERIAL_USAGE_CATEGORIES,
  fmtDate,
  fmtQty,
  type InventoryItem,
  type MaterialRequest,
  type MaterialRequestItem,
} from '@/lib/inventory';

interface Warehouse { id: string; name: string; is_default: boolean }
interface Department { id: string; name: string }
interface ProjectRef { id: string; code: string | null; name: string }
interface Line { item_id: string; quantity: string; notes: string }

const EMPTY_FORM = {
  warehouse_id: '',
  department_id: '',
  usage_category: '',
  project_id: '',
  purpose: '',
  required_date: '',
  priority: 'NORMAL',
  notes: '',
};

const usageLabel = (value: string | null) =>
  MATERIAL_USAGE_CATEGORIES.find((u) => u.value === value)?.label ?? '—';

const statusClass = (status: string) => {
  switch (status) {
    case 'APPROVED': return 'bg-success/10 text-success border-success/30';
    case 'ISSUED': return 'bg-primary/10 text-primary border-primary/30';
    case 'REJECTED': return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'CANCELLED': return 'bg-muted text-muted-foreground';
    default: return 'bg-warning/10 text-warning border-warning/30';
  }
};

export default function MaterialRequestsPage() {
  const { can, employee } = useAccess();
  const canRequest = can('inventory.request') || can('inventory.manage');
  const canIssue = can('inventory.issue') || can('inventory.manage');

  const [rows, setRows] = useState<MaterialRequest[]>([]);
  const [itemsByReq, setItemsByReq] = useState<Record<string, MaterialRequestItem[]>>({});
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [issueTarget, setIssueTarget] = useState<MaterialRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [lines, setLines] = useState<Line[]>([{ item_id: '', quantity: '', notes: '' }]);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, iRes, itemsRes, wRes, dRes, sRes, empRes] = await Promise.all([
        supabase.from('material_requests').select('*, warehouse:inventory_warehouses(name)').order('created_at', { ascending: false }),
        supabase.from('material_request_items').select('*'),
        supabase.from('inventory_items').select('*').eq('is_active', true).order('name'),
        supabase.from('inventory_warehouses').select('id, name, is_default').eq('is_active', true).order('name'),
        supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
        supabase.from('inventory_stock').select('item_id, warehouse_id, quantity'),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      const { data: projData } = await supabase.from('projects').select('id, code, name').order('name');
      setProjects((projData || []) as unknown as ProjectRef[]);
      setRows((rRes.data || []) as unknown as MaterialRequest[]);
      const grouped: Record<string, MaterialRequestItem[]> = {};
      for (const it of (iRes.data || []) as unknown as MaterialRequestItem[]) {
        (grouped[it.request_id] = grouped[it.request_id] || []).push(it);
      }
      setItemsByReq(grouped);
      setItems((itemsRes.data || []) as unknown as InventoryItem[]);
      setWarehouses((wRes.data || []) as unknown as Warehouse[]);
      setDepartments((dRes.data || []) as unknown as Department[]);
      const map: Record<string, number> = {};
      for (const s of (sRes.data || []) as { item_id: string; warehouse_id: string; quantity: number }[]) {
        map[`${s.item_id}:${s.warehouse_id}`] = Number(s.quantity) || 0;
      }
      setStockMap(map);
      const names: Record<string, string> = {};
      for (const e of (empRes.data || []) as { id: string; name: string }[]) names[e.id] = e.name;
      setEmployeeNames(names);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const available = (itemId: string, warehouseId: string) => {
    if (!itemId || !warehouseId) return 0;
    return stockMap[`${itemId}:${warehouseId}`] ?? 0;
  };

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, warehouse_id: warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || '' });
    setLines([{ item_id: '', quantity: '', notes: '' }]);
    setErrors({});
    setCreateOpen(true);
  };

  const validate = (): boolean => {
    const errs: Record<number, string> = {};
    const valid = lines.filter((l) => l.item_id || l.quantity);
    if (valid.length === 0) { toast.error('Add at least one item to the request'); return false; }
    if (!form.warehouse_id) { toast.error('Select a warehouse to release from'); return false; }
    if (!form.usage_category) { toast.error('Select a usage category'); return false; }
    if (form.usage_category === 'PROJECT' && !form.project_id) { toast.error('Select the project this request is for'); return false; }

    lines.forEach((l, idx) => {
      if (!l.item_id && !l.quantity) return;
      const qty = Number(l.quantity) || 0;
      const item = items.find((i) => i.id === l.item_id);
      if (!l.item_id) { errs[idx] = 'Select an item'; return; }
      if (qty <= 0) { errs[idx] = 'Enter a quantity greater than zero'; return; }
      const avail = available(l.item_id, form.warehouse_id);
      if (avail <= 0) {
        errs[idx] = `${item?.name || 'This item'} has zero balance — request it via procurement instead`;
        return;
      }
      if (qty > avail) {
        errs[idx] = `Only ${fmtQty(avail)} available — reduce the quantity or request procurement for the shortfall`;
      }
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please resolve the highlighted lines');
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const number = refNumber('MR');
      const { data, error } = await supabase.from('material_requests').insert({
        request_number: number,
        requested_by: employee?.id || null,
        department_id: form.department_id || null,
        warehouse_id: form.warehouse_id,
        usage_category: form.usage_category || null,
        project_id: form.usage_category === 'PROJECT' ? form.project_id || null : null,
        purpose: form.purpose || null,
        required_date: form.required_date || null,
        priority: form.priority,
        status: 'PENDING',
        notes: form.notes || null,
      }).select().single();
      if (error) throw error;
      const request = data as unknown as MaterialRequest;

      const lineRows = lines
        .filter((l) => l.item_id && Number(l.quantity) > 0)
        .map((l) => ({
          request_id: request.id,
          item_id: l.item_id,
          item_name: items.find((i) => i.id === l.item_id)?.name || 'Item',
          uom: items.find((i) => i.id === l.item_id)?.uom || null,
          quantity_requested: Number(l.quantity) || 0,
          notes: l.notes || null,
        }));
      const { error: ie } = await supabase.from('material_request_items').insert(lineRows);
      if (ie) throw ie;

      const instanceId = await startWorkflow('inventory.material_request', request.id, employee?.id || '');
      if (!instanceId) {
        await supabase.from('material_requests').update({ status: 'CANCELLED' }).eq('id', request.id);
        toast.warning('No approval workflow is enabled for material requests — request was not submitted');
        setCreateOpen(false);
        load();
        return;
      }
      await setWorkflowActors('inventory.material_request', request.id, null, null);

      toast.success(`Material request ${number} submitted for approval`);
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const issue = async (row: MaterialRequest) => {
    try {
      const { data, error } = await supabase.rpc('issue_material_request', { p_request_id: row.id });
      if (error) throw error;
      toast.success(`Issued ${Number(data) || 0} line(s); stock deducted`);
      setIssueTarget(null);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Requests', value: rows.length, icon: ClipboardList, color: 'primary' },
    { label: 'Pending', value: rows.filter((r) => r.status === 'PENDING').length, icon: Clock, color: 'warning' },
    { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length, icon: CheckCircle, color: 'success' },
    { label: 'Issued', value: rows.filter((r) => r.status === 'ISSUED').length, icon: PackageCheck, color: 'info' },
  ];

  const lineCount = (id: string) => (itemsByReq[id] || []).length;

  const projectLabel = (id: string | null) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return '—';
    return p.code ? `${p.code} · ${p.name}` : p.name;
  };

  const columns: Column<MaterialRequest>[] = [
    { key: 'request_number', label: 'Request', render: (r) => <span className="font-medium">{r.request_number}</span> },
    { key: 'requested_by', label: 'Requested By', render: (r) => (r.requested_by ? employeeNames[r.requested_by] || '—' : '—') },
    { key: 'warehouse', label: 'Warehouse', render: (r) => r.warehouse?.name || '—' },
    {
      key: 'usage_category',
      label: 'Usage',
      render: (r) => (
        <div className="flex flex-col">
          <span>{usageLabel(r.usage_category)}</span>
          {r.usage_category === 'PROJECT' && r.project_id && (
            <span className="text-xs text-muted-foreground">{projectLabel(r.project_id)}</span>
          )}
        </div>
      ),
      searchText: (r) => [usageLabel(r.usage_category), r.project_id ? projectLabel(r.project_id) : ''],
    },
    { key: 'items', label: 'Items', render: (r) => lineCount(r.id), searchable: false },
    { key: 'required_date', label: 'Required', render: (r) => fmtDate(r.required_date) },
    { key: 'priority', label: 'Priority', render: (r) => <Badge variant="outline">{r.priority}</Badge> },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={statusClass(r.status)}>{r.status}</Badge> },
  ];

  const detailRow = rows.find((r) => r.id === detailId) || null;

  return (
    <>
      <ModuleListPage
        title="Material Requests"
        description="Request the release of items from a warehouse; stock is deducted when issued"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search requests..."
        statusKey="status"
        createLabel="New Request"
        onCreate={canRequest ? openCreate : undefined}
        onRowClick={(r) => setDetailId(r.id)}
        rowActions={(r) => (
          canIssue && r.status === 'APPROVED'
            ? <Button size="sm" variant="outline" onClick={() => setIssueTarget(r)}><PackageCheck className="mr-1.5 h-4 w-4" /> Issue</Button>
            : null
        )}
        emptyMessage="No material requests yet"
        emptyDescription="Raise a request to release items from a warehouse."
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>New Material Request</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Warehouse *</Label>
                <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}{w.is_default ? ' (default)' : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={form.department_id || '__none__'} onValueChange={(v) => setForm({ ...form, department_id: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Usage category *</Label>
                <Select value={form.usage_category || '__none__'} onValueChange={(v) => setForm({ ...form, usage_category: v === '__none__' ? '' : v, project_id: v === 'PROJECT' ? form.project_id : '' })}>
                  <SelectTrigger><SelectValue placeholder="Select usage" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select…</SelectItem>
                    {MATERIAL_USAGE_CATEGORIES.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Project {form.usage_category === 'PROJECT' ? '*' : ''}</Label>
                <Select
                  value={form.project_id || '__none__'}
                  onValueChange={(v) => setForm({ ...form, project_id: v === '__none__' ? '' : v })}
                  disabled={form.usage_category !== 'PROJECT'}
                >
                  <SelectTrigger><SelectValue placeholder={form.usage_category === 'PROJECT' ? 'Select project' : 'Only for project usage'} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Required date</Label>
                <Input type="date" value={form.required_date} onChange={(e) => setForm({ ...form, required_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MATERIAL_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Purpose</Label>
                <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Office restock" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Items</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { item_id: '', quantity: '', notes: '' }])}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add line
                </Button>
              </div>
              {lines.map((l, idx) => {
                const avail = available(l.item_id, form.warehouse_id);
                const item = items.find((i) => i.id === l.item_id);
                return (
                  <div key={idx} className="space-y-1 rounded-lg border border-border p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <Select value={l.item_id || undefined} onValueChange={(v) => {
                          const next = [...lines]; next[idx] = { ...next[idx], item_id: v }; setLines(next);
                        }}>
                          <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                          <SelectContent>
                            {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}{i.sku ? ` · ${i.sku}` : ''}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-28"
                        placeholder="Qty"
                        value={l.quantity}
                        onChange={(e) => { const next = [...lines]; next[idx] = { ...next[idx], quantity: e.target.value }; setLines(next); }}
                      />
                      <Button type="button" variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, i) => i !== idx))} disabled={lines.length === 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {l.item_id ? `Available: ${fmtQty(avail)} ${item?.uom || ''}` : 'Choose an item to see available balance'}
                      </span>
                      {errors[idx] && <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> {errors[idx]}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{detailRow?.request_number || 'Material Request'}</DialogTitle></DialogHeader>
          {detailRow && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={statusClass(detailRow.status)}>{detailRow.status}</Badge>
                <Badge variant="outline">{detailRow.priority}</Badge>
                <Badge variant="outline">Warehouse: {detailRow.warehouse?.name || '—'}</Badge>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p>Requested by: <span className="font-medium">{detailRow.requested_by ? employeeNames[detailRow.requested_by] || '—' : '—'}</span></p>
                <p>Required: <span className="font-medium">{fmtDate(detailRow.required_date)}</span></p>
                <p>Usage: <span className="font-medium">{usageLabel(detailRow.usage_category)}</span></p>
                {detailRow.usage_category === 'PROJECT' && (
                  <p>Project: <span className="font-medium">{projectLabel(detailRow.project_id)}</span></p>
                )}
                {detailRow.purpose && <p>Purpose: <span className="font-medium">{detailRow.purpose}</span></p>}
                {detailRow.issued_at && <p>Issued: <span className="font-medium">{fmtDate(detailRow.issued_at)}</span></p>}
              </div>
              {(itemsByReq[detailRow.id] || []).map((line) => (
                <div key={line.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                  <span className="font-medium">{line.item_name}</span>
                  <span>{fmtQty(line.quantity_requested)} {line.uom || ''}{line.quantity_issued > 0 ? ` · issued ${fmtQty(line.quantity_issued)}` : ''}</span>
                </div>
              ))}
              {detailRow.notes && <p className="text-sm text-muted-foreground">{detailRow.notes}</p>}
            </div>
          )}
          <DialogFooter>
            {detailRow && canIssue && detailRow.status === 'APPROVED' && (
              <Button onClick={() => { const r = detailRow; setDetailId(null); setIssueTarget(r); }}>
                <PackageCheck className="mr-1.5 h-4 w-4" /> Issue items
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issueTarget} onOpenChange={(o) => !o && setIssueTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Issue material request</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will release the requested items and deduct them from stock for <span className="font-medium">{issueTarget?.request_number}</span>. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueTarget(null)}>Cancel</Button>
            <Button onClick={() => issueTarget && issue(issueTarget)}>Issue &amp; deduct stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
