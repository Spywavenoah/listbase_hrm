'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface AttendanceRecord {
  id: string;
  employee_id: string;
  clock_in: string | null;
  clock_out: string | null;
  date: string;
  status: string;
  work_hours: number | null;
  overtime_hours: number;
  notes: string | null;
}

export default function TimesheetsPage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: '', date: '', clock_in: '', clock_out: '', status: 'PRESENT' });

  const load = useCallback(async () => {
    try {
      const [aRes, eRes] = await Promise.all([
        supabase.from('attendance').select('*').order('date', { ascending: false }).limit(200),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE'),
      ]);
      setRecords((aRes.data || []) as unknown as AttendanceRecord[]);
      setEmployees(eRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('attendance').insert({
        employee_id: form.employee_id,
        date: form.date,
        clock_in: form.clock_in ? new Date(form.clock_in).toISOString() : null,
        clock_out: form.clock_out ? new Date(form.clock_out).toISOString() : null,
        status: form.status,
      });
      if (error) throw error;
      toast.success('Timesheet entry added');
      setCreateOpen(false);
      setForm({ employee_id: '', date: '', clock_in: '', clock_out: '', status: 'PRESENT' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const empName = (id: string) => {
    const e = employees.find((e) => e.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };

  const statusColors: Record<string, string> = {
    PRESENT: 'bg-success/10 text-success',
    ABSENT: 'bg-destructive/10 text-destructive',
    LATE: 'bg-warning/10 text-warning',
    HALF_DAY: 'bg-info/10 text-info',
  REMOTE: 'bg-primary/10 text-primary',
  LEAVE: 'bg-muted text-muted-foreground',
  WEEKEND: 'bg-muted text-muted-foreground',
  HOLIDAY: 'bg-muted text-muted-foreground',
  AWAY: 'bg-destructive/10 text-destructive',
  PRESENT_WEEKEND: 'bg-success/10 text-success',
    WEEKEND_WORK: 'bg-success/10 text-success',
    AWAY_WEEKEND: 'bg-destructive/10 text-destructive',
    PRESENT_HOLIDAY: 'bg-success/10 text-success',
    HOLIDAY_WORK: 'bg-success/10 text-success',
    AWAY_HOLIDAY: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Entries', value: records.length, icon: Clock, color: 'primary' },
    { label: 'Present', value: records.filter((r) => r.status === 'PRESENT').length, icon: CheckCircle, color: 'success' },
    { label: 'Absent', value: records.filter((r) => r.status === 'ABSENT').length, icon: XCircle, color: 'destructive' },
    { label: 'Late', value: records.filter((r) => r.status === 'LATE').length, icon: AlertTriangle, color: 'warning' },
  ];

  const columns: Column<AttendanceRecord>[] = [
    { key: 'employee', label: 'Employee', render: (r) => empName(r.employee_id) },
    { key: 'date', label: 'Date' },
    {
      key: 'clock_in', label: 'Clock In',
      render: (r) => r.clock_in ? new Date(r.clock_in).toLocaleTimeString() : '—',
    },
    {
      key: 'clock_out', label: 'Clock Out',
      render: (r) => r.clock_out ? new Date(r.clock_out).toLocaleTimeString() : '—',
    },
    { key: 'work_hours', label: 'Hours', render: (r) => r.work_hours ? `${r.work_hours}h` : '—' },
    {
      key: 'status', label: 'Status',
      render: (r) => <Badge variant="outline" className={statusColors[r.status] || ''}>{r.status}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Timesheets"
        description="Detailed attendance records and manual time entries"
        summaryCards={summaryCards}
        columns={columns}
        data={records}
        searchPlaceholder="Search timesheets..."
        createLabel="Add Entry"
        onCreate={() => setCreateOpen(true)}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Timesheet Entry</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRESENT">Present</SelectItem>
                    <SelectItem value="ABSENT">Absent</SelectItem>
                    <SelectItem value="LATE">Late</SelectItem>
                    <SelectItem value="HALF_DAY">Half Day</SelectItem>
                    <SelectItem value="REMOTE">Remote</SelectItem>
                    <SelectItem value="LEAVE">On Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Clock In</Label>
                <Input type="datetime-local" value={form.clock_in} onChange={(e) => setForm({ ...form, clock_in: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Clock Out</Label>
                <Input type="datetime-local" value={form.clock_out} onChange={(e) => setForm({ ...form, clock_out: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.employee_id || !form.date}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
