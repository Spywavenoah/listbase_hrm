-- ============================================================
-- Migration 28 — Edit an offshore allowance cycle (rename + date window).
--
-- Name can always be changed. The date window may only be changed while the
-- cycle has no payments yet: re-deriving worked days / entitlement over days
-- that were already paid (and renumbering day_no, which payments are keyed on)
-- would corrupt history. When dates change, the day ledger and per-employee
-- day rates are re-derived server-side exactly like cycle creation
-- (project_workforce worked dates, rate resolved on the new start date).
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_offshore_allowance_cycle(
  p_cycle_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle public.offshore_allowance_cycles%ROWTYPE;
  v_dates_changed boolean;
  v_total_days integer;
  v_rate numeric := 0;
  v_emp public.offshore_allowance_cycle_employees%ROWTYPE;
  v_n integer;
  v_seeded integer := 0;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to edit offshore allowance cycles';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Cycle name is required';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Start date and end date are required';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;

  SELECT * INTO v_cycle
    FROM public.offshore_allowance_cycles
   WHERE id = p_cycle_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;

  v_dates_changed := (v_cycle.start_date IS DISTINCT FROM p_start_date)
                  OR (v_cycle.end_date IS DISTINCT FROM p_end_date);

  IF NOT v_dates_changed THEN
    UPDATE public.offshore_allowance_cycles
       SET name = trim(p_name), updated_at = now()
     WHERE id = p_cycle_id;
    RETURN;
  END IF;

  -- Dates may only move before anything has been paid on this cycle.
  IF EXISTS (
       SELECT 1 FROM public.offshore_allowance_payments WHERE cycle_id = p_cycle_id
     )
     OR EXISTS (
       SELECT 1 FROM public.offshore_allowance_day_ledger
        WHERE cycle_id = p_cycle_id AND status = 'PAID'
     ) THEN
    RAISE EXCEPTION 'Cycle dates cannot be changed after payments have been recorded (you can still rename the cycle)';
  END IF;

  v_total_days := (p_end_date - p_start_date) + 1;

  -- Re-resolve the allowance rate in force on the new start date.
  SELECT oa.amount, oa.currency INTO v_rate
    FROM public.offshore_allowances oa
   WHERE oa.is_active
     AND oa.effective_from <= p_start_date
     AND (oa.effective_to IS NULL OR oa.effective_to >= p_start_date)
     AND (oa.project_id IS NULL OR oa.project_id = v_cycle.project_id)
   ORDER BY (oa.project_id IS NOT NULL) DESC, oa.effective_from DESC, oa.effective_to DESC NULLS LAST
   LIMIT 1;
  v_rate := COALESCE(v_rate, 0);

  -- Drop the old (entirely PENDING) ledger and rebuild it for the new window.
  DELETE FROM public.offshore_allowance_day_ledger WHERE cycle_id = p_cycle_id;

  FOR v_emp IN
    SELECT * FROM public.offshore_allowance_cycle_employees WHERE cycle_id = p_cycle_id
  LOOP
    IF v_cycle.project_id IS NOT NULL THEN
      -- Worked dates from the project's deployments, matching creation.
      INSERT INTO public.offshore_allowance_day_ledger (cycle_id, employee_id, day_no, day_date, amount)
      SELECT p_cycle_id,
             v_emp.employee_id,
             row_number() OVER (ORDER BY w.day)::integer,
             w.day,
             v_rate
      FROM (
        SELECT DISTINCT rd.day
        FROM (SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date AS day) rd
        JOIN public.project_workforce pw
          ON rd.day >= pw.start_date
         AND (pw.end_date IS NULL OR rd.day <= pw.end_date)
         AND pw.project_id = v_cycle.project_id
         AND pw.employee_id = v_emp.employee_id
      ) w;
    ELSE
      -- Project-less (legacy) cycles have no workforce data to consult:
      -- every calendar day in the window is an allowance day.
      INSERT INTO public.offshore_allowance_day_ledger (cycle_id, employee_id, day_no, day_date, amount)
      SELECT p_cycle_id,
             v_emp.employee_id,
             rd.n,
             rd.day,
             v_rate
      FROM (
        SELECT d.day, row_number() OVER (ORDER BY d.day)::integer AS n
        FROM (SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date AS day) d
      ) rd;
    END IF;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      UPDATE public.offshore_allowance_cycle_employees
         SET day_rate = v_rate
       WHERE id = v_emp.id;
      v_seeded := v_seeded + 1;
    END IF;
  END LOOP;

  IF v_seeded = 0 THEN
    RAISE EXCEPTION 'None of this cycle''s employees have any worked days in the new date range';
  END IF;

  UPDATE public.offshore_allowance_cycles
     SET name = trim(p_name),
         start_date = p_start_date,
         end_date = p_end_date,
         total_days = v_total_days,
         updated_at = now()
   WHERE id = p_cycle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_offshore_allowance_cycle(uuid, text, date, date) TO authenticated;
