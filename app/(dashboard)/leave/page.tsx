'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { CalendarDays, CheckCircle, Clock, XCircle, AlertTriangle, Scale } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { enqueueAndProcess } from '@/lib/notifications';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAccess } from '@/lib/access';
import { toast } from 'sonner';

interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  approver_id: string | null;
  approved_at: string | null;
  created_at: string;
}

interface EmployeeRef {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface LeaveTypeRef {
  id: string;
  name: string;
  annual_allocation: number;
}

interface LeaveBalance {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  opening_balance: number;
  note: string | null;
}

export default function LeavePage() {
  const { employee: currentUser } = useAccess();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '' });
  const [formError, setFormError] = useState('');
  const [approving, setApproving] = useState<string | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [balOpen, setBalOpen] = useState(false);
  const [balSaving, setBalSaving] = useState(false);
  const [balForm, setBalForm] = useState({ employee_id: '', leave_type_id: '', year: String(new Date().getFullYear()), opening_balance: '', note: '' });

  const load = useCallback(async () => {
    try {
      const [lrRes, empRes, ltRes, balRes] = await Promise.all([
        supabase.from('leave_requests').select('*').order('created_at', { ascending: false }),
        supabase.from('employees').select('id, first_name, last_name, email').eq('employment_status', 'ACTIVE'),
        supabase.from('leave_types').select('id, name, annual_allocation').eq('is_active', true),
        supabase.from('leave_balances').select('*').order('year', { ascending: false }),
      ]);
      setRequests((lrRes.data || []) as unknown as LeaveRequest[]);
      setEmployees((empRes.data || []) as unknown as EmployeeRef[]);
      setLeaveTypes((ltRes.data || []) as unknown as LeaveTypeRef[]);
      setBalances((balRes.data || []) as unknown as LeaveBalance[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const getDaysBetween = (start: string, end: string) => {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  };

  const validateForm = async (): Promise<boolean> => {
    if (!form.employee_id || !form.leave_type_id || !form.start_date || !form.end_date) {
      setFormError('All required fields must be filled');
      return false;
    }
    if (new Date(form.end_date) < new Date(form.start_date)) {
      setFormError('End date cannot be before start date');
      return false;
    }

    // Check for overlapping approved leave
    const { data: overlaps } = await supabase
      .from('leave_requests')
      .select('id')
      .eq('employee_id', form.employee_id)
      .eq('status', 'APPROVED')
      .lte('start_date', form.end_date)
      .gte('end_date', form.start_date);
    if (overlaps && overlaps.length > 0) {
      setFormError('This employee already has approved leave overlapping these dates');
      return false;
    }

    // Check leave balance
    const lt = leaveTypes.find((l) => l.id === form.leave_type_id);
    if (lt && lt.annual_allocation > 0) {
      const requestedDays = getDaysBetween(form.start_date, form.end_date);
      const year = new Date(form.start_date).getFullYear();
      const balance = balances.find(
        (b) => b.employee_id === form.employee_id && b.leave_type_id === form.leave_type_id && b.year === year
      );
      const openingBalance = balance?.opening_balance || 0;
      const { data: used } = await supabase
        .from('leave_requests')
        .select('start_date, end_date')
        .eq('employee_id', form.employee_id)
        .eq('leave_type_id', form.leave_type_id)
        .eq('status', 'APPROVED');
      const usedDays = (used || []).reduce((sum: number, r: { start_date: string; end_date: string }) => {
        return sum + getDaysBetween(r.start_date, r.end_date);
      }, 0);
      if (usedDays + requestedDays > lt.annual_allocation + openingBalance) {
        setFormError(`Insufficient leave balance. Used: ${usedDays} days, requesting: ${requestedDays} days, total allocation: ${lt.annual_allocation + openingBalance} days`);
        return false;
      }
    }

    setFormError('');
    return true;
  };

  const handleCreate = async () => {
    const valid = await validateForm();
    if (!valid) return;
    try {
      const { error } = await supabase.from('leave_requests').insert({
        employee_id: form.employee_id,
        leave_type_id: form.leave_type_id,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason || null,
        status: 'PENDING',
      });
      if (error) throw error;
      toast.success('Leave request submitted');
      setCreateOpen(false);
      setForm({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const handleAction = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setApproving(id);
    try {
      let approverId: string | null = null;
      if (currentUser) {
        approverId = currentUser.id;
      }

      const { error } = await supabase
        .from('leave_requests')
        .update({
          status,
          approved_at: new Date().toISOString(),
          approver_id: approverId,
        })
        .eq('id', id);
      if (error) throw error;
      toast.success(`Leave ${status.toLowerCase()}`);

      const req = requests.find((r) => r.id === id);
      if (req) {
        const emp = employees.find((e) => e.id === req.employee_id);
        const lt = leaveTypes.find((l) => l.id === req.leave_type_id);
        if (emp) {
          await enqueueAndProcess({
            eventKey: status === 'APPROVED' ? 'leave.approved' : 'leave.rejected',
            recipientEmail: emp.email,
            recipientName: `${emp.first_name} ${emp.last_name}`,
            subject: `Your leave request has been ${status.toLowerCase()}`,
            bodyHtml: `<p>Hi ${emp.first_name},</p><p>Your ${lt?.name || 'leave'} request from ${req.start_date} to ${req.end_date} has been <strong>${status.toLowerCase()}</strong>.</p>`,
            metadata: {
              employee_name: `${emp.first_name} ${emp.last_name}`,
              leave_type: lt?.name || '',
              start_date: req.start_date,
              end_date: req.end_date,
              status,
            },
          });
        }
      }
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setApproving(null);
    }
  };

  const openBalances = () => {
    setBalForm({ employee_id: '', leave_type_id: '', year: String(new Date().getFullYear()), opening_balance: '', note: '' });
    setBalOpen(true);
  }

  const handleUpsertBalance = async () => {
    if (!balForm.employee_id || !balForm.leave_type_id || balForm.opening_balance === '') {
      toast.error('Employee, leave type and opening balance are required');
      return;
    }
    setBalSaving(true);
    try {
      const year = parseInt(balForm.year, 10);
      const existing = balances.find(
        (b) => b.employee_id === balForm.employee_id && b.leave_type_id === balForm.leave_type_id && b.year === year
      );
      const record = {
        employee_id: balForm.employee_id,
        leave_type_id: balForm.leave_type_id,
        year,
        opening_balance: parseFloat(balForm.opening_balance),
        note: balForm.note || null,
      };
      if (existing) {
        const { error } = await supabase.from('leave_balances').update(record).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('leave_balances').insert(record);
        if (error) throw error;
      }
      toast.success('Balance saved');
      const balRes = await supabase.from('leave_balances').select('*').order('year', { ascending: false });
      setBalances((balRes.data || []) as unknown as LeaveBalance[]);
      setBalForm({ employee_id: '', leave_type_id: '', year: String(new Date().getFullYear()), opening_balance: '', note: '' });
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setBalSaving(false);
    }
  };

  const handleDeleteBalance = async (id: string) => {
    try {
      const { error } = await supabase.from('leave_balances').delete().eq('id', id);
      if (error) throw error;
      toast.success('Balance removed');
      const balRes = await supabase.from('leave_balances').select('*').order('year', { ascending: false });
      setBalances((balRes.data || []) as unknown as LeaveBalance[]);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const empName = (id: string) => {
    const e = employees.find((e) => e.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };
  const ltName = (id: string) => leaveTypes.find((l) => l.id === id)?.name || '—';

  const statusColors: Record<string, string> = {
    PENDING: 'bg-warning/10 text-warning',
    APPROVED: 'bg-success/10 text-success',
    REJECTED: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Requests', value: requests.length, icon: CalendarDays, color: 'primary' },
    { label: 'Pending', value: requests.filter((r) => r.status === 'PENDING').length, icon: Clock, color: 'warning' },
    { label: 'Approved', value: requests.filter((r) => r.status === 'APPROVED').length, icon: CheckCircle, color: 'success' },
    { label: 'Rejected', value: requests.filter((r) => r.status === 'REJECTED').length, icon: XCircle, color: 'destructive' },
  ];

  const columns: Column<LeaveRequest>[] = [
    { key: 'employee', label: 'Employee', render: (r) => empName(r.employee_id), sortable: true },
    { key: 'type', label: 'Leave Type', render: (r) => ltName(r.leave_type_id) },
    { key: 'start_date', label: 'Start', sortable: true },
    { key: 'end_date', label: 'End', sortable: true },
    { key: 'reason', label: 'Reason', render: (r) => r.reason || '—' },
    {
      key: 'status', label: 'Status',
      render: (r) => <Badge variant="outline" className={statusColors[r.status] || ''}>{r.status}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Leave Requests"
        description="Manage employee leave applications and approvals"
        summaryCards={summaryCards}
        columns={columns}
        data={requests}
        loading={loading}
        searchPlaceholder="Search leave requests..."
        createLabel="New Request"
        onCreate={() => setCreateOpen(true)}
        toolbarActions={
          <Button size="sm" variant="outline" onClick={openBalances}>
            <Scale className="mr-2 h-4 w-4" />
            Balances
          </Button>
        }
        rowActions={(r) => (
          r.status === 'PENDING' ? (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 text-success" disabled={approving === r.id} onClick={() => handleAction(r.id, 'APPROVED')}>
                {approving === r.id ? '...' : 'Approve'}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-destructive" disabled={approving === r.id} onClick={() => handleAction(r.id, 'REJECTED')}>
                Reject
              </Button>
            </div>
          ) : null
        )}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Leave Request</DialogTitle></DialogHeader>
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
            <div className="space-y-1.5">
              <Label>Leave Type</Label>
              <Select value={form.leave_type_id} onValueChange={(v) => setForm({ ...form, leave_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.annual_allocation} days/yr)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} />
            </div>
            {formError && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.employee_id || !form.leave_type_id || !form.start_date}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={balOpen} onOpenChange={setBalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Catch-up Accrual / Opening Balances</DialogTitle></DialogHeader>

          <div className="rounded-lg border border-border p-4">
            <p className="mb-3 text-sm font-medium">Adjust balance</p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Employee</Label>
                <Select value={balForm.employee_id} onValueChange={(v) => setBalForm({ ...balForm, employee_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Leave Type</Label>
                  <Select value={balForm.leave_type_id} onValueChange={(v) => setBalForm({ ...balForm, leave_type_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      {leaveTypes.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Leave Year</Label>
                  <Input type="number" value={balForm.year} onChange={(e) => setBalForm({ ...balForm, year: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Opening Balance (days)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={balForm.opening_balance}
                  onChange={(e) => setBalForm({ ...balForm, opening_balance: e.target.value })}
                  placeholder="e.g. 3.5"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Input value={balForm.note} onChange={(e) => setBalForm({ ...balForm, note: e.target.value })} placeholder="e.g. carried over from last leave year" />
              </div>
            </div>
            <Button className="mt-4" size="sm" onClick={handleUpsertBalance} disabled={balSaving}>
              {balSaving ? 'Saving...' : 'Save Balance'}
            </Button>
          </div>

          <div className="max-h-64 overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Year</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No balances recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  balances.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{empName(b.employee_id)}</TableCell>
                      <TableCell>{ltName(b.leave_type_id)}</TableCell>
                      <TableCell className="text-right">{b.year}</TableCell>
                      <TableCell className="text-right">{b.opening_balance}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => handleDeleteBalance(b.id)}>
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
