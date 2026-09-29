/*
# Payroll Calculation Engine

Adds what the payroll module needs to *calculate* pay, not just record runs:

1. **`employees.monthly_salary`** — base monthly salary per employee (nullable).
2. **`payroll_adjustments`** — one-off earnings/deductions applied to pay runs
   within an optional effective window (NULL = always applies).
3. **`_payroll_calc_for(...)`** — internal per-employee calculator: gross from
   monthly salary prorated for unpaid leave days over the working calendar
   (weekdays minus holidays), plus earning adjustments, minus a statutory tax
   rate (read from `system_settings`, group `payroll`, key `tax_rate_pct`;
   defaults to 10%) and deduction adjustments.
4. **`payroll_preview(...)`** — read-only preview rows for a period.
5. **`generate_payroll_run(...)`** — computes every eligible payslip and creates
   a `payroll_runs` row + one `payslips` row per employee (atomic).

Security:
- All RPCs are SECURITY DEFINER and gated by `has_privilege('payroll.manage')`.
- `payroll_adjustments` is fully gated behind `payroll.manage`.
- A trigger blocks employees from changing their own compensation/banking
  fields (`monthly_salary`, grade, bank details) — previously allowed by the
  generic "update own row" RLS policy.
*/

-- ============================================================
-- 1. Salary column + adjustments table
-- ============================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_salary numeric DEFAULT 0;

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  adjustment_type text NOT NULL DEFAULT 'EARNING', -- EARNING | DEDUCTION
  amount numeric NOT NULL DEFAULT 0,
  description text,
  effective_start date,
  effective_end date,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_employee ON payroll_adjustments(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_window ON payroll_adjustments(employee_id, effective_start, effective_end);

DROP POLICY IF EXISTS "select_payroll_adjustments" ON payroll_adjustments;
DROP POLICY IF EXISTS "insert_payroll_adjustments" ON payroll_adjustments;
DROP POLICY IF EXISTS "update_payroll_adjustments" ON payroll_adjustments;
DROP POLICY IF EXISTS "delete_payroll_adjustments" ON payroll_adjustments;
CREATE POLICY "select_payroll_adjustments" ON payroll_adjustments FOR SELECT TO authenticated
  USING (public.has_privilege('payroll.manage'));
CREATE POLICY "insert_payroll_adjustments" ON payroll_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "update_payroll_adjustments" ON payroll_adjustments FOR UPDATE TO authenticated
  USING (public.has_privilege('payroll.manage'))
  WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "delete_payroll_adjustments" ON payroll_adjustments FOR DELETE TO authenticated
  USING (public.has_privilege('payroll.manage'));

-- ============================================================
-- 2. Prevent self-service edits to compensation/banking
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_self_service_salary_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
       NEW.monthly_salary IS DISTINCT FROM OLD.monthly_salary
    OR NEW.compensation_grade IS DISTINCT FROM OLD.compensation_grade
    OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
    OR NEW.bank_routing_number IS DISTINCT FROM OLD.bank_routing_number
  ) AND NOT public.has_privilege('employees.manage') THEN
    RAISE EXCEPTION 'Only payroll administrators can change compensation and banking details';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_service_salary_change ON employees;
CREATE TRIGGER trg_prevent_self_service_salary_change
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION public.prevent_self_service_salary_change();

-- ============================================================
-- 3. Per-employee calculator
-- ============================================================
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
  v_earnings_total numeric := 0;
  v_deductions_total numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_adj record;
BEGIN
  SELECT COALESCE(e.monthly_salary, 0),
         COALESCE(e.first_name || ' ' || e.last_name, ''),
         COALESCE(d.name, 'Unassigned')
    INTO v_monthly_salary, v_name, v_department
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.id = p_employee_id;

  v_working_days := (
    SELECT count(*)::int
      FROM generate_series(p_period_start, p_period_end, interval '1 day') AS g(dt)
     WHERE extract(isodow FROM g.dt) < 6
       AND g.dt::date NOT IN (SELECT holiday_date FROM holidays)
  );

  -- Approved days on unpaid leave types overlapping the period
  v_unpaid_days := (
    SELECT COALESCE(sum(
              (LEAST(lr.end_date, p_period_end) - GREATEST(lr.start_date, p_period_start) + 1)::int
            ), 0)::int
      FROM leave_requests lr
      JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.employee_id = p_employee_id
       AND lr.status = 'APPROVED'
       AND NOT lt.is_paid
       AND lr.start_date <= p_period_end
       AND lr.end_date >= p_period_start
  );

  IF v_working_days <= 0 THEN
    v_gross_base := v_monthly_salary;
  ELSE
    v_gross_base := round(
      v_monthly_salary * (v_working_days - v_unpaid_days)::numeric / v_working_days,
      2
    );
  END IF;

  FOR v_adj IN
    SELECT adjustment_type, amount, description
      FROM payroll_adjustments
     WHERE employee_id = p_employee_id
       AND (effective_start IS NULL OR effective_start <= p_period_end)
       AND (effective_end IS NULL OR effective_end >= p_period_start)
  LOOP
    IF v_adj.adjustment_type = 'EARNING' THEN
      v_earnings := v_earnings || jsonb_build_array(jsonb_build_object(
        'name',   COALESCE(v_adj.description, 'Adjustment'),
        'amount', v_adj.amount
      ));
      v_earnings_total := v_earnings_total + v_adj.amount;
    ELSE
      v_deductions := v_deductions || jsonb_build_array(jsonb_build_object(
        'name',   COALESCE(v_adj.description, 'Adjustment'),
        'amount', v_adj.amount
      ));
      v_deductions_total := v_deductions_total + v_adj.amount;
    END IF;
  END LOOP;

  v_gross := round(v_gross_base + v_earnings_total, 2);
  IF v_gross > 0 THEN
    v_tax := round(v_gross * COALESCE(p_tax_rate, 0) / 100, 2);
  END IF;

  IF v_tax > 0 THEN
    v_deductions := v_deductions || jsonb_build_array(jsonb_build_object(
      'name', 'Tax', 'amount', v_tax
    ));
    v_deductions_total := v_deductions_total + v_tax;
  END IF;

  v_deductions_total := round(v_deductions_total, 2);
  v_net := round(v_gross - v_deductions_total, 2);

  RETURN jsonb_build_object(
    'employee_id',     p_employee_id,
    'name',            v_name,
    'department',      v_department,
    'monthly_salary',  v_monthly_salary,
    'working_days',    v_working_days,
    'unpaid_days',     v_unpaid_days,
    'gross',           v_gross,
    'tax',             v_tax,
    'earnings_total',  v_earnings_total,
    'deductions_total',v_deductions_total,
    'net',             v_net,
    'earnings',        v_earnings,
    'deductions',      v_deductions
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._payroll_calc_for(uuid, date, date, numeric) FROM PUBLIC;

-- ============================================================
-- 4. Preview (read-only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.payroll_preview(
  p_period_start date,
  p_period_end date,
  p_employee_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tax_rate numeric;
  v_emp_id uuid;
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_privilege('payroll.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage payroll';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Invalid pay period';
  END IF;

  v_tax_rate := COALESCE(
    (SELECT value::numeric FROM system_settings WHERE group_name = 'payroll' AND key = 'tax_rate_pct'),
    10
  );

  FOR v_emp_id IN
    SELECT e.id
      FROM employees e
     WHERE e.employment_status NOT IN ('TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED')
       AND (p_employee_ids IS NULL OR e.id = ANY (p_employee_ids))
     ORDER BY e.first_name, e.last_name
  LOOP
    v_row := public._payroll_calc_for(v_emp_id, p_period_start, p_period_end, v_tax_rate);
    v_rows := v_rows || jsonb_build_array(v_row);
  END LOOP;

  RETURN v_rows;
END;
$$;

-- ============================================================
-- 5. Generate a payroll run + payslips (atomic)
-- ============================================================
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
    FROM payroll_runs
   WHERE pay_period_start = p_period_start AND pay_period_end = p_period_end
     AND status <> 'VOID'
   LIMIT 1;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'A payroll run already exists for this period';
  END IF;

  v_tax_rate := COALESCE(
    (SELECT value::numeric FROM system_settings WHERE group_name = 'payroll' AND key = 'tax_rate_pct'),
    10
  );

  INSERT INTO payroll_runs (name, pay_period_start, pay_period_end, status, total_gross, total_deductions, total_net)
  VALUES (
    COALESCE(NULLIF(p_name, ''), 'Payroll ' || to_char(p_period_start, 'Mon YYYY')),
    p_period_start,
    p_period_end,
    'DRAFT',
    0, 0, 0
  )
  RETURNING id INTO v_run_id;

  FOR v_emp_id IN
    SELECT e.id
      FROM employees e
     WHERE e.employment_status NOT IN ('TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED')
       AND (p_employee_ids IS NULL OR e.id = ANY (p_employee_ids))
     ORDER BY e.first_name, e.last_name
  LOOP
    v_row := public._payroll_calc_for(v_emp_id, p_period_start, p_period_end, v_tax_rate);

    INSERT INTO payslips (
      payroll_run_id, employee_id, gross_pay, total_deductions, net_pay,
      earnings, deductions, status, generated_at
    ) VALUES (
      v_run_id,
      v_emp_id,
      (v_row->>'gross')::numeric,
      (v_row->>'deductions_total')::numeric,
      (v_row->>'net')::numeric,
      COALESCE(v_row->'earnings', '[]'::jsonb),
      COALESCE(v_row->'deductions', '[]'::jsonb),
      'GENERATED',
      now()
    );

    v_tot_gross      := v_tot_gross + (v_row->>'gross')::numeric;
    v_tot_deductions := v_tot_deductions + (v_row->>'deductions_total')::numeric;
    v_tot_net        := v_tot_net + (v_row->>'net')::numeric;
    v_created_count  := v_created_count + 1;
  END LOOP;

  IF v_created_count = 0 THEN
    DELETE FROM payroll_runs WHERE id = v_run_id;
    RAISE EXCEPTION 'No eligible employees for the selected period';
  END IF;

  UPDATE payroll_runs
     SET total_gross      = round(v_tot_gross, 2),
         total_deductions = round(v_tot_deductions, 2),
         total_net        = round(v_tot_net, 2)
   WHERE id = v_run_id;

  RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_preview(date, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payroll_run(text, date, date, uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.payroll_preview(date, date, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_payroll_run(text, date, date, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_self_service_salary_change() FROM PUBLIC;