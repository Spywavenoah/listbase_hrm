'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Mail, CheckCircle, XCircle, Clock, RefreshCw, Search, Inbox } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { triggerMailProcessing } from '@/lib/notifications';

interface QueueItem {
  id: string;
  event_key: string | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  status: string;
  error_message: string | null;
  attempts: number;
  sent_at: string | null;
  created_at: string;
}

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  PENDING: { icon: Clock, color: 'bg-warning/10 text-warning border-warning/20', label: 'Pending' },
  SENT: { icon: CheckCircle, color: 'bg-success/10 text-success border-success/20', label: 'Sent' },
  FAILED: { icon: XCircle, color: 'bg-destructive/10 text-destructive border-destructive/20', label: 'Failed' },
};

export default function EmailQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('notification_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (statusFilter !== 'ALL') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setItems((data || []) as unknown as QueueItem[]);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load email queue');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRetry = async (id: string) => {
    try {
      const { error } = await supabase
        .from('notification_queue')
        .update({ status: 'PENDING', error_message: null, next_retry_at: null, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      toast.success('Email queued for retry');
      load();
    } catch (err) {
      toast.error('Failed to retry: ' + (err as Error).message);
    }
  };

  const handleProcessQueue = async () => {
    setProcessing(true);
    try {
      await triggerMailProcessing();
      toast.success('Queue processed');
      load();
    } catch (err) {
      toast.error('Processing failed: ' + (err as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const filtered = search.trim()
    ? items.filter(
        (item) =>
          item.recipient_email.toLowerCase().includes(search.toLowerCase()) ||
          item.subject.toLowerCase().includes(search.toLowerCase()) ||
          (item.event_key || '').toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const counts = {
    total: items.length,
    pending: items.filter((i) => i.status === 'PENDING').length,
    sent: items.filter((i) => i.status === 'SENT').length,
    failed: items.filter((i) => i.status === 'FAILED').length,
  };

  const summaryCards = [
    { label: 'Total', value: counts.total, icon: Mail, color: 'bg-primary/10 text-primary' },
    { label: 'Pending', value: counts.pending, icon: Clock, color: 'bg-warning/10 text-warning' },
    { label: 'Sent', value: counts.sent, icon: CheckCircle, color: 'bg-success/10 text-success' },
    { label: 'Failed', value: counts.failed, icon: XCircle, color: 'bg-destructive/10 text-destructive' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Email Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor outgoing email delivery status and retry failed messages
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleProcessQueue} disabled={processing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${processing ? 'animate-spin' : ''}`} />
          {processing ? 'Processing...' : 'Process Queue'}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold">{card.value}</p>
                <p className="text-sm text-muted-foreground">{card.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 border-b border-border p-4">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by email, subject, or event..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {['ALL', 'PENDING', 'SENT', 'FAILED'].map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'ALL' ? 'All' : statusConfig[s]?.label || s}
                </Button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-5 w-full animate-pulse rounded bg-muted" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32">
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Inbox className="h-10 w-10 opacity-40" />
                        <p className="text-sm font-medium">No emails found</p>
                        <p className="text-xs">Emails will appear here once they are queued</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((item) => {
                    const cfg = statusConfig[item.status] || statusConfig.PENDING;
                    const StatusIcon = cfg.icon;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{item.recipient_email}</p>
                            {item.recipient_name && (
                              <p className="text-xs text-muted-foreground">{item.recipient_name}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{item.subject}</TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {item.event_key || '—'}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cfg.color}>
                            <StatusIcon className="mr-1 h-3 w-3" />
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{item.attempts}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(item.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {item.status === 'FAILED' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRetry(item.id)}
                              title="Retry sending"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {filtered.some((i) => i.status === 'FAILED' && i.error_message) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Failed Email Details</CardTitle>
            <CardDescription>Error messages from failed delivery attempts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {filtered
              .filter((i) => i.status === 'FAILED' && i.error_message)
              .map((item) => (
                <div key={item.id} className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                  <p className="text-sm font-medium">{item.recipient_email}</p>
                  <p className="text-xs text-muted-foreground">{item.subject}</p>
                  <p className="mt-1 font-mono text-xs text-destructive">{item.error_message}</p>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
