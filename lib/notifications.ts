'use client';

import { supabase } from '@/lib/supabase/client';

export interface EnqueueEmailParams {
  eventKey: string;
  recipientEmail: string;
  recipientName?: string;
  subject?: string;
  bodyHtml?: string;
  metadata?: Record<string, string>;
}

export async function enqueueEmail(params: EnqueueEmailParams): Promise<void> {
  const { error } = await supabase.from('notification_queue').insert({
    event_key: params.eventKey,
    recipient_email: params.recipientEmail,
    recipient_name: params.recipientName || null,
    subject: params.subject || '',
    body_html: params.bodyHtml || '',
    status: 'PENDING',
    metadata: params.metadata || {},
  });
  if (error) {
    throw new Error(`Failed to queue email: ${error.message}`);
  }
}

export async function triggerMailProcessing(): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/mail/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch (err) {
    throw new Error(`Failed to reach mail sender: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Failed to process email queue: ${body?.error || res.statusText}`);
  }
}

export async function enqueueAndProcess(params: EnqueueEmailParams): Promise<void> {
  await enqueueEmail(params);
  await triggerMailProcessing();
}
