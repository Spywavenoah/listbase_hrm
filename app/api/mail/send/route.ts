import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import nodemailer from 'nodemailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SmtpSettings {
  host: string;
  port: string;
  username: string;
  password: string;
  encryption: string;
  from_name: string;
  from_email: string;
}

async function getSmtpSettings(): Promise<SmtpSettings | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value')
    .eq('group_name', 'smtp');

  if (error || !data || data.length === 0) return null;

  const settings: Record<string, string> = {};
  for (const row of data) {
    settings[row.key] = String(row.value);
  }

  if (!settings.host || !settings.from_email) return null;

  return {
    host: settings.host,
    port: settings.port || '587',
    username: settings.username || '',
    password: settings.password || '',
    encryption: settings.encryption || 'TLS',
    from_name: settings.from_name || 'HR System',
    from_email: settings.from_email,
  };
}

async function getMailTemplate(
  eventKey: string
): Promise<{ subject: string; body_html: string } | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('mail_templates')
    .select('subject, body_html, is_active')
    .eq('event_key', eventKey)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  return { subject: data.subject, body_html: data.body_html };
}

function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? '');
}

async function sendViaSmtp(
  smtp: SmtpSettings,
  to: string,
  subject: string,
  bodyHtml: string
): Promise<void> {
  const port = parseInt(smtp.port, 10);
  const secure = smtp.encryption === 'SSL' || port === 465;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure,
    requireTLS: smtp.encryption === 'TLS' && port !== 465,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      rejectUnauthorized: false,
      servername: smtp.host,
    },
  });

  await transporter.sendMail({
    from: `${smtp.from_name} <${smtp.from_email}>`,
    to,
    subject,
    html: bodyHtml,
  });
}

async function getSetting(key: string, fallback: string): Promise<string> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('group_name', 'notifications')
    .eq('key', key)
    .maybeSingle();

  if (error || !data || data.value === null) return fallback;
  return String(data.value);
}

export async function POST(request: NextRequest) {
  let body: { notification_id?: string };
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  try {
    const supabase = createServerClient();
    const forceId = body?.notification_id;
    const maxAttempts = parseInt(await getSetting('drain_max_attempts', '3'), 10) || 3;

    const smtp = await getSmtpSettings();
    if (!smtp) {
      return NextResponse.json({ sent: 0, error: 'SMTP not configured' }, { status: 400 });
    }

    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    const processItem = async (notif: { id: string; attempts: number; metadata: unknown; event_key: string | null; subject: string; body_html: string; recipient_email: string }) => {
      const meta = (notif.metadata || {}) as Record<string, string>;
      const attempts = Number(notif.attempts) || 0;
      const nowIso = new Date().toISOString();
      let subject = String(notif.subject || '');
      let bodyHtml = String(notif.body_html || '');

      if (notif.event_key) {
        const template = await getMailTemplate(notif.event_key);
        if (template) {
          subject = interpolate(template.subject, meta);
          bodyHtml = interpolate(template.body_html, meta);
        }
      }

      if (!subject || !bodyHtml) {
        await supabase
          .from('notification_queue')
          .update({
            status: 'FAILED',
            error_message: 'Missing subject or body',
            attempts: attempts + 1,
            updated_at: nowIso,
          })
          .eq('id', notif.id);
        failedCount++;
        return;
      }

      try {
        await sendViaSmtp(smtp, notif.recipient_email, subject, bodyHtml);
        await supabase
          .from('notification_queue')
          .update({ status: 'SENT', sent_at: nowIso, attempts: attempts + 1, updated_at: nowIso })
          .eq('id', notif.id);
        sentCount++;
      } catch (err) {
        const errMsg = (err as Error).message;
        errors.push(`${notif.recipient_email}: ${errMsg}`);
        const exhausted = attempts + 1 >= maxAttempts;
        const backoffMinutes = Math.pow(2, attempts);
        await supabase
          .from('notification_queue')
          .update({
            status: exhausted ? 'FAILED' : 'PENDING',
            error_message: errMsg,
            attempts: attempts + 1,
            next_retry_at: exhausted
              ? null
              : new Date(Date.now() + backoffMinutes * 60000).toISOString(),
            updated_at: nowIso,
          })
          .eq('id', notif.id);
        failedCount++;
      }
    };

    const nowIso = new Date().toISOString();

    if (forceId) {
      const { data: row, error: fetchError } = await supabase
        .from('notification_queue')
        .select('*')
        .eq('id', forceId)
        .limit(1);
      if (fetchError) throw fetchError;
      if (row && row[0]) await processItem(row[0]);
    } else {
      for (let pass = 0; pass < 10; pass++) {
        const { data: notifications, error: fetchError } = await supabase
          .from('notification_queue')
          .select('*')
          .eq('status', 'PENDING')
          .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
          .order('created_at', { ascending: true })
          .limit(25);

        if (fetchError) throw fetchError;
        if (!notifications || notifications.length === 0) break;
        for (const notif of notifications) await processItem(notif);
      }
    }

    return NextResponse.json({ sent: sentCount, failed: failedCount, errors });
  } catch (err) {
    console.error('Mail processing error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}