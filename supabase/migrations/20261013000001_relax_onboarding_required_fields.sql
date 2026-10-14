-- ===========================================================================
-- Relax employee onboarding completion requirements.
--
-- Previously an employee could not complete onboarding until a hard-coded
-- set of personal fields existed (phone, date_of_birth, gender, address,
-- city, emergency contact). Non-required detail fields and optional steps
-- should not block the employee from finishing onboarding. Required-ness is
-- now driven solely by the assigned onboarding template
-- (`onboarding_steps.is_required`). Employees with no assigned checklist are
-- considered ready.
--
-- Supersedes the onboarding_ready() body from
-- 20260924000001_hr_employee_lifecycle.sql (section 1).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.onboarding_ready(p_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id) THEN
    RETURN false;
  END IF;

  SELECT COUNT(*) INTO v_open
    FROM employee_onboarding_progress p
    JOIN onboarding_steps s ON s.id = p.step_id
   WHERE p.employee_id = p_employee_id
     AND s.is_required
     AND p.status IN ('PENDING', 'IN_PROGRESS');

  RETURN v_open = 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.onboarding_ready(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.onboarding_ready(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_onboarding(uuid) FROM PUBLIC;