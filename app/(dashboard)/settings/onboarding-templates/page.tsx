'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, UserPlus, GripVertical } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface Template {
  id: string;
  name: string;
  department_id: string | null;
  is_active: boolean;
}

interface Step {
  id: string;
  template_id: string;
  sort_order: number;
  step_type: string;
  title: string;
  description: string | null;
  is_required: boolean;
  document_url: string | null;
  module_key: string | null;
}

const STEP_TYPES = [
  { value: 'BIODATA', label: 'Bio-data Form' },
  { value: 'GUARANTOR', label: 'Guarantor Form' },
  { value: 'QUALIFICATION', label: 'Qualifications' },
  { value: 'MEDICAL', label: 'Medical Records' },
  { value: 'DOCUMENT_ACK', label: 'Document Acknowledgment' },
  { value: 'CUSTOM_FORM', label: 'Custom Form' },
];

export default function OnboardingTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [steps, setSteps] = useState<Record<string, Step[]>>({});
  const [loading, setLoading] = useState(true);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [stepOpen, setStepOpen] = useState(false);
  const [activeTplId, setActiveTplId] = useState<string | null>(null);
  const [stepForm, setStepForm] = useState<Partial<Step>>({});

  const load = useCallback(async () => {
    try {
      const { data: tpls, error: tErr } = await supabase
        .from('onboarding_templates')
        .select('*')
        .order('name');
      if (tErr) throw tErr;
      setTemplates((tpls || []) as unknown as Template[]);
      if (tpls && tpls.length > 0) {
        const { data: stps } = await supabase
          .from('onboarding_steps')
          .select('*')
          .order('sort_order');
        const stepMap: Record<string, Step[]> = {};
        for (const s of (stps || []) as unknown as Step[]) {
          if (!stepMap[s.template_id]) stepMap[s.template_id] = [];
          stepMap[s.template_id].push(s);
        }
        setSteps(stepMap);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createTemplate = async () => {
    try {
      const { error } = await supabase
        .from('onboarding_templates')
        .insert({ name: tplName });
      if (error) throw error;
      toast.success('Template created');
      setTplOpen(false);
      setTplName('');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openAddStep = (tplId: string) => {
    setActiveTplId(tplId);
    setStepForm({ step_type: 'CUSTOM_FORM', is_required: true, sort_order: (steps[tplId]?.length || 0) });
    setStepOpen(true);
  };

  const addStep = async () => {
    if (!activeTplId || !stepForm.title) return;
    try {
      const { error } = await supabase
        .from('onboarding_steps')
        .insert({
          template_id: activeTplId,
          sort_order: stepForm.sort_order || 0,
          step_type: stepForm.step_type || 'CUSTOM_FORM',
          title: stepForm.title,
          description: stepForm.description || null,
          is_required: stepForm.is_required || false,
          document_url: stepForm.document_url || null,
          module_key: stepForm.module_key || null,
        });
      if (error) throw error;
      toast.success('Step added');
      setStepOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const deleteStep = async (stepId: string) => {
    try {
      const { error } = await supabase.from('onboarding_steps').delete().eq('id', stepId);
      if (error) throw error;
      toast.success('Step deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const deleteTemplate = async (tplId: string) => {
    try {
      const { error } = await supabase.from('onboarding_templates').delete().eq('id', tplId);
      if (error) throw error;
      toast.success('Template deleted');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Onboarding Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure the step-by-step onboarding flow for new hires</p>
        </div>
        <Button size="sm" onClick={() => setTplOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Template
        </Button>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <UserPlus className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No onboarding templates yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {templates.map((tpl) => (
            <Card key={tpl.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">{tpl.name}</CardTitle>
                  <Badge variant="outline" className={tpl.is_active ? 'bg-success/10 text-success' : ''}>
                    {tpl.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openAddStep(tpl.id)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add Step
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteTemplate(tpl.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {(steps[tpl.id] || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No steps yet. Add steps to define the onboarding flow.</p>
                ) : (
                  <div className="space-y-2">
                    {steps[tpl.id].map((step, idx) => (
                      <div key={step.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {idx + 1}
                        </span>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{step.title}</p>
                          <p className="text-xs text-muted-foreground">{step.step_type.replace(/_/g, ' ')}</p>
                        </div>
                        {step.is_required && <Badge variant="outline" className="text-xs bg-warning/10 text-warning">Required</Badge>}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteStep(step.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Onboarding Template</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Template Name</Label>
              <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Default Onboarding" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplOpen(false)}>Cancel</Button>
            <Button onClick={createTemplate} disabled={!tplName}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stepOpen} onOpenChange={setStepOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Onboarding Step</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Step Title</Label>
              <Input value={stepForm.title || ''} onChange={(e) => setStepForm({ ...stepForm, title: e.target.value })} placeholder="Complete Bio-data Form" />
            </div>
            <div className="space-y-1.5">
              <Label>Step Type</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={stepForm.step_type}
                onChange={(e) => setStepForm({ ...stepForm, step_type: e.target.value })}
              >
                {STEP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={stepForm.description || ''} onChange={(e) => setStepForm({ ...stepForm, description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Document URL (for acknowledgment steps)</Label>
              <Input value={stepForm.document_url || ''} onChange={(e) => setStepForm({ ...stepForm, document_url: e.target.value })} placeholder="https://..." />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={stepForm.is_required || false}
                onCheckedChange={(v) => setStepForm({ ...stepForm, is_required: v })}
              />
              <Label>Required step</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStepOpen(false)}>Cancel</Button>
            <Button onClick={addStep} disabled={!stepForm.title}>Add Step</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
