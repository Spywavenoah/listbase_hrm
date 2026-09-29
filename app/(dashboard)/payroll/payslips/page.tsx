'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { FileText, CheckCircle, Clock, DollarSign } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';

interface Payslip {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  status: string;
  generated_at: string;
}

export default function PayslipsPage() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [runs, setRuns] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [pRes, eRes, rRes] = await Promise.all([
        supabase.from('payslips').select('*').order('generated_at', { ascending: false }),
        supabase.from('employees').select('id, first_name, last_name'),
        supabase.from('payroll_runs').select('id, name'),
      ]);
      setPayslips((pRes.data || []) as unknown as Payslip[]);
      setEmployees(eRes.data || []);
      setRuns(rRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const empName = (id: string) => {
    const e = employees.find((e) => e.id === id);
    return e ? `${e.first_name} ${e.last_name}` : '—';
  };
  const runName = (id: string) => runs.find((r) => r.id === id)?.name || '—';

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    GENERATED: 'bg-info/10 text-info',
    PAID: 'bg-success/10 text-success',
    VOID: 'bg-destructive/10 text-destructive',
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Payslips', value: payslips.length, icon: FileText, color: 'primary' },
    { label: 'Draft', value: payslips.filter((p) => p.status === 'DRAFT').length, icon: Clock, color: 'warning' },
    { label: 'Paid', value: payslips.filter((p) => p.status === 'PAID').length, icon: CheckCircle, color: 'success' },
    {
      label: 'Total Net Pay',
      value: `$${payslips.reduce((s, p) => s + (p.net_pay || 0), 0).toLocaleString()}`,
      icon: DollarSign, color: 'info',
    },
  ];

  const columns: Column<Payslip>[] = [
    { key: 'employee', label: 'Employee', render: (p) => empName(p.employee_id) },
    { key: 'run', label: 'Payroll Run', render: (p) => runName(p.payroll_run_id) },
    { key: 'gross_pay', label: 'Gross', render: (p) => `$${(p.gross_pay || 0).toLocaleString()}` },
    { key: 'total_deductions', label: 'Deductions', render: (p) => `$${(p.total_deductions || 0).toLocaleString()}` },
    { key: 'net_pay', label: 'Net Pay', render: (p) => `$${(p.net_pay || 0).toLocaleString()}` },
    {
      key: 'generated_at', label: 'Generated',
      render: (p) => p.generated_at ? new Date(p.generated_at).toLocaleDateString() : '—',
    },
    {
      key: 'status', label: 'Status',
      render: (p) => <Badge variant="outline" className={statusColors[p.status] || ''}>{p.status}</Badge>,
    },
  ];

  return (
    <ModuleListPage
      title="Payslips"
      description="Individual employee payslip records"
      summaryCards={summaryCards}
      columns={columns}
      data={payslips}
      searchPlaceholder="Search payslips..."
    />
  );
}
