export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
  manager_id: string | null;
  is_active: boolean;
  is_default: boolean;
  notes: string | null;
}

export interface InventoryCategory {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface InventoryItem {
  id: string;
  item_id: string | null;
  category_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  image_url: string | null;
  uom: string;
  unit_cost: number;
  reorder_level: number;
  reorder_quantity: number;
  max_stock_level: number | null;
  expiry_warning_days: number;
  is_tracked: boolean;
  is_active: boolean;
  description: string | null;
  category?: { name: string } | null;
}

export interface StockRow {
  id: string;
  item_id: string;
  warehouse_id: string;
  quantity: number;
  reserved_quantity: number;
  bin_location: string | null;
  reorder_level: number | null;
  expiry_date: string | null;
  item?: InventoryItem | null;
  warehouse?: { name: string } | null;
}

export interface MaterialRequestItem {
  id: string;
  request_id: string;
  item_id: string;
  item_name: string;
  uom: string | null;
  quantity_requested: number;
  quantity_issued: number;
  notes: string | null;
  item?: { name: string; uom: string } | null;
}

export interface MaterialRequest {
  id: string;
  request_number: string;
  requested_by: string | null;
  department_id: string | null;
  warehouse_id: string | null;
  project_id: string | null;
  usage_category: string | null;
  purpose: string | null;
  required_date: string | null;
  priority: string;
  status: string;
  notes: string | null;
  issued_by: string | null;
  issued_at: string | null;
  created_at: string;
  warehouse?: { name: string } | null;
}

export const MATERIAL_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ISSUED', 'CANCELLED'];

export const MATERIAL_USAGE_CATEGORIES = [
  { value: 'PROJECT', label: 'Project' },
  { value: 'PLANT_MACHINERY', label: 'Plant & Machinery' },
  { value: 'UTILITY', label: 'Utility' },
  { value: 'OFFICE_ADMIN_WELFARE', label: 'Office Admin & Welfare' },
  { value: 'COMMUNITY_RELATIONS', label: 'Community Relations' },
  { value: 'ICT_FLOW_LAB', label: 'ICT / Flow Lab' },
  { value: 'GENERAL', label: 'General Use' },
];

export const MATERIAL_PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

export interface Movement {
  id: string;
  movement_type: string;
  item_id: string;
  warehouse_id: string;
  dest_warehouse_id: string | null;
  quantity: number;
  resulting_quantity: number | null;
  unit_cost: number | null;
  total_cost: number | null;
  reference: string | null;
  notes: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  movement_date: string;
  performed_by: string | null;
  created_at: string;
  item?: { name: string; uom: string } | null;
  warehouse?: { name: string } | null;
  dest_warehouse?: { name: string } | null;
}

export const WAREHOUSE_TYPES = [
  { value: 'MAIN', label: 'Main store' },
  { value: 'BRANCH', label: 'Branch store' },
  { value: 'TRANSIT', label: 'Transit' },
  { value: 'QUARANTINE', label: 'Quarantine' },
  { value: 'VIRTUAL', label: 'Virtual' },
];

export const MOVEMENT_TYPES = [
  { value: 'RECEIPT', label: 'Receipt (stock in)' },
  { value: 'ISSUE', label: 'Issue (stock out)' },
  { value: 'ADJUSTMENT', label: 'Adjustment (set counted quantity)' },
  { value: 'RETURN', label: 'Return to store' },
  { value: 'OPENING', label: 'Opening balance' },
];

export const UOM_OPTIONS = ['EA', 'BOX', 'REAM', 'PKG', 'KG', 'L', 'M', 'SET', 'UNIT', 'PAIR', 'ROLL'];

export const movementLabel = (type: string) =>
  MOVEMENT_TYPES.find((m) => m.value === type)?.label.split(' (')[0] ||
  type.charAt(0) + type.slice(1).toLowerCase();

export const movementSign = (type: string) =>
  type === 'ISSUE' || type === 'TRANSFER' ? 'out' : type === 'ADJUSTMENT' ? 'adj' : 'in';

export const fmtQty = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export const fmtMoney = (n: number | null | undefined) =>
  `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : '—';
