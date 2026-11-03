'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  BookOpen,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  ReceiptText,
  Search,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { csvFileName, downloadCsv } from '@/lib/export/csv';
import { getBrandVariables } from '@/lib/letterhead';
import {
  downloadRegisterPdf,
  type RegisterDocumentCompany,
  type RegisterDocumentRow,
} from '@/lib/payroll/register-pdf';

type DeductionType = 'PENSION' | 'PAYE' | 'NSITF' | 'OTHER';

interface LedgerEntry {
  id: string;
  payslip_id: string;
  employee_id: string;
  entry_type: 'ADDITION' | 'DEDUCTION' | 'EMPLOYER';
  category: string;
  name: string;
  amount: number;
}

interface PayslipMeta {
  id: string;
  payslip_number: string | null;
  period_start: string | null;
  period_end: string | null;
  payroll_run_id: string;
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

interface RegisterRow {
  key: string;
  type: DeductionType;
  name: string;
  employeeId: string;
  staffId: string;
  employeeName: string;
  pensionPin: string;
  pensionAdministrator: string;
  taxId: string;
  nsitfNumber: string;
  employeeAmount: number;
  employerAmount: number;
  total: number;
  periodStart: string | null;
  periodEnd: string | null;
  runId: string;
  runName: string;
  payslipNumber: string;
  payslipId: string;
}

const TYPE_LABELS: Record<DeductionType, string> = {
  PENSION: 'Pension',
  PAYE: 'PAYE Tax',
  NSITF: 'NSITF',
  OTHER: 'Other deduction',
};

const TYPE_BADGES: Record<DeductionType, string> = {
  PENSION: 'bg-info/10 text-info',
  PAYE: 'bg-warning/10 text-warning',
  NSITF: 'bg-success/10 text-success',
  OTHER: 'bg-muted text-muted-foreground',
};

function money(value: number | null | undefined) {
  return `₦${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value: string | null) {
  return value ? new Date(value + (value.length === 10 ? 'T00:00:00' : '')).toLocaleDateString() : '—';
}

function detectType(entry: LedgerEntry): DeductionType {
  if (entry.category === 'PENSION') return 'PENSION';
  if (entry.category === 'TAX') return 'PAYE';
  if (entry.category === 'NSITF') return 'NSITF';
  if (entry.name.toLowerCase().includes('pension')) return 'PENSION';
  if (entry.name.toLowerCase().includes('tax')) return 'PAYE';
  if (entry.name.toLowerCase().includes('nsitf')) return 'NSITF';
  return 'OTHER';
}

function statutoryId(row: RegisterRow) {
  if (row.type === 'PENSION') return row.pensionPin || '—';
  if (row.type === 'PAYE') return row.taxId || '—';
  if (row.type === 'NSITF') return row.nsitfNumber || '—';
  return '—';
}

function authority(row: RegisterRow) {
  if (row.type === 'PENSION') return row.pensionAdministrator || '—';
  if (row.type === 'PAYE') return 'Tax authority';
  if (row.type === 'NSITF') return 'NSITF';
  return '—';
}

export default function RecorderKeeperPage() {
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [payslips, setPayslips] = useState<Record<string, PayslipMeta>>({});
  const [employees, setEmployees] = useState<Record<string, EmployeeMeta>>({});
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [adminOptions, setAdminOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | DeductionType>('ALL');
  const [adminFilter, setAdminFilter] = useState('ALL');
  const [runFilter, setRunFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [company, setCompany] = useState<RegisterDocumentCompany>({});
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Page through the ledger so exports are never silently truncated.
      const ledgerRows: LedgerEntry[] = [];
      const pageSize = 1000;
      for (let from = 0; from < 20000; from += pageSize) {
        const { data, error } = await supabase
          .from('payslip_ledger')
          .select('id, payslip_id, employee_id, entry_type, category, name, amount')
          .in('entry_type', ['DEDUCTION', 'EMPLOYER'])
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data || []) as unknown as LedgerEntry[];
        ledgerRows.push(...page);
        if (page.length < pageSize) break;
      }

      const [pRes, eRes, rRes, sRes] = await Promise.all([
        supabase
          .from('payslips')
          .select('id, payslip_number, period_start, period_end, payroll_run_id'),
        supabase
          .from('employees')
          .select('id, employee_id, first_name, last_name, pension_pin, pension_administrator, nsitf_number, tax_id'),
        supabase.from('payroll_runs').select('id, name'),
        supabase
          .from('system_settings')
          .select('value')
          .eq('group_name', 'payroll')
          .eq('key', 'pension_administrators')
          .maybeSingle(),
      ]);

      if (pRes.error) throw pRes.error;
      if (eRes.error) throw eRes.error;
      if (rRes.error) throw rRes.error;

      setLedger(ledgerRows);

      const payslipMap: Record<string, PayslipMeta> = {};
      for (const p of (pRes.data || []) as unknown as PayslipMeta[]) payslipMap[p.id] = p;
      setPayslips(payslipMap);

      const empMap: Record<string, EmployeeMeta> = {};
      for (const e of (eRes.data || []) as unknown as EmployeeMeta[]) empMap[e.id] = e;
      setEmployees(empMap);

      const runMap: Record<string, string> = {};
      for (const r of (rRes.data || []) as { id: string; name: string }[]) runMap[r.id] = r.name;
      setRuns(runMap);

      const configured: string[] = [];
      const setting = sRes.data?.value as unknown;
      if (Array.isArray(setting)) {
        for (const item of setting) {
          const name = typeof item === 'string' ? item : (item as { name?: string })?.name;
          if (name) configured.push(name);
        }
      }
      const fromEmployees = Object.values(empMap)
        .map((e) => e.pension_administrator)
        .filter((v): v is string => !!v && v.trim().length > 0);
      setAdminOptions(
        Array.from(new Set([...configured, ...fromEmployees])).sort((a, b) => a.localeCompare(b))
      );

      try {
        const vars = await getBrandVariables();
        setCompany({
          name: vars.company_name,
          address: vars.company_address,
          phone: vars.company_phone,
          email: vars.company_email,
        });
      } catch {
        setCompany({});
      }
    } catch (err) {
      toast.error('Failed to load deduction register: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const map = new Map<string, RegisterRow>();

    for (const entry of ledger) {
      const payslip = payslips[entry.payslip_id];
      const employee = employees[entry.employee_id];
      const type = detectType(entry);
      const label = type === 'OTHER' ? entry.name : TYPE_LABELS[type];
      // Pension is reported once per employee per payslip, combining the
      // employee and employer shares into a single remittance line.
      const key = `${entry.payslip_id}|${entry.employee_id}|${type === 'OTHER' ? label : type}`;

      let row = map.get(key);
      if (!row) {
        row = {
          key,
          type,
          name: label,
          employeeId: entry.employee_id,
          staffId: employee?.employee_id || '',
          employeeName: employee ? `${employee.first_name} ${employee.last_name}`.trim() : '—',
          pensionPin: employee?.pension_pin || '',
          pensionAdministrator: employee?.pension_administrator || '',
          taxId: employee?.tax_id || '',
          nsitfNumber: employee?.nsitf_number || '',
          employeeAmount: 0,
          employerAmount: 0,
          total: 0,
          periodStart: payslip?.period_start || null,
          periodEnd: payslip?.period_end || null,
          runId: payslip?.payroll_run_id || '',
          runName: payslip ? runs[payslip.payroll_run_id] || '' : '',
          payslipNumber: payslip?.payslip_number || '',
          payslipId: entry.payslip_id,
        };
        map.set(key, row);
      }

      const amount = Number(entry.amount || 0);
      if (entry.entry_type === 'EMPLOYER') row.employerAmount += amount;
      else row.employeeAmount += amount;
      row.total = row.employeeAmount + row.employerAmount;
    }

    return Array.from(map.values()).sort((a, b) => {
      const period = (b.periodStart || '').localeCompare(a.periodStart || '');
      if (period !== 0) return period;
      return a.employeeName.localeCompare(b.employeeName) || a.name.localeCompare(b.name);
    });
  }, [ledger, payslips, employees, runs]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter !== 'ALL' && row.type !== typeFilter) return false;
      if (adminFilter !== 'ALL') {
        if (row.type !== 'PENSION' || row.pensionAdministrator !== adminFilter) return false;
      }
      if (runFilter !== 'ALL' && row.runId !== runFilter) return false;
      // Periods overlap the selected window (inclusive).
      if (fromDate && (row.periodEnd || row.periodStart || '') < fromDate) return false;
      if (toDate && (row.periodStart || row.periodEnd || '') > toDate) return false;
      if (!term) return true;
      return [
        row.employeeName,
        row.staffId,
        row.pensionPin,
        row.pensionAdministrator,
        row.taxId,
        row.nsitfNumber,
        row.payslipNumber,
        row.runName,
        row.name,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [rows, search, typeFilter, adminFilter, runFilter, fromDate, toDate]);

  const totals = useMemo(() => {
    const result = {
      employee: 0,
      employer: 0,
      total: 0,
      PENSION: 0,
      PAYE: 0,
      NSITF: 0,
      OTHER: 0,
      pensionEmployee: 0,
      pensionEmployer: 0,
    };
    for (const row of filtered) {
      result.employee += row.employeeAmount;
      result.employer += row.employerAmount;
      result.total += row.total;
      result[row.type] += row.total;
      if (row.type === 'PENSION') {
        result.pensionEmployee += row.employeeAmount;
        result.pensionEmployer += row.employerAmount;
      }
    }
    return result;
  }, [filtered]);

  const runOptions = useMemo(
    () =>
      Object.entries(runs)
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [runs]
  );

  const hasActiveFilters =
    !!search.trim() ||
    typeFilter !== 'ALL' ||
    adminFilter !== 'ALL' ||
    runFilter !== 'ALL' ||
    !!fromDate ||
    !!toDate;

  const resetFilters = () => {
    setSearch('');
    setTypeFilter('ALL');
    setAdminFilter('ALL');
    setRunFilter('ALL');
    setFromDate('');
    setToDate('');
  };

  const REGISTER_HEADERS = [
    'Period Start',
    'Period End',
    'Payroll Run',
    'Payslip Number',
    'Deduction Type',
    'Employee Staff ID',
    'Employee Name',
    'Pension PIN',
    'Pension Administrator',
    'Tax ID',
    'NSITF Number',
    'Employee Amount',
    'Employer Amount',
    'Total Amount',
  ];

  const csvRow = (row: RegisterRow) => [
    row.periodStart || '',
    row.periodEnd || '',
    row.runName,
    row.payslipNumber,
    TYPE_LABELS[row.type],
    row.staffId,
    row.employeeName,
    row.type === 'PENSION' ? row.pensionPin : '',
    row.type === 'PENSION' ? row.pensionAdministrator : '',
    row.type === 'PAYE' ? row.taxId : '',
    row.type === 'NSITF' ? row.nsitfNumber : '',
    row.employeeAmount,
    row.employerAmount,
    row.total,
  ];

  const registerDocumentRows = (list: RegisterRow[]): RegisterDocumentRow[] =>
    list.map((row) => ({
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      runName: row.runName,
      payslipNumber: row.payslipNumber,
      typeLabel: TYPE_LABELS[row.type],
      staffId: row.staffId,
      employeeName: row.employeeName,
      pensionPin: row.pensionPin,
      pensionAdministrator: row.pensionAdministrator,
      taxId: row.taxId,
      nsitfNumber: row.nsitfNumber,
      employeeAmount: row.employeeAmount,
      employerAmount: row.employerAmount,
      total: row.total,
    }));

  const totalsFor = (list: RegisterRow[]) =>
    list.reduce(
      (acc, row) => ({
        employee: acc.employee + row.employeeAmount,
        employer: acc.employer + row.employerAmount,
        total: acc.total + row.total,
      }),
      { employee: 0, employer: 0, total: 0 }
    );

  const fileBase = (suffix?: string) => {
    const parts = ['recorder_keeper'];
    if (suffix) parts.push(suffix);
    if (typeFilter !== 'ALL') parts.push(typeFilter.toLowerCase());
    if (adminFilter !== 'ALL') parts.push(adminFilter);
    if (fromDate) parts.push(`from_${fromDate}`);
    if (toDate) parts.push(`to_${toDate}`);
    return parts.join('_');
  };

  const exportCsv = (list: RegisterRow[], suffix?: string) => {
    if (list.length === 0) {
      toast.error('There are no entries to export for the selected filters');
      return;
    }
    downloadCsv(csvFileName(fileBase(suffix)), REGISTER_HEADERS, list.map(csvRow));
    toast.success(`Exported ${list.length} register entr${list.length === 1 ? 'y' : 'ies'} to CSV`);
  };

  const exportPdf = async (list: RegisterRow[], suffix?: string) => {
    if (list.length === 0) {
      toast.error('There are no entries to export for the selected filters');
      return;
    }
    setExporting(true);
    try {
      const windowLabel =
        fromDate || toDate
          ? `Period ${fromDate || 'start'} to ${toDate || 'date'}`
          : 'All periods';
      const pdfName = `${fileBase(suffix).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
      await downloadRegisterPdf(pdfName, {
        title: 'Deduction & Remittance Register',
        subtitle: windowLabel,
        rows: registerDocumentRows(list),
        totals: totalsFor(list),
        company,
      });
      toast.success(`Exported ${list.length} register entr${list.length === 1 ? 'y' : 'ies'} to PDF`);
    } catch (err) {
      toast.error('Failed to export register PDF: ' + (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const cards = [
    {
      label: 'Pension remittance',
      value: money(totals.PENSION),
      hint: `Employee ${money(totals.pensionEmployee)} · Employer ${money(totals.pensionEmployer)}`,
      icon: Landmark,
      color: 'text-info',
    },
    {
      label: 'PAYE Tax',
      value: money(totals.PAYE),
      hint: 'Remit to the tax authority',
      icon: ReceiptText,
      color: 'text-warning',
    },
    {
      label: 'NSITF',
      value: money(totals.NSITF),
      hint: 'Employer contribution',
      icon: ShieldCheck,
      color: 'text-success',
    },
    {
      label: 'Other deductions',
      value: money(totals.OTHER),
      hint: 'Loans, co-operatives and adjustments',
      icon: Wallet,
      color: 'text-muted-foreground',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><BookOpen className="h-6 w-6" /> Recorder Keeper</h1>
          <p className="text-sm text-muted-foreground">
            Statutory deduction register. Every entry carries the employee&apos;s staff ID, statutory PIN and pension administrator so it can be filtered, exported and remitted to PFAs, tax authorities and NSITF.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button onClick={() => exportPdf(filtered)} disabled={filtered.length === 0 || exporting}>
            <Download className="mr-2 h-4 w-4" /> {exporting ? 'Preparing...' : 'Export PDF'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className={`rounded-lg bg-muted p-2 ${card.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
                  <p className="truncate text-lg font-semibold">{card.value}</p>
                  <p className="truncate text-xs text-muted-foreground">{card.hint}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-lg">Deduction & remittance entries</CardTitle>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search employee, staff ID, PIN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={typeFilter}
              onChange={(e) => {
                const value = e.target.value as 'ALL' | DeductionType;
                setTypeFilter(value);
                if (value !== 'ALL' && value !== 'PENSION') setAdminFilter('ALL');
              }}
            >
              <option value="ALL">All deduction types</option>
              <option value="PENSION">Pension</option>
              <option value="PAYE">PAYE Tax</option>
              <option value="NSITF">NSITF</option>
              <option value="OTHER">Other deductions</option>
            </select>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={adminFilter}
              onChange={(e) => setAdminFilter(e.target.value)}
            >
              <option value="ALL">All pension administrators</option>
              {adminOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={runFilter}
              onChange={(e) => setRunFilter(e.target.value)}
            >
              <option value="ALL">All payroll runs</option>
              {runOptions.map((run) => (
                <option key={run.id} value={run.id}>{run.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1">
              <label htmlFor="register-from" className="text-xs font-medium text-muted-foreground">
                Period from
              </label>
              <Input
                id="register-from"
                type="date"
                className="w-full sm:w-auto"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="register-to" className="text-xs font-medium text-muted-foreground">
                Period to
              </label>
              <Input
                id="register-to"
                type="date"
                className="w-full sm:w-auto"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Reset filters
              </Button>
            )}
          </div>
          {adminFilter !== 'ALL' && (
            <p className="text-xs text-muted-foreground">
              Showing the pension report for <strong>{adminFilter}</strong>. Export CSV will contain only this administrator&apos;s entries.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted" />
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No deduction entries match the selected filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Period</th>
                    <th className="py-2 pr-3">Employee</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Administrator / Authority</th>
                    <th className="py-2 pr-3">Statutory ID</th>
                    <th className="py-2 pr-3 text-right">Employee</th>
                    <th className="py-2 pr-3 text-right">Employer</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 pr-3">Payslip</th>
                    <th className="py-2 pr-3">Run</th>
                    <th className="py-2 text-right">Export</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.key} className="border-b border-border/60 hover:bg-muted/50">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {row.periodStart && row.periodEnd
                          ? `${fmtDate(row.periodStart)} – ${fmtDate(row.periodEnd)}`
                          : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <p className="font-medium">{row.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{row.staffId || 'No staff ID'}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={TYPE_BADGES[row.type]}>{TYPE_LABELS[row.type]}</Badge>
                      </td>
                      <td className="py-2 pr-3">{authority(row)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{statutoryId(row)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{money(row.employeeAmount)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{money(row.employerAmount)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">{money(row.total)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{row.payslipNumber || '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{row.runName || '—'}</td>
                      <td className="py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Download this entry as CSV"
                            onClick={() =>
                              exportCsv([row], `${row.employeeName}_${row.type.toLowerCase()}`)
                            }
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Download this entry as PDF"
                            onClick={() =>
                              exportPdf([row], `${row.employeeName}_${row.type.toLowerCase()}`)
                            }
                            disabled={exporting}
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/60 font-semibold">
                    <td className="py-2 pr-3" colSpan={5}>
                      Totals ({filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'})
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{money(totals.employee)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{money(totals.employer)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{money(totals.total)}</td>
                    <td className="py-2 pr-3" />
                    <td className="py-2 pr-3" />
                    <td className="py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
