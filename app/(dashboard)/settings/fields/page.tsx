'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, GripVertical, Eye, EyeOff } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { FIELD_DATA_TYPES, FIELD_DATA_TYPE_LABELS, type FieldDefinitionInput } from '@/lib/field-engine/types';

const MODULES = [
  { key: 'employee', label: 'Employee' },
  { key: 'employee_guarantor', label: 'Employee Guarantor' },
  { key: 'employee_qualifications', label: 'Employee Qualifications' },
  { key: 'employee_medical', label: 'Employee Medical' },
  { key: 'leave_request', label: 'Leave Request' },
  { key: 'asset', label: 'Asset' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'payroll_run', label: 'Payroll Run' },
  { key: 'performance_review', label: 'Performance Review' },
];

export default function FieldBuilderPage() {
  const [fields, setFields] = useState<FieldDefinitionInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState('employee');
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<FieldDefinitionInput | null>(null);
  const [form, setForm] = useState<Partial<FieldDefinitionInput>>({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('field_definitions')
        .select('*')
        .eq('module_key', selectedModule)
        .order('sort_order');
      if (error) throw error;
      setFields((data || []) as unknown as FieldDefinitionInput[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedModule]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      module_key: selectedModule,
      data_type: 'TEXT',
      is_required: false,
      is_unique: false,
      is_active: true,
      sort_order: fields.length,
      section: 'General',
      options: [],
    });
    setEditOpen(true);
  };

  const openEdit = (f: FieldDefinitionInput) => {
    setEditing(f);
    setForm({ ...f });
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!form.field_key || !form.label) {
      toast.error('Field key and label are required');
      return;
    }
    try {
      const payload = {
        module_key: selectedModule,
        field_key: form.field_key,
        label: form.label,
        data_type: form.data_type || 'TEXT',
        options: form.options || null,
        is_required: form.is_required || false,
        is_unique: form.is_unique || false,
        validation: form.validation || null,
        visibility: form.visibility || null,
        section: form.section || 'General',
        sort_order: form.sort_order || 0,
        is_system: editing?.is_system || false,
        is_active: form.is_active !== undefined ? form.is_active : true,
      };
      if (editing) {
        const { error } = await supabase
          .from('field_definitions')
          .update(payload)
          .eq('id', editing.id!);
        if (error) throw error;
        toast.success('Field updated');
      } else {
        const { error } = await supabase
          .from('field_definitions')
          .insert(payload);
        if (error) throw error;
        toast.success('Field created');
      }
      setEditOpen(false);
      load();
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    }
  };

  const handleToggleActive = async (f: FieldDefinitionInput) => {
    try {
      const { error } = await supabase
        .from('field_definitions')
        .update({ is_active: !f.is_active })
        .eq('id', f.id!);
      if (error) throw error;
      load();
    } catch (err) {
      toast.error('Failed to toggle: ' + (err as Error).message);
    }
  };

  const handleDelete = async (f: FieldDefinitionInput) => {
    if (f.is_system) {
      toast.error('System fields cannot be deleted');
      return;
    }
    try {
      const { error } = await supabase
        .from('field_definitions')
        .delete()
        .eq('id', f.id!);
      if (error) throw error;
      toast.success('Field deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete: ' + (err as Error).message);
    }
  };

  const needsOptions = form.data_type === 'SELECT' || form.data_type === 'MULTISELECT';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Field Builder</h1>
          <p className="mt-1 text-sm text-muted-foreground">Add custom fields to any module without writing code</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedModule} onValueChange={setSelectedModule}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODULES.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Add Field
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fields for {MODULES.find((m) => m.key === selectedModule)?.label}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : fields.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">No fields defined yet. Click &quot;Add Field&quot; to create one.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {fields.map((f) => (
                <div key={f.id} className="flex items-center gap-3 p-4 hover:bg-accent/30 transition-colors">
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{f.label}</p>
                      {f.is_system && <Badge variant="outline" className="text-xs">System</Badge>}
                      {f.is_required && <Badge variant="outline" className="text-xs bg-warning/10 text-warning">Required</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{f.field_key} · {FIELD_DATA_TYPE_LABELS[f.data_type as keyof typeof FIELD_DATA_TYPE_LABELS]} · {f.section || 'General'}</p>
                  </div>
                  <Switch checked={f.is_active} onCheckedChange={() => handleToggleActive(f)} />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(f)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive disabled:opacity-30"
                    disabled={f.is_system}
                    onClick={() => handleDelete(f)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Field' : 'New Custom Field'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Label</Label>
                <Input value={form.label || ''} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Blood Group" />
              </div>
              <div className="space-y-1.5">
                <Label>Field Key</Label>
                <Input
                  value={form.field_key || ''}
                  onChange={(e) => setForm({ ...form, field_key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                  placeholder="blood_group"
                  disabled={!!editing?.is_system}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Data Type</Label>
                <Select
                  value={form.data_type}
                  onValueChange={(v) => setForm({ ...form, data_type: v as FieldDefinitionInput['data_type'] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_DATA_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{FIELD_DATA_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Section</Label>
                <Input value={form.section || ''} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="Medical Info" />
              </div>
            </div>
            {needsOptions && (
              <div className="space-y-1.5">
                <Label>Options (comma-separated)</Label>
                <Input
                  value={(form.options || []).join(', ')}
                  onChange={(e) => setForm({ ...form, options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="A+, A-, B+, B-, O+, O-"
                />
              </div>
            )}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_required || false}
                  onCheckedChange={(v) => setForm({ ...form, is_required: v })}
                />
                <Label>Required</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_unique || false}
                  onCheckedChange={(v) => setForm({ ...form, is_unique: v })}
                />
                <Label>Unique</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_active !== false}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label>Active</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
