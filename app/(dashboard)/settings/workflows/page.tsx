'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, ArrowRightLeft } from 'lucide-react';

const MODULES = [
  { key: 'employee', label: 'Employee' },
  { key: 'leave_request', label: 'Leave Request' },
  { key: 'asset', label: 'Asset Assignment' },
  { key: 'payroll_run', label: 'Payroll Run' },
  { key: 'performance_review', label: 'Performance Review' },
  { key: 'recruitment_job', label: 'Recruitment' },
];

interface WorkflowDef {
  id: string;
  name: string;
  module_key: string;
  trigger_event: string;
  description: string | null;
  is_active: boolean;
}

interface ModuleConfig {
  id: string;
  module_key: string;
  is_enabled: boolean;
  workflow_definition_id: string | null;
}

export default function WorkflowsPage() {
  const [defs, setDefs] = useState<WorkflowDef[]>([]);
  const [configs, setConfigs] = useState<ModuleConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [defRes, cfgRes] = await Promise.all([
        supabase.from('workflow_definitions').select('*').order('name'),
        supabase.from('module_workflow_config').select('*'),
      ]);
      if (defRes.data) setDefs(defRes.data as unknown as WorkflowDef[]);
      if (cfgRes.data) setConfigs(cfgRes.data as unknown as ModuleConfig[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleModule = async (moduleKey: string, enabled: boolean) => {
    try {
      const existing = configs.find((c) => c.module_key === moduleKey);
      if (existing) {
        const { error } = await supabase
          .from('module_workflow_config')
          .update({ is_enabled: enabled })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('module_workflow_config')
          .insert({ module_key: moduleKey, is_enabled: enabled });
        if (error) throw error;
      }
      toast.success(`Workflow ${enabled ? 'enabled' : 'disabled'} for ${moduleKey}`);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const getConfig = (moduleKey: string) => configs.find((c) => c.module_key === moduleKey);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workflow Engine</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enable or disable approval workflows per module</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-Module Workflow Toggle</CardTitle>
          <CardDescription>When enabled, new records require approval before going live</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : (
            <div className="divide-y divide-border">
              {MODULES.map((m) => {
                const cfg = getConfig(m.key);
                const enabled = cfg?.is_enabled || false;
                return (
                  <div key={m.key} className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <ArrowRightLeft className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{m.label}</p>
                        <p className="text-xs text-muted-foreground font-mono">{m.key}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {enabled && <Badge variant="outline" className="bg-success/10 text-success">Enabled</Badge>}
                      <Switch checked={enabled} onCheckedChange={(v) => toggleModule(m.key, v)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Workflow Definitions</CardTitle>
          <Button size="sm" variant="outline">
            <Plus className="mr-2 h-4 w-4" /> New Definition
          </Button>
        </CardHeader>
        <CardContent>
          {defs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <ArrowRightLeft className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No workflow definitions yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {defs.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="font-medium text-sm">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.module_key} · {d.trigger_event}</p>
                  </div>
                  <Badge variant="outline" className={d.is_active ? 'bg-success/10 text-success' : ''}>
                    {d.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
