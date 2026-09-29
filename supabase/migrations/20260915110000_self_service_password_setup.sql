-- ============================================================
-- Self-service password setup
-- New employees receive a welcome email (letterhead template,
-- event welcome.new_employee) with a "Start Onboarding" button
-- that links to /setup-account?token=... They must set their
-- own password here BEFORE the onboarding wizard is accessible.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. One-time setup tokens (hashed). Only ever touched via the
--    SECURITY DEFINER RPCs below; direct API access is revoked.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_setup_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  used_at timestamptz,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one active setup token per employee (re-invite overwrites).
CREATE UNIQUE INDEX IF NOT EXISTS employee_setup_tokens_employee_id_key
  ON public.employee_setup_tokens(employee_id);

ALTER TABLE public.employee_setup_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated/service_role get nothing directly.
REVOKE ALL ON public.employee_setup_tokens FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 2. Admin: create a setup token for an employee, returns the RAW
--    token once (for the invitation link). Single active token.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_setup_token(p_employee_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
  v_expired_at timestamptz;
  v_count int;
BEGIN
  IF NOT (public.has_privilege('employees.manage') OR public.has_privilege('admin.privileges')) THEN
    RAISE EXCEPTION 'You do not have permission to issue setup links';
  END IF;

  SELECT count(*) INTO v_count FROM public.employees WHERE id = p_employee_id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');
  v_expired_at := now() + interval '72 hours';

  DELETE FROM public.employee_setup_tokens WHERE employee_id = p_employee_id;

  INSERT INTO public.employee_setup_tokens (employee_id, token_hash, expires_at, created_by)
  VALUES (p_employee_id,
          encode(extensions.digest(v_raw, 'sha256'), 'hex'),
          v_expired_at,
          auth.uid());

  RETURN v_raw;
END;
$$;

-- ------------------------------------------------------------------
-- 3. Validate a setup token (used by the setup page before showing
--    the form). Never reveals the raw token or the hash.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_setup_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_setup_tokens%ROWTYPE;
  v_emp public.employees%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TOKEN');
  END IF;

  SELECT * INTO v_row
    FROM public.employee_setup_tokens t
   WHERE t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   ORDER BY t.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TOKEN');
  END IF;

  IF v_row.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_USED');
  END IF;

  IF v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EXPIRED');
  END IF;

  SELECT * INTO v_emp FROM public.employees e WHERE e.id = v_row.employee_id;
  IF NOT FOUND OR v_emp.password_hash IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_USED');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'first_name', v_emp.first_name,
    'last_name', v_emp.last_name,
    'email', v_emp.email,
    'employment_status', v_emp.employment_status
  );
END;
$$;

-- ------------------------------------------------------------------
-- 4. Complete password setup: validate token, enforce password
--    policy, set the hash, invalidate the token. Callable by anon
--    (the setup link recipient).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_password_setup(p_token text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_setup_tokens%ROWTYPE;
  v_emp public.employees%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TOKEN');
  END IF;

  SELECT * INTO v_row
    FROM public.employee_setup_tokens t
   WHERE t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   ORDER BY t.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TOKEN');
  END IF;

  IF v_row.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_USED');
  END IF;

  IF v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EXPIRED');
  END IF;

  IF p_password IS NULL OR length(p_password) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WEAK_PASSWORD', 'message', 'Passwords must be at least 8 characters long');
  END IF;
  IF p_password !~ '[A-Z]' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WEAK_PASSWORD', 'message', 'Passwords must contain at least one uppercase letter');
  END IF;
  IF p_password !~ '\d' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WEAK_PASSWORD', 'message', 'Passwords must contain at least one number');
  END IF;

  SELECT * INTO v_emp FROM public.employees e WHERE e.id = v_row.employee_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TOKEN');
  END IF;
  IF v_emp.password_hash IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_USED');
  END IF;

  UPDATE public.employees
     SET password_hash        = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         password_updated_at  = now(),
         user_id              = id,
         updated_at           = now()
   WHERE id = v_emp.id;

  UPDATE public.employee_setup_tokens
     SET used_at = now()
   WHERE id = v_row.id;

  DELETE FROM public.employee_setup_tokens WHERE employee_id = v_emp.id AND id <> v_row.id;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'email', v_emp.email,
    'first_name', v_emp.first_name,
    'employment_status', v_emp.employment_status
  );
END;
$$;

-- ------------------------------------------------------------------
-- 5. Grants
--    create_setup_token:   authenticated (admin-checked inside)
--    validate_setup_token / complete_password_setup: anon
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_setup_token(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_setup_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_password_setup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_setup_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_setup_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_password_setup(text, text) TO anon, authenticated;