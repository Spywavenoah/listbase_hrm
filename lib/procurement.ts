export const PROC_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_APPROVAL: 'bg-warning/10 text-warning',
  PENDING: 'bg-warning/10 text-warning',
  SUBMITTED: 'bg-warning/10 text-warning',
  APPROVED: 'bg-primary/10 text-primary',
  REJECTED: 'bg-destructive/10 text-destructive',
  CONVERTED: 'bg-info/10 text-info',
  RECEIVED: 'bg-success/10 text-success',
  PARTIALLY_RECEIVED: 'bg-warning/10 text-warning',
  CLOSED: 'bg-success/10 text-success',
  CANCELLED: 'bg-destructive/10 text-destructive',
  OPEN: 'bg-primary/10 text-primary',
  REGISTERED: 'bg-muted text-muted-foreground',
  VERIFIED: 'bg-info/10 text-info',
  PARTIALLY_PAID: 'bg-warning/10 text-warning',
  PAID: 'bg-success/10 text-success',
  ACTIVE: 'bg-success/10 text-success',
  EXPIRED: 'bg-muted text-muted-foreground',
  TERMINATED: 'bg-destructive/10 text-destructive',
  PASS: 'bg-success/10 text-success',
  FAIL: 'bg-destructive/10 text-destructive',
  PARTIAL: 'bg-warning/10 text-warning',
  MATCHED: 'bg-success/10 text-success',
  DISCREPANCY: 'bg-destructive/10 text-destructive',
};

export function procStatusClass(status: string): string {
  return PROC_STATUS_COLORS[status] || 'bg-muted text-muted-foreground';
}

export function fmtMoney(value: number | string | null | undefined, currency = 'USD'): string {
  const n = Number(value || 0);
  try {
    return n.toLocaleString('en-US', { style: 'currency', currency });
  } catch {
    return `${currency} ${n.toLocaleString('en-US')}`;
  }
}

export function refNumber(prefix: string): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${year}-${rand}`;
}

export const CURRENCIES = ['USD', 'NGN', 'EUR', 'GBP', 'GHS', 'KES', 'ZAR'];

export const PURCHASE_TYPES = ['GOODS', 'SERVICES', 'BOTH'];
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
export const UOMS = ['EA', 'BOX', 'PKG', 'KG', 'L', 'M', 'HRS', 'DAY', 'SET', 'BUNDLE'];