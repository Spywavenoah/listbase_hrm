'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/client';
import type { EmployeeHistoryEntry } from '@/lib/types';

interface AuditEntry {
  id: string;
  action: string;
  field_key: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

interface CombinedEntry {
  id: string;
  kind: 'history' | 'audit';
  event_type?: string;
  title: string;
  description?: string | null;
  date: string;
}

const EVENT_COLORS: Record<string, string> = {
  HIRE: 'bg-primary/10 border-primary/30',
  PROMOTION: 'bg-primary/10 border-primary/30',
  TRANSFER: 'bg-info/10 border-info/30',
  SALARY_CHANGE: 'bg-success/10 border-success/30',
  STATUS_CHANGE: 'bg-warning/10 border-warning/30',
  CONTRACT_CHANGE: 'bg-muted border-border',
  OTHER: 'bg-muted border-border',
};

export default function TimelinePage() {
  const params = useParams();
  const id = params.id as string;
  const [entries, setEntries] = useState<CombinedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [histRes, auditRes] = await Promise.all([
        supabase.from('employee_history').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(100),
        supabase.from('audit_log').select('*').eq('module_key', 'employee').eq('record_id', id).order('created_at', { ascending: false }).limit(100),
      ]);

      const history: CombinedEntry[] = (histRes.data || []).map((h) => {
        const entry = h as unknown as EmployeeHistoryEntry;
        return {
          id: `h-${entry.id}`,
          kind: 'history',
          event_type: entry.event_type,
          title: entry.title,
          description: entry.description,
          date: entry.effective_date || entry.created_at,
        };
      });

      const audit: CombinedEntry[] = (auditRes.data || []).map((a) => {
        const entry = a as unknown as AuditEntry;
        const parts: string[] = [entry.field_key ? `Field: ${entry.field_key}` : ''];
        if (entry.old_value !== null && entry.old_value !== undefined) parts.push(`From: ${JSON.stringify(entry.old_value)}`);
        if (entry.new_value !== null && entry.new_value !== undefined) parts.push(`To: ${JSON.stringify(entry.new_value)}`);
        return {
          id: `a-${entry.id}`,
          kind: 'audit',
          title: entry.action,
          description: parts.filter(Boolean).join(' · ') || null,
          date: entry.created_at,
        };
      });

      const merged = [...history, ...audit]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 100);
      setEntries(merged);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="text-lg">Timeline & Employment History</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">No activity recorded yet.</p>
          </div>
        ) : (
          <div className="relative space-y-4 before:absolute before:left-2 before:top-0 before:h-full before:w-px before:bg-border">
            {entries.map((entry) => (
              <div key={entry.id} className="relative pl-8">
                <div
                  className={`absolute left-0 top-1 h-4 w-4 rounded-full border-2 border-card ${
                    entry.kind === 'history'
                      ? EVENT_COLORS[entry.event_type || 'OTHER'] || 'bg-muted'
                      : 'bg-muted'
                  }`}
                />
                <p className="text-sm font-medium">
                  {entry.title}
                  {entry.kind === 'history' && entry.event_type && (
                    <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                      {entry.event_type.replace(/_/g, ' ')}
                    </span>
                  )}
                </p>
                {entry.description && (
                  <p className="text-xs text-muted-foreground">{entry.description}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(entry.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · {new Date(entry.date).toLocaleTimeString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}