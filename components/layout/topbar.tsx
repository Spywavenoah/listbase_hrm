'use client';

import { useEffect, useState } from 'react';
import { Search, Bell, HelpCircle, Menu, PanelLeftClose, PanelLeftOpen, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { getPreference, setPreference } from '@/lib/storage';
import { cn } from '@/lib/utils';

interface QueueItem {
  id: string;
  event_key: string | null;
  subject: string;
  status: string;
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
  const [notifications, setNotifications] = useState<QueueItem[]>([]);
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
    async function loadNotifications() {
      try {
        const { data } = await supabase
          .from('notification_queue')
          .select('id, event_key, subject, status, created_at')
          .order('created_at', { ascending: false })
          .limit(20);
        const items = (data || []) as QueueItem[];
        setNotifications(items);
        setUnreadCount(items.filter((n) => n.status === 'PENDING' || n.status === 'FAILED').length);
      } catch {
        // silently ignore — notifications are non-critical
      }
    }
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const statusColor = (status: string) => {
    if (status === 'SENT') return 'text-success';
    if (status === 'FAILED') return 'text-destructive';
    return 'text-warning';
  };

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6 print:hidden">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onToggleMobile} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" className="hidden lg:flex" onClick={onToggleDesktop} aria-label="Toggle sidebar">
        {desktopOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
      </Button>

      <div className="relative hidden flex-1 sm:block sm:max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search employees, records, settings..."
          className="pl-9 bg-background"
          aria-label="Search"
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Search">
          <Search className="h-5 w-5" />
        </Button>

        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle dark mode">
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              {unreadCount > 0 && <Badge variant="secondary">{unreadCount} pending</Badge>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <ScrollArea className="max-h-80">
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No notifications yet
                </div>
              ) : (
                notifications.map((n) => (
                  <DropdownMenuItem key={n.id} className="flex-col items-start gap-0.5 py-2">
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{n.subject}</span>
                      <span className={cn('text-xs font-semibold shrink-0', statusColor(n.status))}>
                        {n.status}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" aria-label="Help">
          <HelpCircle className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
