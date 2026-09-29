'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { clearEmployeeSession } from '@/lib/supabase/session';
import { toast } from 'sonner';
import {
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Monitor,
  LogOut,
  Lock,
  CheckCircle2,
  Ban,
} from 'lucide-react';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface ActiveSession {
  email: string;
  createdAt: number | null;
  expiresAt: number | null;
}

function describeDevice(ua: string): string {
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown OS';
  return `${browser} on ${os}`;
}

export default function SecurityPage() {
  const router = useRouter();
  const { employeeId } = useAccess();

  // Password policy
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
  const [minLength, setMinLength] = useState('8');
  const [requireUpper, setRequireUpper] = useState(true);
  const [requireNumber, setRequireNumber] = useState(true);
  const [requireSymbol, setRequireSymbol] = useState(false);
  const [expiryDays, setExpiryDays] = useState('0');

  // API keys
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  // Active session
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const loadPolicy = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('system_settings')
        .select('key, value')
        .eq('group_name', 'security');
      for (const row of data || []) {
        if (row.key === 'password_min_length') setMinLength(String(row.value ?? 8));
        if (row.key === 'password_require_upper') setRequireUpper(row.value === true);
        if (row.key === 'password_require_number') setRequireNumber(row.value === true);
        if (row.key === 'password_require_symbol') setRequireSymbol(row.value === true);
        if (row.key === 'password_expiry_days') setExpiryDays(String(row.value ?? 0));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('api_keys')
        .select('*')
        .order('created_at', { ascending: false });
      setKeys((data || []) as unknown as ApiKeyRow[]);
    } catch (err) {
      console.error(err);
    } finally {
      setKeysLoading(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      if (s) {
        const expiresAt = typeof s.expires_at === 'number' ? s.expires_at : null;
        const expiresIn = typeof s.expires_in === 'number' ? s.expires_in : null;
        setSession({
          email: s.user?.email || '',
          createdAt: expiresAt !== null && expiresIn !== null ? expiresAt - expiresIn : null,
          expiresAt,
        });
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadPolicy();
    loadKeys();
    loadSession();
  }, [loadPolicy, loadKeys, loadSession]);

  const savePolicy = async () => {
    setPolicySaving(true);
    try {
      const min = Math.max(4, Math.min(128, Number(minLength) || 8));
      const days = Math.max(0, Math.min(3650, Number(expiryDays) || 0));
      const { error } = await supabase.from('system_settings').upsert(
        [
          { group_name: 'security', key: 'password_min_length', value: min },
          { group_name: 'security', key: 'password_require_upper', value: requireUpper },
          { group_name: 'security', key: 'password_require_number', value: requireNumber },
          { group_name: 'security', key: 'password_require_symbol', value: requireSymbol },
          { group_name: 'security', key: 'password_expiry_days', value: days },
        ],
        { onConflict: 'group_name,key' }
      );
      if (error) throw error;
      setMinLength(String(min));
      setExpiryDays(String(days));
      toast.success('Password policy saved. It applies to every password change from now on.');
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setPolicySaving(false);
    }
  };

  const handleCreateKey = async () => {
    if (!keyName.trim()) return;
    setCreating(true);
    try {
      if (!globalThis.crypto?.subtle) {
        throw new Error('Secure context required (run on https:// or localhost).');
      }
      const bytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(bytes);
      const secret = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      const fullKey = `hrm_${secret}`;
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(fullKey)
      );
      const keyHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const { error } = await supabase.from('api_keys').insert({
        name: keyName.trim(),
        key_prefix: `${fullKey.slice(0, 12)}...`,
        key_hash: keyHash,
        created_by: employeeId,
      });
      if (error) throw error;

      setCreateOpen(false);
      setKeyName('');
      setNewKey(fullKey);
      loadKeys();
    } catch (err) {
      toast.error('Failed to create key: ' + (err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
    try {
      const { error } = await supabase
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      toast.success('API key revoked');
      loadKeys();
    } catch (err) {
      toast.error('Failed to revoke: ' + (err as Error).message);
    }
  };

  const deleteKey = async (id: string) => {
    try {
      const { error } = await supabase.from('api_keys').delete().eq('id', id);
      if (error) throw error;
      toast.success('API key deleted');
      loadKeys();
    } catch (err) {
      toast.error('Failed to delete: ' + (err as Error).message);
    }
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed — select the key manually.');
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    clearEmployeeSession();
    router.replace('/login');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Password policy, API keys and session management
        </p>
      </div>

      {/* ---------------- Password policy ---------------- */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-4 w-4" /> Password Policy
          </CardTitle>
          <CardDescription>
            Enforced server-side on every password change (admin reset, self-service
            change and invitation setup).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {policyLoading ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-min">Minimum length</Label>
                  <Input
                    id="pw-min"
                    type="number"
                    min={4}
                    max={128}
                    value={minLength}
                    onChange={(e) => setMinLength(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-expiry">Expiry (days, 0 = never)</Label>
                  <Input
                    id="pw-expiry"
                    type="number"
                    min={0}
                    max={3650}
                    value={expiryDays}
                    onChange={(e) => setExpiryDays(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Expired passwords force a change at next login.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { label: 'Require an uppercase letter', checked: requireUpper, set: setRequireUpper },
                  { label: 'Require a number', checked: requireNumber, set: setRequireNumber },
                  { label: 'Require a symbol', checked: requireSymbol, set: setRequireSymbol },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <Label className="cursor-pointer" onClick={() => row.set(!row.checked)}>
                      {row.label}
                    </Label>
                    <Switch checked={row.checked} onCheckedChange={row.set} />
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button onClick={savePolicy} disabled={policySaving}>
                  {policySaving ? 'Saving...' : 'Save Policy'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------- API keys ---------------- */}
      <Card className="max-w-3xl">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-4 w-4" /> API Keys
            </CardTitle>
            <CardDescription>
              Credentials for external integrations, e.g.{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                GET /api/v1/employees
              </code>{' '}
              with header <code className="rounded bg-muted px-1 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code>
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New Key
          </Button>
        </CardHeader>
        <CardContent>
          {keysLoading ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          ) : keys.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No API keys yet. Create one to integrate external systems.
            </p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {keys.map((k) => (
                <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{k.name}</p>
                      <Badge variant="outline" className={k.revoked_at ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}>
                        {k.revoked_at ? 'Revoked' : 'Active'}
                      </Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{k.key_prefix}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Created {new Date(k.created_at).toLocaleDateString()}
                      {k.last_used_at ? ` · Last used ${new Date(k.last_used_at).toLocaleString()}` : ' · Never used'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {!k.revoked_at && (
                      <Button size="sm" variant="outline" className="h-8 text-warning" onClick={() => revokeKey(k.id)}>
                        <Ban className="mr-1.5 h-3.5 w-3.5" /> Revoke
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-8 text-destructive" onClick={() => deleteKey(k.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Active session ---------------- */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Monitor className="h-4 w-4" /> Your Session
          </CardTitle>
          <CardDescription>The session you are using right now on this device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!session ? (
            <p className="text-sm text-muted-foreground">No active session found.</p>
          ) : (
            <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Signed in as</span>
                <span className="font-medium">{session.email}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Device</span>
                <span>{describeDevice(typeof navigator !== 'undefined' ? navigator.userAgent : '')}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Session started</span>
                <span>{session.createdAt ? new Date(session.createdAt * 1000).toLocaleString() : '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Expires</span>
                <span>{session.expiresAt ? new Date(session.expiresAt * 1000).toLocaleString() : '—'}</span>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/change-password">
              <Button variant="outline" size="sm">
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Change Password
              </Button>
            </Link>
            <Button variant="outline" size="sm" className="text-destructive" onClick={signOut} disabled={signingOut}>
              <LogOut className="mr-1.5 h-4 w-4" /> {signingOut ? 'Signing out...' : 'Sign Out'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Create key dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              The full key is shown once, immediately after creation. Only its
              hash is stored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="key-name">Key name *</Label>
            <Input
              id="key-name"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="Payroll integration"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateKey} disabled={!keyName.trim() || creating}>
              {creating ? 'Creating...' : 'Create Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New key reveal dialog */}
      <Dialog open={!!newKey} onOpenChange={(open) => { if (!open) setNewKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key now</DialogTitle>
            <DialogDescription>
              This is the only time the full key will be shown. If you lose it,
              revoke the key and create a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3">
            <code className="min-w-0 flex-1 break-all text-xs">{newKey}</code>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={copyKey}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}