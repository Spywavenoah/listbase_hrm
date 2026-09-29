'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { enqueueAndProcess } from '@/lib/notifications';

export default function SmtpPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    host: '',
    port: '587',
    username: '',
    password: '',
    encryption: 'TLS',
    from_name: '',
    from_email: '',
  });

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('system_settings')
          .select('*')
          .eq('group_name', 'smtp');
        if (data) {
          const next = { ...form };
          for (const row of data) {
            const k = row.key as keyof typeof next;
            if (k in next) {
              next[k] = String(row.value);
              if (row.key === 'password') next.password = '••••';
            }
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
        { group_name: 'smtp', key: 'host', value: form.host },
        { group_name: 'smtp', key: 'port', value: form.port },
        { group_name: 'smtp', key: 'username', value: form.username },
        { group_name: 'smtp', key: 'encryption', value: form.encryption },
        { group_name: 'smtp', key: 'from_name', value: form.from_name },
        { group_name: 'smtp', key: 'from_email', value: form.from_email },
      ];
      if (form.password && !form.password.startsWith('••••')) {
        settings.push({ group_name: 'smtp', key: 'password', value: form.password });
      }
      const { error } = await supabase
        .from('system_settings')
        .upsert(settings, { onConflict: 'group_name,key' });
      if (error) throw error;
      toast.success('SMTP settings saved');
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
        <CardTitle className="text-lg">Email Configuration (SMTP)</CardTitle>
        <CardDescription>Configure the email server used for all outgoing notifications</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>SMTP Host</Label>
            <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.gmail.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Port</Label>
            <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Encryption</Label>
          <Select value={form.encryption} onValueChange={(v) => setForm({ ...form, encryption: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="TLS">TLS</SelectItem>
              <SelectItem value="SSL">SSL</SelectItem>
              <SelectItem value="NONE">None</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>From Name</Label>
            <Input value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>From Email</Label>
            <Input type="email" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-4">
          <Button variant="outline" disabled={!form.from_email} onClick={async () => {
            try {
              await enqueueAndProcess({
                eventKey: 'smtp.test',
                recipientEmail: form.from_email,
                recipientName: form.from_name || 'Admin',
                subject: 'SMTP Test Email',
                bodyHtml: `<p>This is a test email from your HR system.</p><p>If you received this, your SMTP configuration is working correctly.</p>`,
                metadata: { test: 'true' },
              });
              toast.success('Test email sent to ' + form.from_email);
            } catch (err) {
              toast.error('Failed: ' + (err as Error).message);
            }
          }}>Send Test Email</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
