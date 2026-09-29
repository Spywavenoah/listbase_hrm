'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { Package } from 'lucide-react';

interface Asset {
  id: string;
  asset_tag: string | null;
  name: string;
  asset_type: string | null;
  condition_status: string;
  status: string;
  assigned_at: string | null;
}

export default function AssetsPage() {
  const params = useParams();
  const id = params.id as string;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from('assets')
          .select('*')
          .eq('assigned_to', id)
          .order('assigned_at', { ascending: false });
        if (error) throw error;
        setAssets((data || []) as unknown as Asset[]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="text-lg">Assigned Assets</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Package className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No assets assigned.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {assets.map((asset) => (
              <div key={asset.id} className="flex items-center justify-between rounded-lg border border-border p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Package className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">{asset.asset_tag || 'No tag'} · {asset.asset_type || 'Uncategorized'}</p>
                  </div>
                </div>
                <Badge variant="outline" className={asset.condition_status === 'GOOD' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}>
                  {asset.condition_status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
