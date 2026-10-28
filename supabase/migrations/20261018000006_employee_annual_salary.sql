-- ============================================================
-- Migration 29 — Annual salary field and payroll uses annual/12
--
-- Adds employees.annual_salary. Payroll preview/generate will derive
-- monthly_salary as annual_salary/12 when present, otherwise use
-- employees.monthly_salary as before.
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS annual_salary numeric;

-- Update payroll preview to compute monthly_salary from annual_salary/12 if available
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
  deductions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tax_rate numeric := 0.10;
BEGIN
  IF NOT public.has_privilege('payroll.manage') AND NOT public.has_privilege('payroll.view') THEN
    RAISE EXCEPTION 'Not authorized to preview payroll';
  END IF;

  SELECT COALESCE((value)::numeric, 10)/100 INTO v_tax_rate
  FROM public.system_settings
  WHERE group_name = 'payroll' AND key = 'tax_rate_pct'
  LIMIT 1;

  RETURN QUERY
  WITH base AS (
    SELECT
      e.id AS employee_id,
      trim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')) AS name,
      d.name AS department,
      COALESCE(e.annual_salary/12, e.monthly_salary, 0) AS monthly_salary,
      GREATEST(1, (p_period_end - p_period_start + 1)) AS period_days,
      (SELECT COUNT(*)::int
         FROM public.holidays h
        WHERE h.holiday_date BETWEEN p_period_start AND p_period_end
          AND h.is_active) AS holidays_in_period
    FROM public.employees e
    LEFT JOIN public.departments d ON d.id = e.department_id
    WHERE e.employment_status IN ('ACTIVE','PROBATION')
      AND (p_employee_ids IS NULL OR e.id = ANY(p_employee_ids))
  ),
  leave_unpaid AS (
    SELECT lr.employee_id, COUNT(*)::int AS unpaid_days
    FROM public.leave_requests lr
    WHERE lr.status = 'APPROVED'
      AND lr.start_date <= p_period_end
      AND lr.end_date >= p_period_start
      AND COALESCE(lr.is_paid, true) = false
    GROUP BY lr.employee_id
  ),
  adj_earn AS (
    SELECT a.employee_id,
           jsonb_agg(jsonb_build_object('name', a.description, 'amount', a.amount)) FILTER (WHERE a.adjustment_type='EARNING') AS items,
           COALESCE(SUM(a.amount) FILTER (WHERE a.adjustment_type='EARNING'), 0) AS total
    FROM public.payroll_adjustments a
    WHERE a.is_active
      AND a.effective_start <= p_period_end
      AND (a.effective_end IS NULL OR a.effective_end >= p_period_start)
    GROUP BY a.employee_id
  ),
  adj_ded AS (
    SELECT a.employee_id,
           jsonb_agg(jsonb_build_object('name', a.description, 'amount', a.amount)) FILTER (WHERE a.adjustment_type='DEDUCTION') AS items,
           COALESCE(SUM(a.amount) FILTER (WHERE a.adjustment_type='DEDUCTION'), 0) AS total
    FROM public.payroll_adjustments a
    WHERE a.is_active
      AND a.effective_start <= p_period_end
      AND (a.effective_end IS NULL OR a.effective_end >= p_period_start)
    GROUP BY a.employee_id
  ),
  bonus AS (
    SELECT b.employee_id, COALESCE(SUM(b.amount), 0) AS total
    FROM public.bonus_master b
    WHERE b.is_active
      AND b.effective_start <= p_period_end
      AND b.effective_end >= p_period_start
    GROUP BY b.employee_id
  )
  SELECT
    base.employee_id,
    base.name,
    base.department,
    base.monthly_salary,
    GREATEST(0, base.period_days - base.holidays_in_period)::int AS working_days,
    COALESCE(leave_unpaid.unpaid_days, 0)::int AS unpaid_days,
    ROUND(base.monthly_salary, 2) AS gross,
    ROUND(base.monthly_salary * v_tax_rate, 2) AS tax,
    ROUND(COALESCE(adj_earn.total,0) + COALESCE(bonus.total,0), 2) AS earnings_total,
    ROUND(COALESCE(adj_ded.total,0), 2) AS deductions_total,
    ROUND(base.monthly_salary + COALESCE(adj_earn.total,0) + COALESCE(bonus.total,0) - (base.monthly_salary * v_tax_rate) - COALESCE(adj_ded.total,0), 2) AS net,
    ROUND(COALESCE(bonus.total,0), 2) AS bonus_total,
    COALESCE(adj_earn.items, '[]'::jsonb) || COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('name', b2.description, 'amount', b2.amount))
         FROM public.bonus_master b2
        WHERE b2.employee_id = base.employee_id
          AND b2.status = 'APPROVED'
          AND b2.payroll_run_id IS NULL
          AND b2.period_start <= p_period_end
          AND b2.period_end >= p_period_start), '[]'::jsonb
    ) AS earnings,
    COALESCE(adj_ded.items, '[]'::jsonb) AS deductions
  FROM base
  LEFT JOIN leave_unpaid ON leave_unpaid.employee_id = base.employee_id
  LEFT JOIN adj_earn ON adj_earn.employee_id = base.employee_id
  LEFT JOIN adj_ded ON adj_ded.employee_id = base.employee_id
  LEFT JOIN bonus ON bonus.employee_id = base.employee_id;
END;
$$;

-- Update generate_payroll_run to use same logic
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
  v_tax_rate numeric := 0.10;
BEGIN
  IF NOT public.has_privilege('payroll.manage') THEN
    RAISE EXCEPTION 'Not authorized to generate payroll runs';
  END IF;

  SELECT COALESCE((value)::numeric, 10)/100 INTO v_tax_rate
  FROM public.system_settings
  WHERE group_name = 'payroll' AND key = 'tax_rate_pct'
  LIMIT 1;

  INSERT INTO public.payroll_runs (name, pay_period_start, pay_period_end, status, created_by)
  VALUES (p_name, p_period_start, p_period_end, 'DRAFT', public.current_employee_id())
  RETURNING id INTO v_run_id;

  INSERT INTO public.payslips (
    payroll_run_id, employee_id, period_start, period_end,
    basic_salary, gross_pay, tax_amount, deductions_total, net_pay,
    earnings_json, deductions_json, status
  )
  SELECT
    v_run_id,
    e.id,
    p_period_start,
    p_period_end,
    COALESCE(e.annual_salary/12, e.monthly_salary, 0),
    COALESCE(e.annual_salary/12, e.monthly_salary, 0) + COALESCE(ae.total,0) + COALESCE(b.total,0),
    COALESCE(e.annual_salary/12, e.monthly_salary, 0) * v_tax_rate,
    COALESCE(ad.total,0),
    COALESCE(e.annual_salary/12, e.monthly_salary, 0) + COALESCE(ae.total,0) + COALESCE(b.total,0) - COALESCE(e.annual_salary/12, e.monthly_salary, 0) * v_tax_rate - COALESCE(ad.total,0),
    COALESCE(ae.items, '[]'::jsonb) || COALESCE(b.items, '[]'::jsonb),
    COALESCE(ad.items, '[]'::jsonb),
    'PENDING'
  FROM public.employees e
  LEFT JOIN (
    SELECT employee_id, SUM(amount) FILTER (WHERE adjustment_type='EARNING') AS total,
           jsonb_agg(jsonb_build_object('name', description, 'amount', amount)) FILTER (WHERE adjustment_type='EARNING') AS items
    FROM public.payroll_adjustments
    WHERE is_active AND effective_start <= p_period_end AND (effective_end IS NULL OR effective_end >= p_period_start)
    GROUP BY employee_id
  ) ae ON ae.employee_id = e.id
  LEFT JOIN (
    SELECT employee_id, SUM(amount) FILTER (WHERE adjustment_type='DEDUCTION') AS total,
           jsonb_agg(jsonb_build_object('name', description, 'amount', amount)) FILTER (WHERE adjustment_type='DEDUCTION') AS items
    FROM public.payroll_adjustments
    WHERE is_active AND effective_start <= p_period_end AND (effective_end IS NULL OR effective_end >= p_period_start)
    GROUP BY employee_id
  ) ad ON ad.employee_id = e.id
  LEFT JOIN (
    SELECT employee_id, SUM(amount) AS total,
           jsonb_agg(jsonb_build_object('name', description, 'amount', amount)) AS items
    FROM public.bonus_master
    WHERE is_active AND effective_start <= p_period_end AND effective_end >= p_period_start
    GROUP BY employee_id
  ) b ON b.employee_id = e.id
  WHERE e.employment_status IN ('ACTIVE','PROBATION')
    AND (p_employee_ids IS NULL OR e.id = ANY(p_employee_ids));

  UPDATE public.bonus_master
  SET is_active = false
  WHERE is_active = true
    AND effective_start <= p_period_end
    AND effective_end >= p_period_start;

  RETURN v_run_id;
END;
$$;
