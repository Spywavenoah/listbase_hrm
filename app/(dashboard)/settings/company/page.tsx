'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function CompanyPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company_name: '',
    company_address: '',
    company_logo_url: '',
    tax_id: '',
    registration_number: '',
    gemini_api_key: '',
  });

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('system_settings')
          .select('*')
          .eq('group_name', 'company');
        if (data) {
          const next = { ...form };
          for (const row of data) {
            const k = row.key as keyof typeof next;
            if (k in next) {
              next[k] = String(row.value);
              // never echo a stored secret into the form
              if (row.key === 'gemini_api_key') next.gemini_api_key = '••••';
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
      const settings = Object.entries(form)
        .map(([key, value]) => ({ group_name: 'company', key, value }))
        // never overwrite a saved secret with its mask
        .filter((s) => !(s.key === 'gemini_api_key' && s.value.startsWith('••••')));
      const { error } = await supabase
        .from('system_settings')
        .upsert(settings, { onConflict: 'group_name,key' });
      if (error) throw error;
      toast.success('Company profile saved');
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <>
    <Card className="animate-fade-in max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">Company Profile</CardTitle>
        <CardDescription>Used on payslips, invoices, offer letters, and official documents</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1.5">
          <Label>Company Name</Label>
          <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Company Address</Label>
          <Textarea value={form.company_address} onChange={(e) => setForm({ ...form, company_address: e.target.value })} rows={2} />
        </div>
        <div className="space-y-1.5">
          <Label>Company Logo URL</Label>
          <Input value={form.company_logo_url} onChange={(e) => setForm({ ...form, company_logo_url: e.target.value })} placeholder="https://..." />
          <p className="text-xs text-muted-foreground">Separate from the app logo — this is your company&apos;s brand for official documents.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Tax ID</Label>
            <Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Registration Number</Label>
            <Input value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card className="animate-fade-in mt-6 max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">AI — Gemini</CardTitle>
        <CardDescription>
          The API key used to generate end-of-video assessment questions automatically from each lesson video.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>GEMINI_API_KEY</Label>
          <Input
            type="password"
            autoComplete="off"
            value={form.gemini_api_key}
            onChange={(e) => setForm({ ...form, gemini_api_key: e.target.value })}
            placeholder={form.gemini_api_key ? '' : 'AIza...'}
          />
          <p className="text-xs text-muted-foreground">
            Saved in company settings and read by the assessment generator. Leave as-is to keep the stored key.
          </p>
        </div>
        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
    </>
  );
}
