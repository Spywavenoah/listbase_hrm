'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Layers, TrendingUp, TrendingDown, CheckCircle, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface PayComponent {
  id: string;
  name: string;
  code: string;
  component_type: string;
  calculation_type: string;
  formula: string | null;
  amount: number | null;
  is_taxable: boolean;
  is_active: boolean;
  is_system: boolean;
  system_key: string | null;
  employee_id: string | null;
}

interface EmployeeOption {
  id: string;
  first_name: string;
  last_name: string;
  employee_id: string | null;
}

const ALL_EMPLOYEES = '__all__';

const EMPTY_FORM = {
  name: '',
  code: '',
  component_type: 'EARNING',
  calculation_type: 'FIXED',
  formula: '',
  amount: '',
  is_taxable: false,
  employee_id: null as string | null,
};

export default function PayComponentsPage() {
  const [components, setComponents] = useState<PayComponent[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PayComponent | null>(null);
  const [viewTarget, setViewTarget] = useState<PayComponent | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    try {
      const [{ data, error }, { data: empData }] = await Promise.all([
        supabase.from('pay_components').select('*').order('component_type, name'),
        supabase.from('employees').select('id, first_name, last_name, employee_id').order('first_name'),
      ]);
      if (error) throw error;
      setComponents((data || []) as unknown as PayComponent[]);
      setEmployees((empData || []) as unknown as EmployeeOption[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const employeeName = (id: string | null) => {
    if (!id) return 'All employees';
    const emp = employees.find((e) => e.id === id);
    return emp ? `${emp.first_name} ${emp.last_name}` : '—';
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setCreateOpen(true);
  };

  const openEdit = (c: PayComponent) => {
    setEditing(c);
    setForm({
      name: c.name,
      code: c.code,
      component_type: c.component_type,
      calculation_type: c.calculation_type,
      formula: c.formula || '',
      amount: c.amount != null ? String(c.amount) : '',
      is_taxable: c.is_taxable,
      employee_id: c.employee_id,
    });
    setCreateOpen(true);
  };

  const closeDialog = () => {
    setCreateOpen(false);
    setEditing(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        code: form.code.toUpperCase(),
        component_type: form.component_type,
        calculation_type: form.calculation_type,
        formula: form.formula || null,
        amount: form.amount ? Number(form.amount) : null,
        is_taxable: form.is_taxable,
        employee_id: form.employee_id,
      };
      if (editing?.is_system) {
        delete payload.name;
        delete payload.code;
        delete payload.component_type;
        delete payload.employee_id;
      }
      if (editing) {
        const { error } = await supabase.from('pay_components').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Pay component updated');
      } else {
        const { error } = await supabase.from('pay_components').insert({ ...payload, is_active: true });
        if (error) throw error;
        toast.success('Pay component created');
      }
      closeDialog();
      setForm({ ...EMPTY_FORM });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const typeColors: Record<string, string> = {
    EARNING: 'bg-success/10 text-success',
    DEDUCTION: 'bg-destructive/10 text-destructive',
    TAX: 'bg-warning/10 text-warning',
    BENEFIT: 'bg-info/10 text-info',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Components', value: components.length, icon: Layers, color: 'primary' },
    { label: 'Earnings', value: components.filter((c) => c.component_type === 'EARNING').length, icon: TrendingUp, color: 'success' },
    { label: 'Deductions', value: components.filter((c) => c.component_type === 'DEDUCTION').length, icon: TrendingDown, color: 'destructive' },
    { label: 'Active', value: components.filter((c) => c.is_active).length, icon: CheckCircle, color: 'info' },
  ];

  const columns: Column<PayComponent>[] = [
    {
      key: 'name', label: 'Name',
      render: (c) => (
        <div className="flex items-center gap-2">
          <span>{c.name}</span>
          {c.is_system && <Badge variant="outline" className="bg-primary/10 text-primary">System</Badge>}
        </div>
      ),
    },
    { key: 'code', label: 'Code' },
    {
      key: 'component_type', label: 'Type',
      render: (c) => <Badge variant="outline" className={typeColors[c.component_type] || ''}>{c.component_type}</Badge>,
    },
    { key: 'calculation_type', label: 'Calculation' },
    {
      key: 'amount', label: 'Amount / Rate',
      render: (c) => c.amount != null ? (c.calculation_type === 'PERCENTAGE' ? `${c.amount}%` : `₦${Number(c.amount).toLocaleString()}`) : '—',
    },
    { key: 'employee_id', label: 'Applies To', render: (c) => employeeName(c.employee_id) },
    { key: 'formula', label: 'Formula', render: (c) => c.formula || '—' },
    {
      key: 'is_taxable', label: 'Taxable',
      render: (c) => <Badge variant="outline" className={c.is_taxable ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'}>{c.is_taxable ? 'Yes' : 'No'}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Pay Components"
        description="Configure earnings, deductions, and tax components"
        summaryCards={summaryCards}
        columns={columns}
        data={components}
        loading={loading}
        searchPlaceholder="Search pay components..."
        createLabel="Add Component"
        onCreate={openCreate}
        rowActions={(c) => (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setViewTarget(c)}>
              <Eye className="mr-1 h-3.5 w-3.5" /> View
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>Update</Button>
          </div>
        )}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o && !saving) closeDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? `Update Pay Component — ${editing.code}` : 'Add Pay Component'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            {editing?.is_system && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                System component. Name, code, type and scope are locked, but the rate/formula can be edited to match your company policy.
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Basic Salary" disabled={!!editing?.is_system} />
              </div>
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BASIC" disabled={!!editing?.is_system} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Component Type</Label>
                <Select value={form.component_type} onValueChange={(v) => setForm({ ...form, component_type: v })} disabled={!!editing?.is_system}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EARNING">Earning</SelectItem>
                    <SelectItem value="DEDUCTION">Deduction</SelectItem>
                    <SelectItem value="TAX">Tax</SelectItem>
                    <SelectItem value="BENEFIT">Benefit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Calculation Type</Label>
                <Select value={form.calculation_type} onValueChange={(v) => setForm({ ...form, calculation_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">Fixed Amount</SelectItem>
                    <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                    <SelectItem value="FORMULA">Formula</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{form.calculation_type === 'PERCENTAGE' ? 'Rate (%)' : 'Amount (₦)'}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder={form.calculation_type === 'PERCENTAGE' ? 'e.g. 8' : 'e.g. 50000'}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Formula</Label>
                <Input value={form.formula} onChange={(e) => setForm({ ...form, formula: e.target.value })} placeholder="basic * 0.1" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select
                value={form.employee_id || ALL_EMPLOYEES}
                onValueChange={(v) => setForm({ ...form, employee_id: v === ALL_EMPLOYEES ? null : v })}
                disabled={!!editing?.is_system}
              >
                <SelectTrigger><SelectValue placeholder="All employees" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_EMPLOYEES}>All employees (company-wide)</SelectItem>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name}{emp.employee_id ? ` (${emp.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Leave as company-wide, or pick a single employee for a custom component.</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_taxable} onCheckedChange={(v) => setForm({ ...form, is_taxable: v })} />
              <Label className="cursor-pointer" onClick={() => setForm({ ...form, is_taxable: !form.is_taxable })}>Taxable</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.code}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewTarget} onOpenChange={(o) => { if (!o) setViewTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{viewTarget?.name}</DialogTitle></DialogHeader>
          {viewTarget && (
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Code</dt>
                <dd className="font-mono">{viewTarget.code}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Type</dt>
                <dd><Badge variant="outline" className={typeColors[viewTarget.component_type] || ''}>{viewTarget.component_type}</Badge></dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Calculation</dt>
                <dd>{viewTarget.calculation_type}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Amount / Rate</dt>
                <dd>{viewTarget.amount != null ? (viewTarget.calculation_type === 'PERCENTAGE' ? `${viewTarget.amount}%` : `₦${Number(viewTarget.amount).toLocaleString()}`) : '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Formula</dt>
                <dd>{viewTarget.formula || '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Applies to</dt>
                <dd>{employeeName(viewTarget.employee_id)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Taxable</dt>
                <dd><Badge variant="outline" className={viewTarget.is_taxable ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'}>{viewTarget.is_taxable ? 'Yes' : 'No'}</Badge></dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Status</dt>
                <dd><Badge variant="outline" className={viewTarget.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{viewTarget.is_active ? 'Active' : 'Inactive'}</Badge></dd>
              </div>
              {viewTarget.is_system && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">System Key</dt>
                  <dd className="font-mono text-xs">{viewTarget.system_key || '—'}</dd>
                </div>
              )}
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
            {viewTarget && (
              <Button onClick={() => { const c = viewTarget; setViewTarget(null); openEdit(c); }}>Update</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
