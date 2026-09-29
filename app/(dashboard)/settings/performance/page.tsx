'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus } from 'lucide-react';

export default function PerformanceSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [max, setMax] = useState('5');
  const [labels, setLabels] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const [maxRow, labelsRow] = await Promise.all([
          supabase.from('system_settings').select('value').eq('group_name', 'performance').eq('key', 'rating_scale_max').maybeSingle(),
          supabase.from('system_settings').select('value').eq('group_name', 'performance').eq('key', 'rating_scale_labels').maybeSingle(),
        ]);
        if (maxRow.data) setMax(String(maxRow.data.value));
        const raw = labelsRow.data?.value as unknown;
        if (Array.isArray(raw)) setLabels(raw.map((l) => String(l)));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async () => {
    const n = Math.max(1, Number(max) || 5);
    const clean = labels.slice(0, n).map((l) => l.trim());
    while (clean.length < n) clean.push(`Level ${clean.length + 1}`);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('system_settings')
        .upsert([
          { group_name: 'performance', key: 'rating_scale_max', value: n },
          { group_name: 'performance', key: 'rating_scale_labels', value: clean },
        ], { onConflict: 'group_name,key' });
      if (error) throw error;
      setMax(String(n));
      setLabels(clean);
      toast.success('Performance rating scale saved');
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setLabel = (i: number, v: string) => {
    setLabels((prev) => prev.map((l, idx) => (idx === i ? v : l)));
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <Card>
        <CardHeader>
          <CardTitle>Performance Rating Scale</CardTitle>
          <CardDescription>
            Configure the rating scale used across performance reviews. Labels are stored in Settings, not code, so
            changing them never requires a redeploy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Maximum rating</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={max}
              onChange={(e) => {
                const n = Math.max(1, Number(e.target.value) || 1);
                setMax(String(n));
                setLabels((prev) => {
                  const next = prev.slice(0, n);
                  while (next.length < n) next.push(`Level ${next.length + 1}`);
                  return next;
                });
              }}
            />
            <p className="text-xs text-muted-foreground">Ratings are stored as raw scores; the scale only affects display.</p>
          </div>

          <div className="space-y-2">
            <Label>Rating labels</Label>
            {labels.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge variant="outline" className="w-24 shrink-0 justify-center">{i + 1} / {max}</Badge>
                <Input value={label} onChange={(e) => setLabel(i, e.target.value)} placeholder={`Level ${i + 1}`} />
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setLabels((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLabels((prev) => [...prev, `Level ${prev.length + 1}`])}>
              <Plus className="mr-2 h-4 w-4" /> Add label
            </Button>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            Example: a rating of 4 on a {max}-point scale shows as <Badge variant="outline" className="mx-1">{4}/{max}{labels[3] ? ` · ${labels[3]}` : ''}</Badge>.
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Scale'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}