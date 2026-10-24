-- ============================================================
-- Migration 30 — Timecard, Nigerian payroll components & recorder keeper
--
-- 1. Timecard payroll calculation configuration (DAYS or HOURS).
-- 2. Timecard: break out/in on attendance + adjustment requests (3-day window).
-- 3. Recorder keeper: payslip numbers + per-line ledger of additions/deductions.
-- 4. Employee compensation toggles (Pension / NSITF / Tax) and statutory fields.
-- 5. Nigerian statutory pay components (locked/system) + payroll engine rewrite.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Attendance — break tracking columns
-- ------------------------------------------------------------
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS break_start timestamptz,
  ADD COLUMN IF NOT EXISTS break_end timestamptz;

-- ------------------------------------------------------------
-- 2. Timecard adjustment requests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timecard_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  field_name text NOT NULL,          -- CLOCK_IN | CLOCK_OUT | BREAK_START | BREAK_END
  original_time timestamptz,
  requested_time timestamptz NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
  reviewed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timecard_adj_employee ON public.timecard_adjustment_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_timecard_adj_attendance ON public.timecard_adjustment_requests(attendance_id);

ALTER TABLE public.timecard_adjustment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_timecard_adj" ON public.timecard_adjustment_requests;
CREATE POLICY "select_timecard_adj" ON public.timecard_adjustment_requests FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('attendance.manage'));

DROP POLICY IF EXISTS "insert_timecard_adj" ON public.timecard_adjustment_requests;
CREATE POLICY "insert_timecard_adj" ON public.timecard_adjustment_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS "update_timecard_adj" ON public.timecard_adjustment_requests;
CREATE POLICY "update_timecard_adj" ON public.timecard_adjustment_requests FOR UPDATE TO authenticated
  USING (public.has_privilege('attendance.manage'))
  WITH CHECK (public.has_privilege('attendance.manage'));

DROP POLICY IF EXISTS "delete_timecard_adj" ON public.timecard_adjustment_requests;
CREATE POLICY "delete_timecard_adj" ON public.timecard_adjustment_requests FOR DELETE TO authenticated
  USING (public.has_privilege('attendance.manage'));

-- Self-service request with a strict 3-day window
CREATE OR REPLACE FUNCTION public.request_timecard_adjustment(
  p_attendance_id uuid,
  p_field text,
  p_requested_time timestamptz,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_owner uuid;
  v_date date;
  v_original timestamptz;
  v_id uuid;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee profile linked to this account';
  END IF;

  SELECT employee_id, date,
         CASE p_field
           WHEN 'CLOCK_IN' THEN clock_in
           WHEN 'CLOCK_OUT' THEN clock_out
           WHEN 'BREAK_START' THEN break_start
           WHEN 'BREAK_END' THEN break_end
         END
    INTO v_owner, v_date, v_original
    FROM public.attendance
   WHERE id = p_attendance_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Attendance record not found';
  END IF;
  IF v_owner <> v_emp THEN
    RAISE EXCEPTION 'You can only adjust your own timecard';
  END IF;
  IF p_field NOT IN ('CLOCK_IN','CLOCK_OUT','BREAK_START','BREAK_END') THEN
    RAISE EXCEPTION 'Invalid timecard field';
  END IF;
  IF v_date < (CURRENT_DATE - INTERVAL '3 days') THEN
    RAISE EXCEPTION 'Adjustments are only allowed within 3 days of the entry';
  END IF;
  IF p_requested_time IS NULL THEN
    RAISE EXCEPTION 'A requested time is required';
  END IF;

  INSERT INTO public.timecard_adjustment_requests
    (attendance_id, employee_id, field_name, original_time, requested_time, reason)
  VALUES
    (p_attendance_id, v_emp, p_field, v_original, p_requested_time, p_reason)
  RETURNING id INTO v_id;

  -- Notify HR/managers who can approve
  PERFORM public.create_notification(
    x.employee_id,
    'Timecard adjustment requested',
    'An employee requested a timecard adjustment that needs review.',
    'WARNING',
    '/attendance/timecard-requests',
    jsonb_build_object('request_id', v_id)
  )
  FROM (
    SELECT DISTINCT ep.employee_id
      FROM public.employee_privileges ep
     WHERE ep.privilege_key = 'attendance.manage'
  ) x;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_timecard_adjustment(uuid, text, timestamptz, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.request_timecard_adjustment(uuid, text, timestamptz, text) FROM PUBLIC;

-- HR approval — applies the change to attendance
CREATE OR REPLACE FUNCTION public.review_timecard_adjustment(
  p_id uuid,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.timecard_adjustment_requests%ROWTYPE;
BEGIN
  IF NOT public.has_privilege('attendance.manage') THEN
    RAISE EXCEPTION 'Not authorized to review timecard adjustments';
  END IF;

  SELECT * INTO v_req FROM public.timecard_adjustment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment request not found';
  END IF;
  IF v_req.status <> 'PENDING' THEN
    RAISE EXCEPTION 'This request has already been reviewed';
  END IF;

  IF p_approve THEN
    UPDATE public.attendance
       SET clock_in    = CASE WHEN v_req.field_name = 'CLOCK_IN'    THEN v_req.requested_time ELSE clock_in END,
           clock_out   = CASE WHEN v_req.field_name = 'CLOCK_OUT'   THEN v_req.requested_time ELSE clock_out END,
           break_start = CASE WHEN v_req.field_name = 'BREAK_START' THEN v_req.requested_time ELSE break_start END,
           break_end   = CASE WHEN v_req.field_name = 'BREAK_END'   THEN v_req.requested_time ELSE break_end END,
           work_hours  = CASE
                           WHEN (CASE WHEN v_req.field_name = 'CLOCK_IN' THEN v_req.requested_time ELSE clock_in END) IS NOT NULL
                            AND (CASE WHEN v_req.field_name = 'CLOCK_OUT' THEN v_req.requested_time ELSE clock_out END) IS NOT NULL
                           THEN ROUND(
                             EXTRACT(EPOCH FROM (
                               (CASE WHEN v_req.field_name = 'CLOCK_OUT' THEN v_req.requested_time ELSE clock_out END)
                               - (CASE WHEN v_req.field_name = 'CLOCK_IN' THEN v_req.requested_time ELSE clock_in END)
                             ))/3600.0
                             - COALESCE(EXTRACT(EPOCH FROM (
                                 (CASE WHEN v_req.field_name = 'BREAK_END' THEN v_req.requested_time ELSE break_end END)
                                 - (CASE WHEN v_req.field_name = 'BREAK_START' THEN v_req.requested_time ELSE break_start END)
                               ))/3600.0, 0), 2)
                           ELSE work_hours
                         END,
           updated_at = now()
     WHERE id = v_req.attendance_id;
  END IF;

  UPDATE public.timecard_adjustment_requests
     SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,
         reviewed_by = public.current_employee_id(),
         reviewed_at = now(),
         review_note = p_note,
         updated_at = now()
   WHERE id = p_id;

  PERFORM public.create_notification(
    v_req.employee_id,
    CASE WHEN p_approve THEN 'Timecard adjustment approved' ELSE 'Timecard adjustment rejected' END,
    COALESCE(p_note, CASE WHEN p_approve THEN 'Your timecard adjustment was approved and applied.' ELSE 'Your timecard adjustment was rejected.' END),
    CASE WHEN p_approve THEN 'SUCCESS' ELSE 'WARNING' END,
    '/attendance/timecard',
    jsonb_build_object('request_id', p_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_timecard_adjustment(uuid, boolean, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.review_timecard_adjustment(uuid, boolean, text) FROM PUBLIC;

-- ------------------------------------------------------------
-- 3. Payroll configuration defaults
-- ------------------------------------------------------------
INSERT INTO public.system_settings (group_name, key, value) VALUES
  ('payroll', 'timecard_calc_mode', '"DAYS"'::jsonb),
  ('payroll', 'hours_per_day', '8'::jsonb),
  ('payroll', 'pension_administrators', '[]'::jsonb)
ON CONFLICT (group_name, key) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Employees — compensation toggles + statutory identifiers
-- ------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS annual_salary numeric,
  ADD COLUMN IF NOT EXISTS pension_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nsitf_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pension_administrator text,
  ADD COLUMN IF NOT EXISTS pension_pin text,
  ADD COLUMN IF NOT EXISTS nsitf_number text,
  ADD COLUMN IF NOT EXISTS tax_id text;

-- Backfill annual salary from monthly for existing employees
UPDATE public.employees
   SET annual_salary = monthly_salary * 12
 WHERE annual_salary IS NULL
   AND monthly_salary IS NOT NULL
   AND monthly_salary > 0;

-- ------------------------------------------------------------
-- 5. Pay components — amount + system protection
-- ------------------------------------------------------------
ALTER TABLE public.pay_components
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_components_system_key
  ON public.pay_components(system_key) WHERE system_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.block_system_pay_component_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'System pay components cannot be deleted (they can be updated)';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_system_pay_component_delete ON public.pay_components;
CREATE TRIGGER trg_block_system_pay_component_delete
  BEFORE DELETE ON public.pay_components
  FOR EACH ROW EXECUTE FUNCTION public.block_system_pay_component_delete();

-- Seed Nigerian statutory components (locked, but editable)
INSERT INTO public.pay_components
  (name, code, component_type, calculation_type, formula, amount, is_taxable, is_active, is_system, system_key)
VALUES
  ('Pension — Employee',   'PENSION_EMP', 'DEDUCTION', 'PERCENTAGE', 'basic * rate / 100', 8,    false, true, true, 'PENSION_EMP'),
  ('Pension — Employer',   'PENSION_ER',  'BENEFIT',   'PERCENTAGE', 'basic * rate / 100', 10,   false, true, true, 'PENSION_ER'),
  ('PAYE Tax (Nigeria)',   'TAX_PAYE',    'TAX',       'FORMULA',    'ng_paye(gross)',      NULL, false, true, true, 'TAX_PAYE'),
  ('NSITF — Employer',     'NSITF',       'BENEFIT',   'PERCENTAGE', 'gross * rate / 100', 1,    false, true, true, 'NSITF')
ON CONFLICT (code) DO NOTHING;

UPDATE public.pay_components
   SET is_system = true,
       system_key = code
 WHERE code IN ('PENSION_EMP','PENSION_ER','TAX_PAYE','NSITF');

-- Normalise the editable statutory rate components (safe to re-run)
UPDATE public.pay_components
   SET calculation_type = 'PERCENTAGE',
       amount = CASE code WHEN 'PENSION_EMP' THEN 8 WHEN 'PENSION_ER' THEN 10 WHEN 'NSITF' THEN 1 END,
       name = CASE code
                WHEN 'PENSION_EMP' THEN 'Pension — Employee'
                WHEN 'PENSION_ER' THEN 'Pension — Employer'
                WHEN 'NSITF' THEN 'NSITF — Employer'
                ELSE name
              END
 WHERE code IN ('PENSION_EMP','PENSION_ER','NSITF');

-- ------------------------------------------------------------
-- 6. Payslips — recorder keeper: number + statutory breakdown
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.payslip_number_seq;

ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS payslip_number text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS basic_salary numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_contributions jsonb DEFAULT '[]'::jsonb;

UPDATE public.payslips
   SET payslip_number = 'PS-' || to_char(COALESCE(generated_at, now()), 'YYYY') || '-' ||
       lpad(nextval('public.payslip_number_seq')::text, 6, '0')
 WHERE payslip_number IS NULL;

ALTER TABLE public.payslips
  ALTER COLUMN payslip_number SET DEFAULT (
    'PS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.payslip_number_seq')::text, 6, '0')
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_payslips_number ON public.payslips(payslip_number);

CREATE TABLE IF NOT EXISTS public.payslip_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id uuid NOT NULL REFERENCES public.payslips(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  entry_type text NOT NULL,          -- ADDITION | DEDUCTION | EMPLOYER
  category text NOT NULL DEFAULT 'PAY_COMPONENT',
                                     -- BASIC | PAY_COMPONENT | ADJUSTMENT | BONUS | TAX | PENSION | NSITF
  name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  source_code text,
  formula text,
  notes text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payslip_ledger_payslip ON public.payslip_ledger(payslip_id);
CREATE INDEX IF NOT EXISTS idx_payslip_ledger_employee ON public.payslip_ledger(employee_id);

ALTER TABLE public.payslip_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_payslip_ledger" ON public.payslip_ledger;
CREATE POLICY "select_payslip_ledger" ON public.payslip_ledger FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id()
         OR public.has_privilege('payroll.manage')
         OR public.has_privilege('payroll.settings')
         OR public.has_privilege('payroll.payout_read'));

-- ------------------------------------------------------------
-- 7. Nigerian PAYE helper (annual bands, returns monthly tax)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ng_paye_monthly(p_annual_gross numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_rem numeric := GREATEST(COALESCE(p_annual_gross, 0), 0);
  v_tax numeric := 0;
  v_chunk numeric;
BEGIN
  v_chunk := LEAST(v_rem, 300000);      v_tax := v_tax + v_chunk * 0.07; v_rem := v_rem - v_chunk;
  v_chunk := LEAST(v_rem, 300000);      v_tax := v_tax + v_chunk * 0.11; v_rem := v_rem - v_chunk;
  v_chunk := LEAST(v_rem, 500000);      v_tax := v_tax + v_chunk * 0.15; v_rem := v_rem - v_chunk;
  v_chunk := LEAST(v_rem, 500000);      v_tax := v_tax + v_chunk * 0.19; v_rem := v_rem - v_chunk;
  v_chunk := LEAST(v_rem, 1600000);     v_tax := v_tax + v_chunk * 0.21; v_rem := v_rem - v_chunk;
  v_tax := v_tax + GREATEST(v_rem, 0) * 0.24;
  RETURN round(v_tax / 12, 2);
END;
$$;

-- ------------------------------------------------------------
-- 8. Payroll calculation engine (timecard-aware + statutory components)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._payroll_calc_for(
  p_employee_id uuid,
  p_period_start date,
  p_period_end date,
  p_tax_rate numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_monthly_salary numeric := 0;
  v_name text;
  v_department text;
  v_working_days integer := 0;
  v_unpaid_days integer := 0;
  v_gross_base numeric := 0;
  v_earnings jsonb := '[]'::jsonb;
  v_deductions jsonb := '[]'::jsonb;
  v_employer jsonb := '[]'::jsonb;
  v_earnings_total numeric := 0;
  v_deductions_total numeric := 0;
  v_employer_total numeric := 0;
  v_bonus jsonb;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_adj record;
  v_comp record;
  v_amt numeric;
  v_pension_enabled boolean := false;
  v_nsitf_enabled boolean := false;
  v_tax_enabled boolean := true;
  v_mode text := 'DAYS';
  v_hours_per_day numeric := 8;
  v_timecard_days integer := 0;
  v_worked_hours numeric := 0;
  v_expected_hours numeric := 0;
  v_basic numeric := 0;
  v_pen_emp_rate numeric := 8;
  v_pen_er_rate numeric := 10;
  v_nsitf_rate numeric := 1;
  v_tax_override numeric := NULL;
BEGIN
  SELECT COALESCE(NULLIF(e.annual_salary, 0) / 12, e.monthly_salary, 0),
         COALESCE(e.first_name || ' ' || e.last_name, ''),
         COALESCE(d.name, 'Unassigned'),
         COALESCE(e.pension_enabled, false),
         COALESCE(e.nsitf_enabled, false),
         COALESCE(e.tax_enabled, true)
    INTO v_monthly_salary, v_name, v_department,
         v_pension_enabled, v_nsitf_enabled, v_tax_enabled
    FROM public.employees e
    LEFT JOIN public.departments d ON d.id = e.department_id
   WHERE e.id = p_employee_id;

  SELECT COALESCE(value #>> '{}', 'DAYS') INTO v_mode
    FROM public.system_settings
   WHERE group_name = 'payroll' AND key = 'timecard_calc_mode'
   LIMIT 1;
  v_mode := UPPER(COALESCE(v_mode, 'DAYS'));

  SELECT COALESCE((value #>> '{}')::numeric, 8) INTO v_hours_per_day
    FROM public.system_settings
   WHERE group_name = 'payroll' AND key = 'hours_per_day'
   LIMIT 1;

  -- Editable statutory rates come from the locked system pay components
  SELECT
    COALESCE(MAX(CASE WHEN system_key = 'PENSION_EMP' THEN CASE WHEN is_active THEN COALESCE(amount, 8) ELSE 0 END END), 8),
    COALESCE(MAX(CASE WHEN system_key = 'PENSION_ER'  THEN CASE WHEN is_active THEN COALESCE(amount, 10) ELSE 0 END END), 10),
    COALESCE(MAX(CASE WHEN system_key = 'NSITF'       THEN CASE WHEN is_active THEN COALESCE(amount, 1) ELSE 0 END END), 1),
    MAX(CASE WHEN system_key = 'TAX_PAYE' AND is_active AND calculation_type = 'PERCENTAGE' THEN amount END)
    INTO v_pen_emp_rate, v_pen_er_rate, v_nsitf_rate, v_tax_override
    FROM public.pay_components
   WHERE is_system;

  v_working_days := (
    SELECT count(*)::int
      FROM generate_series(p_period_start, p_period_end, interval '1 day') AS g(dt)
     WHERE extract(isodow FROM g.dt) < 6
       AND g.dt::date NOT IN (SELECT holiday_date FROM public.holidays)
  );

  v_unpaid_days := (
    SELECT COALESCE(sum(
              (LEAST(lr.end_date, p_period_end) - GREATEST(lr.start_date, p_period_start) + 1)::int
            ), 0)::int
      FROM public.leave_requests lr
      JOIN public.leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.employee_id = p_employee_id
       AND lr.status = 'APPROVED'
       AND NOT lt.is_paid
       AND lr.start_date <= p_period_end
       AND lr.end_date >= p_period_start
  );

  -- Timecard aggregates for the period
  SELECT COUNT(*)::int,
         COALESCE(SUM(
           COALESCE(a.work_hours,
             CASE WHEN a.clock_in IS NOT NULL AND a.clock_out IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (a.clock_out - a.clock_in)) / 3600.0
                       - COALESCE(CASE WHEN a.break_start IS NOT NULL AND a.break_end IS NOT NULL
                                       THEN EXTRACT(EPOCH FROM (a.break_end - a.break_start)) / 3600.0
                                       ELSE 0 END, 0)
                  ELSE 0 END)
         ), 0)
    INTO v_timecard_days, v_worked_hours
    FROM public.attendance a
   WHERE a.employee_id = p_employee_id
     AND a.date BETWEEN p_period_start AND p_period_end
     AND a.status IN ('PRESENT','LATE','HALF_DAY','REMOTE','ONSITE');

  IF v_mode = 'HOURS' AND v_timecard_days > 0 AND v_working_days > 0 THEN
    v_expected_hours := GREATEST(v_working_days - v_unpaid_days, 0) * GREATEST(v_hours_per_day, 1);
    IF v_expected_hours > 0 THEN
      v_gross_base := round(LEAST(v_monthly_salary, v_monthly_salary * v_worked_hours / v_expected_hours), 2);
    ELSE
      v_gross_base := v_monthly_salary;
    END IF;
  ELSIF v_mode = 'DAYS' AND v_timecard_days > 0 AND v_working_days > 0 THEN
    v_gross_base := round(
      v_monthly_salary * LEAST(v_timecard_days, GREATEST(v_working_days - v_unpaid_days, 0))::numeric / v_working_days,
      2
    );
  ELSIF v_working_days <= 0 THEN
    v_gross_base := v_monthly_salary;
  ELSE
    v_gross_base := round(
      v_monthly_salary * (v_working_days - v_unpaid_days)::numeric / v_working_days,
      2
    );
  END IF;

  v_basic := v_gross_base;

  -- Explicit payroll adjustments
  FOR v_adj IN
    SELECT adjustment_type, amount, description
      FROM public.payroll_adjustments
     WHERE employee_id = p_employee_id
       AND (effective_start IS NULL OR effective_start <= p_period_end)
       AND (effective_end IS NULL OR effective_end >= p_period_start)
  LOOP
    IF v_adj.adjustment_type = 'EARNING' THEN
      v_earnings := v_earnings || jsonb_build_array(jsonb_build_object(
        'name', COALESCE(v_adj.description, 'Adjustment'), 'amount', v_adj.amount
      ));
      v_earnings_total := v_earnings_total + v_adj.amount;
    ELSE
      v_deductions := v_deductions || jsonb_build_array(jsonb_build_object(
        'name', COALESCE(v_adj.description, 'Adjustment'), 'amount', v_adj.amount
      ));
      v_deductions_total := v_deductions_total + v_adj.amount;
    END IF;
  END LOOP;

  -- Bonuses
  v_bonus := public._bonus_calc_for(p_employee_id, v_monthly_salary, p_period_start, p_period_end);
  v_earnings := v_earnings || COALESCE(v_bonus->'items', '[]'::jsonb);
  v_earnings_total := v_earnings_total + COALESCE((v_bonus->>'total')::numeric, 0);

  -- Non-system pay components (fixed / percentage only)
  FOR v_comp IN
    SELECT id, name, code, component_type, calculation_type, amount
      FROM public.pay_components
     WHERE is_active
       AND NOT is_system
       AND (employee_id IS NULL OR employee_id = p_employee_id)
  LOOP
    IF v_comp.calculation_type = 'FIXED' THEN
      v_amt := COALESCE(v_comp.amount, 0);
    ELSIF v_comp.calculation_type = 'PERCENTAGE' THEN
      v_amt := round((v_gross_base + v_earnings_total) * COALESCE(v_comp.amount, 0) / 100, 2);
    ELSE
      v_amt := 0;
    END IF;

    IF v_amt <> 0 THEN
      IF v_comp.component_type = 'EARNING' THEN
        v_earnings := v_earnings || jsonb_build_array(jsonb_build_object('name', v_comp.name, 'amount', v_amt));
        v_earnings_total := v_earnings_total + v_amt;
      ELSIF v_comp.component_type IN ('DEDUCTION','TAX') THEN
        v_deductions := v_deductions || jsonb_build_array(jsonb_build_object('name', v_comp.name, 'amount', v_amt));
        v_deductions_total := v_deductions_total + v_amt;
      ELSE
        v_employer := v_employer || jsonb_build_array(jsonb_build_object('name', v_comp.name, 'amount', v_amt));
        v_employer_total := v_employer_total + v_amt;
      END IF;
    END IF;
  END LOOP;

  v_gross := round(v_gross_base + v_earnings_total, 2);

  -- Statutory: Pension (employee deduction + employer contribution)
  IF v_pension_enabled THEN
    v_amt := round(v_basic * COALESCE(v_pen_emp_rate, 0) / 100, 2);
    IF v_amt > 0 THEN
      v_deductions := v_deductions || jsonb_build_array(jsonb_build_object('name', 'Pension — Employee', 'amount', v_amt));
      v_deductions_total := v_deductions_total + v_amt;
    END IF;
    v_amt := round(v_basic * COALESCE(v_pen_er_rate, 0) / 100, 2);
    IF v_amt > 0 THEN
      v_employer := v_employer || jsonb_build_array(jsonb_build_object('name', 'Pension — Employer', 'amount', v_amt));
      v_employer_total := v_employer_total + v_amt;
    END IF;
  END IF;

  -- Statutory: NSITF (employer contribution, not deducted from employee)
  IF v_nsitf_enabled THEN
    v_amt := round(v_gross * COALESCE(v_nsitf_rate, 0) / 100, 2);
    IF v_amt > 0 THEN
      v_employer := v_employer || jsonb_build_array(jsonb_build_object('name', 'NSITF — Employer', 'amount', v_amt));
      v_employer_total := v_employer_total + v_amt;
    END IF;
  END IF;

  -- Statutory: PAYE (percent override when configured, otherwise Nigerian bands)
  IF v_tax_enabled AND v_gross > 0 THEN
    IF v_tax_override IS NOT NULL THEN
      v_tax := round(v_gross * v_tax_override / 100, 2);
    ELSE
      v_tax := public._ng_paye_monthly(v_gross * 12);
    END IF;
    IF v_tax > 0 THEN
      v_deductions := v_deductions || jsonb_build_array(jsonb_build_object('name', 'PAYE Tax', 'amount', v_tax));
      v_deductions_total := v_deductions_total + v_tax;
    END IF;
  END IF;

  v_deductions_total := round(v_deductions_total, 2);
  v_employer_total := round(v_employer_total, 2);
  v_net := round(v_gross - v_deductions_total, 2);

  RETURN jsonb_build_object(
    'employee_id',      p_employee_id,
    'name',             v_name,
    'department',       v_department,
    'monthly_salary',   v_monthly_salary,
    'working_days',     v_working_days,
    'unpaid_days',      v_unpaid_days,
    'gross',            v_gross,
    'tax',              v_tax,
    'earnings_total',   v_earnings_total,
    'deductions_total', v_deductions_total,
    'net',              v_net,
    'bonus_total',      COALESCE((v_bonus->>'total')::numeric, 0),
    'earnings',         v_earnings,
    'deductions',       v_deductions,
    'employer_total',   v_employer_total,
    'employer_contributions', v_employer,
    'basic',            v_basic,
    'timecard_days',    v_timecard_days,
    'worked_hours',     round(v_worked_hours, 2),
    'timecard_mode',    v_mode
  );
END;
$$;

-- ------------------------------------------------------------
-- 9. generate_payroll_run — numbers payslips + writes recorder ledger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_payroll_run(
  p_name text,
  p_period_start date,
  p_period_end date,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_tax_rate numeric;
  v_emp_id uuid;
  v_row jsonb;
  v_payslip_id uuid;
  v_tot_gross numeric := 0;
  v_tot_deductions numeric := 0;
  v_tot_net numeric := 0;
  v_created_count integer := 0;
  v_dup uuid;
BEGIN
  IF NOT public.has_privilege('payroll.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage payroll';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Invalid pay period';
  END IF;

  SELECT id INTO v_dup
    FROM public.payroll_runs
   WHERE pay_period_start = p_period_start AND pay_period_end = p_period_end
     AND status <> 'VOID'
   LIMIT 1;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'A payroll run already exists for this period';
  END IF;

  v_tax_rate := COALESCE(
    (SELECT value::numeric FROM public.system_settings WHERE group_name = 'payroll' AND key = 'tax_rate_pct'),
    10
  );

  INSERT INTO public.payroll_runs (name, pay_period_start, pay_period_end, status, total_gross, total_deductions, total_net)
  VALUES (
    COALESCE(NULLIF(p_name, ''), 'Payroll ' || to_char(p_period_start, 'Mon YYYY')),
    p_period_start, p_period_end, 'DRAFT', 0, 0, 0
  )
  RETURNING id INTO v_run_id;

  FOR v_emp_id IN
    SELECT e.id
      FROM public.employees e
     WHERE e.employment_status NOT IN ('TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED', 'DISABLED')
       AND (p_employee_ids IS NULL OR e.id = ANY (p_employee_ids))
     ORDER BY e.first_name, e.last_name
  LOOP
    v_row := public._payroll_calc_for(v_emp_id, p_period_start, p_period_end, v_tax_rate);

    INSERT INTO public.payslips (
      payroll_run_id, employee_id, period_start, period_end,
      basic_salary, gross_pay, tax_amount, total_deductions, net_pay,
      earnings, deductions, employer_cost, employer_contributions,
      status, generated_at
    ) VALUES (
      v_run_id, v_emp_id, p_period_start, p_period_end,
      (v_row->>'basic')::numeric,
      (v_row->>'gross')::numeric,
      (v_row->>'tax')::numeric,
      (v_row->>'deductions_total')::numeric,
      (v_row->>'net')::numeric,
      COALESCE(v_row->'earnings', '[]'::jsonb),
      COALESCE(v_row->'deductions', '[]'::jsonb),
      COALESCE((v_row->>'employer_total')::numeric, 0),
      COALESCE(v_row->'employer_contributions', '[]'::jsonb),
      'GENERATED', now()
    )
    RETURNING id INTO v_payslip_id;

    -- Recorder keeper ledger
    INSERT INTO public.payslip_ledger (payslip_id, employee_id, entry_type, category, name, amount, created_by)
    VALUES (v_payslip_id, v_emp_id, 'ADDITION', 'BASIC', 'Basic Salary', (v_row->>'basic')::numeric, public.current_employee_id());

    INSERT INTO public.payslip_ledger (payslip_id, employee_id, entry_type, category, name, amount, created_by)
    SELECT v_payslip_id, v_emp_id, 'ADDITION', 'BONUS',
           COALESCE(el->>'name', 'Earning'), COALESCE((el->>'amount')::numeric, 0), public.current_employee_id()
      FROM jsonb_array_elements(COALESCE(v_row->'earnings', '[]'::jsonb)) el
     WHERE COALESCE((el->>'amount')::numeric, 0) <> 0;

    INSERT INTO public.payslip_ledger (payslip_id, employee_id, entry_type, category, name, amount, created_by)
    SELECT v_payslip_id, v_emp_id, 'DEDUCTION',
           CASE
             WHEN dl->>'name' ILIKE 'Pension%' THEN 'PENSION'
             WHEN dl->>'name' ILIKE '%Tax%' THEN 'TAX'
             WHEN dl->>'name' ILIKE '%NSITF%' THEN 'NSITF'
             ELSE 'PAY_COMPONENT'
           END,
           COALESCE(dl->>'name', 'Deduction'), COALESCE((dl->>'amount')::numeric, 0), public.current_employee_id()
      FROM jsonb_array_elements(COALESCE(v_row->'deductions', '[]'::jsonb)) dl
     WHERE COALESCE((dl->>'amount')::numeric, 0) <> 0;

    INSERT INTO public.payslip_ledger (payslip_id, employee_id, entry_type, category, name, amount, created_by)
    SELECT v_payslip_id, v_emp_id, 'EMPLOYER',
           CASE WHEN cl->>'name' ILIKE '%NSITF%' THEN 'NSITF' ELSE 'PENSION' END,
           COALESCE(cl->>'name', 'Employer contribution'), COALESCE((cl->>'amount')::numeric, 0), public.current_employee_id()
      FROM jsonb_array_elements(COALESCE(v_row->'employer_contributions', '[]'::jsonb)) cl
     WHERE COALESCE((cl->>'amount')::numeric, 0) <> 0;

    v_tot_gross      := v_tot_gross + (v_row->>'gross')::numeric;
    v_tot_deductions := v_tot_deductions + (v_row->>'deductions_total')::numeric;
    v_tot_net        := v_tot_net + (v_row->>'net')::numeric;
    v_created_count  := v_created_count + 1;
  END LOOP;

  IF v_created_count = 0 THEN
    DELETE FROM public.payroll_runs WHERE id = v_run_id;
    RAISE EXCEPTION 'No eligible employees for the selected period';
  END IF;

  UPDATE public.payroll_runs
     SET total_gross      = round(v_tot_gross, 2),
         total_deductions = round(v_tot_deductions, 2),
         total_net        = round(v_tot_net, 2)
   WHERE id = v_run_id;

  RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_payroll_run(text, date, date, uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_payroll_run(text, date, date, uuid[]) FROM PUBLIC;
