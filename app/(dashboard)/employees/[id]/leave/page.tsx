'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { CalendarDays } from 'lucide-react';

interface LeaveRequest {
  id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  created_at: string;
}

export default function LeavePage() {
  const params = useParams();
  const id = params.id as string;
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from('leave_requests')
          .select('*')
          .eq('employee_id', id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setRequests((data || []) as unknown as LeaveRequest[]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const statusColors: Record<string, string> = {
    PENDING: 'bg-warning/10 text-warning',
    APPROVED: 'bg-success/10 text-success',
    REJECTED: 'bg-destructive/10 text-destructive',
  };

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="text-lg">Leave History</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <CalendarDays className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No leave requests yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <div key={req.id} className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium">{req.start_date} → {req.end_date}</p>
                  {req.reason && <p className="text-sm text-muted-foreground mt-0.5">{req.reason}</p>}
                </div>
                <Badge variant="outline" className={statusColors[req.status] || ''}>
                  {req.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
