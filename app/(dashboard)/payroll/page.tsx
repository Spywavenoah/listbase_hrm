'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Wallet, FileText, CheckCircle, Clock, Calculator, Sparkles, Gift } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { enqueueAndProcess } from '@/lib/notifications';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  previewPayroll,
  generatePayrollRun,
  formatMoney,
  fetchBonuses,
  createBonus,
  updateBonus,
  deleteBonus,
  type PayrollPreviewRow,
  type BonusMaster,
} from '@/lib/payroll/engine';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface PayrollRun {
  id: string;
  name: string;
  pay_period_start: string;
  pay_period_end: string;
  status: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  approved_by: string | null;
  approved_at: string | null;
}

export default function PayrollPage() {
  const { employee: currentUser } = useAccess();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', pay_period_start: '', pay_period_end: '' });
  const [approveTarget, setApproveTarget] = useState<PayrollRun | null>(null);
  const [approving, setApproving] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genForm, setGenForm] = useState({ name: '', pay_period_start: '', pay_period_end: '' });
  const [previewRows, setPreviewRows] = useState<PayrollPreviewRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [bonuses, setBonuses] = useState<BonusMaster[]>([]);
  const [bonusesLoading, setBonusesLoading] = useState(false);
  const [bonusForm, setBonusForm] = useState({
    name: '',
    employee_id: '',
    rate_type: 'FIXED',
    amount: '',
    effective_start: '',
    effective_end: '',
  });
  const [bonusSaving, setBonusSaving] = useState(false);
  const [bonusDeleting, setBonusDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('payroll_runs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRuns((data || []) as unknown as PayrollRun[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    try {
      const { error } = await supabase.from('payroll_runs').insert({
        name: form.name,
        pay_period_start: form.pay_period_start,
        pay_period_end: form.pay_period_end,
        status: 'DRAFT',
      });
      if (error) throw error;
      toast.success('Payroll run created');
      setCreateOpen(false);
      setForm({ name: '', pay_period_start: '', pay_period_end: '' });
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const handleApprove = async () => {
    if (!approveTarget) return;
    setApproving(true);
    try {
      let approverId: string | null = null;
      if (currentUser) {
        approverId = currentUser.id;
      }

      const { error } = await supabase
        .from('payroll_runs')
        .update({
          status: 'APPROVED',
          approved_at: new Date().toISOString(),
          approved_by: approverId,
        })
        .eq('id', approveTarget.id);
      if (error) throw error;
      toast.success('Payroll run approved');

      const { data: payslips } = await supabase
        .from('payslips')
        .select('employee_id')
        .eq('payroll_run_id', approveTarget.id);

      if (payslips && payslips.length > 0) {
        const empIds = payslips.map((p: { employee_id: string }) => p.employee_id);
        const { data: emps } = await supabase
          .from('employees')
          .select('email, first_name, last_name')
          .in('id', empIds);

        for (const emp of (emps || []) as { email: string; first_name: string; last_name: string }[]) {
          await enqueueAndProcess({
            eventKey: 'payroll.payslip_ready',
            recipientEmail: emp.email,
            recipientName: `${emp.first_name} ${emp.last_name}`,
            subject: `Payslip ready for ${approveTarget.name}`,
            bodyHtml: `<p>Hi ${emp.first_name},</p><p>Your payslip for <strong>${approveTarget.name}</strong> (period ${approveTarget.pay_period_start} to ${approveTarget.pay_period_end}) is now available.</p>`,
            metadata: {
              employee_name: `${emp.first_name} ${emp.last_name}`,
              payroll_name: approveTarget.name,
              net_pay: String(approveTarget.total_net),
            },
          });
        }
      }
      setApproveTarget(null);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setApproving(false);
    }
  };

  const handlePreview = async () => {
    if (!genForm.pay_period_start || !genForm.pay_period_end) {
      toast.error('Enter the pay period');
      return;
    }
    setPreviewing(true);
    try {
      const rows = await previewPayroll({
        name: genForm.name,
        pay_period_start: genForm.pay_period_start,
        pay_period_end: genForm.pay_period_end,
      });
      setPreviewRows(rows);
      if (rows.length === 0) toast.info('No eligible employees for this period');
      else toast.success(`${rows.length} employees calculated`);
    } catch (err) {
      toast.error('Failed to preview: ' + (err as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleGenerate = async () => {
    if (!genForm.pay_period_start || !genForm.pay_period_end) {
      toast.error('Enter the pay period');
      return;
    }
    setCreating(true);
    try {
      const runId = await generatePayrollRun({
        name: genForm.name,
        pay_period_start: genForm.pay_period_start,
        pay_period_end: genForm.pay_period_end,
      });
      toast.success(`Payroll run generated (${runId})`);
      setGenOpen(false);
      setPreviewRows(null);
      setGenForm({ name: '', pay_period_start: '', pay_period_end: '' });
      load();
    } catch (err) {
      toast.error('Failed to generate: ' + (err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const openGenerate = () => {
    setGenForm({ name: '', pay_period_start: '', pay_period_end: '' });
    setPreviewRows(null);
    setGenOpen(true);
  };

  const [bonusEmployees, setBonusEmployees] = useState<{ id: string; name: string }[]>([]);

  const openBonuses = async () => {
    setBonusForm({ name: '', employee_id: '', rate_type: 'FIXED', amount: '', effective_start: '', effective_end: '' });
    setBonusOpen(true);
    setBonusesLoading(true);
    try {
      const [b, e] = await Promise.all([
        fetchBonuses(),
        supabase.from('employees').select('id, first_name, last_name').order('first_name'),
      ]);
      setBonuses(b);
      if (e.error) throw e.error;
      setBonusEmployees(
        ((e.data || []) as { id: string; first_name: string; last_name: string }[]).map((x) => ({
          id: x.id,
          name: `${x.first_name} ${x.last_name}`,
        }))
      );
    } catch (err) {
      toast.error('Failed to load bonuses: ' + (err as Error).message);
    } finally {
      setBonusesLoading(false);
    }
  };

  const handleAddBonus = async () => {
    if (!bonusForm.name.trim() || !bonusForm.amount) {
      toast.error('Name and amount are required');
      return;
    }
    setBonusSaving(true);
    try {
      await createBonus({
        name: bonusForm.name.trim(),
        employee_id: bonusForm.employee_id || null,
        rate_type: (bonusForm.rate_type as 'FIXED' | 'PERCENTAGE'),
        amount: parseFloat(bonusForm.amount),
        effective_start: bonusForm.effective_start || null,
        effective_end: bonusForm.effective_end || null,
      });
      toast.success('Bonus added');
      setBonusForm({ name: '', employee_id: '', rate_type: 'FIXED', amount: '', effective_start: '', effective_end: '' });
      setBonuses(await fetchBonuses());
    } catch (err) {
      toast.error('Failed to add bonus: ' + (err as Error).message);
    } finally {
      setBonusSaving(false);
    }
  };

  const handleToggleBonus = async (bonus: BonusMaster) => {
    try {
      await updateBonus(bonus.id, { is_active: !bonus.is_active });
      setBonuses(await fetchBonuses());
    } catch (err) {
      toast.error('Failed to update bonus: ' + (err as Error).message);
    }
  };

  const handleDeleteBonus = async (bonus: BonusMaster) => {
    setBonusDeleting(bonus.id);
    try {
      await deleteBonus(bonus.id);
      setBonuses(await fetchBonuses());
    } catch (err) {
      toast.error('Failed to delete bonus: ' + (err as Error).message);
    } finally {
      setBonusDeleting(null);
    }
  };

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    CALCULATED: 'bg-info/10 text-info',
    REVIEWED: 'bg-warning/10 text-warning',
    APPROVED: 'bg-primary/10 text-primary',
    DISBURSED: 'bg-success/10 text-success',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Runs', value: runs.length, icon: Wallet, color: 'primary' },
    { label: 'Draft', value: runs.filter((r) => r.status === 'DRAFT').length, icon: FileText, color: 'warning' },
    { label: 'Approved', value: runs.filter((r) => r.status === 'APPROVED').length, icon: CheckCircle, color: 'success' },
    { label: 'Disbursed', value: runs.filter((r) => r.status === 'DISBURSED').length, icon: Clock, color: 'info' },
  ];

  const columns: Column<PayrollRun>[] = [
    { key: 'name', label: 'Run Name', sortable: true },
    { key: 'pay_period_start', label: 'Period Start', sortable: true },
    { key: 'pay_period_end', label: 'Period End', sortable: true },
    { key: 'total_gross', label: 'Gross', render: (r) => `$${(r.total_gross || 0).toLocaleString()}`, sortable: true },
    { key: 'total_net', label: 'Net', render: (r) => `$${(r.total_net || 0).toLocaleString()}`, sortable: true },
    {
      key: 'status', label: 'Status',
      render: (r) => <Badge variant="outline" className={statusColors[r.status] || ''}>{r.status}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Payroll Runs"
        description="Manage payroll cycles from draft to disbursement"
        summaryCards={summaryCards}
        columns={columns}
        data={runs}
        loading={loading}
        searchPlaceholder="Search payroll runs..."
        createLabel="New Run"
        toolbarActions={
          <>
            <Button size="sm" variant="outline" onClick={openGenerate}>
              <Calculator className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Generate Payslips</span>
              <span className="sm:hidden">Generate</span>
            </Button>
            <Button size="sm" variant="outline" onClick={openBonuses}>
              <Gift className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Bonuses</span>
              <span className="sm:hidden">Bonuses</span>
            </Button>
          </>
        }
        onCreate={() => setCreateOpen(true)}
        rowActions={(r) =>
          r.status === 'DRAFT' || r.status === 'REVIEWED' ? (
            <Button size="sm" variant="outline" className="h-7 text-success" onClick={() => setApproveTarget(r)}>
              Approve
            </Button>
          ) : null
        }
      />
      <Dialog open={genOpen} onOpenChange={(open) => { setGenOpen(open); if (!open) setPreviewRows(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Generate Payroll Run & Payslips
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Run Name (optional)</Label>
              <Input value={genForm.name} onChange={(e) => setGenForm({ ...genForm, name: e.target.value })} placeholder="e.g. September 2026 Payroll" />
              <p className="text-xs text-muted-foreground">Defaults to the period month if left blank.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Period Start</Label>
                <Input type="date" value={genForm.pay_period_start} onChange={(e) => setGenForm({ ...genForm, pay_period_start: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Period End</Label>
                <Input type="date" value={genForm.pay_period_end} onChange={(e) => setGenForm({ ...genForm, pay_period_end: e.target.value })} />
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewing}>
                {previewing ? 'Calculating...' : 'Preview'}
              </Button>
            </div>

            {previewRows && previewRows.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Monthly</TableHead>
                      <TableHead className="text-right">Bonus</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row) => (
                      <TableRow key={row.employee_id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right">{formatMoney(row.monthly_salary)}</TableCell>
                        <TableCell className="text-right">{formatMoney(row.bonus_total || 0)}</TableCell>
                        <TableCell className="text-right">{formatMoney(row.gross)}</TableCell>
                        <TableCell className="text-right text-destructive">{formatMoney(row.deductions_total)}</TableCell>
                        <TableCell className="text-right font-medium text-success">{formatMoney(row.net)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={2}></TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoney(previewRows.reduce((s, r) => s + (r.bonus_total || 0), 0))}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoney(previewRows.reduce((s, r) => s + r.gross, 0))}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-destructive">
                        {formatMoney(previewRows.reduce((s, r) => s + r.deductions_total, 0))}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-success">
                        {formatMoney(previewRows.reduce((s, r) => s + r.net, 0))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
            {previewRows && previewRows.length === 0 && (
              <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
                No eligible employees for this period.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={creating || !genForm.pay_period_start || !genForm.pay_period_end}>
              {creating ? 'Generating...' : 'Create Run & Payslips'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Payroll Run</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Run Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="August 2026 Payroll" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Period Start</Label>
                <Input type="date" value={form.pay_period_start} onChange={(e) => setForm({ ...form, pay_period_start: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Period End</Label>
                <Input type="date" value={form.pay_period_end} onChange={(e) => setForm({ ...form, pay_period_end: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bonusOpen} onOpenChange={setBonusOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              Manage Bonuses
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-lg border border-border p-4">
            <p className="mb-3 text-sm font-medium">Add bonus</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Bonus Name</Label>
                <Input value={bonusForm.name} onChange={(e) => setBonusForm({ ...bonusForm, name: e.target.value })} placeholder="e.g. 13th Month, Performance Bonus" />
              </div>
              <div className="space-y-1.5">
                <Label>Applies To</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={bonusForm.employee_id}
                  onChange={(e) => setBonusForm({ ...bonusForm, employee_id: e.target.value })}
                >
                  <option value="">All employees</option>
                  {bonusEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={bonusForm.rate_type}
                  onChange={(e) => setBonusForm({ ...bonusForm, rate_type: e.target.value })}
                >
                  <option value="FIXED">Fixed amount</option>
                  <option value="PERCENTAGE">% of monthly salary</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{bonusForm.rate_type === 'PERCENTAGE' ? 'Amount (%)' : 'Amount ($)'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={bonusForm.amount}
                  onChange={(e) => setBonusForm({ ...bonusForm, amount: e.target.value })}
                  placeholder={bonusForm.rate_type === 'PERCENTAGE' ? 'e.g. 10' : 'e.g. 500'}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Effective From</Label>
                  <Input type="date" value={bonusForm.effective_start} onChange={(e) => setBonusForm({ ...bonusForm, effective_start: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Effective Until</Label>
                  <Input type="date" value={bonusForm.effective_end} onChange={(e) => setBonusForm({ ...bonusForm, effective_end: e.target.value })} />
                </div>
              </div>
            </div>
            <Button className="mt-4" size="sm" onClick={handleAddBonus} disabled={bonusSaving}>
              {bonusSaving ? 'Saving...' : 'Add Bonus'}
            </Button>
          </div>

          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bonusesLoading ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="h-8 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ) : bonuses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No bonuses configured yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  bonuses.map((b) => {
                    const emp = bonusEmployees.find((e) => e.id === b.employee_id);
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell>{b.employee_id ? emp?.name || '—' : 'All employees'}</TableCell>
                        <TableCell className="text-right">
                          {b.rate_type === 'PERCENTAGE' ? `${b.amount}%` : formatMoney(b.amount)}
                        </TableCell>
                        <TableCell>
                          {b.effective_start || b.effective_end
                            ? `${b.effective_start || '∞'} → ${b.effective_end || '∞'}`
                            : 'Always'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={b.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>
                            {b.is_active ? 'Active' : 'Paused'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => handleToggleBonus(b)}
                            >
                              {b.is_active ? 'Pause' : 'Activate'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-destructive"
                              onClick={() => handleDeleteBonus(b)}
                              disabled={bonusDeleting === b.id}
                            >
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!approveTarget} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve payroll run?</AlertDialogTitle>
            <AlertDialogDescription>
              {approveTarget && (
                <>You are about to approve <strong>{approveTarget.name}</strong> (period {approveTarget.pay_period_start} to {approveTarget.pay_period_end}). This action will be recorded with your identity as the approver. Employees with payslips will be notified.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={approving}
              onClick={(e) => { e.preventDefault(); handleApprove(); }}
            >
              {approving ? 'Approving...' : 'Confirm Approval'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
