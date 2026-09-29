'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { LogOut, Laptop, CreditCard, KeyRound, ShieldCheck, Mail, FileCheck2, MessageSquare, Wallet, Plus, CheckCircle2, Circle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { cn } from '@/lib/utils';

interface ExitCheckout {
  id: string;
  employee_id: string;
  exit_type: string | null;
  exit_date: string | null;
  last_working_day: string | null;
  reason: string | null;
  rehire_eligible: boolean | null;
  interview_completed: boolean;
  interview_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CheckoutItem {
  id: string;
  item_key: string;
  is_cleared: boolean;
  cleared_at: string | null;
  notes: string | null;
}

const ITEM_META: Record<string, { label: string; icon: typeof Laptop }> = {
  EQUIPMENT: { label: 'Equipment returned', icon: Laptop },
  ID_BADGE: { label: 'ID / access badge returned', icon: CreditCard },
  CREDENTIALS: { label: 'Credentials & accounts revoked', icon: KeyRound },
  ACCESS: { label: 'Systems / facility access removed', icon: ShieldCheck },
  EMAIL_INBOX: { label: 'Email inbox handed over', icon: Mail },
  CLEARANCE: { label: 'Department clearance signed off', icon: FileCheck2 },
  EXIT_INTERVIEW: { label: 'Exit interview completed', icon: MessageSquare },
  FINAL_PAY: { label: 'Final pay processed', icon: Wallet },
};

const EXIT_TYPES = ['VOLUNTARY', 'INVOLUNTARY', 'RETIREMENT', 'LAYOFF', 'OTHER'];

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning border-warning/20',
  IN_PROGRESS: 'bg-info/10 text-info border-info/20',
  COMPLETED: 'bg-success/10 text-success border-success/20',
};

export default function ExitPage() {
  const params = useParams();
  const id = params.id as string;
  const { employeeId: myId, can } = useAccess();

  const [checkout, setCheckout] = useState<ExitCheckout | null>(null);
  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const canWrite = can('employees.manage');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_exit_checkouts')
        .select('*')
        .eq('employee_id', id)
        .maybeSingle();
      if (error) throw error;
      const co = (data || null) as ExitCheckout | null;
      setCheckout(co);
      if (co) {
        const { data: itemsData, error: itemsError } = await supabase
          .from('exit_checklist_items')
          .select('*')
          .eq('checkout_id', co.id)
          .order('item_key', { ascending: true });
        if (itemsError) throw itemsError;
        const rows = (itemsData || []) as CheckoutItem[];
        setItems(rows);
        setNoteDrafts(
          rows.reduce((acc, r) => ({ ...acc, [r.id]: r.notes || '' }), {})
        );
      } else {
        setItems([]);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load exit checkout: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const statusFor = (co: ExitCheckout, itemsList: CheckoutItem[]) => {
    if (itemsList.length === 0) return co.status;
    const cleared = itemsList.filter((i) => i.is_cleared).length;
    if (cleared === itemsList.length) {
      return co.interview_completed ? 'COMPLETED' : 'IN_PROGRESS';
    }
    return cleared > 0 ? 'IN_PROGRESS' : 'PENDING';
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('employee_exit_checkouts').insert({
        employee_id: id,
        exit_type: 'VOLUNTARY',
        status: 'PENDING',
      });
      if (error) throw error;
      toast.success('Checkout started');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updateCheckout = async (
    co: ExitCheckout,
    patch: Record<string, unknown>
  ) => {
    const nextStatus = statusFor({ ...co, ...patch }, items);
    const { error } = await supabase
      .from('employee_exit_checkouts')
      .update({ ...patch, status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', co.id);
    if (error) throw error;
    setCheckout((prev) => (prev ? { ...prev, ...patch, status: nextStatus } : prev));
  };

  const handleToggleItem = async (item: CheckoutItem) => {
    setToggling(item.id);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('exit_checklist_items')
        .update({
          is_cleared: !item.is_cleared,
          cleared_at: !item.is_cleared ? now : null,
          cleared_by: !item.is_cleared ? myId : null,
        })
        .eq('id', item.id);
      if (error) throw error;
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? { ...it, is_cleared: !it.is_cleared, cleared_at: !it.is_cleared ? now : null }
            : it
        )
      );
      if (checkout) {
        const nextStatus = statusFor(checkout, items.map((it) =>
          it.id === item.id ? { ...it, is_cleared: !it.is_cleared } : it
        ));
        const { error: ue } = await supabase
          .from('employee_exit_checkouts')
          .update({ status: nextStatus, updated_at: now })
          .eq('id', checkout.id);
        if (ue) throw ue;
        setCheckout((prev) => (prev ? { ...prev, status: nextStatus } : prev));
      }
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setToggling(null);
    }
  };

  const saveNote = async (item: CheckoutItem) => {
    try {
      const { error } = await supabase
        .from('exit_checklist_items')
        .update({ notes: noteDrafts[item.id] || null })
        .eq('id', item.id);
      if (error) throw error;
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, notes: noteDrafts[item.id] || null } : it))
      );
      toast.success('Note saved');
    } catch (err) {
      toast.error('Failed to save note: ' + (err as Error).message);
    }
  };

  const dismissSelf = checkout?.employee_id === (myId || '');

  if (loading) {
    return <div className="space-y-4"><div className="h-40 animate-pulse rounded-lg bg-muted" /><div className="h-64 animate-pulse rounded-lg bg-muted" /></div>;
  }

  if (!checkout) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <LogOut className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">No exit checkout yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a checklist to track equipment, credentials, clearance and interview
            </p>
          </div>
          {canWrite && (
            <Button onClick={handleCreate} disabled={saving}>
              <Plus className="mr-2 h-4 w-4" />
              Start Checkout
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const clearedCount = items.filter((i) => i.is_cleared).length;
  const progress = items.length ? Math.round((clearedCount / items.length) * 100) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LogOut className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle className="text-lg">Exit Checkout</CardTitle>
              <CardDescription>
                {clearedCount} of {items.length} items cleared
              </CardDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className={STATUS_COLORS[checkout.status] || STATUS_COLORS.PENDING}
          >
            {checkout.status.replace(/_/g, ' ')}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Exit Type</Label>
              <Select
                value={checkout.exit_type || 'OTHER'}
                onValueChange={(v) => checkout && updateCheckout(checkout, { exit_type: v })}
                disabled={!canWrite || dismissSelf}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXIT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Exit Date (override)</Label>
              <Input
                type="date"
                value={checkout.exit_date || ''}
                disabled={!canWrite || dismissSelf}
                onChange={(e) =>
                  checkout && updateCheckout(checkout, { exit_date: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Last Working Day (override)</Label>
              <Input
                type="date"
                value={checkout.last_working_day || ''}
                disabled={!canWrite || dismissSelf}
                onChange={(e) =>
                  checkout && updateCheckout(checkout, { last_working_day: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rehire Eligible</Label>
              <div className="flex h-10 items-center">
                <Switch
                  checked={checkout.rehire_eligible ?? true}
                  disabled={!canWrite || dismissSelf}
                  onCheckedChange={(v) => checkout && updateCheckout(checkout, { rehire_eligible: v })}
                />
                <span className="ml-2 text-sm text-muted-foreground">
                  {checkout.rehire_eligible ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Reason for Exit</Label>
              <Textarea
                rows={3}
                value={checkout.reason || ''}
                disabled={!canWrite || dismissSelf}
                placeholder="Reason provided"
                onBlur={(e) =>
                  checkout && updateCheckout(checkout, { reason: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Exit Interview Notes</Label>
              <Textarea
                rows={3}
                value={checkout.interview_notes || ''}
                disabled={!canWrite || dismissSelf}
                placeholder="Interview findings"
                onBlur={(e) =>
                  checkout && updateCheckout(checkout, { interview_notes: e.target.value || null })
                }
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Switch
              checked={checkout.interview_completed}
              disabled={!canWrite || dismissSelf}
              onCheckedChange={(v) =>
                checkout && updateCheckout(checkout, { interview_completed: v })
              }
            />
            <span className="text-sm text-muted-foreground">Exit interview completed</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clearance Checklist</CardTitle>
          <CardDescription>Toggle items as equipment and access are returned</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const meta = ITEM_META[item.item_key] || { label: item.item_key, icon: Wallet };
            const Icon = meta.icon;
            return (
              <div
                key={item.id}
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  item.is_cleared ? 'border-success/30 bg-success/5' : 'border-border'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Icon className={cn('h-4 w-4', item.is_cleared ? 'text-success' : 'text-muted-foreground')} />
                    <p className={cn('text-sm', item.is_cleared ? 'text-success line-through' : 'font-medium')}>
                      {meta.label}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn('h-7 gap-1.5', canWrite && !dismissSelf ? '' : 'pointer-events-none opacity-50')}
                    disabled={toggling === item.id}
                    onClick={() => handleToggleItem(item)}
                  >
                    {item.is_cleared ? (
                      <><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Cleared</>
                    ) : (
                      <><Circle className="h-3.5 w-3.5" /> Clear</>
                    )}
                  </Button>
                </div>
                {(canWrite && !dismissSelf) && (
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      placeholder="Note (optional)"
                      value={noteDrafts[item.id] || ''}
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                    />
                    <Button size="sm" variant="outline" onClick={() => saveNote(item)}>
                      Save
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}