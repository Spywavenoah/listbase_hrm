'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Eye, EyeOff, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/client';
import { clearEmployeeSession, getEmployeeSession, getSessionEmployeeId } from '@/lib/supabase/session';

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['Too short', 'Weak', 'Okay', 'Good', 'Strong'];
  return { score, label: labels[score] };
}

interface PasswordPolicy {
  min_length: number;
  require_upper: boolean;
  require_number: boolean;
  require_symbol: boolean;
}

const DEFAULT_POLICY: PasswordPolicy = {
  min_length: 8,
  require_upper: true,
  require_number: true,
  require_symbol: false,
};

export default function ChangePasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [current, setCurrent] = useState('');
  const [nextPw, setNextPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY);

  useEffect(() => {
    const hasSession = !!getEmployeeSession();
    if (!hasSession) {
      router.replace('/login');
      return;
    }
    const empId = getSessionEmployeeId();
    (async () => {
      try {
        const [empRes, policyRes] = await Promise.all([
          supabase
            .from('employees')
            .select('first_name, last_name, must_change_password')
            .eq('id', empId || '')
            .maybeSingle(),
          supabase.rpc('get_password_policy'),
        ]);
        if (empRes.data?.must_change_password === false) {
          router.replace('/dashboard');
          return;
        }
        if (!policyRes.error && policyRes.data) {
          setPolicy({ ...DEFAULT_POLICY, ...(policyRes.data as Partial<PasswordPolicy>) });
        }
      } catch {
        // if the lookup fails, still allow the change screen
      }
      setChecking(false);
    })();
  }, [router]);

  const meter = strength(nextPw);

  const policyHint = [
    `at least ${policy.min_length} characters`,
    policy.require_upper ? 'an uppercase letter' : null,
    policy.require_number ? 'a number' : null,
    policy.require_symbol ? 'a symbol' : null,
  ].filter(Boolean).join(', ');

  const submit = async () => {
    setError('');
    if (!current) {
      setError('Enter your current password.');
      return;
    }
    if (nextPw.length < policy.min_length) {
      setError(`Password must be at least ${policy.min_length} characters long.`);
      return;
    }
    if (policy.require_upper && !/[A-Z]/.test(nextPw)) {
      setError('Password must contain at least one uppercase letter.');
      return;
    }
    if (policy.require_number && !/\d/.test(nextPw)) {
      setError('Password must contain at least one number.');
      return;
    }
    if (policy.require_symbol && !/[^A-Za-z0-9]/.test(nextPw)) {
      setError('Password must contain at least one symbol.');
      return;
    }
    if (nextPw !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (nextPw === current) {
      setError('New password must be different from your current password.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('change_my_password', {
        p_current_password: current,
        p_new_password: nextPw,
      });
      if (rpcError) throw rpcError;
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    clearEmployeeSession();
    router.replace('/login');
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/30 p-4">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-warning text-warning-foreground">
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">{done ? 'Password Updated' : 'Change Your Password'}</CardTitle>
          <CardDescription>
            {done
              ? 'Your password has been updated.'
              : 'For security, you must choose a new password before continuing.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {done ? (
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3 rounded-lg bg-success/10 p-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-success" />
                <p className="text-sm text-muted-foreground">
                  Next time you sign in, use your new password.
                </p>
              </div>
              <Button className="w-full" onClick={() => router.push('/dashboard')}>
                Continue to Dashboard
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="current">Current Password</Label>
                <div className="relative">
                  <Input
                    id="current"
                    type={showPw ? 'text' : 'password'}
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new">New Password</Label>
                <Input
                  id="new"
                  type={showPw ? 'text' : 'password'}
                  value={nextPw}
                  onChange={(e) => setNextPw(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                {nextPw && (
                  <div className="flex items-center gap-2">
                    <div className="flex h-1.5 flex-1 gap-1">
                      {['Too short', 'Weak', 'Okay', 'Good', 'Strong'].map((_, i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full transition-colors ${
                            i < meter.score ? 'bg-primary' : 'bg-muted'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">{meter.label}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Must include {policyHint}.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm New Password</Label>
                <Input
                  id="confirm"
                  type={showPw ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={signOut}>
                  Sign Out
                </Button>
                <Button className="flex-1" onClick={submit} disabled={submitting}>
                  {submitting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                  ) : (
                    <>Update Password</>
                  )}
                </Button>
              </div>

              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Your password is encrypted and never stored in plain text.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}