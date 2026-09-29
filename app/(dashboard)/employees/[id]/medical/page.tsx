'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Activity,
  Plus,
  Trash2,
  LineChart as LineChartIcon,
  Weight,
  HeartPulse,
  Gauge,
  CalendarDays,
  Lock,
} from 'lucide-react';
import { DynamicForm } from '@/components/field-engine/dynamic-form';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { cn } from '@/lib/utils';

interface HealthMetric {
  id: string;
  employee_id: string;
  measured_on: string;
  weight_kg: number | null;
  height_cm: number | null;
  systolic: number | null;
  diastolic: number | null;
  heart_rate: number | null;
  notes: string | null;
  created_at: string;
}

type MetricKey = 'weight_kg' | 'blood_pressure' | 'heart_rate';

const METRIC_OPTIONS: { key: MetricKey; label: string; icon: typeof Weight }[] = [
  { key: 'weight_kg', label: 'Weight', icon: Weight },
  { key: 'blood_pressure', label: 'Blood Pressure', icon: Gauge },
  { key: 'heart_rate', label: 'Heart Rate', icon: HeartPulse },
];

const COLORS: Record<string, string> = {
  weight_kg: 'hsl(221 83% 53%)',
  systolic: 'hsl(0 72% 51%)',
  diastolic: 'hsl(25 95% 53%)',
  heart_rate: 'hsl(142 71% 45%)',
};

export default function MedicalPage() {
  const params = useParams();
  const id = params.id as string;
  const { employeeId: myId, can } = useAccess();

  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<MetricKey>('weight_kg');
  const [form, setForm] = useState({
    measured_on: new Date().toISOString().slice(0, 10),
    weight_kg: '',
    height_cm: '',
    systolic: '',
    diastolic: '',
    heart_rate: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const canView = id === (myId || '') || can('employees.medical');
  const canWrite = canView;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_health_metrics')
        .select('*')
        .eq('employee_id', id)
        .order('measured_on', { ascending: true });
      if (error) throw error;
      setMetrics((data || []) as unknown as HealthMetric[]);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load health metrics: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (canView) load(); }, [load, canView]);

  const fetchSystemValues = useCallback(async (): Promise<Record<string, unknown>> => {
    const [emp, med] = await Promise.all([
      supabase.from('employees').select('blood_group, genotype').eq('id', id).maybeSingle(),
      supabase
        .from('employee_medical')
        .select('allergies, conditions, emergency_medical_contact')
        .eq('employee_id', id)
        .maybeSingle(),
    ]);
    if (emp.error) throw emp.error;
    if (med.error) throw med.error;
    const asText = (v: unknown) =>
      v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    return {
      blood_group: emp.data?.blood_group || '',
      genotype: emp.data?.genotype || '',
      allergies: asText(med.data?.allergies),
      chronic_conditions: asText(med.data?.conditions),
      emergency_medical_contact: med.data?.emergency_medical_contact || '',
    };
  }, [id]);

  const saveSystemValues = useCallback(
    async (sys: Record<string, unknown>) => {
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

      const medPayload = {
        employee_id: id,
        allergies: str(sys.allergies),
        conditions: str(sys.chronic_conditions),
        emergency_medical_contact: str(sys.emergency_medical_contact),
      };
      const existing = await supabase
        .from('employee_medical')
        .select('id')
        .eq('employee_id', id)
        .maybeSingle();
      if (existing.error) throw existing.error;

      if (existing.data) {
        const res = await supabase
          .from('employee_medical')
          .update(medPayload)
          .eq('id', existing.data.id)
          .select('id');
        if (res.error) throw res.error;
        if ((res.data || []).length === 0) {
          throw new Error('Not authorized to update this medical record');
        }
      } else {
        const res = await supabase.from('employee_medical').insert(medPayload).select('id');
        if (res.error) throw res.error;
      }

      const empRes = await supabase
        .from('employees')
        .update({
          blood_group: str(sys.blood_group),
          genotype: str(sys.genotype),
        })
        .eq('id', id)
        .select('id');
      if (empRes.error) throw empRes.error;
      if ((empRes.data || []).length === 0) {
        throw new Error('Not authorized to update blood group/genotype on the employee record');
      }
    },
    [id]
  );


  const handleAdd = async () => {
    const payload: Record<string, unknown> = { employee_id: id, measured_on: form.measured_on };
    if (form.weight_kg) payload.weight_kg = parseFloat(form.weight_kg);
    if (form.height_cm) payload.height_cm = parseFloat(form.height_cm);
    if (form.systolic) payload.systolic = parseInt(form.systolic, 10);
    if (form.diastolic) payload.diastolic = parseInt(form.diastolic, 10);
    if (form.heart_rate) payload.heart_rate = parseInt(form.heart_rate, 10);
    if (form.notes.trim()) payload.notes = form.notes.trim();

    setSaving(true);
    try {
      const { error } = await supabase.from('employee_health_metrics').insert(payload);
      if (error) throw error;
      toast.success('Reading added');
      setForm({
        measured_on: new Date().toISOString().slice(0, 10),
        weight_kg: '',
        height_cm: '',
        systolic: '',
        diastolic: '',
        heart_rate: '',
        notes: '',
      });
      load();
    } catch (err) {
      toast.error('Failed to add reading: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (metricId: string) => {
    setDeleting(metricId);
    try {
      const { error } = await supabase
        .from('employee_health_metrics')
        .delete()
        .eq('id', metricId);
      if (error) throw error;
      toast.success('Reading deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete reading: ' + (err as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  const chartData = useMemo(() => {
    return metrics.map((m) => ({
      label: m.measured_on,
      weight_kg: m.weight_kg,
      systolic: m.systolic,
      diastolic: m.diastolic,
      heart_rate: m.heart_rate,
    }));
  }, [metrics]);

  const latest = metrics[metrics.length - 1];

  const metricValue = (key: MetricKey): string | null => {
    if (!latest) return null;
    if (key === 'weight_kg') return latest.weight_kg != null ? `${latest.weight_kg} kg` : null;
    if (key === 'blood_pressure')
      return latest.systolic != null && latest.diastolic != null
        ? `${latest.systolic}/${latest.diastolic} mmHg`
        : null;
    return latest.heart_rate != null ? `${latest.heart_rate} bpm` : null;
  };

  if (!canView) {
    return (
      <Card className="animate-fade-in">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Lock className="h-10 w-10 text-muted-foreground opacity-50" />
          <div className="max-w-md">
            <p className="font-medium">Medical records are restricted</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Viewing this employee&apos;s medical information requires the
              &quot;View &amp; manage medical records&quot; privilege. Contact your
              administrator if you believe you need access.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Medical Records</CardTitle>
        </CardHeader>
        <CardContent>
          <DynamicForm
            moduleKey="employee_medical"
            recordId={id}
            systemFieldDefs={[
              { key: 'blood_group', label: 'Blood Group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], section: 'Medical Information' },
              { key: 'genotype', label: 'Genotype', type: 'select', options: ['AA', 'AS', 'SS', 'AC'], section: 'Medical Information' },
              { key: 'allergies', label: 'Known Allergies', type: 'text', section: 'Medical Information' },
              { key: 'chronic_conditions', label: 'Chronic Conditions', type: 'text', section: 'Medical Information' },
              { key: 'emergency_medical_contact', label: 'Emergency Medical Contact', type: 'text', section: 'Medical Information' },
            ]}
            fetchSystemValues={fetchSystemValues}
            onSubmitSystem={saveSystemValues}
            submitLabel="Save Medical Info"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Activity className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle className="text-lg">Health Metrics</CardTitle>
              <p className="text-sm text-muted-foreground">Vitals tracked over time</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-border p-1">
            {METRIC_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = metric === opt.key;
              return (
                <Button
                  key={opt.key}
                  size="sm"
                  variant={active ? 'default' : 'ghost'}
                  className="h-7 gap-1.5"
                  onClick={() => setMetric(opt.key)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {opt.label}
                </Button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="h-64 animate-pulse rounded-lg bg-muted" />
          ) : metrics.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-14 text-muted-foreground">
              <LineChartIcon className="h-10 w-10 opacity-40" />
              <p className="text-sm font-medium">No readings yet</p>
              <p className="text-xs">Add the first reading to start tracking trends.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {METRIC_OPTIONS.map((opt) => {
                  const value = metricValue(opt.key);
                  return (
                    <div key={opt.key} className="rounded-lg border border-border p-4">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <opt.icon className="h-3.5 w-3.5" />
                        {opt.label}
                      </div>
                      <p className="mt-1.5 text-xl font-bold">
                        {value || <span className="text-muted-foreground">—</span>}
                      </p>
                      {value && (
                        <p className="text-xs text-muted-foreground">Latest reading</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {METRIC_OPTIONS.find((m) => m.key === metric)?.label} trend
                  </p>
                  <Badge variant="outline">
                    {chartData.length} reading{chartData.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend />
                    {metric === 'weight_kg' && (
                      <Line type="monotone" dataKey="weight_kg" stroke={COLORS.weight_kg} strokeWidth={2} dot={{ r: 4 }} name="Weight (kg)" />
                    )}
                    {metric === 'blood_pressure' && (
                      <>
                        <Line type="monotone" dataKey="systolic" stroke={COLORS.systolic} strokeWidth={2} dot={{ r: 4 }} name="Systolic (mmHg)" />
                        <Line type="monotone" dataKey="diastolic" stroke={COLORS.diastolic} strokeWidth={2} dot={{ r: 4 }} name="Diastolic (mmHg)" />
                      </>
                    )}
                    {metric === 'heart_rate' && (
                      <Line type="monotone" dataKey="heart_rate" stroke={COLORS.heart_rate} strokeWidth={2} dot={{ r: 4 }} name="Heart rate (bpm)" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {canWrite && (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-sm font-medium">Add reading</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Date</Label>
                  <div className="relative">
                    <CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="date"
                      className="pl-9"
                      value={form.measured_on}
                      onChange={(e) => setForm({ ...form, measured_on: e.target.value })}
                      max={new Date().toISOString().slice(0, 10)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Weight (kg)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 72.5"
                    value={form.weight_kg}
                    onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Height (cm)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 175"
                    value={form.height_cm}
                    onChange={(e) => setForm({ ...form, height_cm: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Heart rate (bpm)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 72"
                    value={form.heart_rate}
                    onChange={(e) => setForm({ ...form, heart_rate: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-2">
                  <div className="space-y-1.5">
                    <Label>Systolic</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 120"
                      value={form.systolic}
                      onChange={(e) => setForm({ ...form, systolic: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Diastolic</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 80"
                      value={form.diastolic}
                      onChange={(e) => setForm({ ...form, diastolic: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
                  <Label>Notes (optional)</Label>
                  <Input
                    placeholder="e.g. fasting blood pressure, after morning run"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
              <Button className="mt-4" onClick={handleAdd} disabled={saving}>
                {saving ? 'Saving...' : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Reading
                  </>
                )}
              </Button>
            </div>
          )}

          {metrics.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
                <p className="text-sm font-medium">History</p>
                {metrics.length > 5 && (
                  <p className="text-xs text-muted-foreground">
                    Showing latest {Math.min(metrics.length, 10)} of {metrics.length}
                  </p>
                )}
              </div>
              <div className="scrollbar-thin max-h-80 overflow-y-auto">
                {[...metrics].reverse().slice(0, 10).map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      'flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm last:border-0'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.measured_on}</span>
                        {m.weight_kg != null && <span className="text-muted-foreground">{m.weight_kg} kg</span>}
                        {m.systolic != null && m.diastolic != null && (
                          <span className="text-muted-foreground">{m.systolic}/{m.diastolic}</span>
                        )}
                        {m.heart_rate != null && <span className="text-muted-foreground">{m.heart_rate} bpm</span>}
                      </div>
                      {m.notes && <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.notes}</p>}
                    </div>
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(m.id)}
                        disabled={deleting === m.id}
                        title="Delete reading"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}