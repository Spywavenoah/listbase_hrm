-- ============================================================
-- Migration 25 — Offshore allowance payment & tracking.
--
-- Finance picks a cycle (a 20-day offshore period) and pays employees in
-- batches of up to 4 days at a time. Each payment covers multiple employees,
-- carries a payment advice document, and marks the covered days as PAID in a
-- per-employee day ledger so the system always knows what is paid and what is
-- left.
-- ============================================================

-- ------------------------------------------------------------
-- Storage bucket for payment advice documents (private).
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('allowance-payment-advice', 'allowance-payment-advice', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "allowance_advice_select" ON storage.objects;
CREATE POLICY "allowance_advice_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'allowance-payment-advice'
    AND (
      public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings'])
      OR (storage.foldername(name))[1] = public.current_employee_id()::text
    )
  );

DROP POLICY IF EXISTS "allowance_advice_insert" ON storage.objects;
CREATE POLICY "allowance_advice_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'allowance-payment-advice'
    AND public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings'])
  );

DROP POLICY IF EXISTS "allowance_advice_delete" ON storage.objects;
CREATE POLICY "allowance_advice_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'allowance-payment-advice'
    AND public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings'])
  );

-- ------------------------------------------------------------
-- Cycles — a 20-day offshore allowance period (optionally per project).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offshore_allowance_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date,
  total_days integer NOT NULL DEFAULT 20 CHECK (total_days > 0),
  currency text NOT NULL DEFAULT 'USD',
  created_by uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Employees attached to a cycle, with their per-day rate.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offshore_allowance_cycle_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.offshore_allowance_cycles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  day_rate numeric NOT NULL DEFAULT 0 CHECK (day_rate >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);

-- ------------------------------------------------------------
-- Payments — a bulk payment batch (<= 4 days) covering many employees.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offshore_allowance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.offshore_allowance_cycles(id) ON DELETE CASCADE,
  reference text,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  days_count integer NOT NULL CHECK (days_count > 0 AND days_count <= 4),
  employee_count integer NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  notes text,
  advice_path text,
  advice_url text,
  created_by uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Day ledger — per-employee per-day paid/pending status.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offshore_allowance_day_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.offshore_allowance_cycles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  day_no integer NOT NULL CHECK (day_no > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID')),
  amount numeric NOT NULL DEFAULT 0,
  payment_id uuid REFERENCES public.offshore_allowance_payments(id) ON DELETE SET NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id, day_no)
);

CREATE INDEX IF NOT EXISTS idx_oac_project ON public.offshore_allowance_cycles(project_id);
CREATE INDEX IF NOT EXISTS idx_oace_cycle ON public.offshore_allowance_cycle_employees(cycle_id);
CREATE INDEX IF NOT EXISTS idx_oace_employee ON public.offshore_allowance_cycle_employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_oap_cycle ON public.offshore_allowance_payments(cycle_id);
CREATE INDEX IF NOT EXISTS idx_oal_cycle ON public.offshore_allowance_day_ledger(cycle_id);
CREATE INDEX IF NOT EXISTS idx_oal_employee ON public.offshore_allowance_day_ledger(employee_id);
CREATE INDEX IF NOT EXISTS idx_oal_payment ON public.offshore_allowance_day_ledger(payment_id);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.offshore_allowance_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offshore_allowance_cycle_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offshore_allowance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offshore_allowance_day_ledger ENABLE ROW LEVEL SECURITY;

-- Finance oversight set used across the module.
-- (projects.allowance = finance unit for offshore allowances)

DROP POLICY IF EXISTS "oac_select" ON public.offshore_allowance_cycles;
CREATE POLICY "oac_select" ON public.offshore_allowance_cycles FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','projects.allowance','admin.settings','admin.reports_read']));
DROP POLICY IF EXISTS "oac_write" ON public.offshore_allowance_cycles;
CREATE POLICY "oac_write" ON public.offshore_allowance_cycles FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']));

DROP POLICY IF EXISTS "oace_select" ON public.offshore_allowance_cycle_employees;
CREATE POLICY "oace_select" ON public.offshore_allowance_cycle_employees FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','projects.allowance','admin.settings','admin.reports_read']));
DROP POLICY IF EXISTS "oace_write" ON public.offshore_allowance_cycle_employees;
CREATE POLICY "oace_write" ON public.offshore_allowance_cycle_employees FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']));

DROP POLICY IF EXISTS "oap_select" ON public.offshore_allowance_payments;
CREATE POLICY "oap_select" ON public.offshore_allowance_payments FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','projects.allowance','admin.settings','admin.reports_read']));
DROP POLICY IF EXISTS "oap_write" ON public.offshore_allowance_payments;
CREATE POLICY "oap_write" ON public.offshore_allowance_payments FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']));

DROP POLICY IF EXISTS "oal_select" ON public.offshore_allowance_day_ledger;
CREATE POLICY "oal_select" ON public.offshore_allowance_day_ledger FOR SELECT TO authenticated
  USING (
    public.has_any_privilege(ARRAY['projects.view','projects.manage','projects.allowance','admin.settings','admin.reports_read'])
    OR employee_id = public.current_employee_id()
  );
DROP POLICY IF EXISTS "oal_write" ON public.offshore_allowance_day_ledger;
CREATE POLICY "oal_write" ON public.offshore_allowance_day_ledger FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']));

-- ------------------------------------------------------------
-- RPC: create a cycle, attach employees and seed the day ledger.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_offshore_allowance_cycle(uuid, text, date, integer, text, uuid[], numeric);
CREATE OR REPLACE FUNCTION public.create_offshore_allowance_cycle(
  p_project_id uuid,
  p_name text,
  p_start_date date,
  p_total_days integer,
  p_currency text,
  p_employee_ids uuid[],
  p_day_rate numeric
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle_id uuid;
  v_emp uuid;
  v_day integer;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to create offshore allowance cycles';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Cycle name is required';
  END IF;
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'Start date is required';
  END IF;
  IF p_total_days IS NULL OR p_total_days <= 0 THEN
    RAISE EXCEPTION 'Total days must be greater than zero';
  END IF;
  IF p_employee_ids IS NULL OR array_length(p_employee_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one employee';
  END IF;

  INSERT INTO public.offshore_allowance_cycles (project_id, name, start_date, total_days, currency, created_by)
  VALUES (p_project_id, trim(p_name), p_start_date, p_total_days, COALESCE(NULLIF(trim(p_currency),''),'USD'), public.current_employee_id())
  RETURNING id INTO v_cycle_id;

  FOREACH v_emp IN ARRAY p_employee_ids LOOP
    INSERT INTO public.offshore_allowance_cycle_employees (cycle_id, employee_id, day_rate)
    VALUES (v_cycle_id, v_emp, COALESCE(p_day_rate, 0))
    ON CONFLICT (cycle_id, employee_id) DO UPDATE SET day_rate = EXCLUDED.day_rate;

    FOR v_day IN 1..p_total_days LOOP
      INSERT INTO public.offshore_allowance_day_ledger (cycle_id, employee_id, day_no, amount)
      VALUES (v_cycle_id, v_emp, v_day, COALESCE(p_day_rate, 0))
      ON CONFLICT (cycle_id, employee_id, day_no) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN v_cycle_id;
END;
$$;

-- ------------------------------------------------------------
-- RPC: record a bulk payment (<= 4 days) for multiple employees.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_offshore_allowance_payment(uuid, uuid[], integer[], text, date, text, text, text);
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

  -- Validate every (employee, day) is PENDING and belongs to the cycle.
  FOREACH v_emp IN ARRAY p_employee_ids LOOP
    FOREACH v_day IN ARRAY p_day_nos LOOP
      IF v_day < 1 OR v_day > v_cycle.total_days THEN
        RAISE EXCEPTION 'Day % is outside the 1..% cycle range', v_day, v_cycle.total_days;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.offshore_allowance_day_ledger
         WHERE cycle_id = p_cycle_id AND employee_id = v_emp AND day_no = v_day AND status = 'PAID'
      ) THEN
        RAISE EXCEPTION 'Day % is already paid for an employee', v_day;
      END IF;
      SELECT day_rate INTO v_rate
        FROM public.offshore_allowance_cycle_employees
       WHERE cycle_id = p_cycle_id AND employee_id = v_emp;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee is not part of this cycle';
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

  -- Mark the covered days as PAID and stamp the payment.
  UPDATE public.offshore_allowance_day_ledger
     SET status = 'PAID', payment_id = v_payment_id, paid_at = now(), amount = amount
   WHERE cycle_id = p_cycle_id
     AND employee_id = ANY(p_employee_ids)
     AND day_no = ANY(p_day_nos)
     AND status = 'PENDING';

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_offshore_allowance_cycle(uuid, text, date, integer, text, uuid[], numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_offshore_allowance_payment(uuid, uuid[], integer[], text, date, text, text, text) TO authenticated;
