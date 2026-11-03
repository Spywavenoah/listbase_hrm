export const PAYMENT_PROOF_BUCKET = 'payroll-payment-proofs';
export const PAYMENT_PROOF_GROUP = 'payroll';
export const PAYMENT_PROOF_KEY = 'payment_proofs';
export const PAYMENT_PROOF_MAX_SIZE = 15 * 1024 * 1024;
export const PAYMENT_PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export interface PaymentProofRecord {
  id: string;
  payroll_run_id: string | null;
  payslip_ids: string[];
  path: string;
  file_name: string;
  content_type: string;
  size: number;
  payment_date: string | null;
  reference: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

/** The payment proof recorded for a payslip, if it was uploaded with one. */
export function proofForPayslip(proofs: PaymentProofRecord[], payslipId: string): PaymentProofRecord | undefined {
  return proofs.find((proof) => proof.payslip_ids.includes(payslipId));
}

export function paymentProofUrl(path: string): string {
  return `/api/payroll/payment-proof?path=${encodeURIComponent(path)}`;
}

export async function fetchPaymentProofs(): Promise<PaymentProofRecord[]> {
  const res = await fetch('/api/payroll/payment-proof', { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || res.statusText);
  return (body?.proofs || []) as PaymentProofRecord[];
}

export async function uploadPaymentProof(params: {
  file: File;
  payslipIds: string[];
  payrollRunId?: string | null;
  paymentDate?: string | null;
  reference?: string | null;
  uploadedBy?: string | null;
}): Promise<PaymentProofRecord> {
  const form = new FormData();
  form.append('file', params.file);
  form.append('payslip_ids', JSON.stringify(params.payslipIds));
  if (params.payrollRunId) form.append('payroll_run_id', params.payrollRunId);
  if (params.paymentDate) form.append('payment_date', params.paymentDate);
  if (params.reference) form.append('reference', params.reference);
  if (params.uploadedBy) form.append('uploaded_by', params.uploadedBy);

  const res = await fetch('/api/payroll/payment-proof', { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || res.statusText);
  return body.proof as PaymentProofRecord;
}

export async function deletePaymentProof(id: string): Promise<PaymentProofRecord[]> {
  const res = await fetch(`/api/payroll/payment-proof?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || res.statusText);
  return (body?.proofs || []) as PaymentProofRecord[];
}
