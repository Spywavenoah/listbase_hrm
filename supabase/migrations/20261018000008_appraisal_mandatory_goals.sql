/*
# Mandatory appraisal goals

Every appraisal includes 3 mandatory, locked goals that cannot be edited or
removed by anyone (including HR/admin):

  1. HSE — Employee adherence to HSE policy and reporting of UAUC.
  2. Values — Employee adherence and responsiveness to company Values
     (Safety, Respect, Teamwork, Integrity, Creativity, Leadership and
     Innovation).
  3. Equipment & Tools — Employee's attitude towards company equipment and tools.

Adds `appraisal_areas.is_mandatory`. Mandatory areas are seeded automatically
when an appraisal is created and are protected from edit/delete in the RPCs.
*/

-- ============================================================
-- 1. Column
-- ============================================================
ALTER TABLE appraisal_areas
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Backfill the 3 mandatory goals into existing appraisals
-- ============================================================
INSERT INTO appraisal_areas (appraisal_id, name, description, weight, sort_order, is_mandatory)
SELECT c.id, g.name, g.description, 1, g.sort_order, true
FROM appraisal_cycles c
CROSS JOIN (VALUES
  ('HSE', 'Employee adherence to HSE policy and reporting of UAUC', -3),
  ('Values', 'Employee adherence and responsiveness to company Values (Safety, Respect, Teamwork, Integrity, Creativity, Leadership and Innovation)', -2),
  ('Equipment & Tools', 'Employee''s attitude towards company equipment and tools', -1)
) AS g(name, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM appraisal_areas a
  WHERE a.appraisal_id = c.id AND a.name = g.name AND a.is_mandatory
);

-- ============================================================
-- 3. create_appraisal — seed mandatory goals
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_appraisal(
  p_employee_id uuid,
  p_review_cycle text,
  p_period_start date DEFAULT NULL,
  p_period_end date DEFAULT NULL,
  p_reporting_manager_id uuid DEFAULT NULL,
  p_md_id uuid DEFAULT NULL,
  p_allow_edit_areas boolean DEFAULT false,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_manager uuid;
  v_employee employees;
  v_emp_name text;
BEGIN
  IF NOT public.has_privilege('performance.appraisal') THEN
    RAISE EXCEPTION 'Not authorized to create appraisals';
  END IF;

  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'Employee is required';
  END IF;

  SELECT * INTO v_employee FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  v_manager := COALESCE(p_reporting_manager_id, v_employee.reporting_manager_id);
  IF v_manager = p_employee_id THEN
    v_manager := NULL;
  END IF;

  INSERT INTO appraisal_cycles (
    employee_id, reporting_manager_id, md_id, review_cycle,
    period_start, period_end, status, allow_edit_areas, notes, created_by
  ) VALUES (
    p_employee_id, v_manager, p_md_id, p_review_cycle,
    p_period_start, p_period_end, 'SCORING', COALESCE(p_allow_edit_areas, false),
    p_notes, public.current_employee_id()
  )
  RETURNING id INTO v_id;

  -- Seed the 3 mandatory, locked goals for every appraisal.
  INSERT INTO appraisal_areas (appraisal_id, name, description, weight, sort_order, is_mandatory) VALUES
    (v_id, 'HSE', 'Employee adherence to HSE policy and reporting of UAUC', 1, 1, true),
    (v_id, 'Values', 'Employee adherence and responsiveness to company Values (Safety, Respect, Teamwork, Integrity, Creativity, Leadership and Innovation)', 1, 2, true),
    (v_id, 'Equipment & Tools', 'Employee''s attitude towards company equipment and tools', 1, 3, true);

  v_emp_name := trim(coalesce(v_employee.first_name,'') || ' ' || coalesce(v_employee.last_name,''));

  -- Notify the employee (point 1 & 3)
  PERFORM public.create_notification(
    p_employee_id,
    'New appraisal created',
    'An appraisal for "' || p_review_cycle || '" has been created. You can add your scores and justifications.',
    'INFO',
    '/performance/appraisals/' || v_id,
    jsonb_build_object('kind', 'appraisal_created', 'appraisal_id', v_id)
  );

  -- Notify the reporting manager / HOD (point 3)
  IF v_manager IS NOT NULL THEN
    PERFORM public.create_notification(
      v_manager,
      'Appraisal to score',
      'You have been assigned as the reporting manager for ' || v_emp_name || '''s "' || p_review_cycle || '" appraisal.',
      'INFO',
      '/performance/appraisals/' || v_id,
      jsonb_build_object('kind', 'appraisal_assigned', 'appraisal_id', v_id)
    );
  END IF;

  -- Notify the MD if set
  IF p_md_id IS NOT NULL THEN
    PERFORM public.create_notification(
      p_md_id,
      'Appraisal assigned for final verdict',
      'You have been assigned to give the final verdict for ' || v_emp_name || '''s "' || p_review_cycle || '" appraisal.',
      'INFO',
      '/performance/appraisals/' || v_id,
      jsonb_build_object('kind', 'appraisal_md_assigned', 'appraisal_id', v_id)
    );
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_appraisal(uuid, text, date, date, uuid, uuid, boolean, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_appraisal(uuid, text, date, date, uuid, uuid, boolean, text) FROM PUBLIC;

-- ============================================================
-- 4. add_appraisal_area — cannot add another mandatory row (only HR/normal)
--    (mandatory rows are seeded internally, so users never add them)
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_appraisal_area(
  p_appraisal_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_weight numeric DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_order integer;
  v_cycle appraisal_cycles;
BEGIN
  SELECT * INTO v_cycle FROM appraisal_cycles WHERE id = p_appraisal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appraisal not found'; END IF;

  IF NOT public.has_privilege('performance.appraisal') THEN
    IF NOT (
      v_cycle.allow_edit_areas
      AND v_cycle.status = 'SCORING'
      AND (v_cycle.employee_id = public.current_employee_id() OR v_cycle.reporting_manager_id = public.current_employee_id())
    ) THEN
      RAISE EXCEPTION 'Not authorized to add appraisal areas';
    END IF;
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_order FROM appraisal_areas WHERE appraisal_id = p_appraisal_id;

  INSERT INTO appraisal_areas (appraisal_id, name, description, weight, sort_order, is_mandatory)
  VALUES (p_appraisal_id, p_name, p_description, COALESCE(p_weight, 1), v_order, false)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_appraisal_area(uuid, text, text, numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.add_appraisal_area(uuid, text, text, numeric) FROM PUBLIC;

-- ============================================================
-- 5. update_appraisal_area — mandatory rows cannot be edited by anyone
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_appraisal_area(
  p_area_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_weight numeric DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle appraisal_cycles;
  v_mandatory boolean;
BEGIN
  SELECT is_mandatory INTO v_mandatory FROM appraisal_areas WHERE id = p_area_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Area not found'; END IF;

  SELECT c.* INTO v_cycle FROM appraisal_cycles c JOIN appraisal_areas a ON a.appraisal_id = c.id WHERE a.id = p_area_id;

  IF v_mandatory THEN
    RAISE EXCEPTION 'Mandatory goals cannot be edited';
  END IF;

  IF NOT public.has_privilege('performance.appraisal') THEN
    IF NOT (
      v_cycle.allow_edit_areas
      AND v_cycle.status = 'SCORING'
      AND (v_cycle.employee_id = public.current_employee_id() OR v_cycle.reporting_manager_id = public.current_employee_id())
    ) THEN
      RAISE EXCEPTION 'Not authorized to edit appraisal areas';
    END IF;
  END IF;

  UPDATE appraisal_areas
     SET name = p_name, description = p_description, weight = COALESCE(p_weight, 1)
   WHERE id = p_area_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_appraisal_area(uuid, text, text, numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_appraisal_area(uuid, text, text, numeric) FROM PUBLIC;

-- ============================================================
-- 6. delete_appraisal_area — mandatory rows cannot be removed by anyone
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_appraisal_area(p_area_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle appraisal_cycles;
  v_mandatory boolean;
BEGIN
  SELECT is_mandatory INTO v_mandatory FROM appraisal_areas WHERE id = p_area_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Area not found'; END IF;

  SELECT c.* INTO v_cycle FROM appraisal_cycles c JOIN appraisal_areas a ON a.appraisal_id = c.id WHERE a.id = p_area_id;

  IF v_mandatory THEN
    RAISE EXCEPTION 'Mandatory goals cannot be removed';
  END IF;

  IF NOT public.has_privilege('performance.appraisal') THEN
    IF NOT (
      v_cycle.allow_edit_areas
      AND v_cycle.status = 'SCORING'
      AND (v_cycle.employee_id = public.current_employee_id() OR v_cycle.reporting_manager_id = public.current_employee_id())
    ) THEN
      RAISE EXCEPTION 'Not authorized to remove appraisal areas';
    END IF;
  END IF;

  DELETE FROM appraisal_areas WHERE id = p_area_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_appraisal_area(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_appraisal_area(uuid) FROM PUBLIC;

-- ============================================================
-- 7. appraisal_weighted_avg — only average areas actually scored by the party
--    (unscored areas must not drag the average down)
-- ============================================================
CREATE OR REPLACE FUNCTION public.appraisal_weighted_avg(p_appraisal_id uuid, p_party text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ROUND(
    SUM(
      CASE WHEN p_party = 'manager' THEN a.manager_score
           ELSE a.employee_score END * COALESCE(a.weight, 1)
    )
    / NULLIF(SUM(COALESCE(a.weight, 1)), 0),
    2)
  FROM appraisal_areas a
  WHERE a.appraisal_id = p_appraisal_id
    AND (CASE WHEN p_party = 'manager' THEN a.manager_score ELSE a.employee_score END) IS NOT NULL;
$$;
