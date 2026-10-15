'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { toast } from 'sonner';
import { MessageSquare, Plus, CheckCircle, Send, CalendarClock, Loader2 } from 'lucide-react';

interface Query {
  id: string;
  employee_id: string;
  subject: string;
  category: string;
  details: string | null;
  status: 'OPEN' | 'RESPONDED' | 'CLOSED';
  raised_by: string | null;
  reply_deadline: string | null;
  last_message_at: string | null;
  last_message_by: string | null;
  raised_at: string;
  created_at: string;
}

interface QueryMessage {
  id: string;
  query_id: string;
  author_id: string | null;
  author_type: 'EMPLOYEE' | 'HR';
  body: string;
  created_at: string;
}

const CATEGORIES = ['GENERAL', 'PAYROLL', 'LEAVE', 'ATTENDANCE', 'BENEFITS', 'OTHER'];

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-warning/10 text-warning border-warning/20',
  RESPONDED: 'bg-info/10 text-info border-info/20',
  CLOSED: 'bg-success/10 text-success border-success/20',
};

export default function EmployeeQueriesPage() {
  const params = useParams();
  const id = params.id as string;
  const { employeeId: myId, can } = useAccess();
  const canManage = can('employees.manage') || can('admin.settings');

  const [queries, setQueries] = useState<Query[]>([]);
  const [messages, setMessages] = useState<Record<string, QueryMessage[]>>({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [details, setDetails] = useState('');
  const [deadline, setDeadline] = useState('');

  const [chatTarget, setChatTarget] = useState<Query | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [editDeadline, setEditDeadline] = useState('');

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('employee_queries')
        .select('*')
        .eq('employee_id', id)
        .order('raised_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []) as unknown as Query[];
      setQueries(rows);

      if (rows.length) {
        const { data: msgData, error: msgError } = await supabase
          .from('employee_query_messages')
          .select('*')
          .in('query_id', rows.map((q) => q.id))
          .order('created_at', { ascending: true });
        if (msgError) throw msgError;
        const grouped: Record<string, QueryMessage[]> = {};
        for (const m of (msgData || []) as unknown as QueryMessage[]) {
          (grouped[m.query_id] = grouped[m.query_id] || []).push(m);
        }
        setMessages(grouped);
      } else {
        setMessages({});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.rpc('notify_query_deadlines').then(() => {}, () => {});
  }, []);

  const submit = async () => {
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('employee_queries').insert({
        employee_id: id,
        subject: subject.trim(),
        category,
        details: details.trim() || null,
        reply_deadline: deadline || null,
        raised_by: myId || null,
      });
      if (error) throw error;
      toast.success('Query created');
      setCreateOpen(false);
      setSubject('');
      setCategory('GENERAL');
      setDetails('');
      setDeadline('');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async () => {
    if (!chatTarget) return;
    if (!replyBody.trim()) { toast.error('Enter a message'); return; }
    setSending(true);
    try {
      const { error } = await supabase.from('employee_query_messages').insert({
        query_id: chatTarget.id,
        body: replyBody.trim(),
      });
      if (error) throw error;
      setReplyBody('');
      await load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const saveDeadline = async () => {
    if (!chatTarget) return;
    try {
      const { error } = await supabase
        .from('employee_queries')
        .update({ reply_deadline: editDeadline || null, updated_at: new Date().toISOString() })
        .eq('id', chatTarget.id);
      if (error) throw error;
      toast.success(editDeadline ? 'Reply deadline saved' : 'Reply deadline cleared');
      await load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const closeQuery = async (q: Query) => {
    try {
      const { error } = await supabase
        .from('employee_queries')
        .update({ status: 'CLOSED', updated_at: new Date().toISOString() })
        .eq('id', q.id);
      if (error) throw error;
      toast.success('Query closed');
      setChatTarget(null);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const openChatThread = (q: Query) => {
    setChatTarget(q);
    setEditDeadline(q.reply_deadline ? q.reply_deadline.slice(0, 16) : '');
    setReplyBody('');
  };

  const undoClose = async (q: Query) => {
    try {
      const { error } = await supabase
        .from('employee_queries')
        .update({ status: 'OPEN', updated_at: new Date().toISOString() })
        .eq('id', q.id);
      if (error) throw error;
      toast.success('Query reopened');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const chatMessages = (q: Query): { type: 'EMPLOYEE' | 'HR'; body: string; at: string }[] => {
    const list: { type: 'EMPLOYEE' | 'HR'; body: string; at: string }[] = [];
    if (q.details) list.push({ type: 'HR', body: q.details, at: q.raised_at });
    for (const m of messages[q.id] || []) list.push({ type: m.author_type, body: m.body, at: m.created_at });
    return list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Queries</CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {canManage ? 'Raise queries and reply in the thread' : 'View queries raised against you and reply'}
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> New Query
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : queries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No queries yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {queries.map((q) => {
              const thread = messages[q.id] || [];
              const last = thread[thread.length - 1];
              const overdue = q.reply_deadline && q.status !== 'CLOSED' && new Date(q.reply_deadline).getTime() < Date.now() && q.last_message_by !== 'EMPLOYEE';
              return (
                <button
                  key={q.id}
                  onClick={() => openChatThread(q)}
                  className="w-full rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{q.subject}</p>
                    <Badge variant="outline" className={STATUS_COLORS[q.status] || ''}>{q.status}</Badge>
                    <Badge variant="outline" className="text-muted-foreground">{q.category}</Badge>
                    {q.reply_deadline && (
                      <Badge variant="outline" className={overdue ? 'bg-destructive/10 text-destructive border-destructive/20' : 'text-muted-foreground'}>
                        <CalendarClock className="mr-1 h-3 w-3" />
                        {new Date(q.reply_deadline).toLocaleString()}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Opened {new Date(q.raised_at).toLocaleString()}
                    {thread.length > 0 ? ` · ${thread.length} message${thread.length === 1 ? '' : 's'}` : ''}
                  </p>
                  {last && (
                    <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground/80">{last.author_type === 'EMPLOYEE' ? 'Employee' : 'HR'}: </span>
                      {last.body}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={(o) => { if (!saving) setCreateOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Query</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="q-subject">Subject</Label>
              <Input id="q-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reply deadline (optional)</Label>
              <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              <p className="text-xs text-muted-foreground">The employee is reminded as this deadline approaches.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q-details">Details</Label>
              <Textarea id="q-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={4} placeholder="Describe the query..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Submitting...' : 'Create Query'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!chatTarget} onOpenChange={(o) => { if (!o) setChatTarget(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{chatTarget?.subject}</DialogTitle>
          </DialogHeader>
          {chatTarget && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={STATUS_COLORS[chatTarget.status] || ''}>{chatTarget.status}</Badge>
                <Badge variant="outline" className="text-muted-foreground">{chatTarget.category}</Badge>
                {chatTarget.reply_deadline && (
                  <Badge variant="outline" className="text-muted-foreground">
                    <CalendarClock className="mr-1 h-3 w-3" /> Due {new Date(chatTarget.reply_deadline).toLocaleString()}
                  </Badge>
                )}
              </div>

              <div className="max-h-[45vh] space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
                {chatMessages(chatTarget).map((m, i) => (
                  <div key={i} className={`flex ${m.type === 'HR' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.type === 'HR' ? 'bg-background border border-border' : 'bg-primary text-primary-foreground'}`}>
                      <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">{m.type === 'HR' ? 'HR' : 'You'}</p>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className={`mt-1 text-[10px] ${m.type === 'HR' ? 'text-muted-foreground' : 'opacity-70'}`}>
                        {new Date(m.at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {canManage && (
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="q-deadline">Reply deadline</Label>
                    <Input id="q-deadline" type="datetime-local" value={editDeadline} onChange={(e) => setEditDeadline(e.target.value)} />
                  </div>
                  <Button variant="outline" onClick={saveDeadline}>Save deadline</Button>
                </div>
              )}

              {chatTarget.status !== 'CLOSED' ? (
                <div className="space-y-2">
                  <Textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={3}
                    placeholder={canManage ? 'Write a message...' : 'Type your reply...'}
                  />
                  <div className="flex items-center justify-between">
                    <div>
                      {canManage && (
                        <Button size="sm" variant="outline" onClick={() => closeQuery(chatTarget)}>
                          <CheckCircle className="mr-1 h-3.5 w-3.5" /> Close query
                        </Button>
                      )}
                    </div>
                    <Button onClick={sendReply} disabled={sending || !replyBody.trim()}>
                      {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                      Send
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm text-muted-foreground">This query is closed.</p>
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => undoClose(chatTarget)}>Reopen</Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
