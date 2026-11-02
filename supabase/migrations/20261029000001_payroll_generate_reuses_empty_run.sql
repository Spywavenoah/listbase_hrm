-- ============================================================
-- Fix: Generating payslips for a period that already has an
-- empty payroll run used to fail with
--   "A payroll run already exists for this period"
-- leaving the user with a run that has no payslips and no
-- recorder keeper entries.
--
-- Empty runs (no payslips) are now discarded automatically so
-- generation can proceed. Runs that already contain payslips
-- are still protected against duplicates.
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
  v_payslip_id uuid;
  v_tot_gross numeric := 0;
  v_tot_deductions numeric := 0;
  v_tot_net numeric := 0;
  v_created_count integer := 0;
BEGIN
  IF NOT public.has_privilege('payroll.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage payroll';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Invalid pay period';
  END IF;

  -- Only a run that already has payslips blocks generation.
  IF EXISTS (
    SELECT 1
      FROM public.payroll_runs r
      JOIN public.payslips p ON p.payroll_run_id = r.id
     WHERE r.pay_period_start = p_period_start
       AND r.pay_period_end = p_period_end
       AND r.status <> 'VOID'
  ) THEN
    RAISE EXCEPTION 'A payroll run already exists for this period';
  END IF;

  -- Drop abandoned empty runs for this period (e.g. created from the
  -- old "New Run" dialog) so they do not block payslip generation.
  DELETE FROM public.payroll_runs r
   WHERE r.pay_period_start = p_period_start
     AND r.pay_period_end = p_period_end
     AND r.status <> 'VOID'
     AND NOT EXISTS (
       SELECT 1 FROM public.payslips ps WHERE ps.payroll_run_id = r.id
     );

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
