-- ============================================================
-- Migration 22 — Employee directory RPC no longer leaks the full
-- staff list to plain employees.
--
-- `get_procurement_employee_list()` is SECURITY DEFINER, so it
-- bypassed the `select_employees` RLS policy. Its only gate was
-- `has_procurement_access()`, which includes the
-- `procurement.requisition_create` privilege that EVERY employee
-- receives in the default bundle. Result: any employee could read
-- every colleague's name, email and department.
--
-- New behaviour:
--   * callers with people/oversight privileges get the full list;
--   * everyone else gets only their own row (no exception), so the
--     self-service pickers keep working without exposing others.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper: does the caller legitimately see the whole staff?
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_all_employees()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_procurement_oversight()
      OR public.has_any_privilege(ARRAY[
        'employees.view_all',
        'employees.manage',
        'employees.invite',
        'admin.settings',
        'organization.manage',
        'leave.manage',
        'expense.manage',
        'expense.approve',
        'recruitment.manage',
        'payroll.manage',
        'attendance.manage',
        'inventory.view',
        'inventory.manage',
        'inventory.move',
        'inventory.issue',
        'assets.view',
        'assets.manage',
        'projects.view',
        'projects.manage'
      ]);
$$;

GRANT EXECUTE ON FUNCTION public.can_see_all_employees() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_see_all_employees() FROM PUBLIC;

-- ------------------------------------------------------------
-- 2. Scope the employee directory RPC.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_procurement_employee_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
  v_emp RECORD;
  v_me uuid := public.current_employee_id();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_emp IN
    SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email,
           d.name AS department_name, p.title AS position_name
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN positions p ON p.id = e.position_id
     WHERE COALESCE(e.employment_status, '') <> 'TERMINATED'
       AND (public.can_see_all_employees() OR e.id = v_me)
     ORDER BY e.first_name, e.last_name
  LOOP
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id',              v_emp.id,
      'employee_id',     v_emp.employee_id,
      'name',            trim(v_emp.first_name || ' ' || v_emp.last_name),
      'email',           v_emp.email,
      'department_name', v_emp.department_name,
      'position_name',   v_emp.position_name
    ));
  END LOOP;

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_procurement_employee_list() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_procurement_employee_list() FROM PUBLIC;
