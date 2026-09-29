/*
# Bonus Master

Salary-level bonus overrides that the payroll calculator applies on top of the
base monthly salary when generating payslips.

1. `bonus_master`
- `employee_id` nullable: NULL = applies to ALL employees, otherwise a specific
  employee's salary-level bonus.
- `rate_type`FIXED` (flat amount) or `PERCENTAGE` (of the employee's
  `monthly_salary`).
- `effective_start` / `effective_end` window (NULL = always active).
- `is_active` toggle so bonuses can be suspended without deleting history.

2. Integration
- `_bonus_calc_for(...)` returns the matching bonus lines + total for one
  employee within a pay period.
- `_payroll_calc_for(...)` folds those earnings into gross, so `payroll_preview`
  and `generate_payroll_run` include bonuses automatically.

3. Security
- RLS fully gated by `payroll.manage`.
- Internal helpers are STABLE and not exposed to the API (PUBLIC revoked).
*/

-- ============================================================
-- 1. Bonus master table
-- ============================================================
CREATE TABLE IF NOT EXISTS bonus_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  rate_type text NOT NULL DEFAULT 'FIXED', -- FIXED | PERCENTAGE
  amount numeric NOT NULL DEFAULT 0,
  effective_start date,
  effective_end date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bonus_master ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bonus_master_employee ON bonus_master(employee_id);
CREATE INDEX IF NOT EXISTS idx_bonus_master_window ON bonus_master(employee_id, effective_start, effective_end);

DROP POLICY IF EXISTS "select_bonus_master" ON bonus_master;
DROP POLICY IF EXISTS "insert_bonus_master" ON bonus_master;
DROP POLICY IF EXISTS "update_bonus_master" ON bonus_master;
DROP POLICY IF EXISTS "delete_bonus_master" ON bonus_master;

CREATE POLICY "select_bonus_master" ON bonus_master FOR SELECT TO authenticated
  USING (public.has_privilege('payroll.manage'));
CREATE POLICY "insert_bonus_master" ON bonus_master FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "update_bonus_master" ON bonus_master FOR UPDATE TO authenticated
  USING (public.has_privilege('payroll.manage'))
  WITH CHECK (public.has_privilege('payroll.manage'));
CREATE POLICY "delete_bonus_master" ON bonus_master FOR DELETE TO authenticated
  USING (public.has_privilege('payroll.manage'));

-- ============================================================
-- 2. Per-employee bonus calculator (internal)
-- ============================================================
CREATE OR REPLACE FUNCTION public._bonus_calc_for(
  p_employee_id uuid,
  p_monthly_salary numeric,
  p_period_start date,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_bonus record;
  v_line_amount numeric;
BEGIN
  FOR v_bonus IN
    SELECT b.id, b.name, b.rate_type, b.amount
      FROM bonus_master b
     WHERE b.is_active
       AND (b.employee_id = p_employee_id OR b.employee_id IS NULL)
       AND (b.effective_start IS NULL OR b.effective_start <= p_period_end)
       AND (b.effective_end IS NULL OR b.effective_end >= p_period_start)
     ORDER BY b.name, b.created_at
  LOOP
    IF v_bonus.rate_type = 'PERCENTAGE' THEN
      v_line_amount := round(
        COALESCE(p_monthly_salary, 0) * COALESCE(v_bonus.amount, 0) / 100,
        2
      );
    ELSE
      v_line_amount := COALESCE(v_bonus.amount, 0);
    END IF;

    IF v_line_amount <> 0 THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'name',   v_bonus.name,
        'amount', v_line_amount
      ));
      v_total := v_total + v_line_amount;
    END IF;
  END LOOP;

  v_total := round(v_total, 2);

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._bonus_calc_for(uuid, numeric, date, date) FROM PUBLIC;

-- ============================================================
-- 3. Fold bonuses into the payroll calculator
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
  v_bonus jsonb;
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

  -- Salary-level bonuses (global + employee-specific)
  v_bonus := public._bonus_calc_for(p_employee_id, v_monthly_salary, p_period_start, p_period_end);
  v_earnings := v_earnings || COALESCE(v_bonus->'items', '[]'::jsonb);
  v_earnings_total := v_earnings_total + COALESCE((v_bonus->>'total')::numeric, 0);

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
    'bonus_total',     COALESCE((v_bonus->>'total')::numeric, 0),
    'earnings',        v_earnings,
    'deductions',      v_deductions
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._payroll_calc_for(uuid, date, date, numeric) FROM PUBLIC;