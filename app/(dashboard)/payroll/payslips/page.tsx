'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Building2,
  CheckCircle2,
  DollarSign,
  Download,
  FileText,
  Landmark,
  Mail,
  MinusCircle,
  Paperclip,
  PlusCircle,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { getBrandVariables } from '@/lib/letterhead';
import { enqueueEmail, triggerMailProcessing } from '@/lib/notifications';
import {
  buildPayslipEmailHtml,
  downloadPayslipPdf,
  payslipMoney,
  summariseStatutory,
  type PayslipCompany,
  type PayslipDocumentData,
  type PayslipDocumentLedger,
} from '@/lib/payroll/payslip-pdf';
import {
  PAYMENT_PROOF_MAX_SIZE,
  PAYMENT_PROOF_TYPES,
  fetchPaymentProofs,
  paymentProofUrl,
  proofForPayslip,
  uploadPaymentProof,
  type PaymentProofRecord,
} from '@/lib/payroll/payment-proofs';

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
  email: string | null;
  pension_pin: string | null;
  pension_administrator: string | null;
  nsitf_number: string | null;
  tax_id: string | null;
  department_id: string | null;
  position_id: string | null;
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
  return payslipMoney(value);
}

function fmtDate(value: string | null) {
  return value ? new Date(value + (value.length === 10 ? 'T00:00:00' : '')).toLocaleDateString() : '—';
}

function periodLabel(payslip: Payslip): string {
  if (!payslip.period_start) return 'Payslip';
  const date = new Date(payslip.period_start + (payslip.period_start.length === 10 ? 'T00:00:00' : ''));
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const statusColors: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  GENERATED: 'bg-info/10 text-info',
  PAID: 'bg-success/10 text-success',
  VOID: 'bg-destructive/10 text-destructive',
};

export default function PayslipsPage() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<Record<string, EmployeeMeta>>({});
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [departments, setDepartments] = useState<Record<string, string>>({});
  const [positions, setPositions] = useState<Record<string, string>>({});
  const [proofs, setProofs] = useState<PaymentProofRecord[]>([]);
  const [company, setCompany] = useState<PayslipCompany>({});
  const [loading, setLoading] = useState(true);
  const [selectionToken, setSelectionToken] = useState(0);

  const [selected, setSelected] = useState<Payslip | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const [paidOpen, setPaidOpen] = useState(false);
  const [paidRows, setPaidRows] = useState<Payslip[]>([]);
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [savingPaid, setSavingPaid] = useState(false);

  const [emailOpen, setEmailOpen] = useState(false);
  const [emailYear, setEmailYear] = useState<string>('');
  const [emailMonth, setEmailMonth] = useState<string>('');
  const [emailing, setEmailing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pRes, eRes, rRes, dRes, pstRes] = await Promise.all([
        supabase.from('payslips').select('*').order('generated_at', { ascending: false }),
        supabase
          .from('employees')
          .select('id, employee_id, first_name, last_name, email, pension_pin, pension_administrator, nsitf_number, tax_id, department_id, position_id'),
        supabase.from('payroll_runs').select('id, name'),
        supabase.from('departments').select('id, name'),
        supabase.from('positions').select('id, title'),
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

      const deptMap: Record<string, string> = {};
      for (const d of (dRes.data || []) as { id: string; name: string }[]) deptMap[d.id] = d.name;
      setDepartments(deptMap);

      const posMap: Record<string, string> = {};
      for (const p of (pstRes.data || []) as { id: string; title: string }[]) posMap[p.id] = p.title;
      setPositions(posMap);

      try {
        setProofs(await fetchPaymentProofs());
      } catch {
        setProofs([]);
      }

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
      console.error(err);
      toast.error('Failed to load payslips: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const empName = (id: string) => {
    const e = employees[id];
    return e ? `${e.first_name} ${e.last_name}`.trim() : '—';
  };
  const empLabel = useCallback((id: string) => {
    const e = employees[id];
    return e ? `${e.first_name} ${e.last_name}`.trim() : 'Employee';
  }, [employees]);
  const runName = (id: string) => runs[id] || '—';
  const employee = selected ? employees[selected.employee_id] : undefined;

  const ledgerFor = useCallback(async (ids: string[]): Promise<Record<string, LedgerEntry[]>> => {
    const grouped: Record<string, LedgerEntry[]> = {};
    if (ids.length === 0) return grouped;
    const pageSize = 1000;
    for (let from = 0; from < 20000; from += pageSize) {
      const { data, error } = await supabase
        .from('payslip_ledger')
        .select('id, payslip_id, employee_id, entry_type, category, name, amount, formula, notes')
        .in('payslip_id', ids)
        .order('entry_type', { ascending: true })
        .order('amount', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data || []) as unknown as LedgerEntry[];
      for (const entry of page) {
        (grouped[entry.payslip_id] ||= []).push(entry);
      }
      if (page.length < pageSize) break;
    }
    return grouped;
  }, []);

  const openPayslip = async (p: Payslip) => {
    setSelected(p);
    setLedgerLoading(true);
    setLedger([]);
    try {
      const grouped = await ledgerFor([p.id]);
      setLedger(grouped[p.id] || []);
    } catch (err) {
      toast.error('Failed to load payslip entries: ' + (err as Error).message);
    } finally {
      setLedgerLoading(false);
    }
  };

  const documentFor = useCallback(
    (p: Payslip, entries: LedgerEntry[]): PayslipDocumentData => {
      const emp = employees[p.employee_id];
      return {
        payslip: {
          id: p.id,
          payslip_number: p.payslip_number,
          period_start: p.period_start,
          period_end: p.period_end,
          gross_pay: p.gross_pay,
          total_deductions: p.total_deductions,
          net_pay: p.net_pay,
          employer_cost: p.employer_cost,
          status: p.status,
        },
        employee: emp
          ? {
              ...emp,
              department: emp.department_id ? departments[emp.department_id] || null : null,
              position: emp.position_id ? positions[emp.position_id] || null : null,
            }
          : null,
        ledger: entries as PayslipDocumentLedger[],
        company,
      };
    },
    [employees, departments, positions, company]
  );

  const downloadPayslips = async (targets: Payslip[]) => {
    if (targets.length === 0) return;
    setDownloading(true);
    try {
      const grouped = await ledgerFor(targets.map((p) => p.id));
      for (const p of targets) {
        await downloadPayslipPdf(documentFor(p, grouped[p.id] || []));
      }
      toast.success(`Downloaded ${targets.length} payslip${targets.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error('Failed to download payslip: ' + (err as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const openPaidDialog = (rows: Payslip[]) => {
    const payable = rows.filter((p) => p.status !== 'PAID');
    if (payable.length === 0) {
      toast.info('The selected payslips are already marked as paid');
      return;
    }
    setPaidRows(payable);
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setReference('');
    setProofFile(null);
    setPaidOpen(true);
  };

  const pickProofFile = (file: File | null) => {
    if (!file) { setProofFile(null); return; }
    if (!PAYMENT_PROOF_TYPES.includes(file.type)) {
      toast.error('Only PDF, JPEG or PNG proof files are allowed');
      return;
    }
    if (file.size > PAYMENT_PROOF_MAX_SIZE) {
      toast.error('File must be 15 MB or smaller');
      return;
    }
    setProofFile(file);
  };

  const markAsPaid = async () => {
    if (paidRows.length === 0) return;
    setSavingPaid(true);
    const ids = paidRows.map((p) => p.id);
    const runIds = Array.from(new Set(paidRows.map((p) => p.payroll_run_id)));
    try {
      const { error } = await supabase
        .from('payslips')
        .update({ status: 'PAID', updated_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;

      if (proofFile) {
        await uploadPaymentProof({
          file: proofFile,
          payslipIds: ids,
          payrollRunId: runIds.length === 1 ? runIds[0] : null,
          paymentDate: paymentDate || null,
          reference: reference.trim() || null,
        });
      }

      for (const runId of runIds) {
        const { data: siblings } = await supabase
          .from('payslips')
          .select('id, status')
          .eq('payroll_run_id', runId);
        const rows = (siblings || []) as { id: string; status: string }[];
        if (rows.length > 0 && rows.every((row) => row.status === 'PAID')) {
          await supabase
            .from('payroll_runs')
            .update({ status: 'PAID', updated_at: new Date().toISOString() })
            .eq('id', runId);
        }
      }

      toast.success(
        `Marked ${ids.length} payslip${ids.length === 1 ? '' : 's'} as paid${proofFile ? ' and attached the payment proof' : ''}`
      );
      setPaidOpen(false);
      setSelectionToken((token) => token + 1);
      await load();
    } catch (err) {
      toast.error('Failed to mark payslips as paid: ' + (err as Error).message);
    } finally {
      setSavingPaid(false);
    }
  };

  const sendPayslips = async (targets: Payslip[]) => {
    const withEmail = targets.filter((p) => !!employees[p.employee_id]?.email);
    const missing = targets.length - withEmail.length;
    if (withEmail.length === 0) {
      toast.error('None of the selected payslips have an employee email address');
      return;
    }
    setEmailing(true);
    try {
      const grouped = await ledgerFor(withEmail.map((p) => p.id));
      for (const p of withEmail) {
        const emp = employees[p.employee_id];
        const data = documentFor(p, grouped[p.id] || []);
        const label = periodLabel(p);
        await enqueueEmail({
          eventKey: 'payroll.payslip_ready',
          recipientEmail: emp.email as string,
          recipientName: empLabel(p.employee_id),
          subject: `${company.name || 'Payslip'} — ${label} payslip`,
          bodyHtml: buildPayslipEmailHtml(data),
          metadata: {
            employee_name: empLabel(p.employee_id),
            payslip_period: label,
            payslip_number: p.payslip_number || '',
            net_pay: money(p.net_pay),
            company_name: company.name || '',
            company_address: company.address || '',
            company_phone: company.phone || '',
            company_email: company.email || '',
          },
        });
      }

      let sendError: string | null = null;
      try {
        await triggerMailProcessing();
      } catch (err) {
        sendError = (err as Error).message;
      }

      if (sendError) {
        toast.warning(
          `${withEmail.length} payslip email${withEmail.length === 1 ? '' : 's'} queued, but sending failed: ${sendError}. They will retry from the email queue.`
        );
      } else {
        toast.success(`Sent ${withEmail.length} payslip email${withEmail.length === 1 ? '' : 's'}`);
      }
      if (missing > 0) {
        toast.info(`${missing} payslip${missing === 1 ? '' : 's'} skipped because the employee has no email address`);
      }
      setEmailOpen(false);
    } catch (err) {
      toast.error('Failed to queue payslip emails: ' + (err as Error).message);
    } finally {
      setEmailing(false);
    }
  };

  const openEmailDialog = () => {
    const latest = payslips.find((p) => p.period_start);
    const date = latest?.period_start ? new Date(latest.period_start + 'T00:00:00') : new Date();
    setEmailYear(String(date.getFullYear()));
    setEmailMonth(String(date.getMonth() + 1));
    setEmailOpen(true);
  };

  const emailYears = useMemo(() => {
    const years = new Set<number>();
    for (const p of payslips) {
      if (p.period_start) years.add(new Date(p.period_start + 'T00:00:00').getFullYear());
    }
    if (years.size === 0) years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [payslips]);

  const emailTargets = useMemo(() => {
    const year = Number(emailYear);
    const month = Number(emailMonth);
    if (!year || !month) return [];
    return payslips.filter((p) => {
      if (!p.period_start) return false;
      const date = new Date(p.period_start + 'T00:00:00');
      return date.getFullYear() === year && date.getMonth() + 1 === month;
    });
  }, [payslips, emailYear, emailMonth]);

  const emailTargetsWithAddress = emailTargets.filter((p) => !!employees[p.employee_id]?.email);
  const emailMissing = emailTargets.length - emailTargetsWithAddress.length;

  const additionEntries = ledger.filter((l) => l.entry_type === 'ADDITION');
  const deductionEntries = ledger.filter((l) => l.entry_type === 'DEDUCTION');
  const employerEntries = ledger.filter((l) => l.entry_type === 'EMPLOYER');
  const statutory = summariseStatutory(ledger as PayslipDocumentLedger[]);
  const selectedProof = selected ? proofForPayslip(proofs, selected.id) : undefined;

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
      render: (p) => (
        <div>
          <p className="font-medium">{empName(p.employee_id)}</p>
          <p className="text-xs text-muted-foreground">{employees[p.employee_id]?.employee_id || 'No staff ID'}</p>
        </div>
      ),
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
      render: (p) => {
        const proof = proofForPayslip(proofs, p.id);
        return (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={statusColors[p.status] || ''}>{p.status}</Badge>
            {proof && (
              <a
                href={paymentProofUrl(proof.path)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline"
                title={`Payment proof: ${proof.file_name}`}
                onClick={(e) => e.stopPropagation()}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        );
      },
      searchText: (p) => [p.status],
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
        selectable
        selectionResetToken={selectionToken}
        toolbarActions={
          <Button variant="outline" size="sm" onClick={openEmailDialog}>
            <Mail className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Email payslips</span>
          </Button>
        }
        bulkActions={(rows) => {
          const payable = rows.filter((p) => p.status !== 'PAID');
          return (
            <>
              <Button size="sm" onClick={() => openPaidDialog(rows)} disabled={payable.length === 0}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Mark paid{payable.length !== rows.length ? ` (${payable.length})` : ''}
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadPayslips(rows)} disabled={downloading}>
                <Download className="mr-2 h-4 w-4" />
                Download PDFs
              </Button>
              <Button variant="outline" size="sm" onClick={() => sendPayslips(rows)} disabled={emailing}>
                <Mail className="mr-2 h-4 w-4" />
                Email
              </Button>
            </>
          );
        }}
        rowActions={(p) => (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => openPayslip(p)}>
              View
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="Download payslip PDF"
              onClick={() => downloadPayslips([p])}
              disabled={downloading}
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="Email this payslip"
              onClick={() => sendPayslips([p])}
              disabled={emailing}
            >
              <Mail className="h-4 w-4" />
            </Button>
          </div>
        )}
      />

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setLedger([]); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{selected?.payslip_number || 'Payslip'}</span>
              {selected && <Badge variant="outline" className={statusColors[selected.status] || ''}>{selected.status}</Badge>}
              {selectedProof && (
                <a
                  href={paymentProofUrl(selectedProof.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-normal text-info hover:underline"
                >
                  <Paperclip className="h-3.5 w-3.5" /> Payment proof
                </a>
              )}
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
                    <p className="text-sm font-semibold">{money(statutory.pensionTotal)}</p>
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
                  <PlusCircle className="h-4 w-4" /> Additions <span className="text-muted-foreground">({money(statutory.additions)})</span>
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
                  <MinusCircle className="h-4 w-4" /> Employee deductions <span className="text-muted-foreground">({money(statutory.deductions)})</span>
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
                  <Building2 className="h-4 w-4" /> Employer contributions <span className="text-muted-foreground">({money(statutory.employer)})</span>
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

          {selected && (
            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => downloadPayslips([selected])} disabled={downloading}>
                  <Download className="mr-2 h-4 w-4" /> Download PDF
                </Button>
                <Button variant="outline" onClick={() => sendPayslips([selected])} disabled={emailing}>
                  <Mail className="mr-2 h-4 w-4" /> Email payslip
                </Button>
              </div>
              {selected.status !== 'PAID' && (
                <Button onClick={() => openPaidDialog([selected])}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Mark as paid
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={paidOpen} onOpenChange={(open) => { if (!open && !savingPaid) setPaidOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mark payslips as paid</DialogTitle>
            <DialogDescription>
              {paidRows.length} payslip{paidRows.length === 1 ? '' : 's'} · {money(paidRows.reduce((s, p) => s + (p.net_pay || 0), 0))} net pay.
              Upload a cheque or payment proof if you have one; it is optional.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="payment-date">Payment date</Label>
                <Input
                  id="payment-date"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-reference">Reference</Label>
                <Input
                  id="payment-reference"
                  placeholder="Cheque or transfer reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payment-proof">Cheque / payment proof (optional)</Label>
              <Input
                id="payment-proof"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => pickProofFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">
                PDF, JPEG or PNG up to 15 MB. Stored against the selected payslips and linked from the register.
              </p>
              {proofFile && (
                <p className="flex items-center gap-1 text-xs text-success">
                  <Paperclip className="h-3 w-3" /> {proofFile.name}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaidOpen(false)} disabled={savingPaid}>
              Cancel
            </Button>
            <Button onClick={markAsPaid} disabled={savingPaid}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {savingPaid ? 'Saving...' : 'Mark as paid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={(open) => { if (!open && !emailing) setEmailOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Email payslips</DialogTitle>
            <DialogDescription>
              Pick the pay month and year. Every employee with an email address receives their payslip breakdown.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Pay month</Label>
              <Select value={emailMonth} onValueChange={setEmailMonth}>
                <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((name, index) => (
                    <SelectItem key={name} value={String(index + 1)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Select value={emailYear} onValueChange={setEmailYear}>
                <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
                <SelectContent>
                  {emailYears.map((year) => (
                    <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">
              {emailTargets.length} payslip{emailTargets.length === 1 ? '' : 's'} in {MONTH_NAMES[Number(emailMonth) - 1]} {emailYear}
            </p>
            <p className="text-xs text-muted-foreground">
              {emailTargetsWithAddress.length} will be emailed
              {emailMissing > 0 ? ` · ${emailMissing} skipped (no email address)` : ''}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)} disabled={emailing}>
              Cancel
            </Button>
            <Button
              onClick={() => sendPayslips(emailTargets)}
              disabled={emailing || emailTargetsWithAddress.length === 0}
            >
              <Mail className="mr-2 h-4 w-4" />
              {emailing ? 'Sending...' : `Send ${emailTargetsWithAddress.length || ''}`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
