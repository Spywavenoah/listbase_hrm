'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { AccessGate } from '@/lib/access';

interface AuditEntry {
  id: string;
  actor_id: string | null;
  action: string;
  module_key: string;
  record_id: string | null;
  field_key: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from('audit_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        setEntries((data || []) as unknown as AuditEntry[]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <AccessGate privilege="admin.audit">
      <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">Append-only record of all changes across the platform</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">No audit entries yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{entry.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm font-mono">{entry.module_key}</TableCell>
                      <TableCell className="text-sm font-mono">{entry.field_key || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {entry.old_value !== null && `From: ${JSON.stringify(entry.old_value).slice(0, 50)}`}
                        {entry.old_value !== null && entry.new_value !== null && ' → '}
                        {entry.new_value !== null && `To: ${JSON.stringify(entry.new_value).slice(0, 50)}`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </AccessGate>
  );
}
