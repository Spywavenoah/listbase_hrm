'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Wallet } from 'lucide-react';

type Mode = 'DAYS' | 'HOURS';

interface AdminEntry {
  id: string;
  name: string;
}

export default function PayrollSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>('DAYS');
  const [hoursPerDay, setHoursPerDay] = useState('8');
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [newAdmin, setNewAdmin] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await supabase
        .from('system_settings')
        .select('key, value')
        .eq('group_name', 'payroll')
        .in('key', ['timecard_calc_mode', 'hours_per_day', 'pension_administrators']);
      const map: Record<string, unknown> = {};
      for (const r of res.data || []) {
        map[r.key] = r.value;
      }
      const rawMode = map['timecard_calc_mode'];
      if (rawMode === 'HOURS') setMode('HOURS');
      const hpd = map['hours_per_day'];
      if (typeof hpd === 'number') setHoursPerDay(String(hpd));
      else if (typeof hpd === 'string') setHoursPerDay(hpd);
      const adminsRaw = map['pension_administrators'];
      if (Array.isArray(adminsRaw)) {
        const list = adminsRaw
          .map((a, idx) => {
            if (typeof a === 'string') return { id: `str-${idx}`, name: a };
            if (a && typeof a === 'object') {
              const obj = a as Record<string, unknown>;
              const name = typeof obj.name === 'string' ? obj.name : typeof obj.title === 'string' ? obj.title : String(Object.values(obj)[0] || '');
              return { id: (obj.id as string) || `obj-${idx}`, name };
            }
            return null;
          })
          .filter(Boolean) as AdminEntry[];
        setAdmins(list);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addAdmin = () => {
    const name = newAdmin.trim();
    if (!name) return;
    setAdmins((prev) => [...prev, { id: `new-${Date.now()}`, name }]);
    setNewAdmin('');
  };

  const removeAdmin = (id: string) => {
    setAdmins((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const hpdNum = Math.max(1, Number(hoursPerDay) || 8);
      const payload = [
        { group_name: 'payroll', key: 'timecard_calc_mode', value: mode },
        { group_name: 'payroll', key: 'hours_per_day', value: hpdNum },
        { group_name: 'payroll', key: 'pension_administrators', value: admins.map((a) => ({ name: a.name })) },
      ];
      const { error } = await supabase.from('system_settings').upsert(payload, { onConflict: 'group_name,key' });
      if (error) throw error;
      toast.success('Payroll settings saved');
      load();
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Wallet className="h-6 w-6" /> Payroll Settings</h1>
        <p className="text-sm text-muted-foreground">Timecard calculation, working hours, and Nigerian payroll configuration.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timecard Calculation</CardTitle>
          <CardDescription>Control how attendance is converted to payable units for payroll.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Calculation Mode</p>
              <p className="text-xs text-muted-foreground">DAYS uses calendar working days; HOURS uses total worked hours ÷ hours per day.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${mode === 'DAYS' ? 'font-medium' : 'text-muted-foreground'}`}>Days</span>
              <Switch checked={mode === 'HOURS'} onCheckedChange={(c) => setMode(c ? 'HOURS' : 'DAYS')} />
              <span className={`text-sm ${mode === 'HOURS' ? 'font-medium' : 'text-muted-foreground'}`}>Hours</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Hours per day</Label>
            <Input type="number" min={1} step={0.5} value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} />
            <p className="text-xs text-muted-foreground">Used when calculating in HOURS mode or for reporting.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pension Administrators</CardTitle>
          <CardDescription>Dropdown options shown on employee compensation when Pension is enabled.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {admins.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <Badge variant="outline" className="flex-1 justify-start">{a.name}</Badge>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeAdmin(a.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input placeholder="e.g. Stanbic IBTC Pension, ARM Pension" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAdmin()} />
            <Button variant="outline" onClick={addAdmin}><Plus className="mr-2 h-4 w-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Payroll Settings'}
        </Button>
      </div>
    </div>
  );
}
