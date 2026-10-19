-- ============================================================
-- Migration 26 — Offshore allowance cycles become project-driven.
--
-- The cycle length is derived from start/end dates (not hand-entered). Each
-- employee's entitlement is the number of days they actually worked on the
-- project within that window (from project_workforce deployments), and the
-- amount due is worked_days x the project's allowance rate. The rate may
-- differ per project (and several can be configured for one project), so the
-- caller resolves it and passes the per-employee worked days + rate in.
--
-- Also tightens record_offshore_allowance_payment so a day can only be paid
-- if the employee actually has that day in their entitlement ledger.
-- ============================================================

-- ------------------------------------------------------------
-- RPC: create a project-driven cycle with per-employee worked days.
--   p_employees: JSON array of { "employee_id": uuid, "worked_days": int, "day_rate": numeric }
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_offshore_allowance_cycle(uuid, text, date, integer, text, uuid[], numeric);
DROP FUNCTION IF EXISTS public.create_offshore_allowance_cycle(uuid, text, date, date, text, jsonb);
CREATE OR REPLACE FUNCTION public.create_offshore_allowance_cycle(
  p_project_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date,
  p_currency text,
  p_employees jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle_id uuid;
  v_total_days integer;
  v_elem jsonb;
  v_emp uuid;
  v_worked integer;
  v_rate numeric;
  v_day integer;
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
  IF p_employees IS NULL OR jsonb_array_length(p_employees) = 0 THEN
    RAISE EXCEPTION 'Select at least one employee';
  END IF;

  v_total_days := (p_end_date - p_start_date) + 1;

  INSERT INTO public.offshore_allowance_cycles (project_id, name, start_date, end_date, total_days, currency, created_by)
  VALUES (p_project_id, trim(p_name), p_start_date, p_end_date, v_total_days,
          COALESCE(NULLIF(trim(p_currency),''),'USD'), public.current_employee_id())
  RETURNING id INTO v_cycle_id;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_employees) LOOP
    v_emp := (v_elem->>'employee_id')::uuid;
    v_worked := COALESCE((v_elem->>'worked_days')::integer, 0);
    v_rate := COALESCE((v_elem->>'day_rate')::numeric, 0);

    IF v_emp IS NULL THEN
      RAISE EXCEPTION 'Each employee entry needs an employee_id';
    END IF;
    IF v_worked < 1 OR v_worked > v_total_days THEN
      RAISE EXCEPTION 'Worked days must be between 1 and % for the selected period', v_total_days;
    END IF;
    IF v_rate < 0 THEN
      RAISE EXCEPTION 'Rate cannot be negative';
    END IF;

    INSERT INTO public.offshore_allowance_cycle_employees (cycle_id, employee_id, day_rate)
    VALUES (v_cycle_id, v_emp, v_rate)
    ON CONFLICT (cycle_id, employee_id) DO UPDATE SET day_rate = EXCLUDED.day_rate;

    FOR v_day IN 1..v_worked LOOP
      INSERT INTO public.offshore_allowance_day_ledger (cycle_id, employee_id, day_no, amount)
      VALUES (v_cycle_id, v_emp, v_day, v_rate)
      ON CONFLICT (cycle_id, employee_id, day_no) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN v_cycle_id;
END;
$$;

-- ------------------------------------------------------------
-- Payment RPC: only allow paying days the employee is entitled to
-- (i.e. a ledger row exists), not just "not already paid".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_offshore_allowance_payment(
  p_cycle_id uuid,
  p_employee_ids uuid[],
  p_day_nos integer[],
  p_reference text,
  p_payment_date date,
  p_notes text,
  p_advice_path text,
  p_advice_url text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_cycle public.offshore_allowance_cycles%ROWTYPE;
  v_days_count integer;
  v_emp_count integer;
  v_total numeric := 0;
  v_emp uuid;
  v_day integer;
  v_rate numeric;
  v_currency text;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to record offshore allowance payments';
  END IF;

  SELECT * INTO v_cycle FROM public.offshore_allowance_cycles WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;

  IF p_employee_ids IS NULL OR array_length(p_employee_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one employee';
  END IF;
  IF p_day_nos IS NULL OR array_length(p_day_nos, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one day';
  END IF;

  v_days_count := array_length(p_day_nos, 1);
  IF v_days_count > 4 THEN
    RAISE EXCEPTION 'You can pay a maximum of 4 days at a time';
  END IF;

  v_emp_count := array_length(p_employee_ids, 1);
  v_currency := v_cycle.currency;

  -- Validate every (employee, day) exists in the entitlement ledger and is unpaid.
  FOREACH v_emp IN ARRAY p_employee_ids LOOP
    FOREACH v_day IN ARRAY p_day_nos LOOP
      SELECT amount INTO v_rate
        FROM public.offshore_allowance_day_ledger
       WHERE cycle_id = p_cycle_id AND employee_id = v_emp AND day_no = v_day;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Day % is not part of this employee''s entitlement', v_day;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.offshore_allowance_day_ledger
         WHERE cycle_id = p_cycle_id AND employee_id = v_emp AND day_no = v_day AND status = 'PAID'
      ) THEN
        RAISE EXCEPTION 'Day % is already paid for an employee', v_day;
      END IF;
      v_total := v_total + COALESCE(v_rate, 0);
    END LOOP;
  END LOOP;

  INSERT INTO public.offshore_allowance_payments (
    cycle_id, reference, payment_date, days_count, employee_count,
    total_amount, currency, notes, advice_path, advice_url, created_by
  ) VALUES (
    p_cycle_id, NULLIF(trim(p_reference),''), COALESCE(p_payment_date, CURRENT_DATE), v_days_count, v_emp_count,
    v_total, v_currency, NULLIF(trim(p_notes),''), p_advice_path, p_advice_url, public.current_employee_id()
  ) RETURNING id INTO v_payment_id;

  UPDATE public.offshore_allowance_day_ledger
     SET status = 'PAID', payment_id = v_payment_id, paid_at = now()
   WHERE cycle_id = p_cycle_id
     AND employee_id = ANY(p_employee_ids)
     AND day_no = ANY(p_day_nos)
     AND status = 'PENDING';

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_offshore_allowance_cycle(uuid, text, date, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_offshore_allowance_payment(uuid, uuid[], integer[], text, date, text, text, text) TO authenticated;
