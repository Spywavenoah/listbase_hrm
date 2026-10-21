'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { FileSignature, Clock, Gavel, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAccess } from '@/lib/access';
import { fetchMyAppraisals, employeeName, APPRAISAL_STATUS_LABELS, APPRAISAL_STATUS_COLORS, type AppraisalWithPeople } from '@/lib/appraisal';

export default function MyAppraisalsPage() {
  const router = useRouter();
  const { employeeId } = useAccess();
  const [rows, setRows] = useState<AppraisalWithPeople[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!employeeId) { setLoading(false); return; }
    try {
      setRows(await fetchMyAppraisals(employeeId));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const summaryCards: SummaryCard[] = [
    { label: 'My Appraisals', value: rows.length, icon: FileSignature, color: 'primary' },
    { label: 'Scoring', value: rows.filter((r) => r.status === 'SCORING').length, icon: Clock, color: 'info' },
    { label: 'With MD', value: rows.filter((r) => r.status === 'PENDING_MD').length, icon: Gavel, color: 'warning' },
    { label: 'Completed', value: rows.filter((r) => r.status === 'COMPLETED').length, icon: CheckCircle, color: 'success' },
  ];

  const columns: Column<AppraisalWithPeople>[] = [
    { key: 'review_cycle', label: 'Cycle' },
    { key: 'manager', label: 'Reporting Manager', render: (r) => employeeName(r.manager) },
    { key: 'md', label: 'MD', render: (r) => employeeName(r.md) },
    {
      key: 'scores', label: 'My Score',
      render: (r) => r.employee_submitted_at
        ? <Badge variant="outline" className="bg-success/10 text-success">Submitted</Badge>
        : <Badge variant="outline" className="bg-muted text-muted-foreground">Pending</Badge>,
    },
    {
      key: 'final_rating', label: 'Final',
      render: (r) => r.final_rating != null ? <span className="font-medium">{r.final_rating}</span> : '—',
    },
    {
      key: 'status', label: 'Status',
      render: (r) => (
        <Badge variant="outline" className={APPRAISAL_STATUS_COLORS[r.status] || ''}>
          {APPRAISAL_STATUS_LABELS[r.status] || r.status}
        </Badge>
      ),
    },
  ];

  return (
    <ModuleListPage
      title="My Appraisals"
      description="Your appraisal records and scoring tasks"
      summaryCards={summaryCards}
      columns={columns}
      data={rows}
      loading={loading}
      searchPlaceholder="Search my appraisals..."
      onRowClick={(r) => router.push(`/performance/appraisals/${r.id}`)}
      statusKey="status"
      statusValue={(r) => APPRAISAL_STATUS_LABELS[r.status] || r.status}
      emptyMessage="No appraisals yet."
      emptyDescription="When HR creates an appraisal for you, it will appear here."
    />
  );
}
