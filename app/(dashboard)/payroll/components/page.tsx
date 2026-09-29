'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Layers, TrendingUp, TrendingDown, CheckCircle } from 'lucide-react';
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
  is_taxable: boolean;
  is_active: boolean;
}

export default function PayComponentsPage() {
  const [components, setComponents] = useState<PayComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', component_type: 'EARNING', calculation_type: 'FIXED', formula: '', is_taxable: false });

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('pay_components').select('*').order('component_type, name');
      if (error) throw error;
      setComponents((data || []) as unknown as PayComponent[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('pay_components').insert({
        name: form.name,
        code: form.code.toUpperCase(),
        component_type: form.component_type,
        calculation_type: form.calculation_type,
        formula: form.formula || null,
        is_taxable: form.is_taxable,
        is_active: true,
      });
      if (error) throw error;
      toast.success('Pay component created');
      setCreateOpen(false);
      setForm({ name: '', code: '', component_type: 'EARNING', calculation_type: 'FIXED', formula: '', is_taxable: false });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
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
    { key: 'name', label: 'Name' },
    { key: 'code', label: 'Code' },
    {
      key: 'component_type', label: 'Type',
      render: (c) => <Badge variant="outline" className={typeColors[c.component_type] || ''}>{c.component_type}</Badge>,
    },
    { key: 'calculation_type', label: 'Calculation' },
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
        searchPlaceholder="Search pay components..."
        createLabel="Add Component"
        onCreate={() => setCreateOpen(true)}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Pay Component</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Basic Salary" />
              </div>
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BASIC" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Component Type</Label>
                <Select value={form.component_type} onValueChange={(v) => setForm({ ...form, component_type: v })}>
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
            <div className="space-y-1.5">
              <Label>Formula</Label>
              <Input value={form.formula} onChange={(e) => setForm({ ...form, formula: e.target.value })} placeholder="basic * 0.1" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_taxable} onCheckedChange={(v) => setForm({ ...form, is_taxable: v })} />
              <Label className="cursor-pointer" onClick={() => setForm({ ...form, is_taxable: !form.is_taxable })}>Taxable</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name || !form.code}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
