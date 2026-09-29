'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { supabase } from '@/lib/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

const CHART_COLORS = [
  'hsl(221 83% 53%)',
  'hsl(142 71% 45%)',
  'hsl(38 92% 50%)',
  'hsl(0 72% 51%)',
  'hsl(280 65% 60%)',
  'hsl(199 89% 48%)',
  'hsl(262 83% 58%)',
];

const tooltipStyle: React.CSSProperties = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
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

export function ProcurementCharts() {
  const [spendByVendor, setSpendByVendor] = useState<{ name: string; value: number; currency: string }[]>([]);
  const [poByStatus, setPoByStatus] = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [poRes, vendorRes] = await Promise.all([
          supabase.from('purchase_orders').select('vendor_id, total, status, currency').in('status', ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED']),
          supabase.from('procurement_vendors').select('id, name'),
        ]);
        const vendors = new Map((vendorRes.data || []).map((v) => [v.id, v.name]));
        const poRows = (poRes.data || []) as { vendor_id: string | null; total: number; status: string; currency: string }[];
        const byVendor = new Map<string, { value: number; currency: string }>();
        for (const po of poRows) {
          if (!po.vendor_id) continue;
          const name = vendors.get(po.vendor_id) || 'Unknown';
          const currency = po.currency || 'USD';
          const key = `${name}::${currency}`;
          byVendor.set(key, {
            value: (byVendor.get(key)?.value || 0) + Number(po.total || 0),
            currency,
          });
        }
        const byStatus = new Map<string, number>();
        for (const po of poRows) {
          byStatus.set(po.status, (byStatus.get(po.status) || 0) + 1);
        }
        if (!cancelled) {
          setSpendByVendor(
            Array.from(byVendor.entries())
              .map(([key, v]) => ({ name: key.split('::')[0], value: v.value, currency: v.currency }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 8)
          );
          setPoByStatus(Array.from(byStatus.entries()).map(([name, value]) => ({ name, value })));
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="Spend by Vendor" subtitle="Total value of active purchase orders per supplier (native currency)">
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : spendByVendor.length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchase order spend yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={spendByVendor} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, _name, item) => {
                  const payload = (item as { payload?: { currency?: string } }).payload;
                  return [Number(value).toLocaleString('en-US', { style: 'currency', currency: payload?.currency || 'USD' }), 'Spend'];
                }}
              />
              <Bar dataKey="value" fill="hsl(221 83% 53%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Purchase Orders by Status" subtitle="Distribution of active and historical orders">
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : poByStatus.length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchase orders recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={poByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name }) => name}>
                {poByStatus.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend formatter={(value) => <span style={{ textTransform: 'capitalize' }}>{String(value).replace(/_/g, ' ')}</span>} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}