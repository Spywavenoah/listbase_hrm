/*
# Training: auto-generated end-of-video assessment (quiz)

Adds a short multiple-choice assessment that is generated automatically from the
course video (no admin authoring), presented right after the lesson finishes,
marked server-side, and required before a certificate is issued.

Data model
  * training_quiz_questions  - the generated questions (correct answers are
    never exposed to the browser: the table has RLS and no authenticated
    policies, so only the service-role API can read/write it).
  * training_quiz_attempts   - one row per submission (audit + retake history).
  * courses gain quiz_pass_pct / quiz_question_count / quiz_generation_status.
  * enrollments cache the best score + pass flag so the SQL evaluator and the
    certificate issuer can gate without recomputing.

RPCs
  * set_training_quiz(course, questions, model) - replace the question set
    (used by the admin generate/regenerate flow); invalidates earlier passes.
  * submit_training_quiz(enrollment, answers)   - mark one attempt, return the
    score + per-question results, and update the enrollment's cached pass state.

Behaviour changes
  * training_completion_evaluation now includes a `quiz_passed` check when the
    course has questions (independent of the video checks).
  * issue_training_certificate refuses with code QUIZ_NOT_PASSED whenever the
    course has questions and the enrollment has not passed - even when
    p_skip_validation is true - because the quiz is a hard gate.
*/

-- ============================================================
-- 1. Course assessment settings
-- ============================================================
ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS quiz_pass_pct integer NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS quiz_question_count integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS quiz_generation_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS quiz_generation_error text,
  ADD COLUMN IF NOT EXISTS quiz_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS quiz_model text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'training_courses_quiz_generation_status_check'
  ) THEN
    ALTER TABLE public.training_courses
      ADD CONSTRAINT training_courses_quiz_generation_status_check
      CHECK (quiz_generation_status IN ('NONE', 'PENDING', 'READY', 'FAILED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'training_courses_quiz_pass_pct_check'
  ) THEN
    ALTER TABLE public.training_courses
      ADD CONSTRAINT training_courses_quiz_pass_pct_check
      CHECK (quiz_pass_pct >= 0 AND quiz_pass_pct <= 100);
  END IF;
END $$;

-- ============================================================
-- 2. Enrollment assessment cache (best score + pass flag)
-- ============================================================
ALTER TABLE public.training_enrollments
  ADD COLUMN IF NOT EXISTS quiz_best_score numeric,
  ADD COLUMN IF NOT EXISTS quiz_passed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiz_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_passed_at timestamptz;

-- ============================================================
-- 3. Question bank
-- ============================================================
CREATE TABLE IF NOT EXISTS public.training_quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_index integer NOT NULL DEFAULT 0,
  explanation text,
  position integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'AI',
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_quiz_questions_course_idx
  ON public.training_quiz_questions (course_id, position);

-- service-role only: RLS on, no policies -> browser cannot read correct answers
ALTER TABLE public.training_quiz_questions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Attempt log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.training_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.training_enrollments(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL DEFAULT 1,
  total_questions integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  score_pct numeric NOT NULL DEFAULT 0,
  passed boolean NOT NULL DEFAULT false,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  taken_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_quiz_attempts_enrollment_idx
  ON public.training_quiz_attempts (enrollment_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS training_quiz_attempts_course_idx
  ON public.training_quiz_attempts (course_id);

ALTER TABLE public.training_quiz_attempts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. Replace the question set for a course (admin generate/regenerate)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_training_quiz(
  p_course_id uuid,
  p_questions jsonb,
  p_model text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_elem jsonb;
  v_pos integer := 0;
  v_count integer := 0;
  v_options jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM training_courses WHERE id = p_course_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  DELETE FROM training_quiz_questions WHERE course_id = p_course_id;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(COALESCE(p_questions, '[]'::jsonb))
  LOOP
    v_options := COALESCE(v_elem -> 'options', '[]'::jsonb);
    IF COALESCE(trim(v_elem ->> 'prompt'), '') = '' THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_options) <> 'array' OR jsonb_array_length(v_options) < 2 THEN
      CONTINUE;
    END IF;

    INSERT INTO training_quiz_questions
      (course_id, prompt, options, correct_index, explanation, position, source, model)
    VALUES (
      p_course_id,
      trim(v_elem ->> 'prompt'),
      v_options,
      GREATEST(0, LEAST(jsonb_array_length(v_options) - 1, COALESCE((v_elem ->> 'correctIndex')::integer, 0))),
      NULLIF(trim(COALESCE(v_elem ->> 'explanation', '')), ''),
      v_pos,
      'AI',
      p_model
    );
    v_pos := v_pos + 1;
  END LOOP;

  SELECT count(*) INTO v_count FROM training_quiz_questions WHERE course_id = p_course_id;

  UPDATE training_courses
     SET quiz_generation_status = CASE WHEN v_count > 0 THEN 'READY' ELSE 'NONE' END,
         quiz_generation_error = NULL,
         quiz_generated_at = now(),
         quiz_model = p_model,
         updated_at = now()
   WHERE id = p_course_id;

  -- a new question set invalidates previous passes; attempts history is kept
  UPDATE training_enrollments
     SET quiz_passed = false,
         quiz_best_score = NULL,
         quiz_passed_at = NULL,
         updated_at = now()
   WHERE course_id = p_course_id;

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.set_training_quiz(uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_training_quiz(uuid, jsonb, text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_training_quiz(uuid, jsonb, text) TO service_role;

-- ============================================================
-- 6. Mark one attempt
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

  UPDATE training_enrollments
     SET quiz_attempts = COALESCE(quiz_attempts, 0) + 1,
         quiz_best_score = v_best,
         quiz_passed = v_prev_passed OR v_passed,
         quiz_passed_at = CASE
           WHEN (v_prev_passed OR v_passed) AND quiz_passed_at IS NULL THEN now()
           ELSE quiz_passed_at
         END,
         updated_at = now()
   WHERE id = p_enrollment_id;

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

-- ============================================================
-- 7. Completion evaluation gains a quiz check
-- ============================================================
CREATE OR REPLACE FUNCTION public.training_completion_evaluation(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_en training_enrollments%ROWTYPE;
  v_course training_courses%ROWTYPE;
  v_p training_video_progress%ROWTYPE;
  v_dur numeric;
  v_pass integer;
  v_coverage numeric := 0;
  v_expected integer := 0;
  v_checks jsonb := '{}'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_no_video boolean := false;
  v_has_quiz boolean := false;
  v_quiz_pass integer := 70;
BEGIN
  SELECT * INTO v_en FROM training_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_course FROM training_courses WHERE id = v_en.course_id;
  SELECT * INTO v_p FROM training_video_progress WHERE enrollment_id = p_enrollment_id;

  v_has_quiz := EXISTS (SELECT 1 FROM training_quiz_questions WHERE course_id = v_en.course_id);
  v_quiz_pass := GREATEST(0, LEAST(100, COALESCE(v_course.quiz_pass_pct, 70)));

  -- no lesson video configured: nothing to verify against (manual completion still works)
  IF (COALESCE(v_course.video_url, '') = '' AND COALESCE(v_course.video_path, '') = '')
     OR COALESCE(v_course.video_duration_seconds, 0) <= 0 THEN
    v_no_video := true;
    v_dur := 0;
  ELSE
    v_dur := COALESCE(v_course.video_duration_seconds, 0);
  END IF;

  v_pass := GREATEST(0, LEAST(100, COALESCE(v_course.pass_pct, 95)));
  v_coverage := COALESCE(v_p.watch_duration_seconds, 0);
  v_expected := CASE WHEN v_dur > 0 THEN ceil(v_dur / 7.0)::integer ELSE 0 END;

  IF v_no_video THEN
    v_checks := jsonb_build_object('not_applicable', true);
  ELSE
    -- 1. union of watched segments >= pass_pct% of duration
    v_checks := v_checks || jsonb_build_object(
      'coverage_pct',
      jsonb_build_object(
        'ok', (v_coverage / NULLIF(v_dur,0) * 100.0) >= v_pass,
        'actual', round((v_coverage / NULLIF(v_dur,0) * 100.0)::numeric, 2),
        'required', v_pass
      )
    );
    -- 2. max position reached the end (duration - 2s)
    v_checks := v_checks || jsonb_build_object(
      'reached_end',
      jsonb_build_object(
        'ok', COALESCE(v_p.max_position_seconds, 0) >= (v_dur - 2),
        'actual', COALESCE(v_p.max_position_seconds, 0),
        'required', round((v_dur - 2)::numeric, 2)
      )
    );
    -- 3. heartbeat count >= 90% of expected
    v_checks := v_checks || jsonb_build_object(
      'heartbeat_count',
      jsonb_build_object(
        'ok', COALESCE(v_p.heartbeat_count, 0) >= ceil(v_expected * 0.9),
        'actual', COALESCE(v_p.heartbeat_count, 0),
        'expected', v_expected
      )
    );
    -- 4. no heartbeat gap > 15s (buffering/pause gaps carry interrupted=true and are ignored)
    v_checks := v_checks || jsonb_build_object(
      'max_gap_ms',
      jsonb_build_object(
        'ok', COALESCE(v_p.max_gap_ms, 0) <= 15000,
        'actual', COALESCE(v_p.max_gap_ms, 0),
        'required', 15000
      )
    );
    -- 5. active watch time >= pass_pct% of duration
    v_checks := v_checks || jsonb_build_object(
      'active_watch',
      jsonb_build_object(
        'ok', (v_coverage / NULLIF(v_dur,0) * 100.0) >= v_pass,
        'actual', round((v_coverage / NULLIF(v_dur,0) * 100.0)::numeric, 2),
        'required', v_pass
      )
    );
    -- 6. playback rate <= 1.25 throughout
    v_checks := v_checks || jsonb_build_object(
      'playback_rate',
      jsonb_build_object(
        'ok', COALESCE(v_p.max_playback_rate, 1) <= 1.25,
        'actual', COALESCE(v_p.max_playback_rate, 1),
        'required', 1.25
      )
    );
  END IF;

  -- 7. assessment passed (independent of the video checks)
  IF v_has_quiz THEN
    v_checks := v_checks || jsonb_build_object(
      'quiz_passed',
      jsonb_build_object(
        'ok', COALESCE(v_en.quiz_passed, false),
        'actual', COALESCE(v_en.quiz_best_score, 0),
        'required', v_quiz_pass
      )
    );
  END IF;

  SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
    INTO v_reasons
  FROM (
    SELECT k
    FROM jsonb_each(v_checks) e(k, v)
    WHERE v ? 'ok' AND NOT COALESCE((v ->> 'ok')::boolean, false)
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'has_video', NOT v_no_video,
    'duration_seconds', v_dur,
    'coverage_seconds', v_coverage,
    'active_watch_seconds', v_coverage,
    'max_position_seconds', COALESCE(v_p.max_position_seconds, 0),
    'heartbeat_count', COALESCE(v_p.heartbeat_count, 0),
    'expected_heartbeats', v_expected,
    'max_gap_ms', COALESCE(v_p.max_gap_ms, 0),
    'max_playback_rate', COALESCE(v_p.max_playback_rate, 1),
    'fingerprint_mismatch', COALESCE(v_p.fingerprint_mismatch, false),
    'pass_pct', v_pass,
    'quiz', jsonb_build_object(
      'required', v_has_quiz,
      'passed', COALESCE(v_en.quiz_passed, false),
      'best_score_pct', COALESCE(v_en.quiz_best_score, 0),
      'attempts', COALESCE(v_en.quiz_attempts, 0),
      'required_pct', v_quiz_pass
    ),
    'checks', v_checks,
    'reasons', v_reasons,
    'eligible', (jsonb_array_length(v_reasons) = 0)
  );
END $$;

REVOKE ALL ON FUNCTION public.training_completion_evaluation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.training_completion_evaluation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.training_completion_evaluation(uuid) TO service_role;

-- ============================================================
-- 8. Issuance hard-gates on the assessment, even in shadow mode
-- ============================================================
CREATE OR REPLACE FUNCTION public.issue_training_certificate(
  p_enrollment_id uuid,
  p_skip_validation boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_en training_enrollments%ROWTYPE;
  v_course training_courses%ROWTYPE;
  v_eval jsonb;
  v_cert_id text;
  v_issued timestamptz := now();
  v_expires timestamptz;
  v_interval integer;
  v_next_id uuid := NULL;
  v_pdf text := NULL;
  v_has_quiz boolean := false;
  v_quiz_pass integer := 70;
BEGIN
  SELECT * INTO v_en FROM training_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  SELECT * INTO v_course FROM training_courses WHERE id = v_en.course_id;

  v_has_quiz := EXISTS (SELECT 1 FROM training_quiz_questions WHERE course_id = v_en.course_id);
  v_quiz_pass := GREATEST(0, LEAST(100, COALESCE(v_course.quiz_pass_pct, 70)));

  -- the assessment is a hard gate: must pass before any certificate, even shadow
  IF v_has_quiz AND NOT COALESCE(v_en.quiz_passed, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'QUIZ_NOT_PASSED',
      'message', 'The course assessment must be passed before the certificate can be issued.',
      'quiz', jsonb_build_object(
        'required', true,
        'passed', false,
        'best_score_pct', COALESCE(v_en.quiz_best_score, 0),
        'required_pct', v_quiz_pass
      )
    );
  END IF;

  v_eval := public.training_completion_evaluation(p_enrollment_id);
  IF NOT COALESCE((v_eval ->> 'eligible')::boolean, false) AND NOT p_skip_validation THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'NOT_ELIGIBLE',
      'message', 'Completion criteria are not met.',
      'evaluation', v_eval
    );
  END IF;

  v_cert_id := COALESCE(
    v_en.certificate_id,
    'TRN-' || upper(substr(replace(v_en.id::text, '-', ''), 1, 10))
  );

  v_interval := COALESCE(v_course.reassessment_interval_months, v_course.renewal_months);
  IF v_interval IS NOT NULL THEN
    v_expires := v_issued + make_interval(months => v_interval);
  ELSE
    v_expires := NULL;
  END IF;

  UPDATE training_enrollments
     SET status = 'COMPLETED',
         completed_at = COALESCE(completed_at, v_issued),
         progress = 100,
         completion_state = 'ISSUED',
         certificate_id = v_cert_id,
         certificate_issued_at = v_issued,
         certificate_expires_at = v_expires,
         completion_decision = v_eval,
         updated_at = now()
   WHERE id = v_en.id
   RETURNING certificate_pdf_url INTO v_pdf;

  -- next reassessment cycle is a NEW row (history of this row is untouched)
  IF v_interval IS NOT NULL THEN
    INSERT INTO training_enrollments
      (course_id, employee_id, status, enrolled_at, progress, cycle,
       parent_enrollment_id, completion_state, validation_enabled, due_date)
    SELECT v_en.course_id, v_en.employee_id, 'ENROLLED', now(), 0,
           v_en.cycle + 1, v_en.id, 'IN_PROGRESS', v_en.validation_enabled, v_expires
    WHERE NOT EXISTS (
      SELECT 1 FROM training_enrollments x
      WHERE x.course_id = v_en.course_id
        AND x.employee_id = v_en.employee_id
        AND x.cycle = v_en.cycle + 1
    )
    RETURNING id INTO v_next_id;
  END IF;

  INSERT INTO notification_queue (event_key, recipient_email, recipient_name, subject, body_html, status, metadata)
  SELECT
    'training.certificate_issued',
    e.email,
    e.first_name,
    'Certificate issued: ' || v_course.title,
    '<p>Hi ' || COALESCE(e.first_name, '') || ',</p>'
      || '<p>Congratulations - your certificate for <strong>' || v_course.title || '</strong> has been issued.</p>'
      || '<p>Certificate ID: <strong>' || v_cert_id || '</strong></p>'
      || CASE WHEN v_expires IS NOT NULL
              THEN '<p>It is valid until ' || to_char(v_expires, 'DD Mon YYYY')
                   || '. Your next renewal cycle will open automatically.</p>'
              ELSE '<p>This certificate does not expire.</p>' END,
    'PENDING',
    jsonb_build_object(
      'enrollment_id', v_en.id::text,
      'course_id', v_en.course_id::text,
      'certificate_id', v_cert_id,
      'certificate_expires_at', v_expires,
      'cycle', v_en.cycle,
      'next_enrollment_id', v_next_id
    )
  FROM employees e
  WHERE e.id = v_en.employee_id
    AND e.email IS NOT NULL AND e.email <> '';

  RETURN jsonb_build_object(
    'ok', true,
    'certificate_id', v_cert_id,
    'certificate_issued_at', v_issued,
    'certificate_expires_at', v_expires,
    'certificate_pdf_url', v_pdf,
    'next_enrollment_id', v_next_id,
    'cycle', v_en.cycle,
    'evaluation', v_eval
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_training_certificate(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_training_certificate(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_training_certificate(uuid, boolean) TO service_role;
