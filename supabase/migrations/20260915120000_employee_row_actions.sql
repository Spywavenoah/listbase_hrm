-- Employee self-service default privilege + row-action support (disable/enable).

-- Every employee always has self-service access to their own profile,
-- onboarding and self-service modules. Persist it as a marker privilege so it
-- shows up consistently in the access UI as the default grant.
INSERT INTO privilege_definitions (key, category, label, description, sort_order)
VALUES ('self-service', 'Employee', 'Employee Self-Service', 'Default access to own profile, self-service and onboarding', 0)
ON CONFLICT (key) DO NOTHING;

-- Always re-grant self-service when access is saved, so it can never be revoked.
CREATE OR REPLACE FUNCTION public.set_employee_access(p_employee_id uuid, p_role text DEFAULT 'EMPLOYEE'::text, p_privileges text[] DEFAULT '{}'::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := public.current_employee_id();
  v_caller_role text;
  v_target_role text;
  v_valid_roles text[] := ARRAY['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'];
  v_super_admin_count integer;
BEGIN
  IF NOT public.has_privilege('admin.privileges') THEN
    RAISE EXCEPTION 'You do not have permission to manage access';
  END IF;

  IF p_role IS NULL OR NOT (p_role = ANY(v_valid_roles)) THEN
    RAISE EXCEPTION 'Invalid role provided';
  END IF;

  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;
  SELECT role INTO v_target_role FROM employees WHERE id = p_employee_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Only a SUPER_ADMIN can change a SUPER_ADMIN account
  IF v_target_role = 'SUPER_ADMIN' AND COALESCE(v_caller_role, '') <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Only a SUPER_ADMIN can modify another SUPER_ADMIN';
  END IF;

  -- Only a SUPER_ADMIN can create SUPER_ADMINs
  IF p_role = 'SUPER_ADMIN' AND COALESCE(v_caller_role, '') <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Only a SUPER_ADMIN can grant the SUPER_ADMIN role';
  END IF;

  -- Never demote / revoke access from the last remaining SUPER_ADMIN
  IF v_target_role = 'SUPER_ADMIN' AND p_role <> 'SUPER_ADMIN' THEN
    SELECT count(*) INTO v_super_admin_count FROM employees WHERE role = 'SUPER_ADMIN';
    IF v_super_admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last SUPER_ADMIN';
    END IF;
  END IF;

  UPDATE employees SET role = p_role, updated_at = now() WHERE id = p_employee_id;

  DELETE FROM employee_privileges WHERE employee_id = p_employee_id;

  IF p_privileges IS NOT NULL AND cardinality(p_privileges) > 0 THEN
    -- self-service is always granted and can never be revoked
    INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
    SELECT p_employee_id, pk, v_caller_id
      FROM (SELECT DISTINCT pk
              FROM unnest(ARRAY['self-service']::text[] || p_privileges) AS t(pk)) s
     WHERE EXISTS (SELECT 1 FROM privilege_definitions pd WHERE pd.key = s.pk);
  ELSE
    INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
    VALUES (p_employee_id, 'self-service', v_caller_id);
  END IF;
END;
$function$;

-- Grant the default self-service privilege to all existing employees.
INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
SELECT e.id, 'self-service', e.id
  FROM employees e
  LEFT JOIN employee_privileges ep
         ON ep.employee_id = e.id AND ep.privilege_key = 'self-service'
 WHERE ep.employee_id IS NULL;

-- Disable / re-enable an employee (blocks login, keeps record intact).
CREATE OR REPLACE FUNCTION public.set_employee_disabled(p_employee_id uuid, p_disabled boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_privilege('employees.manage') THEN
    RAISE EXCEPTION 'You do not have permission to disable employees';
  END IF;

  UPDATE employees SET is_login_blocked = p_disabled, updated_at = now() WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_employee_disabled(uuid, boolean) TO authenticated;