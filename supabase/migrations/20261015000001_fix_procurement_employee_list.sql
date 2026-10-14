-- Fix "column p.name does not exist" in get_procurement_employee_list.
-- The positions table column is `title`, not `name`. Redefines the helper so
-- procurement (and every other consumer of this RPC) can load the employee list.

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
BEGIN
  IF public.current_employee_id() IS NULL OR NOT public.has_procurement_access() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_emp IN
    SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email,
           d.name AS department_name, p.title AS position_name
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN positions p ON p.id = e.position_id
     WHERE COALESCE(e.employment_status, '') <> 'TERMINATED'
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