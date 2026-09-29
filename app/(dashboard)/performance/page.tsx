'use client';

import { useEffect, useState, useCallback } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Target, CheckCircle, Clock, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface Review {
  id: string;
  employee_id: string;
  review_cycle: string;
  reviewer_id: string | null;
  status: string;
  rating: number | null;
  feedback: string | null;
  submitted_at: string | null;
}

interface PerformanceScale { max: number; labels: string[] }

export default function PerformancePage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [scale, setScale] = useState<PerformanceScale | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [rRes, sRes] = await Promise.all([
        supabase.from('performance_reviews').select('*').order('created_at', { ascending: false }),
        supabase.rpc('get_performance_scale'),
      ]);
      if (rRes.error) throw rRes.error;
      setReviews((rRes.data || []) as unknown as Review[]);
      const s = sRes.data as { max: number; labels: string[] } | null;
      setScale(s ? { max: s.max || 5, labels: Array.isArray(s.labels) ? s.labels : [] } : null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ratingLabel = (rating: number | null) => {
    if (rating === null) return '—';
    const max = scale?.max || 5;
    if (!scale || scale.labels.length === 0) return `${rating}/${max}`;
    const idx = Math.max(0, Math.min(scale.labels.length - 1, Math.round(rating) - 1));
    return `${rating}/${max} · ${scale.labels[idx]}`;
  };

  const avgRating = reviews.filter((r) => r.rating !== null).length
    ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.filter((r) => r.rating !== null).length).toFixed(1)
    : '—';

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    SUBMITTED: 'bg-info/10 text-info',
    COMPLETED: 'bg-success/10 text-success',
  };

  const completedReviews = reviews.filter((r) => r.status === 'COMPLETED');
  const summaryCards: SummaryCard[] = [
    { label: 'Total Reviews', value: reviews.length, icon: Target, color: 'primary' },
    { label: 'Draft', value: reviews.filter((r) => r.status === 'DRAFT').length, icon: Clock, color: 'warning' },
    { label: 'Submitted', value: reviews.filter((r) => r.status === 'SUBMITTED').length, icon: CheckCircle, color: 'info' },
    { label: 'Avg Rating', value: avgRating, icon: Star, color: 'success' },
  ];

  const columns: Column<Review>[] = [
    { key: 'review_cycle', label: 'Cycle' },
    { key: 'rating', label: 'Rating', render: (r) => <span className="font-medium">{ratingLabel(r.rating)}</span> },
    { key: 'feedback', label: 'Feedback', render: (r) => r.feedback?.slice(0, 60) || '—' },
    {
      key: 'submitted_at', label: 'Submitted',
      render: (r) => r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '—',
    },
    {
      key: 'status', label: 'Status',
      render: (r) => <Badge variant="outline" className={statusColors[r.status] || ''}>{r.status}</Badge>,
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Performance Reviews"
        description="Manage employee performance evaluations and review cycles"
        summaryCards={summaryCards}
        columns={columns}
        data={reviews}
        loading={loading}
        searchPlaceholder="Search reviews..."
        statusKey="status"
      />
      {scale && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold">Rating Scale ({scale.max}-point)</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {scale.labels.map((label, i) => (
                <Badge key={label} variant="outline">{i + 1} — {label}</Badge>
              ))}
              {completedReviews.length > 0 && (
                <Badge variant="secondary" className="ml-auto">Configured in Settings → Performance</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
