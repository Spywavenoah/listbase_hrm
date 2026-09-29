'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, Building2, LogOut, Lock, Eye, EyeOff, CheckCircle, Info } from 'lucide-react';
import { navSections } from '@/lib/navigation';
import { supabase } from '@/lib/supabase/client';
import { clearEmployeeSession } from '@/lib/supabase/session';
import { cn } from '@/lib/utils';
import { useAccess } from '@/lib/access';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { employee, can, canAny } = useAccess();

  const userEmail = employee?.email || '';
  const userName = employee ? `${employee.first_name} ${employee.last_name}` : 'User';

  const handleSignOut = async () => {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    clearEmployeeSession();
    toast.success('Signed out');
    router.push('/login');
  };

  // ---- Change password dialog ----
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwShow, setPwShow] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const pwChecks = {
    length: pwNew.length >= 8,
    uppercase: /[A-Z]/.test(pwNew),
    number: /\d/.test(pwNew),
    match: pwNew === pwConfirm && pwNew.length > 0,
  };
  const pwValid = Object.values(pwChecks).every(Boolean) && pwCurrent.length > 0;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwValid) return;
    setPwLoading(true);
    try {
      const { error } = await supabase.rpc('change_my_password', {
        p_current_password: pwCurrent,
        p_new_password: pwNew,
      });
      if (error) throw error;
      toast.success('Password updated');
      setPwOpen(false);
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPwLoading(false);
    }
  };

  const initials = userName
    .split(/[.\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('') || 'U';

  const visibleSections = useMemo(
    () =>
      navSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => {
            if (item.privileges?.length) return canAny(item.privileges);
            return !item.privilege || can(item.privilege);
          }),
        }))
        .filter((section) => section.items.length > 0),
    [can, canAny]
  );

  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const section of visibleSections) {
      const hasActiveChild = section.items.some(
        (item) => pathname === item.href || pathname.startsWith(item.href + '/')
      );
      if (hasActiveChild) initial.add(section.label);
    }
    return initial;
  });

  useEffect(() => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      for (const section of visibleSections) {
        const hasActiveChild = section.items.some(
          (item) => pathname === item.href || pathname.startsWith(item.href + '/')
        );
        if (hasActiveChild) next.add(section.label);
      }
      return next;
    });
  }, [pathname, visibleSections]);

  const toggleSection = (label: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const hasSettingsAccess = can('admin.settings') || can('admin.privileges');

  return (
    <>
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold tracking-tight">HR Flow</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        {visibleSections.map((section) => {
          const isOpen = openSections.has(section.label);
          const hasActiveChild = section.items.some(
            (item) =>
              pathname === item.href || pathname.startsWith(item.href + '/')
          );

          return (
            <div key={section.label} className="mb-1">
              <button
                onClick={() => toggleSection(section.label)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  hasActiveChild
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <section.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{section.label}</span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 transition-transform',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>

              {isOpen && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-3">
                  {section.items.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      (item.href !== '/dashboard' &&
                        pathname.startsWith(item.href + '/'));
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
                      >
                        <item.icon className="h-3.5 w-3.5 shrink-0" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border p-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg bg-accent/50 px-3 py-2 transition-colors hover:bg-accent">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {initials}
              </div>
              <div className="flex-1 overflow-hidden text-left">
                <p className="truncate text-sm font-medium">{userName}</p>
                <p className="truncate text-xs text-muted-foreground">{userEmail || 'Not signed in'}</p>
              </div>
              {hasSettingsAccess && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">ADMIN</span>}
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuItem className="text-sm font-medium">
              {userEmail}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setPwOpen(true)}>
              <Lock className="mr-2 h-4 w-4" /> Change Password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Change password dialog */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>Update your account password.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPw">Current Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="currentPw"
                  type={pwShow ? 'text' : 'password'}
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  className="pl-9 pr-9"
                  autoFocus
                />
                <button type="button" onClick={() => setPwShow(!pwShow)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {pwShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="newPw">New Password</Label>
              <Input id="newPw" type={pwShow ? 'text' : 'password'} value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPw">Confirm New Password</Label>
              <Input id="confirmPw" type={pwShow ? 'text' : 'password'} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} />
            </div>

            <div className="space-y-1.5 rounded-lg bg-muted/50 p-3">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>At least 8 characters, one uppercase, one number, and passwords must match.</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                {([
                  { label: '8+ characters', met: pwChecks.length },
                  { label: 'Uppercase letter', met: pwChecks.uppercase },
                  { label: 'Number', met: pwChecks.number },
                  { label: 'Passwords match', met: pwChecks.match },
                ] as const).map((r) => (
                  <div key={r.label} className="flex items-center gap-1.5">
                    <CheckCircle className={`h-3 w-3 ${r.met ? 'text-success' : 'text-muted-foreground/40'}`} />
                    <span className={r.met ? 'text-foreground' : 'text-muted-foreground'}>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pwLoading || !pwValid}>
                {pwLoading ? 'Updating...' : 'Update Password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <SidebarContent />
    </aside>
  );
}