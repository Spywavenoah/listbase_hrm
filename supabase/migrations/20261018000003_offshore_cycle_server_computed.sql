-- ============================================================
-- Migration 27 — Offshore cycle creation becomes server-authoritative and
-- double-payment safe.
--
-- The server now derives each selected employee's worked DATES from
-- project_workforce (matching the requested start/end window, including
-- shuffle-created rows), resolves the project's allowance rate itself, and
-- excludes any day that is already PAID in another cycle for the same project
-- and employee. Ledger rows carry the real calendar date (day_date) so the
-- "already paid" check is exact.
-- ============================================================

-- Store the real calendar date worked on each ledger day.
ALTER TABLE public.offshore_allowance_day_ledger
  ADD COLUMN IF NOT EXISTS day_date date;

-- ------------------------------------------------------------
-- RPC: create a project-driven cycle (server computes worked dates + rate,
-- and never re-pays a day that is already paid for the same project+employee).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_offshore_allowance_cycle(uuid, text, date, date, text, jsonb);
DROP FUNCTION IF EXISTS public.create_offshore_allowance_cycle(uuid, text, date, date, text, uuid[]);
CREATE OR REPLACE FUNCTION public.create_offshore_allowance_cycle(
  p_project_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date,
  p_currency text,
  p_employee_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle_id uuid;
  v_total_days integer;
  v_rate numeric := 0;
  v_currency text;
  v_emp uuid;
  v_n integer;
  v_added integer := 0;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to create offshore allowance cycles';
  END IF;
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Select a project for the cycle';
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
  IF p_employee_ids IS NULL OR array_length(p_employee_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one employee';
  END IF;

  v_total_days := (p_end_date - p_start_date) + 1;

  -- Resolve the allowance rate in force on the cycle start date:
  -- project-specific beats the global default, latest effective_from wins.
  SELECT oa.amount, oa.currency INTO v_rate, v_currency
    FROM public.offshore_allowances oa
   WHERE oa.is_active
     AND oa.effective_from <= p_start_date
     AND (oa.effective_to IS NULL OR oa.effective_to >= p_start_date)
     AND (oa.project_id IS NULL OR oa.project_id = p_project_id)
   ORDER BY (oa.project_id IS NOT NULL) DESC, oa.effective_from DESC, oa.effective_to DESC NULLS LAST
   LIMIT 1;

  v_rate := COALESCE(v_rate, 0);
  v_currency := COALESCE(NULLIF(trim(p_currency), ''), NULLIF(v_currency, ''), 'USD');

  INSERT INTO public.offshore_allowance_cycles (project_id, name, start_date, end_date, total_days, currency, created_by)
  VALUES (p_project_id, trim(p_name), p_start_date, p_end_date, v_total_days, v_currency, public.current_employee_id())
  RETURNING id INTO v_cycle_id;

  FOREACH v_emp IN ARRAY p_employee_ids LOOP
    -- Worked dates in the window, minus any day already paid for this
    -- project + employee in another cycle. row_number() gives the day index.
    INSERT INTO public.offshore_allowance_day_ledger (cycle_id, employee_id, day_no, day_date, amount)
    SELECT v_cycle_id,
           v_emp,
           row_number() OVER (ORDER BY w.day)::integer,
           w.day,
           v_rate
    FROM (
      SELECT DISTINCT rd.day
      FROM (SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date AS day) rd
      JOIN public.project_workforce pw
        ON rd.day >= pw.start_date
       AND (pw.end_date IS NULL OR rd.day <= pw.end_date)
       AND pw.project_id = p_project_id
       AND pw.employee_id = v_emp
      WHERE NOT EXISTS (
        SELECT 1
          FROM public.offshore_allowance_day_ledger l
          JOIN public.offshore_allowance_cycles c2 ON c2.id = l.cycle_id
         WHERE c2.project_id = p_project_id
           AND l.employee_id = v_emp
           AND l.day_date = rd.day
           AND l.status = 'PAID'
      )
    ) w
    ON CONFLICT (cycle_id, employee_id, day_no) DO NOTHING;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      INSERT INTO public.offshore_allowance_cycle_employees (cycle_id, employee_id, day_rate)
      VALUES (v_cycle_id, v_emp, v_rate)
      ON CONFLICT (cycle_id, employee_id) DO UPDATE SET day_rate = EXCLUDED.day_rate;
      v_added := v_added + 1;
    END IF;
  END LOOP;

  IF v_added = 0 THEN
    RAISE EXCEPTION 'None of the selected employees have any unpaid worked days in this period (they may already be paid)';
  END IF;

  RETURN v_cycle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_offshore_allowance_cycle(uuid, text, date, date, text, uuid[]) TO authenticated;
