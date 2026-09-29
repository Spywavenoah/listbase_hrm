'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { ClipboardList, CheckCircle, Clock, XCircle, Receipt } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { LineItemsEditor, type LineItem } from '@/components/shared/line-items-editor';
import { ProcurementEmployeePicker } from '@/components/shared/procurement-employee-picker';
import { refNumber, fmtMoney, procStatusClass, PRIORITIES, PURCHASE_TYPES, CURRENCIES } from '@/lib/procurement';
import { startWorkflow } from '@/lib/workflow/engine';
import { useAccess } from '@/lib/access';

interface Requisition {
  id: string;
  req_number: string;
  requester_id: string;
  department_id: string | null;
  category_id: string | null;
  purchase_type: string;
  priority: string;
  purpose: string | null;
  business_justification: string | null;
  delivery_location: string | null;
  required_delivery_date: string | null;
  currency: string;
  estimated_total: number;
  status: string;
  approved_at: string | null;
  remarks: string | null;
  created_at: string;
}

interface Department { id: string; name: string }
interface Category { id: string; name: string }

export default function RequisitionsPage() {
  const { employee } = useAccess();
  const [rows, setRows] = useState<Requisition[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [itemsByReq, setItemsByReq] = useState<Record<string, LineItem[]>>({});
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingReq, setEditingReq] = useState<Requisition | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailItems, setDetailItems] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    requester_id: '',
    department_id: '',
    category_id: '',
    purchase_type: 'GOODS',
    priority: 'NORMAL',
    purpose: '',
    business_justification: '',
    delivery_location: '',
    required_delivery_date: '',
    currency: 'USD',
  });
  const [items, setItems] = useState<LineItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, dRes, cRes, iRes, empRes] = await Promise.all([
        supabase.from('procurement_requisitions').select('*').order('created_at', { ascending: false }),
        supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
        supabase.from('procurement_categories').select('id, name').eq('is_active', true).order('name'),
        supabase.from('procurement_requisition_items').select('*').order('line_no', { ascending: true }),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      setRows((rRes.data || []) as unknown as Requisition[]);
      setDepartments(dRes.data || []);
      setCategories(cRes.data || []);
      const names: Record<string, string> = {};
      for (const e of (empRes.data || []) as { id: string; name: string }[]) names[e.id] = e.name;
      setEmployeeNames(names);
      const grouped: Record<string, LineItem[]> = {};
      for (const it of (iRes.data || []) as unknown as (LineItem & { requisition_id: string })[]) {
        (grouped[it.requisition_id] = grouped[it.requisition_id] || []).push(it);
      }
      setItemsByReq(grouped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const requesterName = (id: string) => employeeNames[id] || 'Unknown';

  const resetForm = () => {
    setForm({
      requester_id: employee?.id || '',
      department_id: '',
      category_id: '',
      purchase_type: 'GOODS',
      priority: 'NORMAL',
      purpose: '',
      business_justification: '',
      delivery_location: '',
      required_delivery_date: '',
      currency: 'USD',
    });
    setItems([]);
  };

  const openEdit = (row: Requisition) => {
    setEditingReq(row);
    setForm({
      requester_id: row.requester_id,
      department_id: row.department_id || '',
      category_id: row.category_id || '',
      purchase_type: row.purchase_type,
      priority: row.priority,
      purpose: row.purpose || '',
      business_justification: row.business_justification || '',
      delivery_location: row.delivery_location || '',
      required_delivery_date: row.required_delivery_date || '',
      currency: row.currency,
    });
    setItems((itemsByReq[row.id] || []).map((i, idx) => ({ ...i, id: `tmp-edit-${idx}` })));
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setEditingReq(null);
  };

  const handleCreate = async () => {
    if (!form.purpose && items.length === 0) {
      toast.error('Add a purpose and at least one line item');
      return;
    }
    if (items.length === 0 || items.some((i) => !i.item_name)) {
      toast.error('Add at least one item with a name');
      return;
    }
    setSaving(true);
    try {
      const total = items.reduce((s, i) => s + Number(i.total || 0), 0);
      const payload = {
        requester_id: form.requester_id || employee?.id,
        department_id: form.department_id || null,
        category_id: form.category_id || null,
        purchase_type: form.purchase_type,
        priority: form.priority,
        purpose: form.purpose,
        business_justification: form.business_justification || null,
        delivery_location: form.delivery_location || null,
        required_delivery_date: form.required_delivery_date || null,
        currency: form.currency,
        estimated_total: Number(total.toFixed(2)),
      };
      const itemRows = items.map((i, idx) => ({
        requisition_id: editingReq ? editingReq.id : '',
        line_no: idx + 1,
        item_name: i.item_name,
        description: i.description || null,
        quantity: i.quantity,
        uom: i.uom,
        estimated_unit_price: i.unit_price,
        total: Number((Number(i.quantity) * Number(i.unit_price)).toFixed(2)),
      }));
      if (editingReq) {
        const { error } = await supabase.from('procurement_requisitions')
          .update(payload)
          .eq('id', editingReq.id);
        if (error) throw error;
        const { error: de } = await supabase.from('procurement_requisition_items')
          .delete()
          .eq('requisition_id', editingReq.id);
        if (de) throw de;
        if (itemRows.length > 0) {
          const { error: ie } = await supabase.from('procurement_requisition_items')
            .insert(itemRows.map((r) => ({ ...r, requisition_id: editingReq.id })));
          if (ie) throw ie;
        }
        toast.success('Requisition updated');
      } else {
        const reqNumber = refNumber('REQ');
        const { data, error } = await supabase
          .from('procurement_requisitions')
          .insert({ ...payload, req_number: reqNumber, status: 'DRAFT' })
          .select()
          .single();
        if (error) throw error;
        const req = data as unknown as Requisition;
        const { error: ie } = await supabase.from('procurement_requisition_items')
          .insert(itemRows.map((r) => ({ ...r, requisition_id: req.id })));
        if (ie) throw ie;
        toast.success('Requisition created');
      }
      closeCreate();
      resetForm();
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitRequisition = async (row: Requisition) => {
    try {
      const { error } = await supabase.from('procurement_requisitions')
        .update({ status: 'PENDING_APPROVAL' })
        .eq('id', row.id);
      if (error) throw error;
      const instanceId = await startWorkflow('procurement.requisition', row.id, row.requester_id || employee?.id);
      if (!instanceId) {
        await supabase.from('procurement_requisitions')
          .update({ status: 'DRAFT' })
          .eq('id', row.id);
        toast.warning('No approval workflow is enabled for requisitions — request returned to draft');
        load();
        return;
      }
      toast.success('Requisition submitted for approval');
      load();
    } catch (err) {
      await supabase.from('procurement_requisitions')
        .update({ status: 'DRAFT' })
        .eq('id', row.id);
      toast.error('Failed: ' + (err as Error).message);
      load();
    }
  };

  const cancelRequisition = async (row: Requisition) => {
    try {
      const { error } = await supabase.from('procurement_requisitions').update({ status: 'CANCELLED' }).eq('id', row.id);
      if (error) throw error;
      toast.success('Requisition cancelled');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openDetail = (row: Requisition) => {
    setDetailId(row.id);
    setDetailItems(itemsByReq[row.id] || []);
    setDetailOpen(true);
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Requisitions', value: rows.length, icon: ClipboardList, color: 'primary' },
    { label: 'Draft', value: rows.filter((r) => r.status === 'DRAFT').length, icon: Receipt, color: 'info' },
    { label: 'Pending Approval', value: rows.filter((r) => r.status === 'PENDING_APPROVAL').length, icon: Clock, color: 'warning' },
    { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length, icon: CheckCircle, color: 'success' },
    { label: 'Rejected', value: rows.filter((r) => r.status === 'REJECTED').length, icon: XCircle, color: 'destructive' },
  ];

  const columns: Column<Requisition>[] = [
    { key: 'req_number', label: 'Req #', render: (r) => <span className="font-medium">{r.req_number}</span> },
    { key: 'purpose', label: 'Purpose', render: (r) => r.purpose || '—' },
    { key: 'requester_id', label: 'Requester', render: (r) => requesterName(r.requester_id), searchText: (r) => [requesterName(r.requester_id)] },
    { key: 'priority', label: 'Priority', render: (r) => <Badge variant="outline">{r.priority}</Badge> },
    { key: 'estimated_total', label: 'Est. Total', render: (r) => <span className="font-medium">{fmtMoney(r.estimated_total, r.currency)}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={procStatusClass(r.status)}>{r.status.replace(/_/g, ' ')}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title="Requisitions"
        description="Raise and track purchase requisitions through approval"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search requisitions..."
        statusKey="status"
        createLabel="New Requisition"
        onCreate={() => { setEditingReq(null); resetForm(); setCreateOpen(true); }}
        onRowClick={openDetail}
        rowActions={(r) => (
          <div className="flex items-center gap-1">
            {r.status === 'DRAFT' && (
              <>
                <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => submitRequisition(r)}>Submit</Button>
              </>
            )}
            {r.status === 'REJECTED' && (
              <Button size="sm" variant="ghost" onClick={() => submitRequisition(r)}>Resubmit</Button>
            )}
            {(r.status === 'DRAFT' || r.status === 'PENDING_APPROVAL') && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancelRequisition(r)}>Cancel</Button>
            )}
          </div>
        )}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) closeCreate(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingReq ? `Edit Requisition — ${editingReq.req_number}` : 'New Requisition'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Requester *</Label>
                <ProcurementEmployeePicker value={form.requester_id || null} onChange={(v) => setForm({ ...form, requester_id: v || '' })} />
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Purchase Type</Label>
                <Select value={form.purchase_type} onValueChange={(v) => setForm({ ...form, purchase_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PURCHASE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Purpose *</Label>
              <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Why does the organization need this?" />
            </div>
            <div className="space-y-1.5">
              <Label>Business Justification</Label>
              <Textarea rows={2} value={form.business_justification} onChange={(e) => setForm({ ...form, business_justification: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Delivery Location</Label>
                <Input value={form.delivery_location} onChange={(e) => setForm({ ...form, delivery_location: e.target.value })} placeholder="e.g. HQ Warehouse 2" />
              </div>
              <div className="space-y-1.5">
                <Label>Required Delivery Date</Label>
                <Input type="date" value={form.required_delivery_date} onChange={(e) => setForm({ ...form, required_delivery_date: e.target.value })} />
              </div>
            </div>

            <LineItemsEditor items={items} onChange={setItems} priceLabel="Est. unit price" />
            {items.length > 0 && (
              <p className="text-right text-sm font-medium">
                Estimated total: {fmtMoney(items.reduce((s, i) => s + Number(i.total || 0), 0), form.currency)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || items.length === 0 || items.some((i) => !i.item_name)}>
              {saving ? 'Saving...' : editingReq ? 'Save Changes' : 'Create Requisition'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailId && rows.find((r) => r.id === detailId)
                ? `${rows.find((r) => r.id === detailId)!.req_number} — ${rows.find((r) => r.id === detailId)!.purpose || 'Requisition'}`
                : 'Requisition'}
            </DialogTitle>
          </DialogHeader>
          {detailId && (() => {
            const row = rows.find((r) => r.id === detailId);
            if (!row) return null;
            const cur = row.currency || 'USD';
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={procStatusClass(row.status)}>{row.status.replace(/_/g, ' ')}</Badge>
                  <Badge variant="outline">Priority: {row.priority}</Badge>
                  <Badge variant="outline">Type: {row.purchase_type}</Badge>
                  <Badge variant="outline">Currency: {cur}</Badge>
                  <Badge variant="outline">Requester: {requesterName(row.requester_id)}</Badge>
                </div>
                {row.business_justification && <p className="text-sm text-muted-foreground">{row.business_justification}</p>}
                {detailItems.length === 0 && (
                  <p className="text-sm text-muted-foreground">No line items on this requisition.</p>
                )}
                {detailItems.map((it) => (
                  <div key={it.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{it.item_name}</p>
                      {it.description && <p className="text-xs text-muted-foreground">{it.description}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{fmtMoney(it.total, cur)}</p>
                      <p className="text-xs text-muted-foreground">{it.quantity} {it.uom} × {fmtMoney(it.unit_price, cur)}</p>
                    </div>
                  </div>
                ))}
                {detailItems.length > 0 && (
                  <div className="flex justify-between border-t border-border pt-3">
                    <span className="text-sm font-medium">Estimated Total</span>
                    <span className="text-sm font-bold">
                      {fmtMoney(detailItems.reduce((s, i) => s + Number(i.total || 0), 0), cur)}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            {detailId && rows.find((r) => r.id === detailId)?.status === 'DRAFT' && (
              <Button onClick={() => { const r = rows.find((x) => x.id === detailId); if (r) { setDetailOpen(false); submitRequisition(r); } }}>
                Submit for Approval
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}