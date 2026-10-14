/*
# HTML mail templates (branded, logo-aware)

Adds four ready-to-use, email-safe HTML templates to `mail_templates`:

  1. welcome.new_employee     - new employee onboarding & welcome
  2. password.reset           - password reset link
  3. general.notification     - general event notifications
  4. performance.appraisal    - performance appraisal email

Every template shares the same branded shell: the company logo and name in the
header, a primary-colored accent bar, and a footer naming the app/company.

Merge tags (interpolated by /api/mail/send and the send-mail edge function):
  Always available from system_settings:
    {{company_name}}      system_settings.company.company_name
    {{company_logo_url}}  system_settings.company.company_logo_url
                          (falls back to branding.logo_url)
    {{app_name}}          system_settings.branding.app_name
  Per-event (supplied by the caller in notification_queue.metadata):
    welcome.new_employee     first_name, employee_name, employee_email, setup_link
    password.reset           first_name, employee_name, employee_email, reset_link
    general.notification     employee_name, title, message, action_label, action_url
    performance.appraisal    first_name, review_period, reviewer_name, due_date, action_url

Idempotent: re-running refreshes the four templates (ON CONFLICT DO UPDATE).
*/

DO $mig$
DECLARE
  v_head text := $head$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>{{company_name}}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#eef2f7;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
<tr><td align="center" style="padding:30px 32px 22px;background-color:#ffffff;">
<img src="{{company_logo_url}}" alt="{{company_name}}" height="46" style="display:block;height:46px;max-height:46px;border:0;outline:none;">
<div style="margin-top:12px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;">{{company_name}}</div>
</td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background-color:#2563eb;">&nbsp;</td></tr>
<tr><td style="padding:34px 36px 30px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">$head$;

  v_foot text := $foot$</td></tr>
<tr><td style="padding:22px 36px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;">
<p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">This is an automated message from {{app_name}} on behalf of {{company_name}}.</p>
<p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">Please do not reply directly to this email.</p>
</td></tr>
</table>
<p style="margin:14px 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:#94a3b8;">&copy; {{company_name}}. All rights reserved.</p>
</td></tr>
</table>
</body>
</html>$foot$;

  v_welcome text := $w$<h1 style="margin:0 0 10px;font-size:23px;line-height:1.3;font-weight:700;color:#0f172a;">Welcome aboard, {{first_name}}!</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#334155;">We are delighted to have you join {{company_name}}. Your employee account has been created for <strong>{{employee_email}}</strong>. Set a password to unlock your onboarding checklist and self-service portal.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="border-radius:9px;background-color:#2563eb;">
<a href="{{setup_link}}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9px;">Set Up My Account</a>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
<tr><td style="padding:18px 20px;">
<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0f172a;">Your onboarding checklist</p>
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td style="padding:3px 0;font-size:14px;line-height:1.5;color:#334155;">&#8226;&nbsp; Set your password with the button above</td></tr>
<tr><td style="padding:3px 0;font-size:14px;line-height:1.5;color:#334155;">&#8226;&nbsp; Complete your personal &amp; employment details</td></tr>
<tr><td style="padding:3px 0;font-size:14px;line-height:1.5;color:#334155;">&#8226;&nbsp; Upload your documents and certifications</td></tr>
<tr><td style="padding:3px 0;font-size:14px;line-height:1.5;color:#334155;">&#8226;&nbsp; Submit your guarantor and medical information</td></tr>
</table>
</td></tr></table>
<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#64748b;">If the button does not work, copy and paste this link into your browser:<br><a href="{{setup_link}}" style="color:#2563eb;word-break:break-all;">{{setup_link}}</a></p>$w$;

  v_reset text := $r$<h1 style="margin:0 0 10px;font-size:23px;line-height:1.3;font-weight:700;color:#0f172a;">Reset your password</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#334155;">Hi {{first_name}}, we received a request to reset the password for your {{app_name}} account (<strong>{{employee_email}}</strong>). Click the button below to choose a new password.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="border-radius:9px;background-color:#2563eb;">
<a href="{{reset_link}}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9px;">Reset Password</a>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background-color:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">
<tr><td style="padding:14px 18px;font-size:13px;line-height:1.6;color:#9a3412;">
<strong>Security notice:</strong> this link expires shortly and can be used only once. If you did not request a password reset, you can safely ignore this email and your current password will remain unchanged.
</td></tr></table>
<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#64748b;">If the button does not work, copy and paste this link into your browser:<br><a href="{{reset_link}}" style="color:#2563eb;word-break:break-all;">{{reset_link}}</a></p>$r$;

  v_general text := $g$<h1 style="margin:0 0 10px;font-size:23px;line-height:1.3;font-weight:700;color:#0f172a;">{{title}}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#334155;">Hello {{employee_name}},</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#334155;">{{message}}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;"><tr><td style="border-radius:9px;background-color:#2563eb;">
<a href="{{action_url}}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9px;">{{action_label}}</a>
</td></tr></table>$g$;

  v_performance text := $p$<h1 style="margin:0 0 10px;font-size:23px;line-height:1.3;font-weight:700;color:#0f172a;">Your performance appraisal is ready</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#334155;">Hi {{first_name}}, your performance appraisal for <strong>{{review_period}}</strong> has been published. Review your ratings, achievements and development goals, and add your self-assessment comments.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:10px;margin:0 0 22px;">
<tr><td style="padding:14px 18px;font-size:14px;line-height:1.6;color:#334155;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;">Review period:</span> <strong style="color:#0f172a;">{{review_period}}</strong></td></tr>
<tr><td style="padding:14px 18px;font-size:14px;line-height:1.6;color:#334155;border-bottom:1px solid #e2e8f0;"><span style="color:#64748b;">Reviewer:</span> <strong style="color:#0f172a;">{{reviewer_name}}</strong></td></tr>
<tr><td style="padding:14px 18px;font-size:14px;line-height:1.6;color:#334155;"><span style="color:#64748b;">Complete your response by:</span> <strong style="color:#0f172a;">{{due_date}}</strong></td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;"><tr><td style="border-radius:9px;background-color:#2563eb;">
<a href="{{action_url}}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9px;">View My Appraisal</a>
</td></tr></table>$p$;
BEGIN
  INSERT INTO public.mail_templates (event_key, subject, body_html, variables, is_active)
  VALUES
    (
      'welcome.new_employee',
      $s1$Welcome to {{company_name}}, {{first_name}}!$s1$,
      v_head || v_welcome || v_foot,
      $v1$["first_name","employee_name","employee_email","setup_link","company_name","company_logo_url","app_name"]$v1$::jsonb,
      true
    ),
    (
      'password.reset',
      $s2$Reset your {{app_name}} password$s2$,
      v_head || v_reset || v_foot,
      $v2$["first_name","employee_name","employee_email","reset_link","company_name","company_logo_url","app_name"]$v2$::jsonb,
      true
    ),
    (
      'general.notification',
      $s3${{title}}$s3$,
      v_head || v_general || v_foot,
      $v3$["employee_name","title","message","action_label","action_url","company_name","company_logo_url","app_name"]$v3$::jsonb,
      true
    ),
    (
      'performance.appraisal',
      $s4$Your {{review_period}} performance appraisal$s4$,
      v_head || v_performance || v_foot,
      $v4$["first_name","review_period","reviewer_name","due_date","action_url","company_name","company_logo_url","app_name"]$v4$::jsonb,
      true
    )
  ON CONFLICT (event_key) DO UPDATE
    SET subject = EXCLUDED.subject,
        body_html = EXCLUDED.body_html,
        variables = EXCLUDED.variables,
        is_active = true,
        updated_at = now();
END;
$mig$;
