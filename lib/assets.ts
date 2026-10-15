export interface AssetCategory {
  id: string;
  code: string | null;
  name: string;
  asset_class: string;
  description: string | null;
  depreciation_method: string;
  default_useful_life_years: number | null;
  default_rate: number | null;
  is_active: boolean;
}

export interface Asset {
  id: string;
  asset_tag: string | null;
  barcode: string | null;
  name: string;
  asset_type: string | null;
  category: string | null;
  category_id: string | null;
  serial_number: string | null;
  condition_status: string;
  status: string;
  location: string | null;
  image_url: string | null;
  image_path: string | null;
  purchase_date: string | null;
  purchase_value: number | null;
  salvage_value: number | null;
  useful_life_years: number | null;
  depreciation_method: string | null;
  depreciation_rate: number | null;
  depreciation_value: number | null;
  depreciation_date: string | null;
  book_value: number | null;
  current_value: number | null;
  assigned_to: string | null;
  assigned_at: string | null;
  notes: string | null;
  created_at: string;
  category_ref?: { name: string; code: string | null; asset_class: string } | null;
}

export interface VehicleProfile {
  id: string;
  asset_id: string;
  plate_number: string | null;
  make: string | null;
  model: string | null;
  manufacture_year: number | null;
  fuel_type: string;
  engine_capacity_cc: number | null;
  num_plugs: number | null;
  tank_capacity: number | null;
  odometer: number;
}

export interface AssetRepair {
  id: string;
  asset_id: string;
  repair_number: string | null;
  repair_date: string;
  description: string;
  vendor: string | null;
  cost: number;
  downtime_days: number | null;
  status: string;
  odometer: number | null;
  performed_by: string | null;
  notes: string | null;
  asset?: { name: string; asset_tag: string | null } | null;
}

export interface FuelLog {
  id: string;
  asset_id: string;
  log_date: string;
  odometer: number;
  previous_odometer: number | null;
  distance: number | null;
  litres: number;
  unit_cost: number | null;
  total_cost: number | null;
  fuel_type: string | null;
  station: string | null;
  receipt_no: string | null;
  issued_to: string | null;
  mileage_band: string | null;
  efficiency: number | null;
  expected_efficiency: number | null;
  own_avg_efficiency: number | null;
  peer_avg_efficiency: number | null;
  anomaly_flag: boolean;
  anomaly_reason: string | null;
  asset?: { name: string; asset_tag: string | null } | null;
}

export interface MaintenanceSchedule {
  id: string;
  asset_id: string;
  title: string;
  description: string | null;
  schedule_type: string;
  recurrence: string;
  interval_days: number | null;
  interval_meter: number | null;
  lead_days: number;
  next_due_date: string | null;
  next_due_meter: number | null;
  last_completed_date: string | null;
  last_completed_meter: number | null;
  estimated_cost: number | null;
  is_active: boolean;
  notes: string | null;
  asset?: { name: string; asset_tag: string | null } | null;
}

export interface MaintenanceLog {
  id: string;
  schedule_id: string | null;
  asset_id: string;
  performed_date: string;
  description: string | null;
  cost: number | null;
  meter: number | null;
  vendor: string | null;
  next_due_date: string | null;
  next_due_meter: number | null;
}

export interface VehicleRequest {
  id: string;
  request_number: string | null;
  requested_by: string | null;
  vehicle_id: string | null;
  purpose: string;
  destination: string | null;
  departure_at: string | null;
  return_at: string | null;
  passengers: number;
  driver_id: string | null;
  status: string;
  notes: string | null;
  approved_at: string | null;
  created_at: string;
  vehicle?: { name: string; asset_tag: string | null } | null;
}

export interface VehicleRequestPassenger {
  id: string;
  request_id: string;
  employee_id: string | null;
  name: string | null;
}

export const ASSET_CLASSES = [
  { value: 'AUTOMOBILE', label: 'Automobile' },
  { value: 'PLANT_MACHINERY', label: 'Plant & Machinery' },
  { value: 'ICT', label: 'ICT Equipment' },
  { value: 'FURNITURE', label: 'Furniture & Fittings' },
  { value: 'OFFICE', label: 'Office Equipment' },
  { value: 'OTHER', label: 'Other' },
];

export const DEPRECIATION_METHODS = [
  { value: 'STRAIGHT_LINE', label: 'Straight line' },
  { value: 'REDUCING_BALANCE', label: 'Reducing balance' },
  { value: 'NONE', label: 'None' },
];

export const FUEL_TYPES = [
  { value: 'PETROL', label: 'Petrol' },
  { value: 'DIESEL', label: 'Diesel' },
  { value: 'CNG', label: 'CNG' },
  { value: 'HYBRID', label: 'Hybrid' },
  { value: 'ELECTRIC', label: 'Electric' },
];

export const REPAIR_STATUSES = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const MAINTENANCE_TYPES = [
  { value: 'PREVENTIVE', label: 'Preventive' },
  { value: 'CORRECTIVE', label: 'Corrective' },
  { value: 'INSPECTION', label: 'Inspection' },
];

export const MAINTENANCE_RECURRENCES = [
  { value: 'RECURRING', label: 'Recurring (calendar)' },
  { value: 'INTERVAL', label: 'Interval (meter reading)' },
  { value: 'ONE_TIME', label: 'One-time (specific date)' },
];

export const ASSET_STATUSES = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_REPAIR', label: 'In repair' },
  { value: 'RETIRED', label: 'Retired' },
];

export const CONDITION_STATUSES = [
  { value: 'GOOD', label: 'Good' },
  { value: 'FAIR', label: 'Fair' },
  { value: 'POOR', label: 'Poor' },
  { value: 'DAMAGED', label: 'Damaged' },
];

export const VEHICLE_REQUEST_STATUSES = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const labelFor = (
  options: { value: string; label: string }[],
  value: string | null | undefined
) => options.find((o) => o.value === value)?.label || value || '—';

export const fmtMoney = (n: number | null | undefined) =>
  `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : '—';

export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString() : '—';

export const fmtQty = (n: number | null | undefined, digits = 2) =>
  Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: digits });

export const mileageBand = (odometer: number | null | undefined) => {
  const o = Number(odometer ?? 0);
  if (o < 50000) return 'LOW';
  if (o < 200000) return 'MEDIUM';
  return 'HIGH';
};

export type DueState = 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NO_DATE';

export interface DueInfo {
  state: DueState;
  days: number | null;
  label: string;
}

export function maintenanceDueInfo(schedule: MaintenanceSchedule): DueInfo {
  if (!schedule.is_active) return { state: 'OK', days: null, label: 'Inactive' };
  if (!schedule.next_due_date) {
    if (schedule.next_due_meter != null) {
      return { state: 'OK', days: null, label: `Due at ${fmtQty(schedule.next_due_meter, 0)} km` };
    }
    return { state: 'NO_DATE', days: null, label: 'No due date' };
  }
  const due = new Date(schedule.next_due_date + 'T00:00:00');
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.round((due.getTime() - now.getTime()) / msPerDay);
  const lead = schedule.lead_days ?? 7;
  if (days < 0) return { state: 'OVERDUE', days, label: `Overdue by ${Math.abs(days)} day(s)` };
  if (days <= lead) return { state: 'DUE_SOON', days, label: `Due in ${days} day(s)` };
  return { state: 'OK', days, label: `Due in ${days} day(s)` };
}

export const dueStateClass = (state: DueState) => {
  switch (state) {
    case 'OVERDUE': return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'DUE_SOON': return 'bg-warning/10 text-warning border-warning/30';
    case 'NO_DATE': return 'bg-muted text-muted-foreground';
    default: return 'bg-success/10 text-success border-success/30';
  }
};

export const requestStatusClass = (status: string) => {
  switch (status) {
    case 'APPROVED': return 'bg-success/10 text-success border-success/30';
    case 'ASSIGNED': return 'bg-primary/10 text-primary border-primary/30';
    case 'COMPLETED': return 'bg-info/10 text-info border-info/30';
    case 'REJECTED': return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'CANCELLED': return 'bg-muted text-muted-foreground';
    default: return 'bg-warning/10 text-warning border-warning/30';
  }
};

export const isAutomobile = (a: Asset) =>
  a.category_ref?.asset_class === 'AUTOMOBILE';
