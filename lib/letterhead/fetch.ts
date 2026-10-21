import { supabase } from '@/lib/supabase/client';

export interface Letterhead {
  id: string;
  name: string;
  body_html: string;
  variables: unknown;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export async function getBrandVariables(): Promise<Record<string, string>> {
  const s = supabase;
  const vars: Record<string, string> = {};
  try {
    const { data } = await s
      .from('system_settings')
      .select('key, value')
      .in('group_name', ['company', 'branding']);
    for (const row of (data || []) as Array<{ key: string; value: string | null }>) {
      vars[row.key] = row.value === null || row.value === undefined ? '' : String(row.value);
    }
  } catch {
    // ignore
  }
  if (!vars.company_logo_url) vars.company_logo_url = vars.logo_url || '';
  if (!vars.app_name) vars.app_name = vars.company_name || 'HR System';
  if (!vars.company_address) vars.company_address = '';
  if (!vars.company_phone) vars.company_phone = '';
  if (!vars.company_email) vars.company_email = '';
  if (!vars.company_website) vars.company_website = '';
  if (!vars.tax_id) vars.tax_id = '';
  if (!vars.registration_number) vars.registration_number = '';
  return vars;
}

export function interpolate(html: string, vars: Record<string, string>): string {
  let out = html;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v ?? '');
  }
  return out;
}

export async function fetchLetterheads(): Promise<Letterhead[]> {
  const { data } = await supabase
    .from('company_letterheads')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name');
  return (data || []) as Letterhead[];
}

export async function fetchDefaultLetterhead(): Promise<Letterhead | null> {
  const { data } = await supabase
    .from('company_letterheads')
    .select('*')
    .eq('is_default', true)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (data) return data as Letterhead;
  const { data: fallback } = await supabase
    .from('company_letterheads')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return (fallback as Letterhead) || null;
}
