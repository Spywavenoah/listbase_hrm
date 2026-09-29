import { NAMESPACE } from '@/lib/storage';

export interface EmployeeSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
  user: null;
}

export function saveEmployeeSession(accessToken: string, expiresAt: number): void {
  if (typeof window === 'undefined') return;
  const session: EmployeeSession = {
    access_token: accessToken,
    refresh_token: 'employee-session',
    expires_at: expiresAt,
    token_type: 'bearer',
    user: null,
  };
  window.localStorage.setItem(NAMESPACE.session, JSON.stringify(session));
}

export function clearEmployeeSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(NAMESPACE.session);
}

export function getEmployeeSession(): EmployeeSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(NAMESPACE.session);
    if (!raw) return null;
    const session = JSON.parse(raw) as EmployeeSession;
    if (!session.access_token) return null;
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      window.localStorage.removeItem(NAMESPACE.session);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function getSessionEmployeeId(): string | null {
  const session = getEmployeeSession();
  const token = session?.access_token;
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(window.atob(padded)) as { sub?: string };
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}