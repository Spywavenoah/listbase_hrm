-- ============================================================
-- Employee-based authentication
-- employees is the single authentication table: passwords are
-- stored (bcrypt) directly on employees.password_hash. No
-- dependency on Supabase Auth / auth.users.
-- Sessions are HS256 JWTs issued by the application (/api/auth/login)
-- signed with the project's SUPABASE_JWT_SECRET.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------
-- 1. Password columns on employees
-- ------------------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_updated_at timestamptz;

-- employees.user_id used to point at auth.users; it now stores the employee's
-- own id (JWT sub mapping). Drop the legacy FK so login can set user_id = id.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_user_id_fkey;

-- Keep the hash columns off the API surface. All password writes must
-- go through the SECURITY DEFINER functions below.
REVOKE SELECT (password_hash) ON TABLE employees FROM anon, authenticated;
REVOKE SELECT (password_updated_at) ON TABLE employees FROM anon, authenticated;
REVOKE UPDATE (password_hash) ON TABLE employees FROM anon, authenticated;
REVOKE UPDATE (password_updated_at) ON TABLE employees FROM anon, authenticated;
REVOKE INSERT (password_hash) ON TABLE employees FROM anon, authenticated;
REVOKE INSERT (password_updated_at) ON TABLE employees FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 2. Login RPC (callable by anon so the login page can authenticate)
--    Returns jsonb instead of raising so the UI can map errors.
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

  -- Keep the JWT sub -> employee mapping consistent with RLS helpers
  -- (current_employee_id matches employees.user_id = auth.uid()).
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
    'employment_status', v_emp.employment_status
  );
END;
$$;

-- ------------------------------------------------------------------
-- 3. Admin set / reset password (employees.manage or admin.privileges)
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

  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'Passwords must be at least 8 characters long';
  END IF;
  IF p_password !~ '[A-Z]' THEN
    RAISE EXCEPTION 'Passwords must contain at least one uppercase letter';
  END IF;
  IF p_password !~ '\d' THEN
    RAISE EXCEPTION 'Passwords must contain at least one number';
  END IF;

  UPDATE employees
     SET     password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         password_updated_at = now(),
         updated_at         = now()
   WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- 4. Self service: change my own password (verified against current)
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

  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'Passwords must be at least 8 characters long';
  END IF;
  IF p_new_password !~ '[A-Z]' THEN
    RAISE EXCEPTION 'Passwords must contain at least one uppercase letter';
  END IF;
  IF p_new_password !~ '\d' THEN
    RAISE EXCEPTION 'Passwords must contain at least one number';
  END IF;

  UPDATE employees
     SET     password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         password_updated_at = now(),
         updated_at          = now()
   WHERE id = v_emp.id;
END;
$$;

-- ------------------------------------------------------------------
-- 5. Execution grants
--    authenticate_employee: public (login needs anon)
--    set_employee_password / change_my_password: authenticated only
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_employee_password(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_my_password(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_employee_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_my_password(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_employee(text, text) TO anon, authenticated;

-- ------------------------------------------------------------------
-- 6. Self-update guard: employees may update their own row, but only
--    via RPCs may the password columns change (defender blocks direct
--    UPDATE of password_hash through the API via the column revokes).
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "update_employees" ON employees;
CREATE POLICY "update_employees" ON employees FOR UPDATE TO authenticated
  USING (id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (public.has_privilege('employees.manage')
              OR (id = public.current_employee_id()
                  AND role = (SELECT e.role FROM employees e WHERE e.id = public.current_employee_id())
                  AND password_hash IS NOT DISTINCT FROM
                      (SELECT e.password_hash FROM employees e WHERE e.id = public.current_employee_id())
                  AND password_updated_at IS NOT DISTINCT FROM
                      (SELECT e.password_updated_at FROM employees e WHERE e.id = public.current_employee_id())));