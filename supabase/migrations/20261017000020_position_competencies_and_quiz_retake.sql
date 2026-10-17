/*
# Position competencies + failed-assessment retake handling

Two additive changes requested together:

1. Competencies are no longer a standalone Training screen. Instead a position
   defines the competencies it requires, entered from the Position form. Adds a
   `position_competencies` join table (reusing the `competencies` library) and a
   `set_position_competencies` RPC that upserts library entries and replaces the
   position's links in one call.

2. A failed end-of-video assessment must NOT create another enrollment entry.
   `submit_training_quiz` keeps the SAME enrollment, resets it to a retakeable
   state and alerts the employee (dashboard + email) that they can retake it.

3. Mandatory-training assignment already only targets ACTIVE employees
   (`assign_training_course`); the new-hire trigger is scoped here so that an
   employee becoming active only enrols/notifies that employee.
*/

-- ============================================================
-- 1. Position <-> competency links
-- ============================================================
CREATE TABLE IF NOT EXISTS public.position_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES public.competencies(id) ON DELETE CASCADE,
  required_level integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT position_competencies_unique UNIQUE (position_id, competency_id),
  CONSTRAINT position_competencies_level_check CHECK (required_level BETWEEN 1 AND 5)
);

ALTER TABLE public.position_competencies ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_position_competencies_position
  ON public.position_competencies (position_id);
CREATE INDEX IF NOT EXISTS idx_position_competencies_competency
  ON public.position_competencies (competency_id);

DROP POLICY IF EXISTS "select_position_competencies" ON public.position_competencies;
DROP POLICY IF EXISTS "insert_position_competencies" ON public.position_competencies;
DROP POLICY IF EXISTS "update_position_competencies" ON public.position_competencies;
DROP POLICY IF EXISTS "delete_position_competencies" ON public.position_competencies;
CREATE POLICY "select_position_competencies" ON public.position_competencies
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_position_competencies" ON public.position_competencies
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['organization.manage', 'training.manage']));
CREATE POLICY "update_position_competencies" ON public.position_competencies
  FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['organization.manage', 'training.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['organization.manage', 'training.manage']));
CREATE POLICY "delete_position_competencies" ON public.position_competencies
  FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['organization.manage', 'training.manage']));

-- ============================================================
-- 2. Replace a position's required competencies in one call.
--    p_items = [{ name, category?, requiredLevel }]
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_position_competencies(
  p_position_id uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_name text;
  v_category text;
  v_level integer;
  v_comp uuid;
  v_keep uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['organization.manage', 'training.manage']) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Not allowed to manage competencies.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM positions WHERE id = p_position_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Position not found.');
  END IF;
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_ITEMS', 'message', 'Items must be an array.');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_name := NULLIF(btrim(COALESCE(v_item ->> 'name', '')), '');
    CONTINUE WHEN v_name IS NULL;

    v_category := NULLIF(btrim(COALESCE(v_item ->> 'category', '')), '');
    v_level := GREATEST(1, LEAST(5, COALESCE((v_item ->> 'requiredLevel')::integer, 3)));

    SELECT id INTO v_comp FROM competencies WHERE lower(name) = lower(v_name) LIMIT 1;
    IF v_comp IS NULL THEN
      INSERT INTO competencies (name, category)
      VALUES (v_name, v_category)
      RETURNING id INTO v_comp;
    ELSIF v_category IS NOT NULL THEN
      UPDATE competencies
         SET category = COALESCE(category, v_category),
             updated_at = now()
       WHERE id = v_comp;
    END IF;

    INSERT INTO position_competencies (position_id, competency_id, required_level)
    VALUES (p_position_id, v_comp, v_level)
    ON CONFLICT (position_id, competency_id)
      DO UPDATE SET required_level = EXCLUDED.required_level;

    v_keep := array_append(v_keep, v_comp);
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM position_competencies
   WHERE position_id = p_position_id
     AND NOT (competency_id = ANY (v_keep));

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.set_position_competencies(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_position_competencies(uuid, jsonb) TO authenticated;

-- ============================================================
-- 3. New-hire mandatory enrolment: notify only the employee who
--    became active (rather than re-running the whole active set).
-- ============================================================
CREATE OR REPLACE FUNCTION public.enroll_mandatory_training_for_employee()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_course record;
BEGIN
  IF NEW.employment_status <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.employment_status = 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  FOR v_course IN SELECT id FROM training_courses WHERE is_mandatory LOOP
    PERFORM public.assign_training_course(v_course.id, ARRAY[NEW.id], NULL);
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enroll_mandatory_training_for_employee() IS
  'Enrols a newly ACTIVE employee into every mandatory training course and notifies only that employee.';

-- ============================================================
-- 4. Failed assessment: keep the same enrollment, reset it and alert.
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_training_quiz(
  p_enrollment_id uuid,
  p_answers jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_en training_enrollments%ROWTYPE;
  v_course training_courses%ROWTYPE;
  v_total integer := 0;
  v_correct integer := 0;
  v_score numeric := 0;
  v_pass_pct integer;
  v_passed boolean := false;
  v_attempt integer := 1;
  v_results jsonb := '[]'::jsonb;
  v_q record;
  v_sel integer;
  v_best numeric;
  v_prev_passed boolean;
  v_first_name text;
  v_email text;
BEGIN
  SELECT * INTO v_en FROM training_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_course FROM training_courses WHERE id = v_en.course_id;

  SELECT count(*) INTO v_total FROM training_quiz_questions WHERE course_id = v_en.course_id;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_QUIZ');
  END IF;

  v_pass_pct := GREATEST(0, LEAST(100, COALESCE(v_course.quiz_pass_pct, 70)));

  FOR v_q IN
    SELECT id, correct_index
    FROM training_quiz_questions
    WHERE course_id = v_en.course_id
    ORDER BY position, created_at
  LOOP
    v_sel := NULL;
    SELECT (elem ->> 'selectedIndex')::integer
      INTO v_sel
    FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) elem
    WHERE elem ->> 'questionId' = v_q.id::text
    LIMIT 1;

    IF v_sel IS NOT NULL AND v_sel = v_q.correct_index THEN
      v_correct := v_correct + 1;
    END IF;

    v_results := v_results || jsonb_build_object(
      'question_id', v_q.id,
      'selected_index', v_sel,
      'correct_index', v_q.correct_index,
      'correct', (v_sel IS NOT NULL AND v_sel = v_q.correct_index)
    );
  END LOOP;

  v_score := round((v_correct::numeric / NULLIF(v_total, 0) * 100.0), 2);
  v_passed := v_score >= v_pass_pct;

  SELECT count(*) + 1 INTO v_attempt
  FROM training_quiz_attempts WHERE enrollment_id = p_enrollment_id;

  INSERT INTO training_quiz_attempts
    (enrollment_id, employee_id, course_id, attempt_no, total_questions, correct_count, score_pct, passed, answers)
  VALUES
    (p_enrollment_id, v_en.employee_id, v_en.course_id, v_attempt, v_total, v_correct, v_score, v_passed, v_results);

  v_prev_passed := COALESCE(v_en.quiz_passed, false);
  v_best := GREATEST(COALESCE(v_en.quiz_best_score, 0), v_score);

  -- Keep the SAME enrollment row (never insert a retake entry). When the
  -- employee has not passed yet, reset it to a retakeable state.
  UPDATE training_enrollments
     SET quiz_attempts = COALESCE(quiz_attempts, 0) + 1,
         quiz_best_score = v_best,
         quiz_passed = v_prev_passed OR v_passed,
         quiz_passed_at = CASE
           WHEN (v_prev_passed OR v_passed) AND quiz_passed_at IS NULL THEN now()
           ELSE quiz_passed_at
         END,
         status = CASE
           WHEN NOT (v_prev_passed OR v_passed) AND status NOT IN ('ENROLLED', 'IN_PROGRESS')
             THEN 'ENROLLED'
           ELSE status
         END,
         completion_state = CASE
           WHEN NOT (v_prev_passed OR v_passed) THEN 'IN_PROGRESS'
           ELSE completion_state
         END,
         updated_at = now()
   WHERE id = p_enrollment_id;

  -- Alert the employee that they did not pass and can retake the same entry.
  IF NOT v_passed AND NOT v_prev_passed THEN
    PERFORM public.create_notification(
      v_en.employee_id,
      'Assessment not passed: ' || v_course.title,
      'You scored ' || v_score || '% (pass mark ' || v_pass_pct
        || '%). Retake the assessment from My Training — no new enrolment is needed.',
      'WARNING',
      '/training/my',
      jsonb_build_object(
        'kind', 'training_quiz_failed',
        'course_id', v_en.course_id::text,
        'enrollment_id', p_enrollment_id::text,
        'score_pct', v_score,
        'required_pct', v_pass_pct
      )
    );

    SELECT first_name, email INTO v_first_name, v_email
      FROM employees WHERE id = v_en.employee_id;

    IF v_email IS NOT NULL AND btrim(v_email) <> '' THEN
      INSERT INTO notification_queue
        (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
      VALUES (
        'training.quiz_failed',
        v_email,
        NULLIF(btrim(v_first_name), ''),
        'Retake needed: ' || v_course.title,
        '<p>Hi ' || COALESCE(NULLIF(btrim(v_first_name), ''), 'there') || ',</p>'
          || '<p>Your assessment for <strong>' || v_course.title || '</strong> was not passed ('
          || v_score || '%; pass mark ' || v_pass_pct || '%).</p>'
          || '<p>You can retake it any time from My Training — the same enrolment stays open, '
          || 'so there is nothing to re-enrol.</p>',
        'PENDING',
        jsonb_build_object(
          'kind', 'training_quiz_failed',
          'course_id', v_en.course_id::text,
          'enrollment_id', p_enrollment_id::text,
          'score_pct', v_score,
          'required_pct', v_pass_pct
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'score_pct', v_score,
    'correct_count', v_correct,
    'total_questions', v_total,
    'passed', v_passed,
    'required_pct', v_pass_pct,
    'attempt_no', v_attempt,
    'best_score_pct', v_best,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_training_quiz(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_training_quiz(uuid, jsonb) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.submit_training_quiz(uuid, jsonb) TO service_role;
