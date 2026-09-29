import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.15";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-webhook-secret",
};

interface SmtpSettings {
  host: string;
  port: string;
  username: string;
  password: string;
  encryption: string;
  from_name: string;
  from_email: string;
}

async function getSmtpSettings(supabase: ReturnType<typeof createClient>): Promise<SmtpSettings | null> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("key, value")
    .eq("group_name", "smtp");

  if (error || !data || data.length === 0) return null;

  const settings: Record<string, string> = {};
  for (const row of data) {
    settings[row.key] = String(row.value);
  }

  if (!settings.host || !settings.from_email) return null;

  return {
    host: settings.host,
    port: settings.port || "587",
    username: settings.username || "",
    password: settings.password || "",
    encryption: settings.encryption || "TLS",
    from_name: settings.from_name || "HR System",
    from_email: settings.from_email,
  };
}

async function getSetting(supabase: ReturnType<typeof createClient>, key: string, fallback: string): Promise<string> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("group_name", "notifications")
    .eq("key", key)
    .maybeSingle();

  if (error || !data || data.value === null) return fallback;
  return String(data.value);
}

async function getMailTemplate(
  supabase: ReturnType<typeof createClient>,
  eventKey: string
): Promise<{ subject: string; body_html: string } | null> {
  const { data, error } = await supabase
    .from("mail_templates")
    .select("subject, body_html, is_active")
    .eq("event_key", eventKey)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  return { subject: data.subject, body_html: data.body_html };
}

function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? "");
}

async function sendViaSmtp(
  smtp: SmtpSettings,
  to: string,
  subject: string,
  bodyHtml: string
): Promise<void> {
  const port = parseInt(smtp.port, 10);
  const secure = smtp.encryption === "SSL";
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure,
    requireTLS: smtp.encryption === "TLS",
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    debug: false,
    logger: false,
    tls: {
      rejectUnauthorized: false,
      minVersion: "TLSv1",
      ciphers: "SSLv3",
      minDHSize: 1024,
      honorCipherOrder: true,
      secureOptions: 0,
      secureProtocol: "",
      servername: smtp.host,
      sessionTimeout: 15000,
      ALPNProtocols: undefined,
      ecdhCurve: "auto",
      clientCertEngine: undefined,
      ca: undefined,
      cert: undefined,
      key: undefined,
      passphrase: undefined,
      pfx: undefined,
      checkServerIdentity: () => undefined,
      enableTrace: false,
      pskCallback: undefined,
      pskIdentityHint: undefined,
    },
  });

  await transporter.sendMail({
    from: `${smtp.from_name} <${smtp.from_email}>`,
    to,
    subject,
    html: bodyHtml,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const forceId = body?.notification_id as string | undefined;
    const drain = body?.drain === true;
    const maxAttempts = parseInt(await getSetting(supabase, "drain_max_attempts", "3"), 10) || 3;

    // Optional shared-secret check for the scheduled drain call
    const expectedSecret = await getSetting(supabase, "edge_function_secret", "");
    if (drain && expectedSecret) {
      const provided = req.headers.get("x-webhook-secret") || "";
      if (provided !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const smtp = await getSmtpSettings(supabase);
    if (!smtp) {
      return new Response(JSON.stringify({ sent: 0, error: "SMTP not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    const nowIso = new Date().toISOString();

    const processItem = async (notif: Record<string, unknown>) => {
      const nid = String(notif.id);
      const attempts = Number(notif.attempts) || 0;
      const meta = (notif.metadata || {}) as Record<string, string>;
      let subject = String(notif.subject || "");
      let bodyHtml = String(notif.body_html || "");

      if (notif.event_key) {
        const template = await getMailTemplate(supabase, String(notif.event_key));
        if (template) {
          subject = interpolate(template.subject, meta);
          bodyHtml = interpolate(template.body_html, meta);
        }
      }

      if (!subject || !bodyHtml) {
        await supabase
          .from("notification_queue")
          .update({
            status: "FAILED",
            error_message: "Missing subject or body",
            attempts: attempts + 1,
            updated_at: nowIso,
          })
          .eq("id", nid);
        failedCount++;
        return;
      }

      try {
        await sendViaSmtp(smtp, String(notif.recipient_email), subject, bodyHtml);
        await supabase
          .from("notification_queue")
          .update({ status: "SENT", sent_at: nowIso, attempts: attempts + 1, updated_at: nowIso })
          .eq("id", nid);
        sentCount++;
      } catch (err) {
        const errMsg = (err as Error).message;
        errors.push(`${notif.recipient_email}: ${errMsg}`);
        const exhausted = attempts + 1 >= maxAttempts;
        const backoffMinutes = Math.pow(2, attempts);
        await supabase
          .from("notification_queue")
          .update({
            status: exhausted ? "FAILED" : "PENDING",
            error_message: errMsg,
            attempts: attempts + 1,
            next_retry_at: exhausted
              ? null
              : new Date(Date.now() + backoffMinutes * 60000).toISOString(),
            updated_at: nowIso,
          })
          .eq("id", nid);
        failedCount++;
      }
    };

    const fetchDue = async () => {
      const { data, error } = await supabase
        .from("notification_queue")
        .select("*")
        .eq("status", "PENDING")
        .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
        .order("created_at", { ascending: true })
        .limit(25);
      return { data, error };
    };

    if (forceId) {
      const { data, error } = await supabase
        .from("notification_queue")
        .select("*")
        .eq("id", forceId)
        .limit(1);
      if (error) throw error;
      if (data && data.length > 0) await processItem(data[0] as Record<string, unknown>);
    } else {
      // Drain mode: keep pulling batches until the queue for this window is clear
      for (let pass = 0; pass < 10; pass++) {
        const { data, error } = await fetchDue();
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const notif of data) await processItem(notif as Record<string, unknown>);
      }
    }

    return new Response(JSON.stringify({ sent: sentCount, failed: failedCount, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});