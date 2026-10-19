export interface Project {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  client_name: string | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number | null;
  is_offshore: boolean;
  start_date: string | null;
  end_date: string | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface WorkforceBatch {
  id: string;
  project_id: string;
  batch_type: string;
  notes: string | null;
  effective_date: string | null;
  created_by: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProjectWorkforce {
  id: string;
  project_id: string;
  employee_id: string;
  role: string | null;
  start_date: string;
  end_date: string | null;
  source: string;
  batch_id: string | null;
  notes: string | null;
  created_at?: string | null;
}

export interface ProjectShuffleRequest {
  id: string;
  project_id: string;
  batch_id: string | null;
  notes: string | null;
  effective_date: string | null;
  created_by: string | null;
  created_at?: string | null;
}

export interface ProjectShuffleItem {
  id: string;
  request_id: string;
  replaced_workforce_id: string | null;
  replaced_employee_id: string;
  replace_start_date: string;
  replace_end_date: string;
  new_employee_id: string;
  new_workforce_id: string | null;
  new_start_date: string;
  notes: string | null;
  created_at?: string | null;
}

export interface OffshoreAllowance {
  id: string;
  project_id: string | null;
  name: string;
  amount: number;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  notes: string | null;
  created_at?: string | null;
}

export interface OffshoreReportRow {
  employee_id: string;
  employee_name: string;
  project_id: string;
  project_code: string | null;
  project_name: string;
  offshore_days: number;
  allowance_amount: number;
  currency: string;
}

export interface EmployeeLite {
  id: string;
  first_name: string;
  last_name: string;
}

export const PROJECT_STATUSES = [
  { value: 'PLANNING', label: 'Planning' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CLOSED', label: 'Closed' },
];

export const WORKFORCE_SOURCES = [
  { value: 'APPEND', label: 'Appended' },
  { value: 'SHUFFLE', label: 'Shuffle' },
  { value: 'INITIAL', label: 'Initial' },
];

export const ALLOWANCE_CURRENCIES = ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR', 'AED', 'SAR', 'XOF'];

export const DEFAULT_GEOFENCE_RADIUS_M = 150;

export function fmtMeters(value?: number | string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!isFinite(n)) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} km` : `${n.toFixed(0)} m`;
}

export function labelFor(options: { value: string; label: string }[], value: string | null | undefined): string {
  if (!value) return '—';
  return options.find((o) => o.value === value)?.label ?? value.replace(/_/g, ' ');
}

const PROJECT_STATUS_CLASSES: Record<string, string> = {
  PLANNING: 'bg-info/10 text-info',
  ACTIVE: 'bg-success/10 text-success',
  ON_HOLD: 'bg-warning/10 text-warning',
  COMPLETED: 'bg-primary/10 text-primary',
  CLOSED: 'bg-muted text-muted-foreground',
};

export function projectStatusClass(status: string | null | undefined): string {
  return (status && PROJECT_STATUS_CLASSES[status]) || 'bg-muted text-muted-foreground';
}

export function employeeName(e: EmployeeLite | null | undefined): string {
  if (!e) return '—';
  return `${e.first_name} ${e.last_name}`.trim() || '—';
}

export function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = value.length === 10 ? new Date(value + 'T00:00:00') : new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtMoney(value?: number | string | null, currency = 'USD'): string {
  const n = Number(value ?? 0);
  if (!isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function fmtCoord(lat?: number | string | null, lng?: number | string | null): string {
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') return '—';
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

export function mapsUrl(lat?: number | string | null, lng?: number | string | null): string | null {
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') return null;
  return `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(value: string, days: number): string {
  const d = new Date(value + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function inclusiveDays(start?: string | null, end?: string | null): number {
  if (!start) return 0;
  const s = new Date(start + 'T00:00:00Z').getTime();
  const e = (end ? new Date(end + 'T00:00:00Z').getTime() : Date.now());
  return Math.max(0, Math.floor((e - s) / 86400000) + 1);
}

export function firstOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Offshore allowance payment & tracking.
// ---------------------------------------------------------------------------

/** A payment cycle: a 20-day offshore allowance period (optionally per project). */
export interface AllowanceCycle {
  id: string;
  project_id: string | null;
  name: string;
  start_date: string;
  end_date: string | null;
  total_days: number;
  currency: string;
  created_by: string | null;
  created_at: string;
}

/** An employee attached to a cycle, with their per-day rate. */
export interface AllowanceCycleEmployee {
  id: string;
  cycle_id: string;
  employee_id: string;
  day_rate: number;
  created_at: string;
  employees?: EmployeeLite | null;
}

/** A bulk payment batch (<= 4 days) covering many employees. */
export interface AllowancePayment {
  id: string;
  cycle_id: string;
  reference: string | null;
  payment_date: string;
  days_count: number;
  employee_count: number;
  total_amount: number;
  currency: string;
  notes: string | null;
  advice_path: string | null;
  advice_url: string | null;
  created_by: string | null;
  created_at: string;
}

/** Per-employee per-day paid/pending status. */
export interface AllowanceDayLedger {
  id: string;
  cycle_id: string;
  employee_id: string;
  day_no: number;
  status: 'PENDING' | 'PAID';
  amount: number;
  payment_id: string | null;
  paid_at: string | null;
}

/** Max days finance can pay in a single batch. */
export const MAX_DAYS_PER_PAYMENT = 4;

/** Default cycle length in days. */
export const DEFAULT_CYCLE_DAYS = 20;

/** Payment advice upload constraints (private bucket). */
export const ALLOWANCE_ADVICE_BUCKET = 'allowance-payment-advice';
export const ALLOWANCE_ADVICE_MAX_SIZE = 15 * 1024 * 1024;
export const ALLOWANCE_ADVICE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function allowanceDayStatusClass(status: string): string {
  return status === 'PAID' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning';
}

export function allowanceDayStatusLabel(status: string): string {
  return status === 'PAID' ? 'Paid' : 'Pending';
}

/**
 * Resolve the offshore allowance rate in force for a project on a given date.
 * Mirrors the SQL resolver used by the offshore report: project-specific rates
 * beat the global default, and within the same scope the latest effective_from
 * wins. Several rates can be configured for one project; this picks the one
 * that applies. Returns null when no active rate covers the date.
 */
export function resolveAllowanceRate(
  allowances: OffshoreAllowance[],
  projectId: string | null | undefined,
  onDate: string,
): OffshoreAllowance | null {
  const candidates = allowances.filter((a) => {
    if (!a.is_active) return false;
    if (a.effective_from > onDate) return false;
    if (a.effective_to && a.effective_to < onDate) return false;
    // Project-specific rates apply to their project; null project_id = default for all.
    return a.project_id === null || a.project_id === projectId;
  });
  if (candidates.length === 0) return null;
  const OPEN_END = '9999-12-31';
  candidates.sort((a, b) => {
    const pa = a.project_id ? 1 : 0;
    const pb = b.project_id ? 1 : 0;
    if (pb !== pa) return pb - pa; // project-specific first
    if (a.effective_from !== b.effective_from) return a.effective_from < b.effective_from ? 1 : -1; // latest effective_from
    const ea = a.effective_to || OPEN_END;
    const eb = b.effective_to || OPEN_END;
    if (ea !== eb) return ea < eb ? 1 : -1; // open/latest end first
    return 0;
  });
  return candidates[0];
}

/** A deployment interval (subset of project_workforce). */
export interface DeploymentInterval {
  start_date: string;
  end_date: string | null;
}

/**
 * The calendar dates in [start, end] (inclusive) the employee was deployed on
 * the project. Overlapping intervals are de-duplicated (a date appears once if
 * covered by any interval). Open-ended intervals count up to the range end.
 */
export function workedDates(
  intervals: DeploymentInterval[],
  start: string,
  end: string,
): string[] {
  if (!start || !end || end < start) return [];
  const dates: string[] = [];
  const d = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (d <= last) {
    const day = d.toISOString().slice(0, 10);
    if (intervals.some((iv) => day >= iv.start_date && (!iv.end_date || day <= iv.end_date))) dates.push(day);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Count how many calendar days in [start, end] (inclusive) the employee was
 * deployed on the project. Overlapping intervals are de-duplicated (a day is
 * counted once if covered by any interval). Open-ended intervals (end_date
 * null) count up to the range end.
 */
export function computeWorkedDays(
  intervals: DeploymentInterval[],
  start: string,
  end: string,
): number {
  return workedDates(intervals, start, end).length;
}

/** A pre-filled employee row in the New Cycle dialog (worked days + amount due). */
export interface CycleEmployeePreview {
  employee_id: string;
  name: string;
  worked_days: number;
  day_rate: number;
  amount_due: number;
}
