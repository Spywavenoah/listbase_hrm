/*
# Training: completion evaluation recognises uploaded lesson videos

`training_completion_evaluation` treated a course as "no video" unless
`video_url` was set. Courses created through the revised Add Course dialog store
their lesson in the `training-videos` bucket and set `video_path` instead, so the
evaluation would skip server-side verification for them.

This replaces the function so a course has video when either `video_path` or
`video_url` is present (and a duration is known). No other behaviour changes.
*/

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
  v_eligible boolean := true;
  v_no_video boolean := false;
BEGIN
  SELECT * INTO v_en FROM training_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  SELECT * INTO v_course FROM training_courses WHERE id = v_en.course_id;
  SELECT * INTO v_p FROM training_video_progress WHERE enrollment_id = p_enrollment_id;

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
    v_checks := jsonb_build_object(
      'not_applicable', true
    );
    v_eligible := true;
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

    SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
      INTO v_reasons
    FROM (
      SELECT k
      FROM jsonb_each(v_checks) e(k, v)
      WHERE NOT COALESCE((v ->> 'ok')::boolean, false)
    ) t;

    IF jsonb_array_length(v_reasons) > 0 THEN
      v_eligible := false;
    END IF;
  END IF;

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
    'checks', v_checks,
    'reasons', v_reasons,
    'eligible', v_eligible
  );
END $$;

REVOKE ALL ON FUNCTION public.training_completion_evaluation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.training_completion_evaluation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.training_completion_evaluation(uuid) TO service_role;
