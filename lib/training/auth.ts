import { createHmac } from 'crypto';
import type { NextRequest } from 'next/server';
import { PROGRESS_TOKEN_PURPOSE, PROGRESS_TOKEN_TTL_SEC } from './constants';

export interface EmployeeAuth {
  employeeId: string;
  email?: string;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  role?: string;
  exp?: number;
  iat?: number;
  [k: string]: unknown;
}

function secret(): string {
  return process.env.SUPABASE_JWT_SECRET || process.env.TRAINING_TOKEN_SECRET || '';
}

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: Record<string, unknown>, key: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', key).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verify(token: string, key: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = createHmac('sha256', key).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !a.equals(b)) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') return null;
    return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
}

function bearer(request: NextRequest): string | null {
  const raw = request.headers.get('authorization') || '';
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Verify the employee session JWT minted at login and return the owning employee. */
export function verifyEmployeeAuth(request: NextRequest): EmployeeAuth | null {
  const key = secret();
  if (!key) return null;
  const token = bearer(request);
  if (!token) return null;
  const payload = verify(token, key);
  if (!payload || payload.role !== 'authenticated') return null;
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  return { employeeId: payload.sub, email: payload.email };
}

/**
 * Per-enrollment signed JWT carried by every heartbeat / completion request.
 * Binds the request to one enrollment + one player session + one employee.
 */
export function signProgressToken(
  enrollmentId: string,
  employeeId: string,
  sessionId: string
): string {
  const key = secret();
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: employeeId,
      enrollment_id: enrollmentId,
      session_id: sessionId,
      purpose: PROGRESS_TOKEN_PURPOSE,
      iat: now,
      exp: now + PROGRESS_TOKEN_TTL_SEC,
    },
    key
  );
}

export interface ProgressTokenClaims {
  employeeId: string;
  enrollmentId: string;
  sessionId: string;
}

export function verifyProgressToken(
  token: string,
  enrollmentId: string,
  employeeId: string
): ProgressTokenClaims | null {
  const key = secret();
  if (!key || !token) return null;
  const payload = verify(token, key);
  if (!payload) return null;
  if (payload.purpose !== PROGRESS_TOKEN_PURPOSE) return null;
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
  if (payload.sub !== employeeId) return null;
  if (payload.enrollment_id !== enrollmentId) return null;
  return {
    employeeId,
    enrollmentId,
    sessionId: String(payload.session_id || ''),
  };
}

export function newSessionId(): string {
  const rand =
    typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `sess_${rand}`;
}
