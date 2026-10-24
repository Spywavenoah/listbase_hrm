'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Bell, HelpCircle, Menu, PanelLeftClose, PanelLeftOpen, Sun, Moon, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/lib/supabase/client';
import { getEmployeeSession } from '@/lib/supabase/session';
import { getPreference, setPreference } from '@/lib/storage';
import { useAccess } from '@/lib/access';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string;
  title: string;
  message: string | null;
  type: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export function Topbar({
  desktopOpen,
  onToggleDesktop,
  onToggleMobile,
}: {
  desktopOpen: boolean;
  onToggleDesktop: () => void;
  onToggleMobile: () => void;
}) {
  const router = useRouter();
  const { employeeId } = useAccess();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const dark = getPreference('darkMode');
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    document.documentElement.classList.toggle('dark', newDark);
    setPreference('darkMode', newDark);
  };

  useEffect(() => {
    if (!employeeId) return;
    let active = true;

    async function loadNotifications() {
      try {
        const { data } = await supabase
          .from('notifications')
          .select('id, title, message, type, link, is_read, created_at')
          .order('created_at', { ascending: false })
          .limit(20);
        if (!active) return;
        const items = (data || []) as NotificationItem[];
        setNotifications(items);
        setUnreadCount(items.filter((n) => !n.is_read).length);
      } catch {
        // notifications are non-critical
      }
    }

    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);

    const token = getEmployeeSession()?.access_token;
    if (token) supabase.realtime.setAuth(token);

    const channel = supabase
      .channel(`notifications-${employeeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `employee_id=eq.${employeeId}` },
        (payload) => {
          const row = payload.new as NotificationItem;
          setNotifications((prev) => [row, ...prev].slice(0, 20));
          setUnreadCount((c) => c + 1);
        }
      )
      .subscribe();

    return () => {
      active = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [employeeId]);

  const markAllRead = async () => {
    try {
      await supabase.rpc('mark_all_notifications_read');
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const openNotification = async (n: NotificationItem) => {
    if (!n.is_read) {
      try {
        await supabase.rpc('mark_notification_read', { p_id: n.id });
      } catch {
        // ignore
      }
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    if (n.link) router.push(n.link);
  };

  const typeColor = (type: string) => {
    if (type === 'SUCCESS') return 'text-success';
    if (type === 'WARNING') return 'text-warning';
    if (type === 'ERROR') return 'text-destructive';
    return 'text-primary';
  };

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border/60 bg-gradient-to-b from-card/80 to-card/50 backdrop-blur-xl px-4 sm:px-6 print:hidden shadow-lg shadow-primary/5">
      <Button variant="ghost" size="icon" className="lg:hidden btn-lift glow-green-hover" onClick={onToggleMobile} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" className="hidden lg:flex btn-lift glow-green-hover" onClick={onToggleDesktop} aria-label="Toggle sidebar">
        {desktopOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
      </Button>

      <div className="relative hidden flex-1 sm:block sm:max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search employees, records, settings..."
          className="pl-9 bg-background/80 backdrop-blur-md border border-border focus:ring-primary focus:border-primary shadow-sm hover:shadow-md"
          aria-label="Search"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" className="btn-lift glow-green-hover" onClick={toggleTheme} aria-label="Toggle theme">
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative btn-lift glow-green-hover" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground shadow-md glow-red">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 border border-border bg-card shadow-xl">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span className="font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <button
                  className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                  onClick={(e) => { e.preventDefault(); markAllRead(); }}
                >
                  Mark all read
                </button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <ScrollArea className="max-h-80">
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No notifications yet
                </div>
              ) : (
                notifications.map((n) => (
                  <DropdownMenuItem
                    key={n.id}
                    className="flex-col items-start gap-0.5 py-2.5 cursor-pointer transition-colors hover:bg-accent/50"
                    onClick={() => openNotification(n)}
                  >
                    <div className="flex w-full items-center gap-2">
                      {!n.is_read && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary pulse-ring" />}
                      <span className={cn('flex-1 truncate text-sm', n.is_read ? 'font-normal' : 'font-semibold')}>
                        {n.title}
                      </span>
                      <span className={cn('shrink-0 text-xs font-semibold', typeColor(n.type))}>•</span>
                    </div>
                    {n.message && (
                      <span className="line-clamp-2 pl-4 text-xs text-muted-foreground">{n.message}</span>
                    )}
                    <span className="pl-4 text-[11px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" className="btn-lift glow-green-hover" aria-label="Help">
          <HelpCircle className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
