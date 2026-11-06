'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModuleListPage, type Column, type SummaryCard } from '@/components/shared/module-list-page';
import { CheckCircle, Clock, FileCheck2, PackageCheck, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import {
  fmtDate,
  fmtQty,
  type MaterialIssueReceipt,
  type MaterialIssueReceiptItem,
} from '@/lib/inventory';

const DOC_BUCKET = 'inventory-items';

const statusClass = (receipt: MaterialIssueReceipt) =>
  receipt.acknowledged_at
    ? 'bg-success/10 text-success border-success/30'
    : 'bg-warning/10 text-warning border-warning/30';

export default function MaterialIssueReceiptsPage() {
  const { can, employee } = useAccess();
  const canIssue = can('inventory.issue') || can('inventory.manage');

  const [rows, setRows] = useState<MaterialIssueReceipt[]>([]);
  const [linesByReceipt, setLinesByReceipt] = useState<Record<string, MaterialIssueReceiptItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);

  const [method, setMethod] = useState('RECIPIENT');
  const [comment, setComment] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, lRes] = await Promise.all([
        supabase
          .from('material_issue_receipts')
          .select('*, request:material_requests!material_issue_receipts_request_id_fkey(request_number, warehouse:inventory_warehouses(name))')
          .order('issued_at', { ascending: false }),
        supabase
          .from('material_issue_receipt_items')
          .select('*, request_item:material_request_items(id,item_name,uom,quantity_requested,quantity_approved,quantity_issued)'),
      ]);
      setRows((hRes.data || []) as unknown as MaterialIssueReceipt[]);
      const grouped: Record<string, MaterialIssueReceiptItem[]> = {};
      for (const line of (lRes.data || []) as unknown as MaterialIssueReceiptItem[]) {
        (grouped[line.receipt_id] = grouped[line.receipt_id] || []).push(line);
      }
      setLinesByReceipt(grouped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const detailRow = rows.find((r) => r.id === detailId) || null;
  const detailLines = useMemo(
    () => (detailRow ? linesByReceipt[detailRow.id] || [] : []),
    [detailRow, linesByReceipt]
  );

  useEffect(() => {
    setMethod('RECIPIENT');
    setComment(detailRow?.comment || '');
    setFile(null);
  }, [detailRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const canAcknowledge = (receipt: MaterialIssueReceipt) =>
    !receipt.acknowledged_at
    && (canIssue || (!!employee?.id && receipt.recipient_employee_id === employee.id));

  const acknowledge = async () => {
    if (!detailRow) return;
    const signedCopy = method === 'SIGNED_COPY';
    if (signedCopy && !file && !detailRow.signed_document_url) {
      toast.error('Choose the signed receipt file');
      return;
    }
    setWorking(true);
    try {
      let documentUrl: string | null = detailRow.signed_document_url;
      if (signedCopy && file) {
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
        const path = `issue-receipts/${detailRow.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(DOC_BUCKET)
          .upload(path, file, { upsert: true, contentType: file.type });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from(DOC_BUCKET).getPublicUrl(path);
        documentUrl = data.publicUrl;
      }
      const { error } = await supabase.rpc('acknowledge_material_issue_receipt', {
        p_receipt_id: detailRow.id,
        p_method: method,
        p_comment: comment || null,
        p_signed_document_url: documentUrl,
      });
      if (error) throw error;
      toast.success('Receipt acknowledgement recorded');
      setDetailId(null);
      await load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Issue Receipts', value: rows.length, icon: FileCheck2, color: 'primary' },
    { label: 'Awaiting Acknowledgement', value: rows.filter((r) => !r.acknowledged_at).length, icon: Clock, color: 'warning' },
    { label: 'Acknowledged', value: rows.filter((r) => !!r.acknowledged_at).length, icon: CheckCircle, color: 'success' },
    { label: 'Lines Issued', value: Object.values(linesByReceipt).reduce((a, l) => a + l.length, 0), icon: PackageCheck, color: 'info' },
  ];

  const columns: Column<MaterialIssueReceipt>[] = [
    { key: 'receipt_number', label: 'Receipt', render: (r) => <span className="font-medium">{r.receipt_number}</span> },
    { key: 'request', label: 'Request', render: (r) => r.request?.request_number || '—' },
    { key: 'warehouse', label: 'Warehouse', render: (r) => r.request?.warehouse?.name || '—' },
    { key: 'recipient_name', label: 'Recipient', render: (r) => r.recipient_name },
    { key: 'issued_at', label: 'Issued', render: (r) => fmtDate(r.issued_at) },
    { key: 'lines', label: 'Items', render: (r) => (linesByReceipt[r.id] || []).length, searchable: false },
    {
      key: 'acknowledged_at',
      label: 'Status',
      render: (r) => (
        <div className="flex flex-col gap-1">
          <Badge variant="outline" className={statusClass(r)}>
            {r.acknowledged_at ? 'Acknowledged' : 'Pending acknowledgement'}
          </Badge>
          {r.acknowledged_at && (
            <span className="text-xs text-muted-foreground">
              {r.acknowledgement_method === 'SIGNED_COPY' ? 'Signed copy' : 'Recipient confirmation'}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Material Issue Receipts"
        description="Every issue against a material request, with recipient or signed-copy acknowledgement"
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search receipts, requests or recipients..."
        onRowClick={(r) => setDetailId(r.id)}
        rowActions={(r) => (
          canAcknowledge(r)
            ? <Button size="sm" variant="outline" onClick={() => setDetailId(r.id)}><CheckCircle className="mr-1.5 h-4 w-4" /> Acknowledge</Button>
            : <Button size="sm" variant="ghost" onClick={() => setDetailId(r.id)}>View</Button>
        )}
        emptyMessage="No issue receipts yet"
        emptyDescription="Issue an approved material request to create a receipt for acknowledgement."
      />

      <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detailRow?.receipt_number || 'Material Issue Receipt'}
              {detailRow && (
                <Badge variant="outline" className={statusClass(detailRow)}>
                  {detailRow.acknowledged_at ? 'Acknowledged' : 'Pending acknowledgement'}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p>Request: <span className="font-medium">{detailRow.request?.request_number || '—'}</span></p>
                <p>Warehouse: <span className="font-medium">{detailRow.request?.warehouse?.name || '—'}</span></p>
                <p>Recipient: <span className="font-medium">{detailRow.recipient_name}</span></p>
                <p>Issued: <span className="font-medium">{fmtDate(detailRow.issued_at)}</span></p>
                {detailRow.acknowledged_at && (
                  <p>Acknowledged: <span className="font-medium">{fmtDate(detailRow.acknowledged_at)}</span></p>
                )}
                {detailRow.acknowledgement_method && (
                  <p>Method: <span className="font-medium">{detailRow.acknowledgement_method === 'SIGNED_COPY' ? 'Signed copy' : 'Recipient confirmation'}</span></p>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Approved</th>
                      <th className="px-3 py-2">Issued now</th>
                      <th className="px-3 py-2">Cumulative issued</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detailLines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2 font-medium">{line.request_item?.item_name || '—'}</td>
                        <td className="px-3 py-2">{fmtQty(line.request_item?.quantity_approved ?? line.request_item?.quantity_requested ?? 0)} {line.request_item?.uom || ''}</td>
                        <td className="px-3 py-2">{fmtQty(line.quantity)} {line.request_item?.uom || ''}</td>
                        <td className="px-3 py-2">{fmtQty(line.request_item?.quantity_issued ?? 0)} {line.request_item?.uom || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detailRow.signed_document_url && (
                <p className="text-sm">
                  Signed copy: <a className="text-primary underline" href={detailRow.signed_document_url} target="_blank" rel="noreferrer">Open document</a>
                </p>
              )}
              {detailRow.comment && <p className="text-sm text-muted-foreground">{detailRow.comment}</p>}

              {canAcknowledge(detailRow) && (
                <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm font-medium">Record acknowledgement</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Method</Label>
                      <Select value={method} onValueChange={setMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="RECIPIENT">Recipient confirmation</SelectItem>
                          <SelectItem value="SIGNED_COPY">Signed receipt uploaded</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {method === 'SIGNED_COPY' && (
                      <div className="space-y-1.5">
                        <Label>Signed receipt</Label>
                        <input
                          ref={fileRef}
                          type="file"
                          accept="application/pdf,image/png,image/jpeg"
                          className="hidden"
                          onChange={(e) => setFile(e.target.files?.[0] || null)}
                        />
                        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => fileRef.current?.click()}>
                          <Upload className="mr-1.5 h-4 w-4" /> {file ? file.name : 'Choose PDF or image'}
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Comment</Label>
                    <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional acknowledgement note" />
                  </div>
                </div>
              )}

              {!canAcknowledge(detailRow) && !detailRow.acknowledged_at && (
                <p className="text-sm text-muted-foreground">
                  Only the named recipient or a warehouse officer can acknowledge this receipt.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            {detailRow && canAcknowledge(detailRow) && (
              <Button onClick={acknowledge} disabled={working}>
                <CheckCircle className="mr-1.5 h-4 w-4" /> {working ? 'Recording...' : 'Record Acknowledgement'}
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
