import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  PAYMENT_PROOF_BUCKET,
  PAYMENT_PROOF_GROUP,
  PAYMENT_PROOF_KEY,
  PAYMENT_PROOF_MAX_SIZE,
  PAYMENT_PROOF_TYPES,
  type PaymentProofRecord,
} from '@/lib/payroll/payment-proofs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DbClient = ReturnType<typeof createServerClient>;

async function ensureBucket(supabase: DbClient): Promise<void> {
  const { data } = await supabase.storage.getBucket(PAYMENT_PROOF_BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(PAYMENT_PROOF_BUCKET, {
    public: false,
    fileSizeLimit: PAYMENT_PROOF_MAX_SIZE,
    allowedMimeTypes: PAYMENT_PROOF_TYPES,
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function readProofs(supabase: DbClient): Promise<PaymentProofRecord[]> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('group_name', PAYMENT_PROOF_GROUP)
    .eq('key', PAYMENT_PROOF_KEY)
    .maybeSingle();
  if (error) throw error;
  const value = data?.value;
  return Array.isArray(value) ? (value as PaymentProofRecord[]) : [];
}

async function writeProofs(supabase: DbClient, proofs: PaymentProofRecord[]): Promise<void> {
  const { error } = await supabase.from('system_settings').upsert(
    {
      group_name: PAYMENT_PROOF_GROUP,
      key: PAYMENT_PROOF_KEY,
      value: proofs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_name,key' }
  );
  if (error) throw error;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');

    if (path) {
      const { data, error } = await supabase.storage.from(PAYMENT_PROOF_BUCKET).download(path);
      if (error || !data) {
        return NextResponse.json({ error: error?.message || 'File not found' }, { status: 404 });
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      const name = path.split('/').pop() || 'payment-proof';
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': data.type || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${name.replace(/"/g, '')}"`,
          'Cache-Control': 'private, max-age=60',
        },
      });
    }

    const proofs = await readProofs(supabase);
    return NextResponse.json({ proofs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Attach a cheque or payment proof file' }, { status: 400 });
    }
    if (file.size > PAYMENT_PROOF_MAX_SIZE) {
      return NextResponse.json({ error: 'File must be 15 MB or smaller' }, { status: 400 });
    }
    const contentType = file.type || 'application/octet-stream';
    if (!PAYMENT_PROOF_TYPES.includes(contentType)) {
      return NextResponse.json({ error: 'Only PDF, JPEG or PNG proof files are allowed' }, { status: 400 });
    }

    const payslipIdsRaw = String(form.get('payslip_ids') || '[]');
    let payslipIds: string[] = [];
    try {
      const parsed = JSON.parse(payslipIdsRaw);
      if (Array.isArray(parsed)) payslipIds = parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      payslipIds = [];
    }
    if (payslipIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one payslip' }, { status: 400 });
    }

    await ensureBucket(supabase);

    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${new Date().toISOString().slice(0, 7)}/${newId()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(PAYMENT_PROOF_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (uploadError) throw uploadError;

    const record: PaymentProofRecord = {
      id: newId(),
      payroll_run_id: (form.get('payroll_run_id') as string) || null,
      payslip_ids: payslipIds,
      path,
      file_name: file.name,
      content_type: contentType,
      size: file.size,
      payment_date: (form.get('payment_date') as string) || null,
      reference: (form.get('reference') as string) || null,
      uploaded_at: new Date().toISOString(),
      uploaded_by: (form.get('uploaded_by') as string) || null,
    };

    const proofs = [record, ...(await readProofs(supabase))];
    await writeProofs(supabase, proofs);

    return NextResponse.json({ proof: record, proofs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing proof id' }, { status: 400 });

    const proofs = await readProofs(supabase);
    const target = proofs.find((proof) => proof.id === id);
    if (!target) return NextResponse.json({ error: 'Payment proof not found' }, { status: 404 });

    await supabase.storage.from(PAYMENT_PROOF_BUCKET).remove([target.path]);
    const next = proofs.filter((proof) => proof.id !== id);
    await writeProofs(supabase, next);
    return NextResponse.json({ proofs: next });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
