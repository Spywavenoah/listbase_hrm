-- Workflow step context: support "Authorize" (step 1) vs "Approve" (final step).
--
-- Adds `is_final` / `total_steps` to `pending_approvals()` so the UI can label
-- the step-1 action "Authorize" and only the final step "Approve". Also adds
-- `get_workflow_step_context(module_key, record_id)` for the module pages that
-- act on a workflow directly (change requests, expense claims).

-- ============================================================
-- 1. pending_approvals() with step context
-- ============================================================
CREATE OR REPLACE FUNCTION public.pending_approvals()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := public.current_employee_id();
  v_caller_role text;
  v_rows jsonb := '[]'::jsonb;
  v_instance RECORD;
  v_requester_name text;
  v_step_title text;
  v_step_ord integer;
  v_total integer;
  v_def_name text;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT role INTO v_caller_role FROM employees WHERE id = v_caller_id;
  v_caller_role := COALESCE(v_caller_role, '');

  FOR v_instance IN
    SELECT wi.id, wi.module_key, wi.record_id, wi.status, wi.initiated_by, wi.initiated_at,
           wi.workflow_definition_id, wi.current_step_id
      FROM workflow_instances wi
     WHERE wi.status = 'PENDING'
       AND wi.initiated_by IS DISTINCT FROM v_caller_id
       AND (
            public.has_privilege('admin.settings')
         OR EXISTS (
              SELECT 1 FROM workflow_steps ws
               WHERE ws.id = wi.current_step_id
                 AND (
                   (
                     (wi.authorizer_user_id IS NOT NULL OR wi.approver_user_id IS NOT NULL)
                     AND CASE
                           WHEN EXISTS (SELECT 1 FROM workflow_steps ws2
                                         WHERE ws2.workflow_definition_id = wi.workflow_definition_id
                                           AND ws2.sort_order > ws.sort_order)
                             THEN wi.authorizer_user_id = v_caller_id
                           ELSE COALESCE(wi.approver_user_id, wi.authorizer_user_id) = v_caller_id
                         END
                   )
                   OR (
                     wi.authorizer_user_id IS NULL AND wi.approver_user_id IS NULL
                     AND (ws.approver_user_id = v_caller_id OR ws.approver_role = v_caller_role)
                   )
                 )
            )
       )
     ORDER BY wi.initiated_at ASC
  LOOP
    SELECT COALESCE(e.first_name || ' ' || e.last_name, '')
      INTO v_requester_name
      FROM employees e WHERE e.id = v_instance.initiated_by;

    SELECT ws.sort_order INTO v_step_ord
      FROM workflow_steps ws WHERE ws.id = v_instance.current_step_id;

    SELECT count(*) INTO v_total
      FROM workflow_steps ws
     WHERE ws.workflow_definition_id = v_instance.workflow_definition_id;

    SELECT name INTO v_def_name FROM workflow_definitions WHERE id = v_instance.workflow_definition_id;
    v_def_name := COALESCE(v_def_name, v_instance.module_key);

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'instance_id',    v_instance.id,
      'module_key',     v_instance.module_key,
      'record_id',      v_instance.record_id,
      'status',         v_instance.status,
      'initiated_by',   v_instance.initiated_by,
      'requester_name', v_requester_name,
      'initiated_at',   to_char(v_instance.initiated_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'workflow_name',  v_def_name,
      'step_title',     'Step ' || COALESCE(v_step_ord::text, ''),
      'step_order',     v_step_ord,
      'total_steps',    COALESCE(v_total, 1),
      'is_final',       v_step_ord IS NULL OR v_step_ord >= COALESCE(v_total, 1)
    ));
  END LOOP;

  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pending_approvals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pending_approvals() TO authenticated;

-- ============================================================
-- 2. Context for a specific module record's pending workflow
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_workflow_step_context(
  p_module_key text,
  p_record_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'instance_id', wi.id,
    'step_order',  ws.sort_order,
    'total_steps', COALESCE(t.total, 1),
    'is_final',    ws.sort_order IS NULL OR ws.sort_order >= COALESCE(t.total, 1)
  )
  FROM workflow_instances wi
  LEFT JOIN workflow_steps ws ON ws.id = wi.current_step_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS total
      FROM workflow_steps ws2
     WHERE ws2.workflow_definition_id = wi.workflow_definition_id
  ) t ON true
  WHERE wi.module_key = p_module_key
    AND wi.record_id = p_record_id
    AND wi.status = 'PENDING'
  ORDER BY wi.created_at DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_workflow_step_context(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workflow_step_context(text, uuid) TO authenticated;
