'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { CalendarDays, Plus, Repeat, Calendar } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  description: string | null;
  is_recurring: boolean;
}

export default function HolidaysPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', holiday_date: '', description: '', is_recurring: false });

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('holidays').select('*').order('holiday_date');
      if (error) throw error;
      setHolidays((data || []) as unknown as Holiday[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('holidays').insert({
        name: form.name,
        holiday_date: form.holiday_date,
        description: form.description || null,
        is_recurring: form.is_recurring,
      });
      if (error) throw error;
      toast.success('Holiday added');
      setCreateOpen(false);
      setForm({ name: '', holiday_date: '', description: '', is_recurring: false });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Holidays', value: holidays.length, icon: CalendarDays, color: 'primary' },
    { label: 'Recurring', value: holidays.filter((h) => h.is_recurring).length, icon: Repeat, color: 'info' },
    { label: 'One-time', value: holidays.filter((h) => !h.is_recurring).length, icon: Calendar, color: 'warning' },
    { label: 'This Year', value: holidays.filter((h) => new Date(h.holiday_date).getFullYear() === new Date().getFullYear()).length, icon: Plus, color: 'success' },
  ];

  const columns: Column<Holiday>[] = [
    { key: 'name', label: 'Holiday Name' },
    {
      key: 'holiday_date', label: 'Date',
      render: (h) => new Date(h.holiday_date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
    },
    { key: 'description', label: 'Description', render: (h) => h.description || '—' },
    {
      key: 'is_recurring', label: 'Recurring',
      render: (h) => <Badge variant="outline" className={h.is_recurring ? 'bg-info/10 text-info' : 'bg-muted text-muted-foreground'}>{h.is_recurring ? 'Recurring' : 'One-time'}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Holidays"
        description="Company-wide holiday calendar"
        summaryCards={summaryCards}
        columns={columns}
        data={holidays}
        searchPlaceholder="Search holidays..."
        createLabel="Add Holiday"
        onCreate={() => setCreateOpen(true)}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Holiday</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Holiday Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Christmas Day" />
            </div>
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input type="date" value={form.holiday_date} onChange={(e) => setForm({ ...form, holiday_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_recurring} onCheckedChange={(v) => setForm({ ...form, is_recurring: v })} />
              <Label className="cursor-pointer" onClick={() => setForm({ ...form, is_recurring: !form.is_recurring })}>Recurring annually</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name || !form.holiday_date}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
