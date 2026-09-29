'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, ShieldCheck, ArrowRight, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/client';

type Status = 'loading' | 'invalid' | 'ready' | 'done';

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN: 'This link is invalid. Ask your HR administrator for a new one.',
  ALREADY_USED: 'This link has already been used. Sign in with the password you set.',
  EXPIRED: 'This link has expired. Ask your HR administrator for a new one.',
  WEAK_PASSWORD: 'Your password does not meet the requirements.',
};

function SetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState<Status>('loading');
  const [errorCode, setErrorCode] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [employeeEmail, setEmployeeEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setErrorCode('INVALID_TOKEN');
      return;
    }
    let active = true;
    (async () => {
      const { data, error } = await supabase.rpc('validate_setup_token', { p_token: token });
      if (!active) return;
      if (error || !data?.ok) {
        setStatus('invalid');
        setErrorCode((error ? 'INVALID_TOKEN' : data?.code) || 'INVALID_TOKEN');
        return;
      }
      setEmployeeName([data.first_name, data.last_name].filter(Boolean).join(' '));
      setEmployeeEmail(data.email);
      setStatus('ready');
    })();
    return () => { active = false; };
  }, [token]);

  const validate = (): string => {
    if (password.length < 8) return 'Password must be at least 8 characters long.';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
    if (!/\d/.test(password)) return 'Password must contain at least one number.';
    if (password !== confirm) return 'Passwords do not match.';
    return '';
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setFieldError(err); return; }
    setFieldError('');
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('complete_password_setup', {
        p_token: token,
        p_password: password,
      });
      if (error || !data?.ok) {
        setStatus('invalid');
        setErrorCode((error ? 'INVALID_TOKEN' : data?.code) || 'INVALID_TOKEN');
        return;
      }
      setStatus('done');
    } catch (err) {
      setFieldError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/30 p-4">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Set Up Your Account</CardTitle>
          <CardDescription>
            Choose a password to activate your account and start onboarding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {status === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your link…
            </div>
          )}

          {status === 'invalid' && (
            <div className="space-y-5">
              <div className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <p>{ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.INVALID_TOKEN}</p>
              </div>
              <Button className="w-full" onClick={() => router.push('/login')}>
                Go to Sign In <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {status === 'ready' && (
            <>
              <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{employeeName || 'Welcome!'}</p>
                <p className="mt-0.5">{employeeEmail}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <p className="text-xs text-muted-foreground">
                  At least 8 characters, one uppercase letter and one number.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm Password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
              <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting password…</>
                ) : (
                  <>Set Password <KeyRound className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </>
          )}

          {status === 'done' && (
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3 rounded-lg bg-success/10 p-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-success" />
                <div>
                  <p className="font-medium text-foreground">Password set successfully!</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Sign in to start your onboarding.
                  </p>
                </div>
              </div>
              <Button className="w-full" onClick={() => router.push('/login')}>
                Go to Sign In <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SetupAccountPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <SetupForm />
    </Suspense>
  );
}