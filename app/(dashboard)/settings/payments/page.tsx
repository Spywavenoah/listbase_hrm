'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function PaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    public_key: '',
    secret_key: '',
    contract_code: '',
    environment: 'SANDBOX',
  });

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('system_settings')
          .select('*')
          .eq('group_name', 'payments');
        if (data) {
          const next = { ...form };
          for (const row of data) {
            if (row.key === 'public_key') next.public_key = String(row.value);
            if (row.key === 'contract_code') next.contract_code = String(row.value);
            if (row.key === 'environment') next.environment = String(row.value);
            if (row.key === 'secret_key_masked') next.secret_key = String(row.value);
          }
          setForm(next);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const settings = [
        { group_name: 'payments', key: 'public_key', value: form.public_key },
        { group_name: 'payments', key: 'contract_code', value: form.contract_code },
        { group_name: 'payments', key: 'environment', value: form.environment },
      ];
      if (form.secret_key && !form.secret_key.startsWith('••••')) {
        settings.push({ group_name: 'payments', key: 'secret_key', value: form.secret_key });
      }
      const { error } = await supabase
        .from('system_settings')
        .upsert(settings, { onConflict: 'group_name,key' });
      if (error) throw error;
      toast.success('Payment settings saved');
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <Card className="animate-fade-in max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">Payment Integration</CardTitle>
        <CardDescription>Monnify API configuration for payroll disbursement and payment collection</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1.5">
          <Label>Environment</Label>
          <Select value={form.environment} onValueChange={(v) => setForm({ ...form, environment: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SANDBOX">Sandbox (Test)</SelectItem>
              <SelectItem value="LIVE">Live (Production)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Public Key</Label>
          <Input value={form.public_key} onChange={(e) => setForm({ ...form, public_key: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Secret Key</Label>
          <Input
            type="password"
            value={form.secret_key}
            onChange={(e) => setForm({ ...form, secret_key: e.target.value })}
            placeholder={form.secret_key ? '' : 'Enter secret key'}
          />
          <p className="text-xs text-muted-foreground">Encrypted at rest. Masked after save — re-enter to change.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Contract Code</Label>
          <Input value={form.contract_code} onChange={(e) => setForm({ ...form, contract_code: e.target.value })} />
        </div>
        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
