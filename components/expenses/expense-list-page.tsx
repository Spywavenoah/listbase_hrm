'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import {
  Receipt, CheckCircle, Clock, XCircle, Wallet, FileText, Plus, Upload, Eye, Loader2, AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useAccess } from '@/lib/access';
import { CustomFieldsBlock } from '@/components/field-engine/custom-fields';
import { saveFieldValues } from '@/lib/field-engine/client';

const BUCKET = 'expense-proofs';
const MAX_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-destructive/10 text-destructive',
  RETIRED: 'bg-info/10 text-info',
  CANCELLED: 'bg-muted text-muted-foreground line-through',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETIRED: 'Retired',
  CANCELLED: 'Cancelled',
};

interface ExpenseClaim {
  id: string;
  claim_number: string;
  kind: 'CLAIM' | 'RETIREMENT';
  requested_by: string;
  category_id: string | null;
  amount: number;
  currency: string;
  expense_date: string | null;
  description: string | null;
  notes: string | null;
  proof_path: string | null;
  proof_name: string | null;
  proof_type: string | null;
  proof_size: number | null;
  status: string;
  requested_at: string;
  created_at: string;
}

interface ExpenseCategory { id: string; name: string }

interface NamedEmployee { id: string; name: string }

function formatBytes(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_') || 'invoice';
}

export default function ExpenseListPage({
  kind,
  title,
  description,
  createLabel,
  emptyMessage,
  emptyDescription,
}: {
  kind: 'CLAIM' | 'RETIREMENT';
  title: string;
  description: string;
  createLabel: string;
  emptyMessage: string;
  emptyDescription: string;
}) {
  const { employee, can, canAny } = useAccess();
  const isApprover = canAny(['expense.manage', 'expense.approve']) || can('admin.settings');

  const [rows, setRows] = useState<ExpenseClaim[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [manageEmployees, setManageEmployees] = useState<NamedEmployee[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    requested_by: '',
    category_id: '',
    amount: '',
    expense_date: '',
    description: '',
    notes: '',
  });
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [claimCustom, setClaimCustom] = useState<Record<string, unknown>>({});
  const setClaimCustomValue = (fieldKey: string, value: unknown) =>
    setClaimCustom((prev) => ({ ...prev, [fieldKey]: value }));

  const [proofTarget, setProofTarget] = useState<ExpenseClaim | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofSaving, setProofSaving] = useState(false);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const [decisionTarget, setDecisionTarget] = useState<{ row: ExpenseClaim; action: 'APPROVE' | 'REJECT' | 'RETIRE' } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionSaving, setDecisionSaving] = useState(false);

  const [viewingId, setViewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, catRes, empRes] = await Promise.all([
        supabase.from('expense_claims').select('*').eq('kind', kind).order('created_at', { ascending: false }),
        supabase.from('expense_categories').select('id, name').order('name'),
        supabase.rpc('get_procurement_employee_list'),
      ]);
      setRows((cRes.data || []) as unknown as ExpenseClaim[]);
      setCategories((catRes.data || []) as unknown as ExpenseCategory[]);
      const names: Record<string, string> = {};
      for (const e of (empRes.data || []) as NamedEmployee[]) names[e.id] = e.name;
      if (employee?.id && !names[employee.id]) names[employee.id] = `${employee.first_name} ${employee.last_name}`;
      setEmployeeNames(names);
      if (can('expense.manage')) {
        const m = await supabase
          .from('employees')
          .select('id, first_name, last_name')
          .eq('employment_status', 'ACTIVE')
          .order('first_name');
        setManageEmployees((m.data || []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` })));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [kind, can, employee]);

  useEffect(() => { load(); }, [load]);

  const employeeName = (id: string) => employeeNames[id] || '—';
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name || '—';
  const money = (n: number) => `₦${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

  const openCreate = () => {
    setForm({
      requested_by: employee?.id || '',
      category_id: '',
      amount: '',
      expense_date: new Date().toISOString().slice(0, 10),
      description: '',
      notes: '',
    });
    setCreateFile(null);
    setClaimCustom({});
    setCreateOpen(true);
  };

  const pickCreateFile = (f: File | null) => {
    setCreateFile(null);
    if (!f) return;
    if (!ALLOWED_TYPES.includes(f.type)) { toast.error('Only PDF, JPEG or PNG files are allowed.'); return; }
    if (f.size > MAX_SIZE) { toast.error('File is too large. Maximum size is 15 MB.'); return; }
    setCreateFile(f);
  };

  const handleCreate = async () => {
    const requestedBy = form.requested_by || employee?.id;
    if (!requestedBy) { toast.error('No employee selected'); return; }
    if (!form.category_id || !form.amount || Number(form.amount) <= 0) {
      toast.error('Select a category and enter a positive amount');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('expense_claims')
        .insert({
          kind,
          requested_by: requestedBy,
          category_id: form.category_id,
          amount: Number(form.amount),
          expense_date: form.expense_date || null,
          description: form.description || null,
          notes: form.notes || null,
          status: 'PENDING',
        })
        .select().single();
      if (error) throw error;
      const row = data as unknown as ExpenseClaim;

      if (createFile) {
        const path = `${row.id}/${sanitizeFileName(createFile.name)}`;
        const { error: upError } = await supabase.storage
          .from(BUCKET)
          .upload(path, createFile, { contentType: createFile.type, cacheControl: '3600', upsert: false });
        if (upError) throw upError;
        const { error: metaError } = await supabase
          .from('expense_claims')
          .update({ proof_path: path, proof_name: createFile.name, proof_type: createFile.type, proof_size: createFile.size })
          .eq('id', row.id);
        if (metaError) throw metaError;
      }

      const customValues = Object.fromEntries(
        Object.entries(claimCustom).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      if (Object.keys(customValues).length > 0) {
        await saveFieldValues('expense_claim', row.id, customValues);
      }

      toast.success(kind === 'CLAIM' ? 'Expense claim submitted' : 'Retirement statement submitted');
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cancelClaim = async (row: ExpenseClaim) => {
    try {
      const { error } = await supabase.from('expense_claims').update({ status: 'CANCELLED' }).eq('id', row.id);
      if (error) throw error;
      toast.success('Claim cancelled');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const runDecision = async () => {
    if (!decisionTarget) return;
    setDecisionSaving(true);
    try {
      const { error } = await supabase.rpc('approve_expense_claim', {
        p_claim_id: decisionTarget.row.id,
        p_action: decisionTarget.action,
        p_note: decisionNote || null,
      });
      if (error) throw error;
      toast.success({
        APPROVE: 'Claim approved',
        REJECT: 'Claim rejected',
        RETIRE: 'Claim retired',
      }[decisionTarget.action]);
      setDecisionTarget(null);
      setDecisionNote('');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setDecisionSaving(false);
    }
  };

  const handleAttachProof = async () => {
    if (!proofTarget || !proofFile) return;
    setProofSaving(true);
    try {
      const path = `${proofTarget.id}/${sanitizeFileName(proofFile.name)}`;
      const { error: upError } = await supabase.storage
        .from(BUCKET)
        .upload(path, proofFile, { contentType: proofFile.type, cacheControl: '3600', upsert: false });
      if (upError) throw upError;
      const { error } = await supabase
        .from('expense_claims')
        .update({ proof_path: path, proof_name: proofFile.name, proof_type: proofFile.type, proof_size: proofFile.size })
        .eq('id', proofTarget.id);
      if (error) throw error;
      toast.success('Proof / invoice attached');
      setProofTarget(null);
      setProofFile(null);
      if (proofInputRef.current) proofInputRef.current.value = '';
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setProofSaving(false);
    }
  };

  const viewProof = async (row: ExpenseClaim) => {
    if (!row.proof_path) return;
    setViewingId(row.id);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.proof_path, 3600);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
    } catch (err) {
      toast.error('Could not open proof: ' + (err as Error).message);
    } finally {
      setViewingId(null);
    }
  };

  const canManageSelfRow = (row: ExpenseClaim) => row.requested_by === employee?.id;
  const canAttachProof = (row: ExpenseClaim) => !row.proof_path && (isApprover || canManageSelfRow(row));

  const summaryCards: SummaryCard[] = [
    { label: 'Total', value: rows.length, icon: Receipt, color: 'primary' },
    { label: 'Pending', value: rows.filter((r) => r.status === 'PENDING').length, icon: Clock, color: 'warning' },
    { label: 'Approved', value: rows.filter((r) => r.status === 'APPROVED').length, icon: CheckCircle, color: 'success' },
    { label: 'Retired', value: rows.filter((r) => r.status === 'RETIRED').length, icon: Wallet, color: 'info' },
  ];

  const columns: Column<ExpenseClaim>[] = [
    { key: 'claim_number', label: 'Ref', render: (r) => <span className="font-medium">{r.claim_number}</span>, searchText: (r) => [r.claim_number] },
    { key: 'employee', label: 'Employee', render: (r) => (canManageSelfRow(r) ? 'You' : employeeName(r.requested_by)), searchText: (r) => [canManageSelfRow(r) ? 'You' : employeeName(r.requested_by)] },
    { key: 'category', label: 'Category', render: (r) => categoryName(r.category_id) },
    { key: 'amount', label: 'Amount', render: (r) => <span className="font-bold">{money(r.amount)}</span> },
    { key: 'expense_date', label: 'Date', render: (r) => fmtDate(r.expense_date) },
    {
      key: 'proof', label: 'Proof',
      render: (r) => r.proof_path ? (
        <Badge variant="outline" className="gap-1 border-info/30 text-info">
          <FileText className="h-3 w-3" /> {r.proof_name ?? 'Attached'}
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    },
    { key: 'status', label: 'Status', render: (r) => <Badge variant="outline" className={STATUS_COLORS[r.status] || ''}>{STATUS_LABELS[r.status] || r.status}</Badge> },
  ];

  return (
    <>
      <ModuleListPage
        title={title}
        description={description}
        summaryCards={summaryCards}
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search..."
        statusKey="status"
        createLabel={createLabel}
        onCreate={openCreate}
        emptyMessage={emptyMessage}
        emptyDescription={emptyDescription}
        rowActions={(r) => {
          const self = canManageSelfRow(r);
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {r.proof_path && (
                <Button size="sm" variant="ghost" className="h-7" onClick={() => viewProof(r)} disabled={viewingId === r.id}>
                  {viewingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  View
                </Button>
              )}
              {canAttachProof(r) && r.status !== 'REJECTED' && r.status !== 'RETIRED' && r.status !== 'CANCELLED' && (
                <Button size="sm" variant="outline" className="h-7" onClick={() => { setProofTarget(r); setProofFile(null); }}>
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  {isApprover ? 'Attach proof' : 'Add proof'}
                </Button>
              )}
              {self && r.status === 'PENDING' && (
                <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => cancelClaim(r)}>
                  Cancel
                </Button>
              )}
              {isApprover && !self && r.status === 'PENDING' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-success/30 text-success hover:bg-success/10"
                    onClick={() => { setDecisionTarget({ row: r, action: 'APPROVE' }); setDecisionNote(''); }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-destructive/30 text-destructive hover:bg-destructive/10"
                    onClick={() => { setDecisionTarget({ row: r, action: 'REJECT' }); setDecisionNote(''); }}
                  >
                    Reject
                  </Button>
                </>
              )}
              {isApprover && !self && r.status === 'APPROVED' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-info/40 text-info hover:bg-info/10"
                  disabled={!r.proof_path}
                  onClick={() => { setDecisionTarget({ row: r, action: 'RETIRE' }); setDecisionNote(''); }}
                  title={r.proof_path ? undefined : 'Attach a proof / invoice before retiring'}
                >
                  <Wallet className="mr-1 h-3.5 w-3.5" />
                  Retire
                </Button>
              )}
            </div>
          );
        }}
      />

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreateFile(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {can('expense.manage') && (
              <div className="space-y-1.5">
                <Label>Employee</Label>
                <Select value={form.requested_by} onValueChange={(v) => setForm({ ...form, requested_by: v })}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {manageEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Amount *</Label>
                <Input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Expense Date</Label>
                <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was this for?" />
            </div>
            <div className="space-y-1.5">
              <Label>Proof / Invoice (optional now)</Label>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
                onChange={(e) => pickCreateFile(e.target.files?.[0] ?? null)}
              />
              {createFile && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3" /> {createFile.name} ({formatBytes(createFile.size)})
                </p>
              )}
              <p className="text-xs text-muted-foreground">PDF, JPG, PNG — up to 15 MB. A proof must be attached before a claim can be retired.</p>
            </div>
            <CustomFieldsBlock moduleKey="expense_claim" values={claimCustom} onChange={setClaimCustomValue} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.category_id || !form.amount || Number(form.amount) <= 0}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {saving ? 'Submitting...' : 'Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!proofTarget} onOpenChange={(open) => { if (!open && !proofSaving) { setProofTarget(null); setProofFile(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attach proof / invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Attach the receipt or invoice for <strong>#{proofTarget?.claim_number}</strong>. This evidence is required
              before the {kind === 'CLAIM' ? 'claim' : 'retirement'} can be cleared.
            </p>
            <div className="space-y-1.5">
              <Label>File (PDF, JPEG, PNG) *</Label>
              <input
                ref={proofInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setProofFile(null);
                  if (!f) return;
                  if (!ALLOWED_TYPES.includes(f.type)) { toast.error('Only PDF, JPEG or PNG files are allowed.'); return; }
                  if (f.size > MAX_SIZE) { toast.error('File is too large. Maximum size is 15 MB.'); return; }
                  setProofFile(f);
                }}
              />
              {proofFile && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3" /> {proofFile.name} ({formatBytes(proofFile.size)})
                </p>
              )}
            </div>
            {!proofFile && <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> A claim cannot be retired until this step is done.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setProofTarget(null); setProofFile(null); }} disabled={proofSaving}>Cancel</Button>
            <Button onClick={handleAttachProof} disabled={!proofFile || proofSaving}>
              {proofSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {proofSaving ? 'Uploading...' : 'Attach proof'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!decisionTarget} onOpenChange={(open) => { if (!open && !decisionSaving) { setDecisionTarget(null); setDecisionNote(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decisionTarget?.action === 'APPROVE' && 'Approve expense?'}
              {decisionTarget?.action === 'REJECT' && 'Reject expense?'}
              {decisionTarget?.action === 'RETIRE' && 'Clear / retire this expense?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {decisionTarget && (
                <>
                  <strong>#{decisionTarget.row.claim_number}</strong> · {categoryName(decisionTarget.row.category_id)} ·{' '}
                  <strong>{money(decisionTarget.row.amount)}</strong> — {canManageSelfRow(decisionTarget.row) ? 'You' : employeeName(decisionTarget.row.requested_by)}
                  {decisionTarget.action === 'RETIRE' && decisionTarget.row.proof_path && (
                    <> · proof attached ({decisionTarget.row.proof_name ?? 'invoice'})</>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decision-note">Note (optional)</Label>
            <Textarea
              id="decision-note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder={decisionTarget?.action === 'REJECT' ? 'Reason for rejection...' : 'Add a note for the requester...'}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decisionSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={decisionSaving}
              onClick={(e) => { e.preventDefault(); runDecision(); }}
            >
              {decisionSaving ? 'Working...' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}