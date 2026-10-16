export interface WhatsAppRule {
  id: string;
  phrase: string;
  action: string;
  match_type: string;
  priority: number;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export const WHATSAPP_ACTIONS = [
  { value: 'CLOCK_IN', label: 'Clock In' },
  { value: 'CLOCK_OUT', label: 'Clock Out' },
];

export const WHATSAPP_MATCH_TYPES = [
  { value: 'EXACT', label: 'Exact match' },
  { value: 'STARTS_WITH', label: 'Starts with' },
  { value: 'CONTAINS', label: 'Contains' },
];

export const WHATSAPP_SETTINGS_GROUP = 'whatsapp';

export interface WhatsAppConfig {
  enabled: string;
  phone_number_id: string;
  business_account_id: string;
  verify_token: string;
  app_secret: string;
  access_token: string;
}

export const EMPTY_WHATSAPP_CONFIG: WhatsAppConfig = {
  enabled: 'false',
  phone_number_id: '',
  business_account_id: '',
  verify_token: '',
  app_secret: '',
  access_token: '',
};

export function labelFor(
  options: { value: string; label: string }[],
  value: string | null | undefined
): string {
  if (!value) return '—';
  return options.find((o) => o.value === value)?.label ?? value.replace(/_/g, ' ');
}

export function actionClass(action: string | null | undefined): string {
  if (action === 'CLOCK_IN') return 'bg-success/10 text-success border-success/30';
  if (action === 'CLOCK_OUT') return 'bg-info/10 text-info border-info/30';
  return 'bg-muted text-muted-foreground';
}
