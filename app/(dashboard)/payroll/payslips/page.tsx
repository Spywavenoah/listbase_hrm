'use client';

import { useCallback, useEffect, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileText, DollarSign, MinusCircle, PlusCircle, Building2, Landmark, ReceiptText, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

interface Payslip {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  payslip_number: string | null;
  period_start: string | null;
  period_end: string | null;
  basic_salary: number | null;
  gross_pay: number | null;
  total_deductions: number | null;
  net_pay: number | null;
  tax_amount: number | null;
  employer_cost: number | null;
  status: string;
  generated_at: string | null;
}

interface EmployeeMeta {
  id: string;
  employee_id: string | null;
  first_name: string;
  last_name: string;
  pension_pin: string | null;
  pension_administrator: string | null;
  nsitf_number: string | null;
  tax_id: string | null;
}

interface LedgerEntry {
  id: string;
  payslip_id: string;
  employee_id: string;
  entry_type: 'ADDITION' | 'DEDUCTION' | 'EMPLOYER';
  category: string;
  name: string;
  amount: number;
  formula: string | null;
  notes: string | null;
}

function money(value: number | null | undefined) {
  return `₦${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value: string | null) {
  return value ? new Date(value + (value.length === 10 ? 'T00:00:00' : '')).toLocaleDateString() : '—';
}

export default function PayslipsPage() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<Record<string, EmployeeMeta>>({});
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Payslip | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pRes, eRes, rRes] = await Promise.all([
        supabase.from('payslips').select('*').order('generated_at', { ascending: false }),
        supabase
          .from('employees')
          .select('id, employee_id, first_name, last_name, pension_pin, pension_administrator, nsitf_number, tax_id'),
        supabase.from('payroll_runs').select('id, name'),
      ]);
      if (pRes.error) throw pRes.error;
      if (eRes.error) throw eRes.error;
      if (rRes.error) throw rRes.error;

      setPayslips((pRes.data || []) as unknown as Payslip[]);

      const empMap: Record<string, EmployeeMeta> = {};
      for (const e of (eRes.data || []) as unknown as EmployeeMeta[]) empMap[e.id] = e;
      setEmployees(empMap);

      const runMap: Record<string, string> = {};
      for (const r of (rRes.data || []) as { id: string; name: string }[]) runMap[r.id] = r.name;
      setRuns(runMap);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load payslips: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openPayslip = async (p: Payslip) => {
    setSelected(p);
    setLedgerLoading(true);
    setLedger([]);
    try {
      const { data, error } = await supabase
        .from('payslip_ledger')
        .select('id, payslip_id, employee_id, entry_type, category, name, amount, formula, notes')
        .eq('payslip_id', p.id)
        .order('entry_type', { ascending: true })
        .order('amount', { ascending: false });
      if (error) throw error;
      setLedger((data || []) as unknown as LedgerEntry[]);
    } catch (err) {
      toast.error('Failed to load payslip entries: ' + (err as Error).message);
    } finally {
      setLedgerLoading(false);
    }
  };

  const empName = (id: string) => {
    const e = employees[id];
    return e ? `${e.first_name} ${e.last_name}`.trim() : '—';
  };
  const runName = (id: string) => runs[id] || '—';
  const employee = selected ? employees[selected.employee_id] : undefined;

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    GENERATED: 'bg-info/10 text-info',
    PAID: 'bg-success/10 text-success',
    VOID: 'bg-destructive/10 text-destructive',
  };

  const additionEntries = ledger.filter((l) => l.entry_type === 'ADDITION');
  const deductionEntries = ledger.filter((l) => l.entry_type === 'DEDUCTION');
  const employerEntries = ledger.filter((l) => l.entry_type === 'EMPLOYER');

  const totals = ledger.reduce(
    (acc, l) => {
      const amount = Number(l.amount || 0);
      if (l.entry_type === 'ADDITION') acc.additions += amount;
      if (l.entry_type === 'DEDUCTION') acc.deductions += amount;
      if (l.entry_type === 'EMPLOYER') acc.employer += amount;
      return acc;
    },
    { additions: 0, deductions: 0, employer: 0 }
  );

  const statutory = ledger.reduce(
    (acc, l) => {
      const amount = Number(l.amount || 0);
      if (l.category === 'PENSION') {
        if (l.entry_type === 'EMPLOYER') acc.pensionEmployer += amount;
        else acc.pensionEmployee += amount;
      }
      if (l.category === 'TAX') acc.paye += amount;
      if (l.category === 'NSITF') acc.nsitf += amount;
      return acc;
    },
    { pensionEmployee: 0, pensionEmployer: 0, paye: 0, nsitf: 0 }
  );

  const summaryCards: SummaryCard[] = [
    { label: 'Total Payslips', value: payslips.length, icon: FileText, color: 'primary' },
    {
      label: 'Total Gross',
      value: money(payslips.reduce((s, p) => s + (p.gross_pay || 0), 0)),
      icon: DollarSign, color: 'info',
    },
    {
      label: 'Total Deductions',
      value: money(payslips.reduce((s, p) => s + (p.total_deductions || 0), 0)),
      icon: MinusCircle, color: 'warning',
    },
    {
      label: 'Total Net Pay',
      value: money(payslips.reduce((s, p) => s + (p.net_pay || 0), 0)),
      icon: DollarSign, color: 'success',
    },
  ];

  const columns: Column<Payslip>[] = [
    {
      key: 'payslip_number', label: 'Payslip #',
      render: (p) => <span className="font-mono text-xs">{p.payslip_number || '—'}</span>,
    },
    {
      key: 'employee', label: 'Employee',
      render: (p) => empName(p.employee_id),
      searchText: (p) => [empName(p.employee_id), employees[p.employee_id]?.employee_id || ''],
      exportValue: (p) => empName(p.employee_id),
    },
    {
      key: 'period', label: 'Period',
      render: (p) => (p.period_start && p.period_end ? `${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}` : '—'),
      searchText: (p) => [`${p.period_start || ''} ${p.period_end || ''}`],
      exportValue: (p) => (p.period_start && p.period_end ? `${p.period_start} to ${p.period_end}` : ''),
    },
    {
      key: 'run', label: 'Payroll Run',
      render: (p) => runName(p.payroll_run_id),
      searchText: (p) => [runName(p.payroll_run_id)],
      exportValue: (p) => runName(p.payroll_run_id),
    },
    { key: 'gross_pay', label: 'Gross', render: (p) => money(p.gross_pay), className: 'text-right' },
    { key: 'total_deductions', label: 'Deductions', render: (p) => money(p.total_deductions), className: 'text-right' },
    { key: 'net_pay', label: 'Net Pay', render: (p) => money(p.net_pay), className: 'text-right' },
    {
      key: 'status', label: 'Status',
      render: (p) => <Badge variant="outline" className={statusColors[p.status] || ''}>{p.status}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Payslips"
        description="Every employee payslip with its full recorder breakdown — additions, deductions and employer contributions."
        summaryCards={summaryCards}
        columns={columns}
        data={payslips}
        loading={loading}
        searchPlaceholder="Search payslip number, employee or run..."
        emptyMessage="No payslips generated yet."
        emptyDescription="Generate a payroll run to create payslips and their recorder entries."
        rowActions={(p) => (
          <Button size="sm" variant="outline" onClick={() => openPayslip(p)}>
            View
          </Button>
        )}
      />

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setLedger([]); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-sm">{selected?.payslip_number || 'Payslip'}</span>
              {selected && <Badge variant="outline">{selected.status}</Badge>}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? `${empName(selected.employee_id)} · ${
                    selected.period_start && selected.period_end
                      ? `${fmtDate(selected.period_start)} – ${fmtDate(selected.period_end)}`
                      : runName(selected.payroll_run_id)
                  }`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {selected && employee && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 text-xs sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Staff ID</p>
                <p className="font-mono">{employee.employee_id || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Pension PIN</p>
                <p className="font-mono">{employee.pension_pin || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Pension administrator</p>
                <p>{employee.pension_administrator || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Tax ID / NSITF</p>
                <p className="font-mono">{employee.tax_id || '—'} / {employee.nsitf_number || '—'}</p>
              </div>
            </div>
          )}

          {ledgerLoading ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : (
            <div className="space-y-5 py-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Basic</p>
                  <p className="text-sm font-semibold">{money(selected?.basic_salary)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Gross</p>
                  <p className="text-sm font-semibold">{money(selected?.gross_pay)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Deductions</p>
                  <p className="text-sm font-semibold">{money(selected?.total_deductions)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Net Pay</p>
                  <p className="text-sm font-semibold">{money(selected?.net_pay)}</p>
                </div>
              </div>

              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-info">
                  <Landmark className="h-4 w-4" /> Statutory remittances
                </h3>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Pension (employee + employer)</p>
                    <p className="text-sm font-semibold">{money(statutory.pensionEmployee + statutory.pensionEmployer)}</p>
                    <p className="text-xs text-muted-foreground">
                      Employee {money(statutory.pensionEmployee)} · Employer {money(statutory.pensionEmployer)}
                    </p>
                    {employee?.pension_administrator && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {employee.pension_administrator}{employee.pension_pin ? ` · PIN ${employee.pension_pin}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><ReceiptText className="h-3 w-3" /> PAYE Tax</p>
                    <p className="text-sm font-semibold">{money(statutory.paye)}</p>
                    <p className="text-xs text-muted-foreground">Tax ID {employee?.tax_id || '—'}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="h-3 w-3" /> NSITF</p>
                    <p className="text-sm font-semibold">{money(statutory.nsitf)}</p>
                    <p className="text-xs text-muted-foreground">NSITF No. {employee?.nsitf_number || '—'}</p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-success">
                  <PlusCircle className="h-4 w-4" /> Additions <span className="text-muted-foreground">({money(totals.additions)})</span>
                </h3>
                {additionEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No additions recorded.</p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {additionEntries.map((l) => (
                      <div key={l.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <p className="text-sm">{l.name}</p>
                          <p className="text-xs text-muted-foreground">{l.category}{l.formula ? ` · ${l.formula}` : ''}{l.notes ? ` · ${l.notes}` : ''}</p>
                        </div>
                        <span className="text-sm font-medium">{money(l.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <MinusCircle className="h-4 w-4" /> Employee deductions <span className="text-muted-foreground">({money(totals.deductions)})</span>
                </h3>
                {deductionEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deductions recorded.</p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {deductionEntries.map((l) => (
                      <div key={l.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <p className="text-sm">{l.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {l.category}
                            {l.category === 'PENSION' && employee?.pension_pin ? ` · PIN ${employee.pension_pin}` : ''}
                            {l.category === 'TAX' && employee?.tax_id ? ` · Tax ID ${employee.tax_id}` : ''}
                            {l.formula ? ` · ${l.formula}` : ''}
                            {l.notes ? ` · ${l.notes}` : ''}
                          </p>
                        </div>
                        <span className="text-sm font-medium">{money(l.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-info">
                  <Building2 className="h-4 w-4" /> Employer contributions <span className="text-muted-foreground">({money(totals.employer)})</span>
                </h3>
                {employerEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No employer contributions recorded.</p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {employerEntries.map((l) => (
                      <div key={l.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <p className="text-sm">{l.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {l.category}
                            {l.category === 'PENSION' && employee?.pension_administrator ? ` · ${employee.pension_administrator}` : ''}
                            {l.category === 'NSITF' && employee?.nsitf_number ? ` · NSITF No. ${employee.nsitf_number}` : ''}
                          </p>
                        </div>
                        <span className="text-sm font-medium">{money(l.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="font-medium">Total employer cost</span>
                <span className="font-semibold">{money(selected?.employer_cost)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
