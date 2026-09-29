/*
# Force Password Change on First Login + Invite Resend

1. Schema
- Adds `employees.must_change_password` (default false). When an admin sets a
  temporary password via `set_employee_password`, the employee is forced to pick
  their own password on next login.
- The column is write-protected at the API level (column UPDATE revoked); it can
  only be flipped by the RPCs below (which verify the current password) or by
  completing the setup token flow.

2. RPC changes
- `password_policy_compliant(p_password)` — single source of truth for the
  password policy (>=8 chars, uppercase, number), used by all password paths.
- `set_employee_password` — sets `must_change_password = true`.
- `complete_password_setup` — sets `must_change_password = false`.
- `change_my_password` — rejects reuse of the current password, sets
  `must_change_password = false` after success.
- `authenticate_employee` — returns `must_change_password` so the login route
  can redirect those users to the change-password screen.

3. Self-service invite resend
- `request_password_setup_link(p_email, p_origin)` — anon-callable. Only works
  for employees who have NOT yet activated a password (no password_hash). Issues
  a fresh setup token and enqueues the `password.setup` email. Employees who
  already have a password get `code: HAS_PASSWORD` and are pointed back to the
  normal login / admin reset flow. Used by "Resend invite on mobile" on the
  login page.

4. Security
- SECURITY DEFINER with `search_path` pinned; PUBLIC execute revoked.
- No direct column access to `must_change_password` for anon/authenticated.
*/

-- ------------------------------------------------------------------
-- 1. Column + column-level write protection
-- ------------------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

REVOKE UPDATE (must_change_password) ON TABLE employees FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 2. Shared password policy
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.password_policy_compliant(p_password text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_password IS NOT NULL
     AND length(p_password) >= 8
     AND p_password ~ '[A-Z]'
     AND p_password ~ '\d';
$$;

REVOKE ALL ON FUNCTION public.password_policy_compliant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_policy_compliant(text) TO anon, authenticated;

-- ------------------------------------------------------------------
-- 3. Admin set/reset password -> force change on next login
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_employee_password(p_employee_id uuid, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_privilege('employees.manage') OR public.has_privilege('admin.privileges')) THEN
    RAISE EXCEPTION 'You do not have permission to set employee passwords';
  END IF;

  IF NOT public.password_policy_compliant(p_password) THEN
    RAISE EXCEPTION 'Passwords must be at least 8 characters long, with one uppercase letter and one number';
  END IF;

  UPDATE employees
     SET password_hash        = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         password_updated_at  = now(),
         must_change_password = true,
         updated_at           = now()
   WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- 4. Complete setup-token flow (fresh password) -> no forced change
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

  IF NOT public.password_policy_compliant(p_password) THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'WEAK_PASSWORD',
      'message', 'Passwords must be at least 8 characters long, with one uppercase letter and one number');
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
         must_change_password = false,
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
-- 5. Self-service change password (verifies current password)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_my_password(p_current_password text, p_new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
BEGIN
  SELECT * INTO v_emp
    FROM employees e
   WHERE e.user_id = auth.uid()
      OR (auth.jwt() ->> 'email' IS NOT NULL AND e.email = auth.jwt() ->> 'email')
   ORDER BY CASE WHEN e.user_id = auth.uid() THEN 0 ELSE 1 END
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid session is required to change your password';
  END IF;

  IF v_emp.password_hash IS NULL OR NOT (v_emp.password_hash = extensions.crypt(p_current_password, v_emp.password_hash)) THEN
    RAISE EXCEPTION 'Current password is incorrect';
  END IF;

  IF NOT public.password_policy_compliant(p_new_password) THEN
    RAISE EXCEPTION 'Passwords must be at least 8 characters long, with one uppercase letter and one number';
  END IF;

  IF p_new_password = p_current_password THEN
    RAISE EXCEPTION 'New password must be different from the current password';
  END IF;

  UPDATE employees
     SET password_hash        = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         password_updated_at  = now(),
         must_change_password = false,
         updated_at           = now()
   WHERE id = v_emp.id;
END;
$$;

-- ------------------------------------------------------------------
-- 6. Login returns the flag (so the client can enforce the change screen)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authenticate_employee(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
BEGIN
  IF p_email IS NULL OR p_password IS NULL OR p_password = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;

  SELECT * INTO v_emp
    FROM employees e
   WHERE lower(e.email) = lower(p_email)
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;

  IF v_emp.is_login_blocked THEN
    RETURN jsonb_build_object('ok', false, 'code', 'LOCKED');
  END IF;

  IF v_emp.password_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_PASSWORD',
                              'employee_id', v_emp.id, 'email', v_emp.email);
  END IF;

  IF NOT (v_emp.password_hash = extensions.crypt(p_password, v_emp.password_hash)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;

  IF v_emp.user_id IS DISTINCT FROM v_emp.id THEN
    UPDATE employees SET user_id = id WHERE id = v_emp.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'email', v_emp.email,
    'role', v_emp.role,
    'first_name', v_emp.first_name,
    'last_name', v_emp.last_name,
    'employment_status', v_emp.employment_status,
    'must_change_password', v_emp.must_change_password
  );
END;
$$;

-- ------------------------------------------------------------------
-- 7. Self-service invite resend (mobile): only for not-yet-activated
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_password_setup_link(p_email text, p_origin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
  v_raw text;
  v_link text;
BEGIN
  IF p_email IS NULL OR p_origin IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID');
  END IF;

  SELECT * INTO v_emp
    FROM employees e
   WHERE lower(e.email) = lower(p_email)
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  IF v_emp.password_hash IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HAS_PASSWORD');
  END IF;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');

  DELETE FROM public.employee_setup_tokens WHERE employee_id = v_emp.id;

  INSERT INTO public.employee_setup_tokens (employee_id, token_hash, expires_at, created_by)
  VALUES (v_emp.id,
          encode(extensions.digest(v_raw, 'sha256'), 'hex'),
          now() + interval '72 hours',
          NULL);

  v_link := rtrim(p_origin, '/') || '/setup-account?token=' || v_raw;

  INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
  VALUES (
    'password.setup',
    v_emp.email,
    trim(COALESCE(v_emp.first_name, '') || ' ' || COALESCE(v_emp.last_name, '')),
    'Set up your HR Flow account',
    '<p>Hi ' || COALESCE(v_emp.first_name, 'there') || ',</p>' ||
    '<p>Click the link below to set your password and start onboarding:</p>' ||
    '<p><a href="' || v_link || '">Set Up Your Account</a></p>' ||
    '<p>This link expires in 72 hours.</p>',
    'PENDING',
    jsonb_build_object(
      'first_name', v_emp.first_name,
      'employee_email', v_emp.email,
      'employee_name', trim(COALESCE(v_emp.first_name, '') || ' ' || COALESCE(v_emp.last_name, '')),
      'setup_link', v_link
    )
  );

  RETURN jsonb_build_object('ok', true, 'code', 'SENT');
END;
$$;

-- ------------------------------------------------------------------
-- 8. Execution grants
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_employee_password(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_password_setup(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_my_password(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.authenticate_employee(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_password_setup_link(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_employee_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_password_setup(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_my_password(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_employee(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_password_setup_link(text, text) TO anon, authenticated;