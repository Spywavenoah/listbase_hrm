import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * GET /api/v1/employees
 *
 * Integration endpoint for external systems. Requires an API key created on
 * the Security settings page:
 *
 *   Authorization: Bearer hrm_<key>
 *
 * Verification happens in the `api_v1_employees` SECURITY DEFINER RPC, which
 * checks the SHA-256 hash of the key (never the plaintext), bumps
 * `last_used_at`, and returns active employee basics.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  const key = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  if (!key) {
    return NextResponse.json(
      { error: 'Missing API key. Send it as: Authorization: Bearer <key>' },
      { status: 401 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await supabase.rpc('api_v1_employees', { p_key: key });

  if (error) {
    console.error('api_v1_employees RPC error:', error);
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 500 });
  }

  const result = data as { ok: boolean; code?: string; employees?: unknown[] } | null;

  if (!result || !result.ok) {
    return NextResponse.json({ error: 'Invalid or revoked API key.' }, { status: 401 });
  }

  return NextResponse.json({ employees: result.employees || [] });
}