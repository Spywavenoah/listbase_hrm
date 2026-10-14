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
import { MessageSquare, Plus, CheckCircle } from 'lucide-react';

interface Query {
  id: string;
  employee_id: string;
  subject: string;
  category: string;
  details: string | null;
  status: 'OPEN' | 'RESPONDED' | 'CLOSED';
  raised_by: string | null;
  response: string | null;
  responded_by: string | null;
  responded_at: string | null;
  raised_at: string;
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
  const isSelf = myId === id;
  const canManage = can('employees.manage') || can('employees.view_all') || can('admin.settings');

  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [details, setDetails] = useState('');

  const [respondTarget, setRespondTarget] = useState<Query | null>(null);
  const [response, setResponse] = useState('');
  const [responding, setResponding] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('employee_queries')
        .select('*')
        .eq('employee_id', id)
        .order('raised_at', { ascending: false });
      if (error) throw error;
      setQueries((data || []) as unknown as Query[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('employee_queries').insert({
        employee_id: id,
        subject: subject.trim(),
        category,
        details: details.trim() || null,
        raised_by: myId || null,
      });
      if (error) throw error;
      toast.success('Query submitted');
      setCreateOpen(false);
      setSubject('');
      setCategory('GENERAL');
      setDetails('');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitResponse = async () => {
    if (!respondTarget) return;
    setResponding(true);
    try {
      const { error } = await supabase
        .from('employee_queries')
        .update({
          response: response.trim() || null,
          responded_by: myId || null,
          responded_at: new Date().toISOString(),
          status: 'RESPONDED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', respondTarget.id);
      if (error) throw error;
      toast.success('Response saved');
      setRespondTarget(null);
      setResponse('');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setResponding(false);
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
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Queries</CardTitle>
        {(isSelf || canManage) && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New Query
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : queries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No queries raised yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {queries.map((q) => (
              <div key={q.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{q.subject}</p>
                  <Badge variant="outline" className={STATUS_COLORS[q.status] || ''}>
                    {q.status}
                  </Badge>
                  <Badge variant="outline" className="text-muted-foreground">{q.category}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(q.raised_at).toLocaleString()}
                </p>
                {q.details && (
                  <p className="mt-2 text-sm text-muted-foreground">{q.details}</p>
                )}
                {q.response && (
                  <div className="mt-2 rounded-md bg-muted/50 p-2.5">
                    <p className="text-xs font-medium text-muted-foreground">Response</p>
                    <p className="mt-0.5 text-sm">{q.response}</p>
                    {q.responded_at && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(q.responded_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
                {q.status !== 'CLOSED' && canManage && (
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => { setRespondTarget(q); setResponse(q.response || ''); }}
                    >
                      Respond
                    </Button>
                    {q.status === 'RESPONDED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-success/30 text-success hover:bg-success/10"
                        onClick={() => closeQuery(q)}
                      >
                        <CheckCircle className="mr-1 h-3.5 w-3.5" /> Close
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={(o) => { if (!saving) setCreateOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Query</DialogTitle>
            <DialogDescription>Raise a query or concern for this employee.</DialogDescription>
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
              <Label htmlFor="q-details">Details</Label>
              <Textarea id="q-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={4} placeholder="Describe the query..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Submitting...' : 'Submit'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!respondTarget} onOpenChange={(o) => { if (!o && !responding) { setRespondTarget(null); setResponse(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Respond to Query</DialogTitle>
            <DialogDescription>{respondTarget?.subject}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="q-response">Response</Label>
            <Textarea id="q-response" value={response} onChange={(e) => setResponse(e.target.value)} rows={4} placeholder="Type your response..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRespondTarget(null)} disabled={responding}>Cancel</Button>
            <Button onClick={submitResponse} disabled={responding}>{responding ? 'Saving...' : 'Save Response'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
