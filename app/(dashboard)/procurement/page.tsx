'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, ClipboardList, Wallet, Receipt, CheckCircle2, Clock, FileCheck2, Package, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { procStatusClass, fmtMoney } from '@/lib/procurement';
import { useAccess } from '@/lib/access';
import { fetchPendingApprovals, WORKFLOW_MODULE_LABELS, type PendingApproval } from '@/lib/workflow/engine';

const ProcurementCharts = dynamic(
  () => import('./procurement-charts').then((m) => m.ProcurementCharts),
  { ssr: false, loading: () => <div className="h-96 animate-pulse rounded-xl bg-muted" /> }
);

interface DashboardCounts {
  requisitions: number;
  pendingRequisitions: number;
  orders: number;
  approvedOrders: number;
  receivedOrders: number;
  unpaidInvoiceTotal: Record<string, number>;
  paidInvoiceTotal: Record<string, number>;
  vendors: number;
  invoices: number;
  contracts: number;
}

const EMPTY: DashboardCounts = {
  requisitions: 0,
  pendingRequisitions: 0,
  orders: 0,
  approvedOrders: 0,
  receivedOrders: 0,
  unpaidInvoiceTotal: {},
  paidInvoiceTotal: {},
  vendors: 0,
  invoices: 0,
  contracts: 0,
};

const fmtCurrencyGroups = (m: Record<string, number>) => {
  const parts = Object.entries(m)
    .filter(([, v]) => Math.abs(v) > 0.004)
    .map(([c, v]) => fmtMoney(v, c));
  return parts.length ? parts.join(' · ') : fmtMoney(0);
};

export default function ProcurementDashboard() {
  const router = useRouter();
  const { employee } = useAccess();
  const [counts, setCounts] = useState<DashboardCounts>(EMPTY);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [req, po, poApr, poRecv, inv, vend, cont, approvalsRows] = await Promise.all([
        supabase.from('procurement_requisitions').select('id', { count: 'exact', head: true }),
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }),
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED'),
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).in('status', ['PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED']),
        supabase.from('procurement_invoices').select('total, paid_amount, currency'),
        supabase.from('procurement_vendors').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('procurement_contracts').select('id', { count: 'exact', head: true }).neq('status', 'TERMINATED'),
        fetchPendingApprovals(),
      ]);

      const invRows = (inv.data || []) as { total: number; paid_amount: number; currency: string }[];
      const unpaidG: Record<string, number> = {};
      const paidG: Record<string, number> = {};
      for (const i of invRows) {
        const c = i.currency || 'USD';
        unpaidG[c] = (unpaidG[c] || 0) + (Number(i.total) - Number(i.paid_amount || 0));
        paidG[c] = (paidG[c] || 0) + (Number(i.paid_amount) || 0);
      }

      setApprovals(approvalsRows.filter((a) => a.module_key.startsWith('procurement.')));
      setCounts({
        requisitions: req.count || 0,
        pendingRequisitions: approvalsRows.filter((a) => a.module_key === 'procurement.requisition').length,
        orders: po.count || 0,
        approvedOrders: poApr.count || 0,
        receivedOrders: poRecv.count || 0,
        unpaidInvoiceTotal: unpaidG,
        paidInvoiceTotal: paidG,
        vendors: vend.count || 0,
        invoices: inv.data?.length || 0,
        contracts: cont.count || 0,
      });
    } catch (err) {
      console.error(err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cards = [
    { label: 'Requisitions', value: counts.requisitions, icon: ClipboardList, color: 'primary', href: '/procurement/requisitions' },
    { label: 'Pending Approvals', value: counts.pendingRequisitions, icon: Clock, color: 'warning', href: '/approvals' },
    { label: 'Purchase Orders', value: counts.orders, icon: ShoppingCart, color: 'info', href: '/procurement/purchase-orders' },
    { label: 'Active POs', value: counts.approvedOrders, icon: CheckCircle2, color: 'success', href: '/procurement/purchase-orders' },
    { label: 'Received POs', value: counts.receivedOrders, icon: Package, color: 'success', href: '/procurement/receipts' },
    { label: 'Invoices', value: counts.invoices, icon: Receipt, color: 'info', href: '/procurement/invoices' },
    { label: 'Unpaid (Invoices)', value: fmtCurrencyGroups(counts.unpaidInvoiceTotal), icon: Wallet, color: 'warning', href: '/procurement/invoices' },
    { label: 'Paid (Invoices)', value: fmtCurrencyGroups(counts.paidInvoiceTotal), icon: Wallet, color: 'success', href: '/procurement/payments' },
    { label: 'Contracts', value: counts.contracts, icon: FileCheck2, color: 'primary', href: '/procurement/contracts' },
    { label: 'Vendors', value: counts.vendors, icon: Package, color: 'info', href: '/procurement/vendors' },
  ];

  const colorClasses: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Procurement Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Source-to-pay overview · {employee?.first_name ? `Welcome, ${employee.first_name}` : ''}
        </p>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">Some procurement stats failed to load. Values may be incomplete.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(card.href)}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className={cn('flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg', colorClasses[card.color])}>
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                </div>
                {loading ? (
                  <div className="mt-3 h-8 w-20 animate-pulse rounded bg-muted" />
                ) : (
                  <p className="mt-3 text-xl sm:text-2xl font-bold">{card.value}</p>
                )}
                <p className="text-xs sm:text-sm text-muted-foreground">{card.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ProcurementCharts />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck2 className="h-4 w-4 text-primary" />
            Pending Procurement Approvals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {approvals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approval requests awaiting action in procurement workflows.</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {approvals.map((a) => (
                <button
                  key={a.instance_id}
                  onClick={() => router.push('/approvals')}
                  className="flex w-full flex-col gap-1 sm:flex-row sm:items-center sm:justify-between px-4 py-3 text-left transition-colors hover:bg-accent/50"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {a.requester_name || 'Requester'} — {WORKFLOW_MODULE_LABELS[a.module_key] || a.module_key}
                    </p>
                    <p className="text-xs text-muted-foreground">{a.workflow_name} · {a.step_title}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={procStatusClass('PENDING')}>Pending</Badge>
                    <span className="text-xs text-muted-foreground">
                      {a.initiated_at ? new Date(a.initiated_at).toLocaleString() : ''}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}