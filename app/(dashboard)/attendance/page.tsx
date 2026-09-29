'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Clock, CheckCircle, XCircle, AlertTriangle, LogIn, LogOut, Pencil, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccess } from '@/lib/access';
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
}

interface EmployeeRef {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

export default function AttendancePage() {
  const { employee: currentUser, can } = useAccess();
  const canManage = can('attendance.manage');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [clocking, setClocking] = useState(false);

  const [entryOpen, setEntryOpen] = useState(false);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryForm, setEntryForm] = useState({
    employee_id: '',
    date: new Date().toISOString().split('T')[0],
    clock_in: '',
    clock_out: '',
    work_hours: '',
    status: 'PRESENT',
  });

  const today = new Date().toISOString().split('T')[0];

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [attRes, empRes] = await Promise.all([
        supabase.from('attendance').select('*').order('date', { ascending: false }).limit(100),
        supabase.from('employees').select('id, first_name, last_name, email'),
      ]);
      setRecords((attRes.data || []) as unknown as AttendanceRecord[]);
      setEmployees((empRes.data || []) as unknown as EmployeeRef[]);

      if (currentUser) {
        const emp = (empRes.data || []).find((e: EmployeeRef) => e.email === currentUser.email);
        if (emp) {
          const todays = (attRes.data || []) as AttendanceRecord[];
          setTodayRecord(todays.find((r) => r.employee_id === emp.id && r.date === today) || null);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [today, currentUser?.email]);

  useEffect(() => { load(); }, [load]);

  const handleClockIn = async () => {
    if (!currentUser) return;
    setClocking(true);
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('attendance')
        .insert({
          employee_id: currentUser.id,
          date: today,
          clock_in: now,
          status: 'PRESENT',
        })
        .select()
        .single();
      if (error) throw error;
      setTodayRecord(data as unknown as AttendanceRecord);
      toast.success('Clocked in successfully');
      load();
    } catch (err) {
      toast.error('Failed to clock in: ' + (err as Error).message);
    } finally {
      setClocking(false);
    }
  };

  const handleClockOut = async () => {
    if (!todayRecord) return;
    setClocking(true);
    try {
      const now = new Date().toISOString();
      const clockIn = new Date(todayRecord.clock_in!);
      const hours = (new Date(now).getTime() - clockIn.getTime()) / (1000 * 60 * 60);
      const { error } = await supabase
        .from('attendance')
        .update({
          clock_out: now,
          work_hours: Math.round(hours * 100) / 100,
        })
        .eq('id', todayRecord.id);
      if (error) throw error;
      setTodayRecord({ ...todayRecord, clock_out: now, work_hours: Math.round(hours * 100) / 100 });
      toast.success('Clocked out successfully');
      load();
    } catch (err) {
      toast.error('Failed to clock out: ' + (err as Error).message);
    } finally {
      setClocking(false);
    }
  };

  const openNewEntry = () => {
    setEditing(null);
    setEntryForm({
      employee_id: '',
      date: new Date().toISOString().split('T')[0],
      clock_in: '',
      clock_out: '',
      work_hours: '',
      status: 'PRESENT',
    });
    setEntryOpen(true);
  };

  const openEditEntry = (rec: AttendanceRecord) => {
    setEditing(rec);
    const toTime = (iso: string | null) =>
      iso ? new Date(iso).toISOString().slice(0, 16) : '';
    setEntryForm({
      employee_id: rec.employee_id,
      date: rec.date,
      clock_in: toTime(rec.clock_in),
      clock_out: toTime(rec.clock_out),
      work_hours: rec.work_hours != null ? String(rec.work_hours) : '',
      status: rec.status,
    });
    setEntryOpen(true);
  };

  const saveEntry = async () => {
    if (!entryForm.employee_id || !entryForm.date) {
      toast.error('Employee and date are required');
      return;
    }
    setEntrySaving(true);
    try {
      const payload: Record<string, unknown> = {
        employee_id: entryForm.employee_id,
        date: entryForm.date,
        status: entryForm.status,
      };
      if (entryForm.clock_in) payload.clock_in = new Date(entryForm.clock_in).toISOString();
      if (entryForm.clock_out) payload.clock_out = new Date(entryForm.clock_out).toISOString();
      if (entryForm.work_hours) payload.work_hours = parseFloat(entryForm.work_hours);

      const { error } = editing
        ? await supabase.from('attendance').update(payload).eq('id', editing.id)
        : await supabase.from('attendance').insert(payload);
      if (error) throw error;
      toast.success(editing ? 'Attendance updated' : 'Attendance record added');
      setEntryOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setEntrySaving(false);
    }
  };

  const handleDelete = async (rec: AttendanceRecord) => {
    try {
      const { error } = await supabase.from('attendance').delete().eq('id', rec.id);
      if (error) throw error;
      toast.success('Attendance record deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete: ' + (err as Error).message);
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
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Records', value: records.length, icon: Clock, color: 'primary' },
    { label: 'Present', value: records.filter((r) => r.status === 'PRESENT').length, icon: CheckCircle, color: 'success' },
    { label: 'Absent', value: records.filter((r) => r.status === 'ABSENT').length, icon: XCircle, color: 'destructive' },
    { label: 'Late', value: records.filter((r) => r.status === 'LATE').length, icon: AlertTriangle, color: 'warning' },
  ];

  const columns: Column<AttendanceRecord>[] = [
    {
      key: 'employee_name',
      label: 'Employee',
      render: (r) => <span className="font-medium">{empName(r.employee_id)}</span>,
    },
    { key: 'date', label: 'Date', sortable: true },
    {
      key: 'clock_in', label: 'Clock In',
      render: (r) => r.clock_in ? new Date(r.clock_in).toLocaleTimeString() : '—',
    },
    {
      key: 'clock_out', label: 'Clock Out',
      render: (r) => r.clock_out ? new Date(r.clock_out).toLocaleTimeString() : '—',
    },
    { key: 'work_hours', label: 'Hours', render: (r) => r.work_hours ? `${r.work_hours}h` : '—', sortable: true },
    { key: 'overtime_hours', label: 'Overtime', render: (r) => r.overtime_hours ? `${r.overtime_hours}h` : '—' },
    {
      key: 'status', label: 'Status',
      render: (r) => <Badge variant="outline" className={statusColors[r.status] || ''}>{r.status}</Badge>,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {currentUser && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Time Tracking</h3>
              <p className="text-sm text-muted-foreground">
                {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
              {todayRecord && (
                <p className="mt-2 text-sm">
                  {todayRecord.clock_in && !todayRecord.clock_out ? (
                    <span className="text-success flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4" />
                      Clocked in at {new Date(todayRecord.clock_in).toLocaleTimeString()}
                    </span>
                  ) : todayRecord.clock_out ? (
                    <span className="text-muted-foreground">
                      Day complete — {todayRecord.work_hours}h logged
                    </span>
                  ) : null}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {!todayRecord || (!todayRecord.clock_in) ? (
                <Button onClick={handleClockIn} disabled={clocking} className="gap-2">
                  <LogIn className="h-4 w-4" />
                  {clocking ? 'Clocking in...' : 'Clock In'}
                </Button>
              ) : !todayRecord.clock_out ? (
                <Button onClick={handleClockOut} disabled={clocking} variant="outline" className="gap-2">
                  <LogOut className="h-4 w-4" />
                  {clocking ? 'Clocking out...' : 'Clock Out'}
                </Button>
              ) : (
                <Button disabled variant="outline" className="gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Day Complete
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <ModuleListPage
        title="Attendance"
        description="Track employee clock-in/out and time management"
        summaryCards={summaryCards}
        columns={columns}
        data={records}
        loading={loading}
        searchPlaceholder="Search attendance..."
        toolbarActions={
          canManage && (
            <Button variant="outline" size="sm" onClick={openNewEntry}>
              <Plus className="mr-2 h-4 w-4" />
              Manual Entry
            </Button>
          )
        }
        onEdit={canManage ? openEditEntry : undefined}
        onDelete={canManage ? handleDelete : undefined}
      />

      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Attendance' : 'Manual Attendance Entry'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select
                value={entryForm.employee_id}
                onValueChange={(v) => setEntryForm((f) => ({ ...f, employee_id: v }))}
                disabled={!!editing}
              >
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.first_name} {e.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={entryForm.date}
                onChange={(e) => setEntryForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Clock In</Label>
                <Input
                  type="datetime-local"
                  value={entryForm.clock_in}
                  onChange={(e) => setEntryForm((f) => ({ ...f, clock_in: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Clock Out</Label>
                <Input
                  type="datetime-local"
                  value={entryForm.clock_out}
                  onChange={(e) => setEntryForm((f) => ({ ...f, clock_out: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Work Hours (override)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={entryForm.work_hours}
                onChange={(e) => setEntryForm((f) => ({ ...f, work_hours: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={entryForm.status}
                onValueChange={(v) => setEntryForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY'].map((s) => (
                    <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEntryOpen(false)}
              disabled={entrySaving}
            >
              Cancel
            </Button>
            <Button onClick={saveEntry} disabled={entrySaving}>
              {entrySaving ? 'Saving...' : editing ? 'Save Changes' : 'Add Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
