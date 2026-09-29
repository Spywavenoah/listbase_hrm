'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { CalendarDays, CheckCircle, XCircle, Plus, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface LeaveType {
  id: string;
  name: string;
  code: string;
  description: string | null;
  accrual_policy: string;
  annual_allocation: number;
  carry_forward_limit: number;
  encashable: boolean;
  encashment_rate_per_day: number;
  is_paid: boolean;
  is_active: boolean;
}

const DEFAULT_FORM = {
  name: '',
  code: '',
  description: '',
  annual_allocation: '0',
  carry_forward_limit: '0',
  encashable: false,
  encashment_rate_per_day: '0',
  is_paid: true,
};

export default function LeaveTypesPage() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingType, setEditingType] = useState<LeaveType | null>(null);
  const [form, setForm] = useState({ ...DEFAULT_FORM });

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('leave_types').select('*').order('name');
      if (error) throw error;
      setTypes((data || []) as unknown as LeaveType[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingType(null);
    setForm({ ...DEFAULT_FORM });
    setCreateOpen(true);
  };

  const openEdit = (t: LeaveType) => {
    setEditingType(t);
    setForm({
      name: t.name,
      code: t.code,
      description: t.description || '',
      annual_allocation: String(t.annual_allocation),
      carry_forward_limit: String(t.carry_forward_limit),
      encashable: t.encashable,
      encashment_rate_per_day: String(t.encashment_rate_per_day || 0),
      is_paid: t.is_paid,
    });
    setCreateOpen(true);
  };

  const toggleActive = async (t: LeaveType) => {
    try {
      const { error } = await supabase.from('leave_types').update({ is_active: !t.is_active }).eq('id', t.id);
      if (error) throw error;
      toast.success(t.is_active ? 'Leave type deactivated' : 'Leave type activated');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.code) {
      toast.error('Name and code are required');
      return;
    }
    try {
      const payload = {
        name: form.name,
        code: form.code.toUpperCase(),
        description: form.description || null,
        accrual_policy: editingType?.accrual_policy || 'FIXED',
        annual_allocation: parseFloat(form.annual_allocation) || 0,
        carry_forward_limit: parseFloat(form.carry_forward_limit) || 0,
        encashable: form.encashable && (parseFloat(form.encashment_rate_per_day) > 0),
        encashment_rate_per_day: parseFloat(form.encashment_rate_per_day) || 0,
        is_paid: form.is_paid,
        is_active: editingType ? editingType.is_active : true,
      };
      if (editingType) {
        const { error } = await supabase.from('leave_types').update(payload).eq('id', editingType.id);
        if (error) throw error;
        toast.success('Leave type updated');
      } else {
        const { error } = await supabase.from('leave_types').insert(payload);
        if (error) throw error;
        toast.success('Leave type created');
      }
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Types', value: types.length, icon: CalendarDays, color: 'primary' },
    { label: 'Active', value: types.filter((t) => t.is_active).length, icon: CheckCircle, color: 'success' },
    { label: 'Encashable', value: types.filter((t) => t.encashable).length, icon: Plus, color: 'info' },
    { label: 'Unpaid', value: types.filter((t) => !t.is_paid).length, icon: XCircle, color: 'destructive' },
  ];

  const columns: Column<LeaveType>[] = [
    { key: 'name', label: 'Name' },
    { key: 'code', label: 'Code' },
    { key: 'annual_allocation', label: 'Annual Allocation', render: (t) => `${t.annual_allocation} days` },
    { key: 'carry_forward_limit', label: 'Carry Forward', render: (t) => `${t.carry_forward_limit} days` },
    {
      key: 'encashment', label: 'Encashment',
      render: (t) => t.encashable
        ? <Badge variant="outline" className="bg-success/10 text-success">${t.encashment_rate_per_day}/day</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Off</Badge>,
    },
    {
      key: 'is_paid', label: 'Paid',
      render: (t) => <Badge variant="outline" className={t.is_paid ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{t.is_paid ? 'Paid' : 'Unpaid'}</Badge>,
    },
    {
      key: 'is_active', label: 'Status',
      render: (t) => <Badge variant="outline" className={t.is_active ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Leave Types"
        description="Configure leave categories, allocations, carry-forward and encashment policies"
        summaryCards={summaryCards}
        columns={columns}
        data={types}
        loading={loading}
        searchPlaceholder="Search leave types..."
        createLabel="Add Type"
        onCreate={openCreate}
        rowActions={(t) => (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toggleActive(t)}>
              {t.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        )}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingType ? `Edit ${editingType.name}` : 'Add Leave Type'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Annual Leave" />
              </div>
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="ANL" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Annual Allocation (days)</Label>
                <Input type="number" value={form.annual_allocation} onChange={(e) => setForm({ ...form, annual_allocation: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Carry Forward Limit (days)</Label>
                <Input type="number" value={form.carry_forward_limit} onChange={(e) => setForm({ ...form, carry_forward_limit: e.target.value })} />
              </div>
            </div>
            <div className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center gap-3">
                <Switch checked={form.encashable} onCheckedChange={(v) => setForm({ ...form, encashable: v })} />
                <Label className="cursor-pointer" onClick={() => setForm({ ...form, encashable: !form.encashable })}>
                  Allow encashment (payout unused days)
                </Label>
              </div>
              {form.encashable && (
                <div className="space-y-1.5">
                  <Label>Encashment Rate (currency / day)</Label>
                  <Input type="number" step="0.01" value={form.encashment_rate_per_day} onChange={(e) => setForm({ ...form, encashment_rate_per_day: e.target.value })} placeholder="0.00" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_paid} onCheckedChange={(v) => setForm({ ...form, is_paid: v })} />
              <Label className="cursor-pointer" onClick={() => setForm({ ...form, is_paid: !form.is_paid })}>Paid Leave</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.code}>
              {editingType ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}