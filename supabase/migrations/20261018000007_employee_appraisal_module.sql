/*
# Employee Appraisal Module

A full multi-party appraisal workflow:

  1. HR/Admin creates an appraisal for an employee and defines the areas
     (sections) the employee is being appraised on. Each area has an optional
     weight and is scored 1-5 with a justification by each party.
  2. The employee and their reporting manager (HOD) each score every area and
     provide a justification.
  3. HR/Admin can optionally allow the employee and reporting manager to add
     and edit the appraisal areas (`allow_edit_areas` flag).
  4. When both parties have submitted, HR pushes the appraisal to the MD for a
     final verdict (final rating + verdict + comments).
  5. All parties (employee, reporting manager, HR/Admin) are notified and given
     access to the appraisal form; progress notifications are sent to the
     reporting manager, HR and admins.

Tables:
  * appraisal_cycles  — an appraisal instance for one employee in one period.
  * appraisal_areas   — the scored areas/sections belonging to a cycle.

Privileges: performance.appraisal (HR/admin manage + push to MD),
            performance.appraisal_verdict (MD final verdict).
*/

-- ============================================================
-- 1. Privilege catalog entries
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('performance.appraisal',         'Performance', 'Manage employee appraisals', 'Create appraisals, define areas, push to MD and view all appraisals', 111),
  ('performance.appraisal_verdict', 'Performance', 'Give final appraisal verdict', 'Review completed appraisals and provide the MD final verdict', 112)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS appraisal_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reporting_manager_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  md_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  review_cycle text NOT NULL,
  period_start date,
  period_end date,
  status text NOT NULL DEFAULT 'DRAFT',
    -- DRAFT | SCORING | PENDING_MD | COMPLETED | CANCELLED
  allow_edit_areas boolean NOT NULL DEFAULT false,
  employee_submitted_at timestamptz,
  manager_submitted_at timestamptz,
  final_rating numeric,
  verdict text,
  md_comments text,
  md_decided_at timestamptz,
  md_decided_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appraisal_cycles_employee ON appraisal_cycles (employee_id);
CREATE INDEX IF NOT EXISTS idx_appraisal_cycles_manager ON appraisal_cycles (reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_appraisal_cycles_status ON appraisal_cycles (status);

CREATE TABLE IF NOT EXISTS appraisal_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id uuid NOT NULL REFERENCES appraisal_cycles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  weight numeric NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  employee_score numeric,
  employee_justification text,
  manager_score numeric,
  manager_justification text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appraisal_areas_appraisal ON appraisal_areas (appraisal_id, sort_order);

-- ============================================================
-- 3. updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_appraisal_cycles_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_appraisal_cycles ON appraisal_cycles;
CREATE TRIGGER trg_touch_appraisal_cycles
  BEFORE UPDATE ON appraisal_cycles
  FOR EACH ROW EXECUTE FUNCTION public.touch_appraisal_cycles_updated_at();

CREATE OR REPLACE FUNCTION public.touch_appraisal_areas_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_appraisal_areas ON appraisal_areas;
CREATE TRIGGER trg_touch_appraisal_areas
  BEFORE UPDATE ON appraisal_areas
  FOR EACH ROW EXECUTE FUNCTION public.touch_appraisal_areas_updated_at();

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE appraisal_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE appraisal_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_appraisal_cycles" ON appraisal_cycles;
DROP POLICY IF EXISTS "insert_appraisal_cycles" ON appraisal_cycles;
DROP POLICY IF EXISTS "update_appraisal_cycles" ON appraisal_cycles;
DROP POLICY IF EXISTS "delete_appraisal_cycles" ON appraisal_cycles;

-- Readable by: the employee, their reporting manager, the MD, and HR/admin
-- (performance.appraisal) or a verdict holder.
CREATE POLICY "select_appraisal_cycles" ON appraisal_cycles FOR SELECT TO authenticated
  USING (
    employee_id = public.current_employee_id()
    OR reporting_manager_id = public.current_employee_id()
    OR md_id = public.current_employee_id()
    OR public.has_privilege('performance.appraisal')
    OR public.has_privilege('performance.appraisal_verdict')
  );

CREATE POLICY "insert_appraisal_cycles" ON appraisal_cycles FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('performance.appraisal'));

-- The employee may update their own scores/areas (limited by RPC for safety),
-- the manager theirs, and HR/admin anything.
CREATE POLICY "update_appraisal_cycles" ON appraisal_cycles FOR UPDATE TO authenticated
  USING (
    employee_id = public.current_employee_id()
    OR reporting_manager_id = public.current_employee_id()
    OR public.has_privilege('performance.appraisal')
    OR (md_id = public.current_employee_id() AND public.has_privilege('performance.appraisal_verdict'))
  )
  WITH CHECK (
    employee_id = public.current_employee_id()
    OR reporting_manager_id = public.current_employee_id()
    OR public.has_privilege('performance.appraisal')
    OR (md_id = public.current_employee_id() AND public.has_privilege('performance.appraisal_verdict'))
  );

CREATE POLICY "delete_appraisal_cycles" ON appraisal_cycles FOR DELETE TO authenticated
  USING (public.has_privilege('performance.appraisal'));

DROP POLICY IF EXISTS "select_appraisal_areas" ON appraisal_areas;
DROP POLICY IF EXISTS "insert_appraisal_areas" ON appraisal_areas;
DROP POLICY IF EXISTS "update_appraisal_areas" ON appraisal_areas;
DROP POLICY IF EXISTS "delete_appraisal_areas" ON appraisal_areas;

CREATE POLICY "select_appraisal_areas" ON appraisal_areas FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM appraisal_cycles c
    WHERE c.id = appraisal_areas.appraisal_id
      AND (
        c.employee_id = public.current_employee_id()
        OR c.reporting_manager_id = public.current_employee_id()
        OR c.md_id = public.current_employee_id()
        OR public.has_privilege('performance.appraisal')
        OR public.has_privilege('performance.appraisal_verdict')
      )
  ));

-- Areas are written only through the RPCs below; allow INSERT/UPDATE/DELETE for
-- HR/admin and (when allow_edit_areas) the employee/manager via the RPC, which
-- runs SECURITY DEFINER. Direct table writes are gated to HR/admin only.
CREATE POLICY "insert_appraisal_areas" ON appraisal_areas FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM appraisal_cycles c
    WHERE c.id = appraisal_areas.appraisal_id
      AND (
        public.has_privilege('performance.appraisal')
        OR ((c.employee_id = public.current_employee_id() OR c.reporting_manager_id = public.current_employee_id())
            AND c.allow_edit_areas)
      )
  ));

CREATE POLICY "update_appraisal_areas" ON appraisal_areas FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM appraisal_cycles c
    WHERE c.id = appraisal_areas.appraisal_id
      AND (
        public.has_privilege('performance.appraisal')
        OR ((c.employee_id = public.current_employee_id() OR c.reporting_manager_id = public.current_employee_id())
            AND c.allow_edit_areas)
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM appraisal_cycles c
    WHERE c.id = appraisal_areas.appraisal_id
      AND (
        public.has_privilege('performance.appraisal')
        OR ((c.employee_id = public.current_employee_id() OR c.reporting_manager_id = public.current_employee_id())
            AND c.allow_edit_areas)
      )
  ));

CREATE POLICY "delete_appraisal_areas" ON appraisal_areas FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM appraisal_cycles c
    WHERE c.id = appraisal_areas.appraisal_id
      AND (
        public.has_privilege('performance.appraisal')
        OR ((c.employee_id = public.current_employee_id() OR c.reporting_manager_id = public.current_employee_id())
            AND c.allow_edit_areas
            AND c.status = 'SCORING')
      )
  ));

-- ============================================================
-- 5. Helper: compute weighted average of scores present
-- ============================================================
CREATE OR REPLACE FUNCTION public.appraisal_weighted_avg(p_appraisal_id uuid, p_party text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ROUND(
    SUM(
      CASE WHEN p_party = 'manager' THEN COALESCE(a.manager_score, 0)
           ELSE COALESCE(a.employee_score, 0) END * COALESCE(a.weight, 1)
    )
    / NULLIF(SUM(COALESCE(a.weight, 1)), 0),
    2)
  FROM appraisal_areas a
  WHERE a.appraisal_id = p_appraisal_id;
$$;

-- ============================================================
-- 6. RPCs
-- ============================================================

-- 6a. Create an appraisal (HR/admin). Optionally set reporting manager (defaults
--     to the employee's reporting_manager_id) and MD.
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

-- 6b. HR/admin: add a scored area to an appraisal.
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

  INSERT INTO appraisal_areas (appraisal_id, name, description, weight, sort_order)
  VALUES (p_appraisal_id, p_name, p_description, COALESCE(p_weight, 1), v_order)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_appraisal_area(uuid, text, text, numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.add_appraisal_area(uuid, text, text, numeric) FROM PUBLIC;

-- 6c. HR/admin: update an area's definition (name/description/weight).
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
BEGIN
  SELECT c.* INTO v_cycle FROM appraisal_cycles c JOIN appraisal_areas a ON a.appraisal_id = c.id WHERE a.id = p_area_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Area not found'; END IF;

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

-- 6d. HR/admin: remove an area.
CREATE OR REPLACE FUNCTION public.delete_appraisal_area(p_area_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle appraisal_cycles;
BEGIN
  SELECT c.* INTO v_cycle FROM appraisal_cycles c JOIN appraisal_areas a ON a.appraisal_id = c.id WHERE a.id = p_area_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Area not found'; END IF;

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

-- 6e. HR/admin: toggle whether employee/manager may add & edit areas.
CREATE OR REPLACE FUNCTION public.set_appraisal_edit_areas(p_appraisal_id uuid, p_allow boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_privilege('performance.appraisal') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE appraisal_cycles SET allow_edit_areas = COALESCE(p_allow, false) WHERE id = p_appraisal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_appraisal_edit_areas(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_appraisal_edit_areas(uuid, boolean) FROM PUBLIC;

-- 6f. Employee or manager: submit their scores + justifications for all areas.
--     p_party is 'employee' or 'manager'.
CREATE OR REPLACE FUNCTION public.submit_appraisal_scores(
  p_appraisal_id uuid,
  p_party text,
  p_scores jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle appraisal_cycles;
  v_caller uuid := public.current_employee_id();
  v_item jsonb;
  v_area_id uuid;
  v_score numeric;
  v_just text;
  v_emp_name text;
  v_manager_name text;
  v_hr record;
BEGIN
  SELECT * INTO v_cycle FROM appraisal_cycles WHERE id = p_appraisal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appraisal not found'; END IF;

  IF p_party NOT IN ('employee', 'manager') THEN
    RAISE EXCEPTION 'Invalid party';
  END IF;

  IF p_party = 'employee' AND v_caller <> v_cycle.employee_id THEN
    RAISE EXCEPTION 'Only the employee can submit their scores';
  END IF;
  IF p_party = 'manager' AND (v_cycle.reporting_manager_id IS NULL OR v_caller <> v_cycle.reporting_manager_id) THEN
    RAISE EXCEPTION 'Only the reporting manager can submit their scores';
  END IF;

  IF v_cycle.status <> 'SCORING' THEN
    RAISE EXCEPTION 'This appraisal is not open for scoring';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_scores, '[]'::jsonb))
  LOOP
    v_area_id := (v_item->>'area_id')::uuid;
    v_score := NULLIF(v_item->>'score', '')::numeric;
    v_just := v_item->>'justification';

    IF p_party = 'employee' THEN
      UPDATE appraisal_areas
         SET employee_score = v_score, employee_justification = v_just
       WHERE id = v_area_id AND appraisal_id = p_appraisal_id;
    ELSE
      UPDATE appraisal_areas
         SET manager_score = v_score, manager_justification = v_just
       WHERE id = v_area_id AND appraisal_id = p_appraisal_id;
    END IF;
  END LOOP;

  IF p_party = 'employee' THEN
    UPDATE appraisal_cycles SET employee_submitted_at = now() WHERE id = p_appraisal_id;
  ELSE
    UPDATE appraisal_cycles SET manager_submitted_at = now() WHERE id = p_appraisal_id;
  END IF;

  SELECT trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) INTO v_emp_name
    FROM employees WHERE id = v_cycle.employee_id;

  -- Progress notifications (point 7): notify manager, HR/admin.
  IF p_party = 'employee' THEN
    IF v_cycle.reporting_manager_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_cycle.reporting_manager_id,
        'Employee submitted appraisal scores',
        v_emp_name || ' has submitted their scores for "' || v_cycle.review_cycle || '". Please add yours.',
        'INFO',
        '/performance/appraisals/' || p_appraisal_id,
        jsonb_build_object('kind', 'appraisal_progress', 'appraisal_id', p_appraisal_id)
      );
    END IF;
  ELSE
    -- Manager done — notify the employee too.
    PERFORM public.create_notification(
      v_cycle.employee_id,
      'Manager submitted appraisal scores',
      'Your reporting manager has submitted their scores for "' || v_cycle.review_cycle || '".',
      'INFO',
      '/performance/appraisals/' || p_appraisal_id,
      jsonb_build_object('kind', 'appraisal_progress', 'appraisal_id', p_appraisal_id)
    );
  END IF;

  -- Notify HR/admin holders about progress.
  FOR v_hr IN
    SELECT ep.employee_id FROM employee_privileges ep
    WHERE ep.privilege_key = 'performance.appraisal'
      AND ep.employee_id <> v_caller
  LOOP
    PERFORM public.create_notification(
      v_hr.employee_id,
      'Appraisal progress update',
      v_emp_name || '''s "' || v_cycle.review_cycle || '" appraisal: ' || p_party || ' scores submitted.',
      'INFO',
      '/performance/appraisals/' || p_appraisal_id,
      jsonb_build_object('kind', 'appraisal_progress', 'appraisal_id', p_appraisal_id)
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_appraisal_scores(uuid, text, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_appraisal_scores(uuid, text, jsonb) FROM PUBLIC;

-- 6g. HR/admin: push a completed (both parties submitted) appraisal to MD.
CREATE OR REPLACE FUNCTION public.push_appraisal_to_md(p_appraisal_id uuid, p_md_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle appraisal_cycles;
  v_md uuid;
  v_emp_name text;
  v_manager_name text;
  v_emp_avg numeric;
  v_mgr_avg numeric;
BEGIN
  IF NOT public.has_privilege('performance.appraisal') THEN
    RAISE EXCEPTION 'Not authorized to push appraisals to MD';
  END IF;

  SELECT * INTO v_cycle FROM appraisal_cycles WHERE id = p_appraisal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appraisal not found'; END IF;

  IF v_cycle.employee_submitted_at IS NULL OR v_cycle.manager_submitted_at IS NULL THEN
    RAISE EXCEPTION 'Both the employee and reporting manager must submit their scores first';
  END IF;

  v_md := COALESCE(p_md_id, v_cycle.md_id);
  IF v_md IS NULL THEN
    RAISE EXCEPTION 'A Managing Director must be selected';
  END IF;
  IF v_md = v_cycle.employee_id THEN
    RAISE EXCEPTION 'The MD cannot be the employee being appraised';
  END IF;

  v_emp_avg := public.appraisal_weighted_avg(p_appraisal_id, 'employee');
  v_mgr_avg := public.appraisal_weighted_avg(p_appraisal_id, 'manager');

  SELECT trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) INTO v_emp_name
    FROM employees WHERE id = v_cycle.employee_id;
  SELECT trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) INTO v_manager_name
    FROM employees WHERE id = v_cycle.reporting_manager_id;

  UPDATE appraisal_cycles
     SET status = 'PENDING_MD',
         md_id = v_md
   WHERE id = p_appraisal_id;

  PERFORM public.create_notification(
    v_md,
    'Appraisal ready for final verdict',
    v_emp_name || '''s "' || v_cycle.review_cycle || '" appraisal is ready for your final verdict.'
      || ' Employee avg: ' || COALESCE(v_emp_avg::text, '-')
      || ', Manager avg: ' || COALESCE(v_mgr_avg::text, '-') || '.',
    'INFO',
    '/performance/appraisals/' || p_appraisal_id,
    jsonb_build_object('kind', 'appraisal_pending_md', 'appraisal_id', p_appraisal_id)
  );

  -- Notify employee + manager that it is with the MD.
  PERFORM public.create_notification(
    v_cycle.employee_id,
    'Appraisal sent to MD',
    'Your "' || v_cycle.review_cycle || '" appraisal has been sent to the Managing Director for final verdict.',
    'INFO',
    '/performance/appraisals/' || p_appraisal_id,
    jsonb_build_object('kind', 'appraisal_progress', 'appraisal_id', p_appraisal_id)
  );
  IF v_cycle.reporting_manager_id IS NOT NULL THEN
    PERFORM public.create_notification(
      v_cycle.reporting_manager_id,
      'Appraisal sent to MD',
      v_emp_name || '''s "' || v_cycle.review_cycle || '" appraisal has been sent to the MD for final verdict.',
      'INFO',
      '/performance/appraisals/' || p_appraisal_id,
      jsonb_build_object('kind', 'appraisal_progress', 'appraisal_id', p_appraisal_id)
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.push_appraisal_to_md(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.push_appraisal_to_md(uuid, uuid) FROM PUBLIC;

-- 6h. MD: give the final verdict.
CREATE OR REPLACE FUNCTION public.give_appraisal_verdict(
  p_appraisal_id uuid,
  p_final_rating numeric,
  p_verdict text,
  p_comments text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle appraisal_cycles;
  v_emp_name text;
  v_hr record;
  v_caller uuid := public.current_employee_id();
BEGIN
  SELECT * INTO v_cycle FROM appraisal_cycles WHERE id = p_appraisal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appraisal not found'; END IF;

  IF v_cycle.status <> 'PENDING_MD' THEN
    RAISE EXCEPTION 'This appraisal is not awaiting a final verdict';
  END IF;

  IF v_caller <> v_cycle.md_id OR NOT public.has_privilege('performance.appraisal_verdict') THEN
    RAISE EXCEPTION 'Only the assigned MD with verdict privilege can give a verdict';
  END IF;

  UPDATE appraisal_cycles
     SET status = 'COMPLETED',
         final_rating = p_final_rating,
         verdict = p_verdict,
         md_comments = p_comments,
         md_decided_at = now(),
         md_decided_by = v_caller
   WHERE id = p_appraisal_id;

  SELECT trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) INTO v_emp_name
    FROM employees WHERE id = v_cycle.employee_id;

  PERFORM public.create_notification(
    v_cycle.employee_id,
    'Appraisal completed',
    'Your "' || v_cycle.review_cycle || '" appraisal is complete. Final rating: ' || COALESCE(p_final_rating::text, '-') || '.',
    'SUCCESS',
    '/performance/appraisals/' || p_appraisal_id,
    jsonb_build_object('kind', 'appraisal_completed', 'appraisal_id', p_appraisal_id)
  );

  IF v_cycle.reporting_manager_id IS NOT NULL THEN
    PERFORM public.create_notification(
      v_cycle.reporting_manager_id,
      'Appraisal completed',
      v_emp_name || '''s "' || v_cycle.review_cycle || '" appraisal has a final verdict.',
      'SUCCESS',
      '/performance/appraisals/' || p_appraisal_id,
      jsonb_build_object('kind', 'appraisal_completed', 'appraisal_id', p_appraisal_id)
    );
  END IF;

  FOR v_hr IN
    SELECT ep.employee_id FROM employee_privileges ep
    WHERE ep.privilege_key = 'performance.appraisal'
      AND ep.employee_id <> v_caller
  LOOP
    PERFORM public.create_notification(
      v_hr.employee_id,
      'Appraisal completed',
      v_emp_name || '''s "' || v_cycle.review_cycle || '" appraisal is complete.',
      'SUCCESS',
      '/performance/appraisals/' || p_appraisal_id,
      jsonb_build_object('kind', 'appraisal_completed', 'appraisal_id', p_appraisal_id)
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.give_appraisal_verdict(uuid, numeric, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.give_appraisal_verdict(uuid, numeric, text, text) FROM PUBLIC;

-- 6i. HR/admin: cancel an appraisal.
CREATE OR REPLACE FUNCTION public.cancel_appraisal(p_appraisal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_privilege('performance.appraisal') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE appraisal_cycles SET status = 'CANCELLED' WHERE id = p_appraisal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_appraisal(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_appraisal(uuid) FROM PUBLIC;
