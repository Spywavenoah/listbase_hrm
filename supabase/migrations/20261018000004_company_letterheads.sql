-- ============================================================
-- Migration 04 — Company letterhead designer.
--
-- A letterhead is a reusable, branded HTML header/footer that can be
-- prepended to ANY document (report, cycle, advice, certificate) when it is
-- printed or downloaded as a PDF. Modeled after `mail_templates`, but:
--   * many named letterheads, exactly one flagged as the default;
--   * SELECT is open to all authenticated users (every module must be able to
--     read it to build a PDF), while only `admin.settings` may create/edit.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_letterheads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  body_html   text NOT NULL,
  variables   jsonb DEFAULT '[]'::jsonb,
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- At most one default letterhead can exist at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_letterheads_default
  ON public.company_letterheads (is_default)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_company_letterheads_active
  ON public.company_letterheads (is_active, name);

ALTER TABLE public.company_letterheads ENABLE ROW LEVEL SECURITY;

-- Read: open (used client-side by any module that renders a PDF).
DROP POLICY IF EXISTS "lh_select" ON public.company_letterheads;
CREATE POLICY "lh_select" ON public.company_letterheads
  FOR SELECT TO authenticated USING (true);

-- Write: restricted to admins who manage settings/branding.
DROP POLICY IF EXISTS "lh_insert" ON public.company_letterheads;
CREATE POLICY "lh_insert" ON public.company_letterheads
  FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('admin.settings'));

DROP POLICY IF EXISTS "lh_update" ON public.company_letterheads;
CREATE POLICY "lh_update" ON public.company_letterheads
  FOR UPDATE TO authenticated
  USING (public.has_privilege('admin.settings'))
  WITH CHECK (public.has_privilege('admin.settings'));

DROP POLICY IF EXISTS "lh_delete" ON public.company_letterheads;
CREATE POLICY "lh_delete" ON public.company_letterheads
  FOR DELETE TO authenticated
  USING (public.has_privilege('admin.settings'));

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.touch_company_letterheads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_letterheads_updated ON public.company_letterheads;
CREATE TRIGGER trg_company_letterheads_updated
BEFORE UPDATE ON public.company_letterheads
FOR EACH ROW EXECUTE FUNCTION public.touch_company_letterheads_updated_at();

-- Seed a sensible default letterhead (idempotent: re-running refreshes it).
-- The content is the branded header block only — document bodies are supplied
-- by the consuming module. Merge tags are interpolated at render time.
INSERT INTO public.company_letterheads (name, body_html, variables, is_default, is_active)
VALUES (
  'Default Letterhead',
  $lh$<header style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;border-bottom:3px solid #2563eb;padding-bottom:14px;margin-bottom:22px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
    <tr>
      <td style="vertical-align:middle;">
        <img src="{{company_logo_url}}" alt="{{company_name}}" style="display:block;height:54px;max-height:54px;border:0;">
      </td>
      <td align="right" style="vertical-align:middle;text-align:right;color:#64748b;font-size:12px;line-height:1.7;">
        <div style="font-size:19px;font-weight:700;color:#0f172a;">{{company_name}}</div>
        <div>{{company_address}}</div>
        <div>{{company_phone}} &nbsp;•&nbsp; {{company_email}} &nbsp;•&nbsp; {{company_website}}</div>
        <div>Tax ID: {{tax_id}} &nbsp;•&nbsp; Reg No: {{registration_number}}</div>
      </td>
    </tr>
  </table>
</header>$lh$,
  '["company_name","company_logo_url","company_address","company_phone","company_email","company_website","tax_id","registration_number","app_name"]'::jsonb,
  true,
  true
)
ON CONFLICT DO NOTHING;
