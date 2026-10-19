'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { Coins, Wallet, Plus, FileText, Users, CalendarDays, CheckCircle2, CircleDollarSign } from 'lucide-react';
import {
  ALLOWANCE_CURRENCIES,
  ALLOWANCE_ADVICE_BUCKET,
  ALLOWANCE_ADVICE_MAX_SIZE,
  ALLOWANCE_ADVICE_TYPES,
  DEFAULT_CYCLE_DAYS,
  MAX_DAYS_PER_PAYMENT,
  fmtDate,
  fmtMoney,
  todayIso,
  employeeName,
  type AllowanceCycle,
  type AllowanceCycleEmployee,
  type AllowanceDayLedger,
  type AllowancePayment,
  type EmployeeLite,
  type Project,
} from '@/lib/projects';

const GLOBAL = '__global__';

const EMPTY_CYCLE = {
  project_id: GLOBAL,
  name: '',
  start_date: todayIso(),
  total_days: String(DEFAULT_CYCLE_DAYS),
  currency: 'USD',
  day_rate: '',
  employee_ids: [] as string[],
};

const EMPTY_PAY = {
  employee_ids: [] as string[],
  day_nos: [] as number[],
  reference: '',
  payment_date: todayIso(),
  notes: '',
};

type CycleForm = typeof EMPTY_CYCLE;
type PayForm = typeof EMPTY_PAY;

export default function AllowancePaymentsPage() {
  const { can } = useAccess();
  const canManage = can('projects.allowance') || can('projects.manage') || can('admin.settings');

  const [cycles, setCycles] = useState<AllowanceCycle[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const [cycleEmployees, setCycleEmployees] = useState<AllowanceCycleEmployee[]>([]);
  const [ledger, setLedger] = useState<AllowanceDayLedger[]>([]);
  const [payments, setPayments] = useState<AllowancePayment[]>([]);

  const [cycleOpen, setCycleOpen] = useState(false);
  const [cycleForm, setCycleForm] = useState<CycleForm>(EMPTY_CYCLE);
  const [creatingCycle, setCreatingCycle] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState<PayForm>(EMPTY_PAY);
  const [adviceFile, setAdviceFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);

  const selectedCycle = useMemo(() => cycles.find((c) => c.id === selectedId) || null, [cycles, selectedId]);

  const loadAll = useCallback(async () => {
    try {
      const [c, p, e] = await Promise.all([
        supabase.from('offshore_allowance_cycles').select('*').order('created_at', { ascending: false }),
        supabase.from('projects').select('*').order('name'),
        supabase.from('employees').select('id, first_name, last_name').eq('employment_status', 'ACTIVE').order('first_name'),
      ]);
      setCycles((c.data || []) as unknown as AllowanceCycle[]);
      setProjects((p.data || []) as unknown as Project[]);
      setEmployees((e.data || []) as unknown as EmployeeLite[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadDetail = useCallback(async (cycleId: string) => {
    if (!cycleId) { setCycleEmployees([]); setLedger([]); setPayments([]); return; }
    try {
      const [ce, lg, pm] = await Promise.all([
        supabase.from('offshore_allowance_cycle_employees').select('*, employees:id(*)').eq('cycle_id', cycleId),
        supabase.from('offshore_allowance_day_ledger').select('*').eq('cycle_id', cycleId),
        supabase.from('offshore_allowance_payments').select('*').eq('cycle_id', cycleId).order('created_at', { ascending: false }),
      ]);
      setCycleEmployees((ce.data || []) as unknown as AllowanceCycleEmployee[]);
      setLedger((lg.data || []) as unknown as AllowanceDayLedger[]);
      setPayments((pm.data || []) as unknown as AllowancePayment[]);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

  const projectMap = useMemo(() => {
    const m: Record<string, Project> = {};
    for (const p of projects) m[p.id] = p;
    return m;
  }, [projects]);

  const ledgerByEmployee = useMemo(() => {
    const m: Record<string, AllowanceDayLedger[]> = {};
    for (const row of ledger) {
      (m[row.employee_id] ||= []).push(row);
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.day_no - b.day_no);
    return m;
  }, [ledger]);

  const totals = useMemo(() => {
    const paidDays = ledger.filter((l) => l.status === 'PAID').length;
    const totalDays = ledger.length;
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.total_amount || 0), 0);
    return { paidDays, totalDays, remainingDays: Math.max(0, totalDays - paidDays), totalPaid };
  }, [ledger, payments]);

  // ---- New cycle -----------------------------------------------------------
  const openCycle = () => { setCycleForm(EMPTY_CYCLE); setCycleOpen(true); };

  const toggleCycleEmployee = (id: string) => {
    setCycleForm((f) => ({
      ...f,
      employee_ids: f.employee_ids.includes(id) ? f.employee_ids.filter((x) => x !== id) : [...f.employee_ids, id],
    }));
  };

  const createCycle = async () => {
    if (!cycleForm.name.trim()) { toast.error('Cycle name is required'); return; }
    if (!cycleForm.start_date) { toast.error('Start date is required'); return; }
    const days = Number(cycleForm.total_days);
    if (!days || days <= 0) { toast.error('Total days must be greater than zero'); return; }
    if (cycleForm.employee_ids.length === 0) { toast.error('Select at least one employee'); return; }
    setCreatingCycle(true);
    try {
      const { data, error } = await supabase.rpc('create_offshore_allowance_cycle', {
        p_project_id: cycleForm.project_id === GLOBAL ? null : cycleForm.project_id,
        p_name: cycleForm.name.trim(),
        p_start_date: cycleForm.start_date,
        p_total_days: days,
        p_currency: cycleForm.currency,
        p_employee_ids: cycleForm.employee_ids,
        p_day_rate: cycleForm.day_rate === '' ? 0 : Number(cycleForm.day_rate),
      });
      if (error) throw error;
      toast.success('Cycle created');
      setCycleOpen(false);
      await loadAll();
      if (data) setSelectedId(String(data));
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setCreatingCycle(false);
    }
  };

  // ---- Record payment ------------------------------------------------------
  const openPay = () => {
    if (!selectedCycle) { toast.error('Select a cycle first'); return; }
    setPayForm(EMPTY_PAY);
    setAdviceFile(null);
    setPayOpen(true);
  };

  const togglePayEmployee = (id: string) => {
    setPayForm((f) => {
      const employee_ids = f.employee_ids.includes(id) ? f.employee_ids.filter((x) => x !== id) : [...f.employee_ids, id];
      // Drop days that are no longer pending for every selected employee.
      const day_nos = f.day_nos.filter((d) => dayPendingForAll(employee_ids, d));
      return { ...f, employee_ids, day_nos };
    });
  };

  const dayPendingForAll = (employeeIds: string[], day: number): boolean => {
    if (employeeIds.length === 0) return false;
    return employeeIds.every((empId) => {
      const row = ledger.find((l) => l.employee_id === empId && l.day_no === day);
      return !row || row.status !== 'PAID';
    });
  };

  const togglePayDay = (day: number) => {
    setPayForm((f) => {
      if (f.day_nos.includes(day)) return { ...f, day_nos: f.day_nos.filter((d) => d !== day) };
      if (f.day_nos.length >= MAX_DAYS_PER_PAYMENT) { toast.error(`You can pay a maximum of ${MAX_DAYS_PER_PAYMENT} days at a time`); return f; }
      if (!dayPendingForAll(f.employee_ids, day)) { toast.error('That day is already paid for a selected employee'); return f; }
      return { ...f, day_nos: [...f.day_nos, day].sort((a, b) => a - b) };
    });
  };

  const pickAdvice = (file: File | null) => {
    if (!file) { setAdviceFile(null); return; }
    if (!ALLOWANCE_ADVICE_TYPES.includes(file.type)) { toast.error('Only PDF, JPEG or PNG files are allowed'); return; }
    if (file.size > ALLOWANCE_ADVICE_MAX_SIZE) { toast.error('File must be 15 MB or smaller'); return; }
    setAdviceFile(file);
  };

  const estimatedTotal = useMemo(() => {
    if (!selectedCycle) return 0;
    const rateByEmployee = new Map(cycleEmployees.map((ce) => [ce.employee_id, Number(ce.day_rate || 0)]));
    let sum = 0;
    for (const empId of payForm.employee_ids) {
      const rate = rateByEmployee.get(empId) || 0;
      sum += rate * payForm.day_nos.length;
    }
    return sum;
  }, [selectedCycle, cycleEmployees, payForm.employee_ids, payForm.day_nos]);

  const recordPayment = async () => {
    if (!selectedCycle) return;
    if (payForm.employee_ids.length === 0) { toast.error('Select at least one employee'); return; }
    if (payForm.day_nos.length === 0) { toast.error('Select at least one day to pay'); return; }
    if (payForm.day_nos.length > MAX_DAYS_PER_PAYMENT) { toast.error(`You can pay a maximum of ${MAX_DAYS_PER_PAYMENT} days at a time`); return; }
    setRecording(true);
    try {
      let advicePath: string | null = null;
      let adviceUrl: string | null = null;
      if (adviceFile) {
        const ext = (adviceFile.name.split('.').pop() || 'pdf').toLowerCase();
        const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `${selectedCycle.id}/${uuid}.${ext}`;
        const { error: upErr } = await supabase.storage.from(ALLOWANCE_ADVICE_BUCKET).upload(path, adviceFile, { upsert: false, contentType: adviceFile.type });
        if (upErr) throw upErr;
        advicePath = path;
        adviceUrl = path;
      }
      const { error } = await supabase.rpc('record_offshore_allowance_payment', {
        p_cycle_id: selectedCycle.id,
        p_employee_ids: payForm.employee_ids,
        p_day_nos: payForm.day_nos,
        p_reference: payForm.reference.trim() || null,
        p_payment_date: payForm.payment_date,
        p_notes: payForm.notes.trim() || null,
        p_advice_path: advicePath,
        p_advice_url: adviceUrl,
      });
      if (error) throw error;
      toast.success('Payment recorded');
      setPayOpen(false);
      await loadDetail(selectedCycle.id);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setRecording(false);
    }
  };

  const viewAdvice = async (p: AllowancePayment) => {
    if (!p.advice_path) return;
    try {
      const { data, error } = await supabase.storage.from(ALLOWANCE_ADVICE_BUCKET).createSignedUrl(p.advice_path, 3600);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const dayCount = selectedCycle ? selectedCycle.total_days : DEFAULT_CYCLE_DAYS;

  const summaryCards = [
    { label: 'Employees', value: cycleEmployees.length, icon: Users, color: 'primary' as const },
    { label: 'Days per cycle', value: dayCount, icon: CalendarDays, color: 'info' as const },
    { label: 'Days paid', value: totals.paidDays, icon: CheckCircle2, color: 'success' as const },
    { label: 'Days remaining', value: totals.remainingDays, icon: Coins, color: 'warning' as const },
    { label: 'Total paid', value: fmtMoney(totals.totalPaid, selectedCycle?.currency), icon: CircleDollarSign, color: 'success' as const },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Offshore Allowance Payments</h1>
          <p className="text-sm text-muted-foreground">
            Finance pays up to {MAX_DAYS_PER_PAYMENT} days at a time out of a {dayCount}-day cycle for multiple employees, tracks what is paid and what is left, and uploads the payment advice.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={openCycle}>
              <Plus className="mr-2 h-4 w-4" /> New Cycle
            </Button>
            <Button onClick={openPay} disabled={!selectedCycle}>
              <Wallet className="mr-2 h-4 w-4" /> Make Payment
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full max-w-sm space-y-1.5">
          <Label>Payment cycle</Label>
          <Select value={selectedId || undefined} onValueChange={setSelectedId}>
            <SelectTrigger><SelectValue placeholder={loading ? 'Loading cycles...' : 'Select a cycle'} /></SelectTrigger>
            <SelectContent>
              {cycles.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{c.project_id ? ` · ${projectMap[c.project_id]?.name || 'Project'}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedCycle && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map((card) => (
            <Card key={card.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
                <card.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedCycle && (
        <Card>
          <CardHeader>
            <CardTitle>Payment tracking</CardTitle>
            <CardDescription>
              Each cell is a day in the cycle. Green days are paid; amber days are still pending.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {cycleEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No employees attached to this cycle.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 pr-4 text-left font-medium">Employee</th>
                      <th className="py-2 pr-4 text-left font-medium">Rate / day</th>
                      <th className="py-2 pr-2 text-left font-medium">Days</th>
                      <th className="py-2 pl-2 text-left font-medium">Paid / left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleEmployees.map((ce) => {
                      const rows = ledgerByEmployee[ce.employee_id] || [];
                      const paid = rows.filter((r) => r.status === 'PAID').length;
                      return (
                        <tr key={ce.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 whitespace-nowrap">{employeeName(ce.employees)}</td>
                          <td className="py-2 pr-4 whitespace-nowrap">{fmtMoney(ce.day_rate, selectedCycle.currency)}</td>
                          <td className="py-2 pr-2">
                            <div className="flex flex-wrap gap-1">
                              {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => {
                                const row = rows.find((r) => r.day_no === d);
                                const isPaid = row?.status === 'PAID';
                                return (
                                  <span
                                    key={d}
                                    title={`Day ${d} — ${isPaid ? 'Paid' : 'Pending'}`}
                                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs font-medium ${isPaid ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}
                                  >
                                    {d}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td className="py-2 pl-2 whitespace-nowrap">
                            <Badge variant="outline" className="bg-success/10 text-success">{paid}</Badge>
                            <span className="mx-1 text-muted-foreground">/</span>
                            <Badge variant="outline" className="bg-warning/10 text-warning">{Math.max(0, dayCount - paid)}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedCycle && (
        <Card>
          <CardHeader>
            <CardTitle>Payment history</CardTitle>
            <CardDescription>Every bulk payment recorded against this cycle.</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Employees</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Advice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap">{fmtDate(p.payment_date)}</TableCell>
                      <TableCell>{p.reference || '—'}</TableCell>
                      <TableCell>{p.days_count}</TableCell>
                      <TableCell>{p.employee_count}</TableCell>
                      <TableCell className="font-medium">{fmtMoney(p.total_amount, p.currency)}</TableCell>
                      <TableCell>
                        {p.advice_path ? (
                          <Button variant="ghost" size="sm" onClick={() => viewAdvice(p)}>
                            <FileText className="mr-1 h-3 w-3" /> View
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedCycle && !loading && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Select a payment cycle to view tracking and payment history, or create a new cycle to get started.
          </CardContent>
        </Card>
      )}

      {/* New cycle dialog */}
      <Dialog open={cycleOpen} onOpenChange={(o) => (o ? setCycleOpen(true) : setCycleOpen(false))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Allowance Cycle</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Project (optional)</Label>
              <Select value={cycleForm.project_id} onValueChange={(v) => setCycleForm({ ...cycleForm, project_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL}>All projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cycle name *</Label>
              <Input value={cycleForm.name} onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })} placeholder="Offshore cycle — Oct 2026" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Start date *</Label>
                <Input type="date" value={cycleForm.start_date} onChange={(e) => setCycleForm({ ...cycleForm, start_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Total days *</Label>
                <Input type="number" min="1" value={cycleForm.total_days} onChange={(e) => setCycleForm({ ...cycleForm, total_days: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={cycleForm.currency} onValueChange={(v) => setCycleForm({ ...cycleForm, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALLOWANCE_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Rate per day (default)</Label>
              <Input type="number" min="0" step="0.01" value={cycleForm.day_rate} onChange={(e) => setCycleForm({ ...cycleForm, day_rate: e.target.value })} placeholder="120" />
            </div>
            <div className="space-y-1.5">
              <Label>Employees * ({cycleForm.employee_ids.length} selected)</Label>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {employees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active employees.</p>
                ) : (
                  employees.map((emp) => (
                    <label key={emp.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                      <Checkbox
                        checked={cycleForm.employee_ids.includes(emp.id)}
                        onCheckedChange={() => toggleCycleEmployee(emp.id)}
                      />
                      <span>{employeeName(emp)}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCycleOpen(false)}>Cancel</Button>
            <Button onClick={createCycle} disabled={creatingCycle || !cycleForm.name.trim() || cycleForm.employee_ids.length === 0}>
              {creatingCycle ? 'Creating...' : 'Create Cycle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record payment dialog */}
      <Dialog open={payOpen} onOpenChange={(o) => (o ? setPayOpen(true) : setPayOpen(false))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Make Payment</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Payment date *</Label>
                <Input type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Reference</Label>
                <Input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="PAY-0001" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Employees * ({payForm.employee_ids.length} selected)</Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {cycleEmployees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No employees in this cycle.</p>
                ) : (
                  cycleEmployees.map((ce) => (
                    <label key={ce.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                      <Checkbox
                        checked={payForm.employee_ids.includes(ce.employee_id)}
                        onCheckedChange={() => togglePayEmployee(ce.employee_id)}
                      />
                      <span className="flex-1">{employeeName(ce.employees)}</span>
                      <span className="text-xs text-muted-foreground">{fmtMoney(ce.day_rate, selectedCycle?.currency)} / day</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Days to pay * (max {MAX_DAYS_PER_PAYMENT})</Label>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => {
                  const selectable = dayPendingForAll(payForm.employee_ids, d);
                  const checked = payForm.day_nos.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={!selectable && !checked}
                      onClick={() => togglePayDay(d)}
                      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors ${
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : selectable
                            ? 'border-border bg-background hover:bg-muted'
                            : 'cursor-not-allowed border-border bg-muted text-muted-foreground opacity-60'
                      }`}
                      title={selectable ? `Day ${d}` : `Day ${d} already paid for a selected employee`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {payForm.day_nos.length} of {MAX_DAYS_PER_PAYMENT} days selected.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Payment advice (PDF / image)</Label>
              <Input type="file" accept={ALLOWANCE_ADVICE_TYPES.join(',')} onChange={(e) => pickAdvice(e.target.files?.[0] || null)} />
              {adviceFile && <p className="text-xs text-muted-foreground">{adviceFile.name}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <CircleDollarSign className="h-4 w-4" /> Estimated total
              </div>
              <p className="mt-1 text-lg font-bold">{fmtMoney(estimatedTotal, selectedCycle?.currency)}</p>
              <p className="text-xs text-muted-foreground">
                {payForm.employee_ids.length} employee(s) × {payForm.day_nos.length} day(s).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={recordPayment} disabled={recording || payForm.employee_ids.length === 0 || payForm.day_nos.length === 0}>
              {recording ? 'Recording...' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
