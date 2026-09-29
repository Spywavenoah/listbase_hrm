'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { supabase } from '@/lib/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertCircle, Download, Printer } from 'lucide-react';
import { downloadCsvSections, csvFileName, type CsvSection } from '@/lib/export/csv';

const CHART_COLORS = [
  'hsl(221 83% 53%)',
  'hsl(142 71% 45%)',
  'hsl(38 92% 50%)',
  'hsl(0 72% 51%)',
  'hsl(280 65% 60%)',
  'hsl(199 89% 48%)',
  'hsl(262 83% 58%)',
  'hsl(12 80% 55%)',
];

const tooltipStyle: React.CSSProperties = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
};

const monthKey = (d: string) => d.slice(0, 7);

const fmtMoney = (v: number, currency = 'USD') =>
  v.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });

const fmtCurrencyGroups = (m: Record<string, number>) => {
  const parts = Object.entries(m)
    .filter(([, v]) => Math.abs(v) > 0.004)
    .map(([c, v]) => fmtMoney(v, c));
  return parts.length ? parts.join(' · ') : fmtMoney(0);
};

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export default function ProcurementReportsPage() {
  const [monthlySpend, setMonthlySpend] = useState<{ name: string; value: number; currency: string }[]>([]);
  const [categorySpend, setCategorySpend] = useState<{ name: string; value: number; currency: string }[]>([]);
  const [reqFunnel, setReqFunnel] = useState<{ name: string; value: number }[]>([]);
  const [invoiceAging, setInvoiceAging] = useState<{ name: string; value: number }[]>([]);
  const [stats, setStats] = useState<{ monthLabel: string; openPOs: number; unpaid: Record<string, number>; onTime: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [poRes, reqRes, catRes, invRes, quoRes] = await Promise.all([
          supabase.from('purchase_orders').select('id, status, total, currency, vendor_id, requisition_id, created_at').order('created_at', { ascending: true }),
          supabase.from('procurement_requisitions').select('id, category_id, status'),
          supabase.from('procurement_categories').select('id, name'),
          supabase.from('procurement_invoices').select('status, total, paid_amount, currency, due_date, created_at'),
          supabase.from('procurement_quotations').select('status, total, lead_time_days'),
        ]);
        if (cancelled) return;

        const pos = (poRes.data || []) as { id: string; status: string; total: number; currency: string; vendor_id: string | null; requisition_id: string | null; created_at: string }[];
        const reqs = (reqRes.data || []) as { id: string; category_id: string | null; status: string }[];
        const cats = new Map((catRes.data || []).map((c) => [c.id, c.name]));
        const invoices = (invRes.data || []) as { status: string; total: number; paid_amount: number; currency: string; due_date: string | null; created_at: string }[];
        const quotes = (quoRes.data || []) as { status: string; total: number; lead_time_days: number | null }[];

        const activeStatuses = ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'];

        // Monthly PO spend (per record currency)
        const byMonth = new Map<string, { value: number; currency: string }>();
        for (const po of pos) {
          if (!activeStatuses.includes(po.status)) continue;
          const mk = monthKey(po.created_at);
          const currency = po.currency || 'USD';
          const key = `${mk}::${currency}`;
          byMonth.set(key, {
            value: (byMonth.get(key)?.value || 0) + Number(po.total || 0),
            currency,
          });
        }
        setMonthlySpend(
          Array.from(byMonth.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, v]) => ({ name: key.split('::')[0], value: v.value, currency: v.currency }))
        );

        // Spend by category (PO -> requisition -> category), per record currency
        const catMap = new Map<string, { name: string; value: number; currency: string }>();
        for (const po of pos) {
          if (!activeStatuses.includes(po.status)) continue;
          const catName = po.requisition_id ? cats.get(reqs.find((r) => r.id === po.requisition_id)?.category_id || '') || 'Uncategorized' : 'Uncategorized';
          const currency = po.currency || 'USD';
          const key = `${catName}::${currency}`;
          const entry = catMap.get(key) || { name: catName, value: 0, currency };
          entry.value += Number(po.total || 0);
          catMap.set(key, entry);
        }
        setCategorySpend(
          Array.from(catMap.values())
            .filter((v) => v.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, 8)
        );

        // Requisition funnel
        const funnel = new Map<string, number>();
        for (const r of reqs) funnel.set(r.status, (funnel.get(r.status) || 0) + 1);
        setReqFunnel(Array.from(funnel.entries()).map(([name, value]) => ({ name, value })));

        // Invoice aging on overdue/unpaid balances
        const buckets = new Map<string, number>();
        buckets.set('On time', 0);
        buckets.set('Overdue ≤ 30d', 0);
        buckets.set('Overdue 31–60d', 0);
        buckets.set('Overdue > 60d', 0);
        let unpaidG: Record<string, number> = {};
        for (const inv of invoices) {
          if (inv.status === 'PAID' || inv.status === 'CANCELLED') continue;
          const remaining = Number(inv.total) - Number(inv.paid_amount || 0);
          if (remaining <= 0) continue;
          const c = inv.currency || 'USD';
          unpaidG[c] = (unpaidG[c] || 0) + remaining;
          const due = inv.due_date ? new Date(inv.due_date).getTime() : 0;
          const overdueDays = due ? Math.floor((Date.now() - due) / 86400000) : 0;
          const key = overdueDays <= 0 ? 'On time' : overdueDays <= 30 ? 'Overdue ≤ 30d' : overdueDays <= 60 ? 'Overdue 31–60d' : 'Overdue > 60d';
          buckets.set(key, (buckets.get(key) || 0) + 1);
        }
        setInvoiceAging(Array.from(buckets.entries()).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })));

        const lastMonth = Array.from(byMonth.keys()).sort().pop();
        const winners = quotes.filter((q) => q.status === 'WINNER' || q.status === 'SELECTED');
        const avgLead = winners.length
          ? Math.round(winners.reduce((s, q) => s + (Number(q.lead_time_days) || 0), 0) / winners.length)
          : null;
        setStats({
          monthLabel: lastMonth || '—',
          openPOs: pos.filter((p) => ['PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status)).length,
          unpaid: unpaidG,
          onTime: avgLead !== null ? `${avgLead} days` : '—',
        });
      } catch (err) {
        console.error(err);
        setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleExportCsv = () => {
    const sections: CsvSection[] = [
      {
        title: 'Summary',
        headers: ['Metric', 'Value'],
        rows: stats
          ? [
              ['Last Month With PO Activity', stats.monthLabel],
              ['Open Purchase Orders', stats.openPOs],
              ['Unpaid Invoice Balance', fmtCurrencyGroups(stats.unpaid)],
              ['Avg. Supplier Lead Time (Winners)', stats.onTime],
            ]
          : [],
      },
      {
        title: 'Purchase Order Spend by Month',
        headers: ['Month', 'Amount', 'Currency'],
        rows: monthlySpend.map((m) => [m.name, m.value, m.currency]),
      },
      {
        title: 'Spend by Category',
        headers: ['Category', 'Amount', 'Currency'],
        rows: categorySpend.map((c) => [c.name, c.value, c.currency]),
      },
      {
        title: 'Requisition Funnel',
        headers: ['Status', 'Requisitions'],
        rows: reqFunnel.map((r) => [r.name, r.value]),
      },
      {
        title: 'Invoice Aging',
        headers: ['Bucket', 'Invoices'],
        rows: invoiceAging.map((b) => [b.name, b.value]),
      },
    ];
    downloadCsvSections(csvFileName('procurement_reports'), sections);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Procurement Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Spend, funnel and supplier performance analytics</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={loading}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            Print
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Failed to load procurement analytics.
        </div>
      )}

      {!error && stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">PO spend (last month with activity)</p>
            <p className="mt-1 text-xl font-semibold">{stats.monthLabel}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Open purchase orders</p>
            <p className="mt-1 text-xl font-semibold">{stats.openPOs}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Unpaid invoice balance</p>
            <p className="mt-1 text-xl font-semibold">{fmtCurrencyGroups(stats.unpaid)}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Avg. supplier lead time (winners)</p>
            <p className="mt-1 text-xl font-semibold">{stats.onTime}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Purchase Order Spend" subtitle="Total value of active POs by month">
          {loading ? <Skeleton className="h-[260px] w-full" /> : monthlySpend.length === 0 ? <Empty>No PO spend recorded yet.</Empty> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlySpend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value, _n, item) => {
                  const payload = (item as { payload?: { currency?: string } }).payload;
                  return [fmtMoney(Number(value), payload?.currency || 'USD'), 'Spend'];
                }} />
                <Bar dataKey="value" fill="hsl(221 83% 53%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Spend by Category" subtitle="Allocated via requisition category">
          {loading ? <Skeleton className="h-[260px] w-full" /> : categorySpend.length === 0 ? <Empty>No categorized spend yet.</Empty> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categorySpend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value, _n, item) => {
                  const payload = (item as { payload?: { currency?: string } }).payload;
                  return [fmtMoney(Number(value), payload?.currency || 'USD'), 'Spend'];
                }} />
                <Bar dataKey="value" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Requisition Funnel" subtitle="Distribution of requisitions by status">
          {loading ? <Skeleton className="h-[260px] w-full" /> : reqFunnel.length === 0 ? <Empty>No requisitions yet.</Empty> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={reqFunnel} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name }) => name}>
                  {reqFunnel.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend formatter={(value) => <span style={{ textTransform: 'capitalize' }}>{String(value).replace(/_/g, ' ')}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Invoice Aging" subtitle="Overdue buckets on unpaid invoice balances">
          {loading ? <Skeleton className="h-[260px] w-full" /> : invoiceAging.length === 0 ? <Empty>All invoices are settled.</Empty> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={invoiceAging} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name }) => name}>
                  {invoiceAging.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend formatter={(value) => <span style={{ textTransform: 'capitalize' }}>{String(value).replace(/_/g, ' ')}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}