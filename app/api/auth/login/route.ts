import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

export const runtime = 'nodejs';

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await supabase.rpc('authenticate_employee', {
    p_email: email,
    p_password: password,
  });

  if (error) {
    console.error('authenticate_employee RPC error:', error);
    return NextResponse.json(
      { error: 'Authentication service unavailable.' },
      { status: 500 }
    );
  }

  const result = data as {
    ok: boolean;
    code?: string;
    employee_id?: string;
    email?: string;
    role?: string;
    first_name?: string;
    last_name?: string;
    must_change_password?: boolean;
  } | null;

  if (!result || !result.ok || !result.employee_id) {
    const status =
      result?.code === 'NO_PASSWORD' || result?.code === 'LOCKED' ? 403 : 401;
    const message =
      result?.code === 'NO_PASSWORD'
        ? 'No password has been set yet. Use the invitation link sent to your email to set up your password.'
        : result?.code === 'LOCKED'
          ? 'This account is locked. Contact your administrator.'
          : 'Invalid email or password.';
    return NextResponse.json({ error: message }, { status });
  }

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error('SUPABASE_JWT_SECRET is not configured');
    return NextResponse.json(
      { error: 'Authentication service is not configured.' },
      { status: 500 }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 8 * 60 * 60;

  const accessToken = signJwt(
    {
      sub: result.employee_id,
      email: result.email,
      role: 'authenticated',
      aud: 'authenticated',
      iat: now,
      exp: expiresAt,
    },
    secret
  );

  return NextResponse.json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_at: expiresAt,
    must_change_password: result.must_change_password === true,
    employee: {
      id: result.employee_id,
      email: result.email,
      role: result.role,
      first_name: result.first_name,
      last_name: result.last_name,
    },
  });
}