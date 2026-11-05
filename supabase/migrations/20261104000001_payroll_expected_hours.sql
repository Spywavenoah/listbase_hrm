-- ===========================================================================
-- Payroll expected hours for hourly calculation
--
-- 1. Adds a global default expected-hours setting and per-employee overrides
--    (JSONB, so no table/column changes are required).
-- 2. `_payroll_calc_for` resolves expected hours as:
--       employee override -> global default -> working days * hours per day
--    and prorates hourly pay as worked hours / expected hours, capped at the
--    monthly salary.
-- 3. `payroll_preview` now reuses `_payroll_calc_for`, so previews match
--    generated payslips in both DAYS and HOURS modes.
-- ===========================================================================

INSERT INTO public.system_settings (group_name, key, value)
VALUES
  ('payroll', 'default_expected_hours', '176'::jsonb),
  ('payroll', 'employee_expected_hours', '{}'::jsonb)
ON CONFLICT (group_name, key) DO NOTHING;

-- ------------------------------------------------------------
-- Payroll calculation engine (timecard-aware + statutory components)
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
  v_default_expected_hours numeric := 0;
  v_employee_expected_hours numeric := 0;
  v_expected_overrides jsonb;
  v_basic numeric := 0;
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

  -- Expected hours resolution: employee override -> global default ->
  -- working days * hours per day. Stored as JSONB so no DDL is required.
  SELECT COALESCE((value #>> '{}')::numeric, 0) INTO v_default_expected_hours
    FROM public.system_settings
   WHERE group_name = 'payroll' AND key = 'default_expected_hours'
   LIMIT 1;

  SELECT value INTO v_expected_overrides
    FROM public.system_settings
   WHERE group_name = 'payroll' AND key = 'employee_expected_hours'
   LIMIT 1;

  IF v_expected_overrides IS NOT NULL THEN
    IF jsonb_typeof(v_expected_overrides) = 'object' THEN
      v_employee_expected_hours := COALESCE(
        NULLIF(v_expected_overrides->>(p_employee_id::text), '')::numeric,
        0
      );
    ELSIF jsonb_typeof(v_expected_overrides) = 'array' THEN
      SELECT COALESCE(MAX(
               COALESCE(
                 NULLIF(o->>'expected_hours', '')::numeric,
                 NULLIF(o->>'hours', '')::numeric,
                 0
               )
             ), 0)
        INTO v_employee_expected_hours
        FROM jsonb_array_elements(v_expected_overrides) o
       WHERE o->>'employee_id' = p_employee_id::text
          OR o->>'id' = p_employee_id::text;
    END IF;
  END IF;

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
    v_expected_hours := COALESCE(
      NULLIF(v_employee_expected_hours, 0),
      NULLIF(v_default_expected_hours, 0),
      GREATEST(v_working_days - v_unpaid_days, 0)::numeric * GREATEST(v_hours_per_day, 1)
    );
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
    v_amt := round(v_basic * 0.08, 2);
    IF v_amt > 0 THEN
      v_deductions := v_deductions || jsonb_build_array(jsonb_build_object('name', 'Pension — Employee (8%)', 'amount', v_amt));
      v_deductions_total := v_deductions_total + v_amt;
    END IF;
    v_amt := round(v_basic * 0.10, 2);
    IF v_amt > 0 THEN
      v_employer := v_employer || jsonb_build_array(jsonb_build_object('name', 'Pension — Employer (10%)', 'amount', v_amt));
      v_employer_total := v_employer_total + v_amt;
    END IF;
  END IF;

  -- Statutory: NSITF (employer contribution, not deducted from employee)
  IF v_nsitf_enabled THEN
    v_amt := round(v_gross * 0.01, 2);
    IF v_amt > 0 THEN
      v_employer := v_employer || jsonb_build_array(jsonb_build_object('name', 'NSITF — Employer (1%)', 'amount', v_amt));
      v_employer_total := v_employer_total + v_amt;
    END IF;
  END IF;

  -- Statutory: PAYE
  IF v_tax_enabled AND v_gross > 0 THEN
    v_tax := public._ng_paye_monthly(v_gross * 12);
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
    'expected_hours',   round(v_expected_hours, 2),
    'default_expected_hours', v_default_expected_hours,
    'employee_expected_hours', v_employee_expected_hours,
    'timecard_mode',    v_mode
  );
END;
$$;

-- ------------------------------------------------------------
-- Preview reuses the calculation engine so it matches generated payslips.
-- The return type changes, so the function must be dropped first.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payroll_preview(date, date, uuid[]);

CREATE OR REPLACE FUNCTION public.payroll_preview(
  p_period_start date,
  p_period_end date,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  employee_id uuid,
  name text,
  department text,
  monthly_salary numeric,
  working_days integer,
  unpaid_days integer,
  gross numeric,
  tax numeric,
  earnings_total numeric,
  deductions_total numeric,
  net numeric,
  bonus_total numeric,
  earnings jsonb,
  deductions jsonb,
  timecard_days integer,
  worked_hours numeric,
  expected_hours numeric,
  timecard_mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tax_rate numeric := 0.10;
  v_row jsonb;
  v_emp_id uuid;
BEGIN
  IF NOT public.has_privilege('payroll.manage') AND NOT public.has_privilege('payroll.view') THEN
    RAISE EXCEPTION 'Not authorized to preview payroll';
  END IF;

  SELECT COALESCE((value #>> '{}')::numeric, 10)/100 INTO v_tax_rate
  FROM public.system_settings
  WHERE group_name = 'payroll' AND key = 'tax_rate_pct'
  LIMIT 1;
  v_tax_rate := COALESCE(v_tax_rate, 0.10);

  -- Reuse the same calculation the run generator uses so the preview always
  -- matches the generated payslips (including HOURS mode and expected hours).
  FOR v_emp_id IN
    SELECT e.id
      FROM public.employees e
     WHERE e.employment_status IN ('ACTIVE','PROBATION')
       AND (p_employee_ids IS NULL OR e.id = ANY(p_employee_ids))
     ORDER BY e.first_name, e.last_name
  LOOP
    v_row := public._payroll_calc_for(v_emp_id, p_period_start, p_period_end, v_tax_rate);

    employee_id      := (v_row->>'employee_id')::uuid;
    name             := COALESCE(v_row->>'name', '');
    department       := COALESCE(v_row->>'department', 'Unassigned');
    monthly_salary   := COALESCE((v_row->>'monthly_salary')::numeric, 0);
    working_days     := COALESCE((v_row->>'working_days')::int, 0);
    unpaid_days      := COALESCE((v_row->>'unpaid_days')::int, 0);
    gross            := COALESCE((v_row->>'gross')::numeric, 0);
    tax              := COALESCE((v_row->>'tax')::numeric, 0);
    earnings_total   := COALESCE((v_row->>'earnings_total')::numeric, 0);
    deductions_total := COALESCE((v_row->>'deductions_total')::numeric, 0);
    net              := COALESCE((v_row->>'net')::numeric, 0);
    bonus_total      := COALESCE((v_row->>'bonus_total')::numeric, 0);
    earnings         := COALESCE(v_row->'earnings', '[]'::jsonb);
    deductions       := COALESCE(v_row->'deductions', '[]'::jsonb);
    timecard_days    := COALESCE((v_row->>'timecard_days')::int, 0);
    worked_hours     := COALESCE((v_row->>'worked_hours')::numeric, 0);
    expected_hours   := COALESCE((v_row->>'expected_hours')::numeric, 0);
    timecard_mode    := COALESCE(v_row->>'timecard_mode', 'DAYS');

    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_preview(date, date, uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.payroll_preview(date, date, uuid[]) FROM PUBLIC;
