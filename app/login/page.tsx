'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Building2,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  Info,
  KeyRound,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { saveEmployeeSession } from '@/lib/supabase/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';

function safeRedirect(target: string | null): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return '/dashboard';
  }
  return target;
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get('redirect'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [showResend, setShowResend] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        router.push(redirectTo);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push(redirectTo);
      } else {
        setChecking(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [router, redirectTo]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'Sign in failed');
      }

      await saveEmployeeSession(json.access_token, json.expires_at);

      if (json.must_change_password) {
        toast.info('You must set a new password before continuing');
        router.push('/change-password');
        return;
      }

      toast.success('Welcome back');
      router.push(redirectTo);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!resendEmail.trim()) return;
    setResending(true);
    try {
      const { data, error } = await supabase.rpc('request_password_setup_link', {
        p_email: resendEmail.trim().toLowerCase(),
        p_origin: window.location.origin,
      });
      if (error) throw error;
      if (data?.code === 'HAS_PASSWORD') {
        toast('This account already has a password. Forgot it? Contact your administrator.');
      } else if (data?.code === 'NOT_FOUND') {
        toast('No account found for that email.');
      } else if (data?.ok) {
        toast.success('Invitation sent. Check your inbox (also spam/junk).');
      } else {
        toast.error('Unable to resend the invitation. Please contact your HR administrator.');
      }
    } catch (err) {
      toast.error('Failed to resend invitation: ' + (err as Error).message);
    } finally {
      setResending(false);
    }
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
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">HR Flow</CardTitle>
          <CardDescription>Sign in to your HR management platform</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignIn} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  placeholder="you@company.com"
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 pr-9"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading || !email || !password}>
              {loading ? 'Signing in...' : 'Sign In'}
              {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Forgot your password? Contact your administrator to have it reset.
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowResend((v) => !v)}
            className="mt-3 text-xs font-medium text-primary hover:underline"
          >
            {showResend ? 'Hide invitation options' : 'Did not receive your account invitation?'}
          </button>

          {showResend && (
            <div className="mt-3 space-y-2 rounded-lg border border-border p-3 animate-fade-in">
              <div className="space-y-1.5">
                <Label htmlFor="resend-email">Email address</Label>
                <Input
                  id="resend-email"
                  type="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={resending || !resendEmail.trim()}
                onClick={handleResend}
              >
                {resending ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-3.5 w-3.5" />
                    Resend invitation
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                This only works before you have set a password. Already have a password? Just sign in above.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}