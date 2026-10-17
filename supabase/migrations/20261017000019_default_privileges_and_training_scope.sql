-- ============================================================
-- Migration 19 — Default privilege bundle + employee self-service
-- training + scoped training assignment.
--
-- 1. New `training.enroll` privilege (self-enrol + take own training).
-- 2. A default-privilege bundle granted to EVERY employee, including a
--    trigger so new hires get it automatically (previously only
--    `self-service` existed and it was only added when an admin first
--    saved an employee's access — new hires got nothing).
-- 3. `self_enroll_training(course)` RPC for the self-service catalog.
-- 4. `assign_training_course` gains optional department / employee-list
--    targeting so admins can assign to a group or a whole department.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Seed the new privilege definition
-- ------------------------------------------------------------
INSERT INTO privilege_definitions (key, category, label, description, sort_order)
VALUES ('training.enroll', 'Training', 'Enrol in training',
        'Self-enrol into courses and complete your own training', 75)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Default privilege bundle
--    (kept in sync with DEFAULT_PRIVILEGE_KEYS in lib/privileges.ts)
-- ------------------------------------------------------------
-- Grant the full default bundle to a given employee (idempotent).
CREATE OR REPLACE FUNCTION public.grant_default_privileges(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_employee_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
  SELECT p_employee_id, pk, p_employee_id
    FROM unnest(ARRAY[
      'self-service',
      'training.enroll',
      'assets.request',
      'inventory.request',
      'procurement.requisition_create'
    ]::text[]) AS pk
   WHERE EXISTS (SELECT 1 FROM privilege_definitions pd WHERE pd.key = pk)
  ON CONFLICT (employee_id, privilege_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_default_privileges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_default_privileges(uuid) TO authenticated;

-- Auto-grant the bundle to every newly created employee.
CREATE OR REPLACE FUNCTION public.trg_grant_default_privileges()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.grant_default_privileges(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_default_privileges ON employees;
CREATE TRIGGER trg_grant_default_privileges
  AFTER INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION public.trg_grant_default_privileges();

-- Backfill the bundle for all existing employees.
DO $$
DECLARE
  v_emp uuid;
BEGIN
  FOR v_emp IN SELECT id FROM employees LOOP
    PERFORM public.grant_default_privileges(v_emp);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. Self-enrolment RPC (employee enrols THEMSELVES into a course)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.self_enroll_training(p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_course training_courses%ROWTYPE;
  v_emp employees%ROWTYPE;
  v_caller uuid := public.current_employee_id();
  v_due timestamptz;
  v_enrollment_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Not signed in.');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = v_caller;
  IF NOT FOUND OR v_emp.employment_status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_ACTIVE', 'message', 'Only active employees can enrol.');
  END IF;

  SELECT * INTO v_course FROM training_courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Course not found.');
  END IF;

  -- Already enrolled in the current cycle?
  IF EXISTS (
    SELECT 1 FROM training_enrollments te
     WHERE te.course_id = p_course_id AND te.employee_id = v_caller AND te.cycle = 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_ENROLLED', 'message', 'You are already enrolled in this course.');
  END IF;

  IF v_course.due_in_days IS NOT NULL AND v_course.due_in_days > 0 THEN
    v_due := now() + make_interval(days => v_course.due_in_days);
  END IF;

  INSERT INTO training_enrollments
    (course_id, employee_id, status, progress, cycle, due_date, enrolled_at, completion_state, validation_enabled)
  VALUES
    (p_course_id, v_caller, 'ENROLLED', 0, 1, v_due, now(), 'IN_PROGRESS', true)
  ON CONFLICT (course_id, employee_id, cycle) DO NOTHING
  RETURNING id INTO v_enrollment_id;

  RETURN jsonb_build_object('ok', true, 'enrollment_id', v_enrollment_id, 'due_date', v_due);
END;
$$;

REVOKE ALL ON FUNCTION public.self_enroll_training(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.self_enroll_training(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 4. Scoped assignment: department or explicit employee list
--    (no args => all active employees, preserving existing behaviour)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.assign_training_course(uuid);
CREATE OR REPLACE FUNCTION public.assign_training_course(
  p_course_id uuid,
  p_employee_ids uuid[] DEFAULT NULL,
  p_department_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_course training_courses%ROWTYPE;
  v_due timestamptz;
  v_enrolled integer := 0;
  v_alerted integer := 0;
  v_emp record;
BEGIN
  SELECT * INTO v_course FROM training_courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Course not found.');
  END IF;

  IF v_course.due_in_days IS NOT NULL AND v_course.due_in_days > 0 THEN
    v_due := now() + make_interval(days => v_course.due_in_days);
  END IF;

  -- Target set: explicit ids > department > all active employees.
  WITH target AS (
    SELECT e.id
      FROM employees e
     WHERE e.employment_status = 'ACTIVE'
       AND (
         CASE
           WHEN p_employee_ids IS NOT NULL AND cardinality(p_employee_ids) > 0
             THEN e.id = ANY(p_employee_ids)
           WHEN p_department_id IS NOT NULL
             THEN e.department_id = p_department_id
           ELSE true
         END
       )
  ),
  added AS (
    INSERT INTO training_enrollments
      (course_id, employee_id, status, progress, cycle, due_date, enrolled_at, completion_state, validation_enabled)
    SELECT p_course_id, t.id, 'ENROLLED', 0, 1, v_due, now(), 'IN_PROGRESS', true
      FROM target t
     WHERE NOT EXISTS (
       SELECT 1 FROM training_enrollments te
        WHERE te.course_id = p_course_id AND te.employee_id = t.id AND te.cycle = 1
     )
    ON CONFLICT (course_id, employee_id, cycle) DO NOTHING
    RETURNING employee_id
  )
  SELECT count(*) INTO v_enrolled FROM added;

  -- Alert the targeted employees (mandatory courses alert the full target
  -- set; optional ones alert only those just enrolled).
  FOR v_emp IN
    SELECT e.id, e.first_name, e.email
      FROM employees e
     WHERE e.employment_status = 'ACTIVE'
       AND (
         CASE
           WHEN p_employee_ids IS NOT NULL AND cardinality(p_employee_ids) > 0
             THEN e.id = ANY(p_employee_ids)
           WHEN p_department_id IS NOT NULL
             THEN e.department_id = p_department_id
           ELSE true
         END
       )
       AND (v_course.is_mandatory
            OR EXISTS (
              SELECT 1 FROM training_enrollments te
               WHERE te.course_id = p_course_id
                 AND te.employee_id = e.id
                 AND te.cycle = 1
            ))
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.employee_id = e.id
            AND n.metadata ->> 'course_id' = p_course_id::text
            AND n.metadata ->> 'kind' = 'training_assignment'
       )
  LOOP
    PERFORM public.create_notification(
      v_emp.id,
      CASE WHEN v_course.is_mandatory THEN 'Mandatory training assigned' ELSE 'New training assigned' END,
      v_course.title
        || CASE WHEN v_due IS NOT NULL
                THEN ' — complete by ' || to_char(v_due, 'DD Mon YYYY') || '.'
                ELSE '.' END,
      CASE WHEN v_course.is_mandatory THEN 'ERROR' ELSE 'INFO' END,
      '/training/my',
      jsonb_build_object(
        'kind', 'training_assignment',
        'course_id', p_course_id::text,
        'mandatory', v_course.is_mandatory,
        'due_date', v_due
      )
    );
    v_alerted := v_alerted + 1;

    IF v_emp.email IS NOT NULL AND btrim(v_emp.email) <> '' THEN
      INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
      VALUES (
        'training.assigned',
        v_emp.email,
        NULLIF(btrim(v_emp.first_name), ''),
        (CASE WHEN v_course.is_mandatory THEN 'Mandatory training: ' ELSE 'New training: ' END) || v_course.title,
        '<p>Hi ' || COALESCE(NULLIF(btrim(v_emp.first_name), ''), 'there') || ',</p>'
          || '<p><strong>' || v_course.title || '</strong>'
          || CASE WHEN v_course.is_mandatory THEN ' is a mandatory course.</strong></p>' ELSE '</strong> has been assigned to you.</p>' END
          || CASE WHEN v_course.instructor IS NOT NULL THEN '<p>Instructor: ' || v_course.instructor || '</p>' ELSE '' END
          || CASE WHEN v_due IS NOT NULL THEN '<p>Please complete it by <strong>' || to_char(v_due, 'DD Mon YYYY') || '</strong>.</p>' ELSE '' END
          || '<p>Open HR Flow → Training → My Training to start.</p>',
        'PENDING',
        jsonb_build_object('kind', 'training_assignment', 'course_id', p_course_id::text, 'due_date', v_due)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'enrolled', v_enrolled, 'alerted', v_alerted);
END;
$$;

REVOKE ALL ON FUNCTION public.assign_training_course(uuid, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_training_course(uuid, uuid[], uuid) TO authenticated;
