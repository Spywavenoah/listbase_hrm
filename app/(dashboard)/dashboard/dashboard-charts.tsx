'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Area, AreaChart,
} from 'recharts';
import { supabase } from '@/lib/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

const CHART_COLORS = [
  'hsl(var(--primary))',           /* dark green */
  'hsl(var(--destructive))',       /* dark red */
  'hsl(142 70% 40%)',              /* green */
  'hsl(38 92% 50%)',               /* amber */
  'hsl(199 89% 48%)',              /* blue */
  'hsl(280 65% 60%)',              /* purple */
  'hsl(145 65% 35%)',              /* bright green */
  'hsl(355 60% 30%)',              /* dark red */
  'hsl(199 89% 48%)',
];

const tooltipStyle: React.CSSProperties = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '10px',
  fontSize: '12px',
  padding: '8px 12px',
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
};

interface ChartCardProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm card-hover">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gradient-primary">{title}</h3>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="h-8 w-8 rounded-lg bg-primary/5 flex items-center justify-center text-primary">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ChartSkeleton() {
  return <Skeleton className="h-[260px] w-full" />;
}

export function DashboardCharts() {
  const [headcountData, setHeadcountData] = useState<{ month: string; count: number }[]>([]);
  const [departmentData, setDepartmentData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [attendanceData, setAttendanceData] = useState<{ day: string; present: number; absent: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCharts() {
      try {
        const [empRes, deptRes, attendanceRes] = await Promise.all([
          supabase.from('employees').select('created_at, department_id').order('created_at', { ascending: true }),
          supabase.from('departments').select('id, name'),
          supabase.from('attendance').select('date, status').order('date', { ascending: false }).limit(500),
        ]);

        // Headcount growth over last 8 months
        const now = new Date();
        const months: { label: string; year: number; month: number }[] = [];
        for (let i = 7; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({ label: d.toLocaleDateString('en', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() });
        }
        const employees = (empRes.data || []) as { created_at: string }[];
        const headcount = months.map((m) => {
          const cutoff = new Date(m.year, m.month + 1, 0, 23, 59, 59);
          const count = employees.filter((e) => new Date(e.created_at) <= cutoff).length;
          return { month: m.label, count };
        });
        setHeadcountData(headcount);

        // Department distribution
        const departments = (deptRes.data || []) as { id: string; name: string }[];
        const empWithDept = (empRes.data || []) as { department_id: string | null }[];
        const deptCounts: Record<string, number> = {};
        for (const emp of empWithDept) {
          if (emp.department_id) {
            deptCounts[emp.department_id] = (deptCounts[emp.department_id] || 0) + 1;
          }
        }
        const deptChart = departments
          .map((d, i) => ({
            name: d.name,
            value: deptCounts[d.id] || 0,
            color: CHART_COLORS[i % CHART_COLORS.length],
          }))
          .filter((d) => d.value > 0)
          .sort((a, b) => b.value - a.value);
        setDepartmentData(deptChart);

        // Weekly attendance - last 5 working days with data
        const attendance = (attendanceRes.data || []) as { date: string; status: string }[];
        const byDate: Record<string, { present: number; absent: number }> = {};
        for (const rec of attendance) {
          if (!byDate[rec.date]) byDate[rec.date] = { present: 0, absent: 0 };
          if (rec.status === 'PRESENT' || rec.status === 'LATE') byDate[rec.date].present++;
          else if (rec.status === 'ABSENT') byDate[rec.date].absent++;
        }
        const sortedDates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1)).slice(0, 5).reverse();
        const weekly = sortedDates.map((date) => {
          const d = new Date(date + 'T00:00:00');
          return {
            day: d.toLocaleDateString('en', { weekday: 'short' }),
            present: byDate[date].present,
            absent: byDate[date].absent,
          };
        });
        setAttendanceData(weekly);
      } catch (err) {
        console.error('Failed to load charts:', err);
      } finally {
        setLoading(false);
      }
    }
    loadCharts();
  }, []);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Headcount Growth" subtitle="Employee count over the past 8 months">
          {loading ? (
            <ChartSkeleton />
          ) : headcountData.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
              No employee data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={headcountData}>
                <defs>
                  <linearGradient id="headcountGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#headcountGradient)"
                  name="Employees"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Department Distribution" subtitle="Employees by department">
          {loading ? (
            <ChartSkeleton />
          ) : departmentData.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
              No department data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={departmentData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                >
                  {departmentData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="mt-4">
        <ChartCard title="Weekly Attendance" subtitle="Present vs absent employees (recent days)">
          {loading ? (
            <ChartSkeleton />
          ) : attendanceData.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
              No attendance data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={attendanceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="present" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Present" />
                <Bar dataKey="absent" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} name="Absent" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </>
  );
}
