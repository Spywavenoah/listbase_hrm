'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Search, PlusCircle, MinusCircle, Building2, BookOpen } from 'lucide-react';

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

interface LedgerEntry {
  id: string;
  payslip_id: string;
  employee_id: string;
  entry_type: 'ADDITION' | 'DEDUCTION' | 'EMPLOYER';
  category: string;
  name: string;
  amount: number;
  source_code: string | null;
  formula: string | null;
  notes: string | null;
}

function money(value: number | null | undefined) {
  return `₦${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value: string | null) {
  return value ? new Date(value + (value.length === 10 ? 'T00:00:00' : '')).toLocaleDateString() : '—';
}

export default function RecorderKeeperPage() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Payslip | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, eRes, rRes] = await Promise.all([
        supabase.from('payslips').select('*').order('generated_at', { ascending: false }).limit(300),
        supabase.from('employees').select('id, first_name, last_name'),
        supabase.from('payroll_runs').select('id, name'),
      ]);
      if (pRes.error) throw pRes.error;
      setPayslips((pRes.data || []) as unknown as Payslip[]);
      const empMap: Record<string, string> = {};
      for (const e of (eRes.data || []) as { id: string; first_name: string; last_name: string }[]) {
        empMap[e.id] = `${e.first_name} ${e.last_name}`;
      }
      setEmployees(empMap);
      const runMap: Record<string, string> = {};
      for (const r of (rRes.data || []) as { id: string; name: string }[]) runMap[r.id] = r.name;
      setRuns(runMap);
    } catch (err) {
      toast.error('Failed to load ledger: ' + (err as Error).message);
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
        .select('*')
        .eq('payslip_id', p.id)
        .order('entry_type', { ascending: true })
        .order('amount', { ascending: false });
      if (error) throw error;
      setLedger((data || []) as unknown as LedgerEntry[]);
    } catch (err) {
      toast.error('Failed to load entries: ' + (err as Error).message);
    } finally {
      setLedgerLoading(false);
    }
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return payslips;
    return payslips.filter((p) => {
      const emp = (employees[p.employee_id] || '').toLowerCase();
      const run = (runs[p.payroll_run_id] || '').toLowerCase();
      return (
        emp.includes(term) ||
        run.includes(term) ||
        (p.payslip_number || '').toLowerCase().includes(term)
      );
    });
  }, [payslips, employees, runs, search]);

  const totals = useMemo(() => {
    const additions = ledger.filter((l) => l.entry_type === 'ADDITION').reduce((s, l) => s + Number(l.amount || 0), 0);
    const deductions = ledger.filter((l) => l.entry_type === 'DEDUCTION').reduce((s, l) => s + Number(l.amount || 0), 0);
    const employer = ledger.filter((l) => l.entry_type === 'EMPLOYER').reduce((s, l) => s + Number(l.amount || 0), 0);
    return { additions, deductions, employer };
  }, [ledger]);

  const additionEntries = ledger.filter((l) => l.entry_type === 'ADDITION');
  const deductionEntries = ledger.filter((l) => l.entry_type === 'DEDUCTION');
  const employerEntries = ledger.filter((l) => l.entry_type === 'EMPLOYER');

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><BookOpen className="h-6 w-6" /> Recorder Keeper</h1>
          <p className="text-sm text-muted-foreground">
            Immutable record of every addition, deduction and employer contribution on each payslip.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search payslip ID or employee..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payslip Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted" />
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No payslips recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Payslip ID</th>
                    <th className="py-2 pr-3">Employee</th>
                    <th className="py-2 pr-3">Period</th>
                    <th className="py-2 pr-3">Basic</th>
                    <th className="py-2 pr-3">Gross</th>
                    <th className="py-2 pr-3">Deductions</th>
                    <th className="py-2 pr-3">Net</th>
                    <th className="py-2 pr-3">Employer Cost</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className="border-b border-border/60 hover:bg-muted/50">
                      <td className="py-2 pr-3 font-mono text-xs">{p.payslip_number || '—'}</td>
                      <td className="py-2 pr-3">{employees[p.employee_id] || '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {p.period_start && p.period_end ? `${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}` : '—'}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{money(p.basic_salary)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{money(p.gross_pay)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{money(p.total_deductions)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap font-medium">{money(p.net_pay)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{money(p.employer_cost)}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">{p.status}</Badge>
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => openPayslip(p)}>View</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-sm">{selected?.payslip_number || 'Payslip'}</span>
              <Badge variant="outline">{selected?.status}</Badge>
            </DialogTitle>
            <DialogDescription>
              {selected ? `${employees[selected.employee_id] || 'Employee'} · ${selected.period_start && selected.period_end ? `${fmtDate(selected.period_start)} – ${fmtDate(selected.period_end)}` : runs[selected.payroll_run_id] || ''}` : ''}
            </DialogDescription>
          </DialogHeader>

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
                  <MinusCircle className="h-4 w-4" /> Deductions <span className="text-muted-foreground">({money(totals.deductions)})</span>
                </h3>
                {deductionEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deductions recorded.</p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {deductionEntries.map((l) => (
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
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-info">
                  <Building2 className="h-4 w-4" /> Employer Contributions <span className="text-muted-foreground">({money(totals.employer)})</span>
                </h3>
                {employerEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No employer contributions recorded.</p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {employerEntries.map((l) => (
                      <div key={l.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <p className="text-sm">{l.name}</p>
                          <p className="text-xs text-muted-foreground">{l.category}{l.formula ? ` · ${l.formula}` : ''}</p>
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
    </div>
  );
}
