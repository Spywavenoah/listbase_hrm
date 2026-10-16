import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WaConfig {
  enabled: string;
  phone_number_id: string;
  verify_token: string;
  app_secret: string;
  access_token: string;
}

async function getConfig(): Promise<WaConfig> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('system_settings')
    .select('key, value')
    .eq('group_name', 'whatsapp');
  const map: Record<string, string> = {};
  for (const row of data || []) map[row.key] = row.value === null ? '' : String(row.value);
  return {
    enabled: map.enabled || 'false',
    phone_number_id: map.phone_number_id || '',
    verify_token: map.verify_token || '',
    app_secret: map.app_secret || '',
    access_token: map.access_token || '',
  };
}

function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!secret) return true;
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge') || '';
  const config = await getConfig();
  if (!config.verify_token) {
    return NextResponse.json({ error: 'WhatsApp webhook is not configured' }, { status: 403 });
  }
  if (mode === 'subscribe' && token && token === config.verify_token) {
    return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

interface WaText { body?: string }
interface WaLocation { latitude?: number; longitude?: number; address?: string }
interface WaMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: WaText;
  location?: WaLocation;
}

/**
 * Recognise an explicit clock command. Matches "clock in", "check out",
 * "punch in", "time out", or a bare "in" / "out" — but not incidental
 * words like "location", "join" or "about".
 */
function detectAction(body: string): 'CLOCK_IN' | 'CLOCK_OUT' | null {
  const txt = body.toLowerCase().trim();
  const m = txt.match(/\b(clock|check|punch|time)\s*[-_]?\s*(in|out)\b/);
  if (m) return m[2] === 'out' ? 'CLOCK_OUT' : 'CLOCK_IN';
  if (/^(in|out)$/.test(txt)) return txt === 'out' ? 'CLOCK_OUT' : 'CLOCK_IN';
  return null;
}

async function reply(config: WaConfig, to: string, body: string) {
  if (!config.access_token || !config.phone_number_id) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
  } catch (err) {
    console.error('WhatsApp reply failed:', err);
  }
}

async function sendLocationRequest(config: WaConfig, to: string, action: string) {
  if (!config.access_token || !config.phone_number_id) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'location_request_message',
          body: { text: `Where are you to ${action.toLowerCase().replace('_', ' ')}?` },
          action: { name: 'send_location' },
        },
      }),
    });
  } catch (err) {
    console.error('WhatsApp location request failed:', err);
  }
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const config = await getConfig();
  if (!verifySignature(raw, request.headers.get('x-hub-signature-256'), config.app_secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  if (config.enabled !== 'true') {
    return NextResponse.json({ received: true, processed: 0 });
  }

  let payload: { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] };
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const messages: WaMessage[] = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of change.value?.messages || []) messages.push(msg);
    }
  }

  const supabase = createServerClient();
  let processed = 0;

  for (const msg of messages) {
    if (!msg.from) continue;

    // location response
    if (msg.type === 'location' && msg.location) {
      const { latitude, longitude } = msg.location;
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        const { data, error } = await supabase.rpc('whatsapp_clock_with_location', {
          p_phone: msg.from, p_lat: latitude, p_lng: longitude, p_accuracy: null,
        });
        if (error) {
          console.error('whatsapp clock rpc failed:', error.message);
          await reply(config, msg.from, 'Sorry, we could not record your attendance right now. Please try again or contact HR.');
          processed++;
          continue;
        }
        if (data) {
          processed++;
          const res = data as { ok?: boolean; code?: string; message?: string; action?: string; time?: string; zone?: string };
          if (res.ok) {
            await reply(config, msg.from, `${res.action === 'CLOCK_OUT' ? 'Clocked out' : 'Clocked in'} at ${res.time}${res.zone ? ' — ' + res.zone : ''}.`);
          } else if (res.message) {
            await reply(config, msg.from, res.message);
          }
          continue;
        }
      }
    }

    // text trigger
    if (msg.type === 'text' && msg.text?.body) {
      const action = detectAction(msg.text.body);
      if (action) {
        const vDigits = msg.from.replace(/[^0-9]/g, '');
        // WhatsApp retries deliveries; ignore a message id we already handled.
        if (msg.id) {
          const { data: seen } = await supabase
            .from('whatsapp_pending_triggers')
            .select('id')
            .eq('wa_id', msg.id)
            .limit(1)
            .maybeSingle();
          if (seen) continue;
        }
        const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await supabase.from('whatsapp_pending_triggers').insert({
          phone_digits: vDigits.slice(-10),
          wa_id: msg.id,
          action,
          expires_at: expires,
        });
        await sendLocationRequest(config, msg.from, action);
        processed++;
        continue;
      }
    }
  }

  return NextResponse.json({ received: true, processed });
}
