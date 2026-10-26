'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, Building2, LogOut, Lock, Eye, EyeOff, CheckCircle, Info, UserCircle } from 'lucide-react';
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
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5 bg-[hsl(187.62deg_100%_2.04%)] backdrop-blur-md">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary via-primary/90 to-primary/70 text-primary-foreground shadow-lg glow-green">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-tight text-gradient-primary">HR Flow</span>
          <span className="text-[10px] uppercase tracking-wider text-white/50 font-medium">Admin Dashboard</span>
        </div>
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
                  'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 group',
                  hasActiveChild
                    ? 'bg-primary/20 text-primary border border-primary/30 shadow-lg shadow-primary/10'
                    : 'text-white/50 hover:bg-white/5 hover:text-white'
                )}
              >
                <section.icon className="h-4 w-4 shrink-0 float-icon group-hover:scale-110 transition-transform" />
                <span className="flex-1 text-left group-hover:text-primary transition-colors">{section.label}</span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 transition-transform duration-200',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>

              {isOpen && (
                <div className="ml-5 mt-1 space-y-2">
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
                          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-200 group',
                          isActive
                            ? 'bg-primary/20 text-primary border border-primary/30 shadow-md shadow-primary/10'
                            : 'text-white/40 hover:bg-white/5 hover:text-white hover:-translate-x-0.5'
                        )}
                      >
                        <item.icon className="h-3.5 w-3.5 shrink-0 group-hover:scale-110 transition-transform" />
                        {item.label}
                        {item.badge && (
                          <span className="ml-auto h-6 min-w-6 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1.5 shadow-lg shadow-destructive/30">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-3.5 py-2.5 transition-all duration-200 hover:bg-white/10">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg">
                {initials}
              </div>
              <div className="flex-1 overflow-hidden text-left">
                <p className="truncate text-sm font-semibold text-white">{userName}</p>
                <p className="truncate text-xs text-white/50">{userEmail || 'Not signed in'}</p>
              </div>
              {hasSettingsAccess && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary border border-primary/20">
                  ADMIN
                </span>
              )}
              <ChevronDown className="h-4 w-4 shrink-0 text-white/50 transition-transform" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border border-border bg-card shadow-xl">
            <DropdownMenuItem className="text-sm font-medium">
              {userEmail}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setPwOpen(true)}>
              <Lock className="mr-2 h-4 w-4" /> Change Password
            </DropdownMenuItem>
            {employee?.id && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { router.push(`/employees/${employee.id}/personal`); onNavigate?.(); }}>
                  <UserCircle className="mr-2 h-4 w-4" /> My Profile
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive font-medium" onClick={handleSignOut}>
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
              <Button type="button" variant="outline" onClick={() => setPwOpen(false)} className="btn-lift">
                Cancel
              </Button>
              <Button type="submit" disabled={pwLoading || !pwValid} className="btn-lift glow-green-hover">
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
    <aside className="hidden h-screen w-72 shrink-0 flex-col border-r border-white/10 bg-[hsl(187.62deg_100%_2.04%)] backdrop-blur-lg lg:flex">
      <SidebarContent />
    </aside>
  );
}