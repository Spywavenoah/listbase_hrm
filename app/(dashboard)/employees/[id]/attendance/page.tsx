'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { Clock } from 'lucide-react';

interface AttendanceRecord {
  id: string;
  clock_in: string | null;
  clock_out: string | null;
  date: string;
  status: string;
  work_hours: number | null;
  overtime_hours: number;
}

export default function AttendancePage() {
  const params = useParams();
  const id = params.id as string;
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from('attendance')
          .select('*')
          .eq('employee_id', id)
          .order('date', { ascending: false })
          .limit(30);
        if (error) throw error;
        setRecords((data || []) as unknown as AttendanceRecord[]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const statusColors: Record<string, string> = {
    PRESENT: 'bg-success/10 text-success',
    ABSENT: 'bg-destructive/10 text-destructive',
    LATE: 'bg-warning/10 text-warning',
    HALF_DAY: 'bg-info/10 text-info',
  };

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="text-lg">Attendance History</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Clock className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No attendance records yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((rec) => (
              <div key={rec.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-medium text-sm">{rec.date}</p>
                    <p className="text-xs text-muted-foreground">
                      {rec.clock_in ? new Date(rec.clock_in).toLocaleTimeString() : '—'} → {rec.clock_out ? new Date(rec.clock_out).toLocaleTimeString() : '—'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {rec.work_hours !== null && (
                    <span className="text-sm text-muted-foreground">{rec.work_hours}h</span>
                  )}
                  <Badge variant="outline" className={statusColors[rec.status] || ''}>
                    {rec.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
