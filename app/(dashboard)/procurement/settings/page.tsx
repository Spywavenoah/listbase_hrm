'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Pencil, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface Category {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
}
interface Criterion {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  is_active: boolean;
}

export default function ProcurementSettingsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [loading, setLoading] = useState(true);

  const [catOpen, setCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [critOpen, setCritOpen] = useState(false);
  const [editingCrit, setEditingCrit] = useState<Criterion | null>(null);
  const [saving, setSaving] = useState(false);

  const [catForm, setCatForm] = useState({ name: '', code: '', description: '' });
  const [critForm, setCritForm] = useState({ name: '', description: '', weight: 1 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, crRes] = await Promise.all([
        supabase.from('procurement_categories').select('*').order('name'),
        supabase.from('procurement_evaluation_criteria').select('*').order('name'),
      ]);
      setCategories((cRes.data || []) as Category[]);
      setCriteria((crRes.data || []) as Criterion[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addCategory = async () => {
    if (!catForm.name) { toast.error('Category name is required'); return; }
    setSaving(true);
    try {
      if (editingCat) {
        const { error } = await supabase.from('procurement_categories').update({
          name: catForm.name,
          code: catForm.code || null,
          description: catForm.description || null,
        }).eq('id', editingCat.id);
        if (error) throw error;
        toast.success('Category updated');
      } else {
        const { error } = await supabase.from('procurement_categories').insert({
          name: catForm.name,
          code: catForm.code || null,
          description: catForm.description || null,
        });
        if (error) throw error;
        toast.success('Category added');
      }
      setCatOpen(false);
      setEditingCat(null);
      setCatForm({ name: '', code: '', description: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openCatEdit = (c: Category) => {
    setEditingCat(c);
    setCatForm({ name: c.name, code: c.code || '', description: c.description || '' });
    setCatOpen(true);
  };

  const closeCatDialog = () => {
    setCatOpen(false);
    setEditingCat(null);
  };

  const toggleCategory = async (c: Category) => {
    const { error } = await supabase.from('procurement_categories').update({ is_active: !c.is_active }).eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const addCriterion = async () => {
    if (!critForm.name) { toast.error('Criterion name is required'); return; }
    setSaving(true);
    try {
      if (editingCrit) {
        const { error } = await supabase.from('procurement_evaluation_criteria').update({
          name: critForm.name,
          description: critForm.description || null,
          weight: Number(critForm.weight || 1),
        }).eq('id', editingCrit.id);
        if (error) throw error;
        toast.success('Evaluation criterion updated');
      } else {
        const { error } = await supabase.from('procurement_evaluation_criteria').insert({
          name: critForm.name,
          description: critForm.description || null,
          weight: Number(critForm.weight || 1),
        });
        if (error) throw error;
        toast.success('Evaluation criterion added');
      }
      setCritOpen(false);
      setEditingCrit(null);
      setCritForm({ name: '', description: '', weight: 1 });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openCritEdit = (c: Criterion) => {
    setEditingCrit(c);
    setCritForm({ name: c.name, description: c.description || '', weight: Number(c.weight) });
    setCritOpen(true);
  };

  const closeCritDialog = () => {
    setCritOpen(false);
    setEditingCrit(null);
  };

  const toggleCriterion = async (c: Criterion) => {
    const { error } = await supabase.from('procurement_evaluation_criteria').update({ is_active: !c.is_active }).eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(c.is_active ? 'Criterion deactivated' : 'Criterion activated');
    load();
  };

  const totalWeight = criteria.reduce((s, c) => s + Number(c.weight), 0);

  const catColumns: Column<Category>[] = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'code', label: 'Code', render: (r) => <span className="font-mono text-xs">{r.code || '—'}</span> },
    { key: 'description', label: 'Description', render: (r) => r.description || '—' },
    { key: 'is_active', label: 'Status', render: (r) => <Badge variant="outline">{r.is_active ? 'Active' : 'Inactive'}</Badge> },
  ];

  const critColumns: Column<Criterion>[] = [
    { key: 'name', label: 'Criterion', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'description', label: 'Description', render: (r) => r.description || '—' },
    { key: 'weight', label: 'Weight', render: (r) => <Badge variant="outline">{r.weight}</Badge> },
    { key: 'is_active', label: 'Status', render: (r) => <Badge variant="outline">{r.is_active ? 'Active' : 'Inactive'}</Badge> },
  ];

  return (
    <>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Procurement Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure categories and quotation evaluation criteria</p>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
          <Info className="h-4 w-4 shrink-0" />
          Approval chains for requisitions, purchase orders, invoices and payments are managed in Settings → Workflows.
        </div>

        <ModuleListPage
          title="Categories"
          description="Procurement categories used on requisitions and RFQs"
          columns={catColumns}
          data={categories}
          loading={loading}
          searchPlaceholder="Search categories..."
          createLabel="Add Category"
          onCreate={() => { setEditingCat(null); setCatForm({ name: '', code: '', description: '' }); setCatOpen(true); }}
          rowActions={(r) => (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => openCatEdit(r)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => toggleCategory(r)}>
                {r.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          )}
          emptyMessage="No categories yet"
          emptyDescription="Add categories to classify requisitions and spending."
        />

        <ModuleListPage
          title="Evaluation Criteria"
          description="Criteria used to score supplier quotations"
          columns={critColumns}
          data={criteria}
          loading={loading}
          searchPlaceholder="Search criteria..."
          createLabel="Add Criterion"
          onCreate={() => { setEditingCrit(null); setCritForm({ name: '', description: '', weight: 1 }); setCritOpen(true); }}
          rowActions={(r) => (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => openCritEdit(r)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => toggleCriterion(r)}>
                {r.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          )}
          toolbarActions={
            totalWeight > 0 ? (
              <Badge variant="outline">Total weight: {totalWeight}</Badge>
            ) : undefined
          }
          emptyMessage="No evaluation criteria"
          emptyDescription="Add criteria such as Price, Quality and Delivery to score quotations."
        />
      </div>

      <Dialog open={catOpen} onOpenChange={(o) => { if (!o) closeCatDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCat ? `Edit Category — ${editingCat.name}` : 'Add Category'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} placeholder="e.g. IT Equipment" />
            </div>
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input value={catForm.code} onChange={(e) => setCatForm({ ...catForm, code: e.target.value })} placeholder="e.g. ITE" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCatDialog}>Cancel</Button>
            <Button onClick={addCategory} disabled={saving}>{editingCat ? 'Save Changes' : 'Add Category'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={critOpen} onOpenChange={(o) => { if (!o) closeCritDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCrit ? `Edit Criterion — ${editingCrit.name}` : 'Add Evaluation Criterion'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={critForm.name} onChange={(e) => setCritForm({ ...critForm, name: e.target.value })} placeholder="e.g. Price" />
            </div>
            <div className="space-y-1.5">
              <Label>Weight</Label>
              <Input type="number" step="0.5" min={0} value={critForm.weight} onChange={(e) => setCritForm({ ...critForm, weight: Number(e.target.value) })} />
              <p className="text-xs text-muted-foreground">Scores are averaged using this weight. Higher weight = more influence.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={critForm.description} onChange={(e) => setCritForm({ ...critForm, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCritDialog}>Cancel</Button>
            <Button onClick={addCriterion} disabled={saving}>{editingCrit ? 'Save Changes' : 'Add Criterion'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}