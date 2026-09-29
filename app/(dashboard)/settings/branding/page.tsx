'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function BrandingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [appName, setAppName] = useState('HR Flow');
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('system_settings')
          .select('*')
          .eq('group_name', 'branding');
        if (data) {
          for (const row of data) {
            if (row.key === 'app_name') setAppName(String(row.value));
            if (row.key === 'logo_url') setLogoUrl(String(row.value));
            if (row.key === 'favicon_url') setFaviconUrl(String(row.value));
          }
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
        { group_name: 'branding', key: 'app_name', value: appName },
        { group_name: 'branding', key: 'logo_url', value: logoUrl },
        { group_name: 'branding', key: 'favicon_url', value: faviconUrl },
      ];
      const { error } = await supabase
        .from('system_settings')
        .upsert(settings, { onConflict: 'group_name,key' });
      if (error) throw error;
      toast.success('Branding settings saved');
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
        <CardTitle className="text-lg">Branding</CardTitle>
        <CardDescription>Customize how your application appears to users</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1.5">
          <Label>Application Name</Label>
          <Input value={appName} onChange={(e) => setAppName(e.target.value)} />
          <p className="text-xs text-muted-foreground">Displayed in the sidebar header, browser tab, and emails.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Logo URL</Label>
          <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
          <p className="text-xs text-muted-foreground">Upload your logo to a CDN and paste the URL here.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Favicon URL</Label>
          <Input value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} placeholder="https://..." />
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
