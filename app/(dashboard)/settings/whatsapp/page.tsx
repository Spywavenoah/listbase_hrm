'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Copy, Plus, Pencil, Trash2, MessageSquare, ShieldCheck } from 'lucide-react';
import {
  WHATSAPP_ACTIONS,
  WHATSAPP_MATCH_TYPES,
  WHATSAPP_SETTINGS_GROUP,
  EMPTY_WHATSAPP_CONFIG,
  labelFor,
  actionClass,
  type WhatsAppConfig,
  type WhatsAppRule,
} from '@/lib/whatsapp';

const RULE_EMPTY = {
  phrase: '',
  action: 'CLOCK_IN',
  match_type: 'CONTAINS',
  priority: '100',
  is_active: true,
};

export default function WhatsAppSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfig>(EMPTY_WHATSAPP_CONFIG);
  const [secretSet, setSecretSet] = useState(false);
  const [tokenSet, setTokenSet] = useState(false);

  const [rules, setRules] = useState<WhatsAppRule[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<WhatsAppRule | null>(null);
  const [ruleForm, setRuleForm] = useState({ ...RULE_EMPTY });

  useEffect(() => { setWebhookUrl(`${window.location.origin}/api/webhooks/whatsapp/attendance`); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('system_settings')
        .select('key, value')
        .eq('group_name', WHATSAPP_SETTINGS_GROUP);
      const map: Record<string, string> = {};
      for (const row of data || []) map[row.key] = row.value === null ? '' : String(row.value);
      setConfig({
        enabled: map.enabled || 'false',
        phone_number_id: map.phone_number_id || '',
        business_account_id: map.business_account_id || '',
        verify_token: map.verify_token || '',
        app_secret: map.app_secret ? '__keep__' : '',
        access_token: map.access_token ? '__keep__' : '',
      });
      setSecretSet(!!map.app_secret);
      setTokenSet(!!map.access_token);

      const { data: ruleData } = await supabase
        .from('whatsapp_attendance_rules')
        .select('*')
        .order('priority', { ascending: true });
      setRules((ruleData || []) as unknown as WhatsAppRule[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const settings = [
        { group_name: WHATSAPP_SETTINGS_GROUP, key: 'enabled', value: config.enabled },
        { group_name: WHATSAPP_SETTINGS_GROUP, key: 'phone_number_id', value: config.phone_number_id },
        { group_name: WHATSAPP_SETTINGS_GROUP, key: 'business_account_id', value: config.business_account_id },
        { group_name: WHATSAPP_SETTINGS_GROUP, key: 'verify_token', value: config.verify_token },
      ];
      if (config.app_secret && config.app_secret !== '__keep__') {
        settings.push({ group_name: WHATSAPP_SETTINGS_GROUP, key: 'app_secret', value: config.app_secret });
      }
      if (config.access_token && config.access_token !== '__keep__') {
        settings.push({ group_name: WHATSAPP_SETTINGS_GROUP, key: 'access_token', value: config.access_token });
      }
      const { error } = await supabase
        .from('system_settings')
        .upsert(settings, { onConflict: 'group_name,key' });
      if (error) throw error;
      toast.success('WhatsApp settings saved');
      load();
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openCreateRule = () => {
    setEditingRule(null);
    setRuleForm({ ...RULE_EMPTY });
    setRuleOpen(true);
  };

  const openEditRule = (r: WhatsAppRule) => {
    setEditingRule(r);
    setRuleForm({
      phrase: r.phrase,
      action: r.action,
      match_type: r.match_type,
      priority: String(r.priority),
      is_active: r.is_active,
    });
    setRuleOpen(true);
  };

  const saveRule = async () => {
    if (!ruleForm.phrase.trim()) { toast.error('Phrase is required'); return; }
    const priority = Number(ruleForm.priority);
    if (isNaN(priority)) { toast.error('Priority must be a number'); return; }
    try {
      const payload = {
        phrase: ruleForm.phrase.trim(),
        action: ruleForm.action,
        match_type: ruleForm.match_type,
        priority,
        is_active: ruleForm.is_active,
      };
      const { error } = editingRule
        ? await supabase.from('whatsapp_attendance_rules').update(payload).eq('id', editingRule.id)
        : await supabase.from('whatsapp_attendance_rules').insert(payload);
      if (error) throw error;
      toast.success(editingRule ? 'Rule updated' : 'Rule added');
      setRuleOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const removeRule = async (r: WhatsAppRule) => {
    try {
      const { error } = await supabase.from('whatsapp_attendance_rules').delete().eq('id', r.id);
      if (error) throw error;
      toast.success('Rule deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete: ' + (err as Error).message);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success('Webhook URL copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="animate-fade-in space-y-6">
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5" /> WhatsApp Attendance
          </CardTitle>
          <CardDescription>
            Let employees clock in/out by sending a WhatsApp message. The sender&apos;s number must match an
            active employee&apos;s phone, secondary phone or emergency contact.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-2">
            <Switch checked={config.enabled === 'true'} onCheckedChange={(v) => setConfig({ ...config, enabled: v ? 'true' : 'false' })} />
            <span className="text-sm text-muted-foreground">Enable WhatsApp clock-in/out</span>
          </div>

          <div className="space-y-1.5">
            <Label>Webhook callback URL (paste into Meta)</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={webhookUrl} className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={copyUrl}><Copy className="h-4 w-4" /></Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Phone number ID</Label>
              <Input value={config.phone_number_id} onChange={(e) => setConfig({ ...config, phone_number_id: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp Business Account ID</Label>
              <Input value={config.business_account_id} onChange={(e) => setConfig({ ...config, business_account_id: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Verify token</Label>
            <Input value={config.verify_token} onChange={(e) => setConfig({ ...config, verify_token: e.target.value })} placeholder="A secret string you also enter in Meta" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>App secret <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={config.app_secret === '__keep__' ? '' : config.app_secret}
                onChange={(e) => setConfig({ ...config, app_secret: e.target.value })}
                placeholder={secretSet ? '•••• saved — leave blank to keep' : 'Used to verify webhook signatures'}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Access token <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                type="password"
                value={config.access_token === '__keep__' ? '' : config.access_token}
                onChange={(e) => setConfig({ ...config, access_token: e.target.value })}
                placeholder={tokenSet ? '•••• saved — leave blank to keep' : 'Used to send confirmation replies'}
              />
            </div>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button onClick={saveConfig} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Listening phrases
            </CardTitle>
            <Button size="sm" variant="outline" onClick={openCreateRule}>
              <Plus className="mr-1.5 h-4 w-4" /> Add phrase
            </Button>
          </div>
          <CardDescription>Messages are matched against these phrases (lowest priority number wins).</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rules.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No phrases configured yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Phrase</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Match</th>
                    <th className="px-4 py-2 font-medium">Priority</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="px-4 py-2 font-medium">{r.phrase}</td>
                      <td className="px-4 py-2"><Badge variant="outline" className={actionClass(r.action)}>{labelFor(WHATSAPP_ACTIONS, r.action)}</Badge></td>
                      <td className="px-4 py-2 text-muted-foreground">{labelFor(WHATSAPP_MATCH_TYPES, r.match_type)}</td>
                      <td className="px-4 py-2">{r.priority}</td>
                      <td className="px-4 py-2">
                        {r.is_active
                          ? <Badge variant="outline" className="bg-success/10 text-success">Active</Badge>
                          : <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditRule(r)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => removeRule(r)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingRule ? 'Edit Phrase' : 'Add Phrase'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Phrase *</Label>
              <Input value={ruleForm.phrase} onChange={(e) => setRuleForm({ ...ruleForm, phrase: e.target.value })} placeholder="clock in" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Action</Label>
                <Select value={ruleForm.action} onValueChange={(v) => setRuleForm({ ...ruleForm, action: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WHATSAPP_ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Match type</Label>
                <Select value={ruleForm.match_type} onValueChange={(v) => setRuleForm({ ...ruleForm, match_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WHATSAPP_MATCH_TYPES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Input type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} />
              <p className="text-xs text-muted-foreground">Lower numbers are checked first.</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={ruleForm.is_active} onCheckedChange={(v) => setRuleForm({ ...ruleForm, is_active: v })} />
              <span className="text-sm text-muted-foreground">Active</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleOpen(false)}>Cancel</Button>
            <Button onClick={saveRule}>{editingRule ? 'Save Changes' : 'Add Phrase'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
