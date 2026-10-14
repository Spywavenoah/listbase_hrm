-- Expense retirement now updates the ORIGINAL claim instead of creating a new
-- RETIREMENT entry. Retiring appends the receipt (already stored on the claim),
-- the actual amount spent and the difference from the amount requested, and
-- flips the claim's retirement_status to RETIRED.

-- 1. Columns that capture the retirement reconciliation.
ALTER TABLE expense_claims
  ADD COLUMN IF NOT EXISTS actual_amount_spent numeric,
  ADD COLUMN IF NOT EXISTS amount_difference numeric,
  ADD COLUMN IF NOT EXISTS retirement_status text NOT NULL DEFAULT 'PENDING';

ALTER TABLE expense_claims
  DROP CONSTRAINT IF EXISTS expense_claims_retirement_status_check;
ALTER TABLE expense_claims
  ADD CONSTRAINT expense_claims_retirement_status_check
  CHECK (retirement_status IN ('PENDING', 'RETIRED'));

-- Backfill: anything already retired is marked retired on the claim itself.
UPDATE expense_claims
   SET retirement_status = 'RETIRED',
       amount_difference = COALESCE(amount_difference, amount - COALESCE(actual_amount_spent, 0))
 WHERE status = 'RETIRED';

-- 2. Copy the requested amount into actual_amount_spent when the claim is
--    approved (a sensible starting point the retiree then corrects).
CREATE OR REPLACE FUNCTION public.guard_expense_claim_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('APPROVED', 'REJECTED', 'RETIRED') AND v_actor = OLD.requested_by THEN
      RAISE EXCEPTION 'You cannot approve, reject or retire a claim you raised';
    END IF;

    IF NEW.status IN ('APPROVED', 'REJECTED') THEN
      IF NOT public.has_any_privilege(ARRAY['expense.manage', 'expense.approve']) THEN
        RAISE EXCEPTION 'You need expense.manage or expense.approve to approve or reject expense claims';
      END IF;
    END IF;

    IF NEW.status = 'RETIRED' THEN
      IF OLD.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Only approved claims can be retired';
      END IF;
      IF COALESCE(NEW.proof_path, '') = '' THEN
        RAISE EXCEPTION 'A proof / invoice attachment is required to retire an expense claim';
      END IF;
      IF NEW.actual_amount_spent IS NULL OR NEW.actual_amount_spent < 0 THEN
        RAISE EXCEPTION 'Enter the actual amount spent from the receipt';
      END IF;
      IF NOT public.has_any_privilege(ARRAY['expense.manage', 'expense.approve']) THEN
        RAISE EXCEPTION 'You need expense.manage or expense.approve to retire an expense claim';
      END IF;
      NEW.retirement_status := 'RETIRED';
      NEW.amount_difference := NEW.amount - NEW.actual_amount_spent;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_claim_status ON expense_claims;
CREATE TRIGGER trg_guard_expense_claim_status
BEFORE UPDATE ON expense_claims
FOR EACH ROW EXECUTE FUNCTION public.guard_expense_claim_status();

-- 3. RPC: add p_actual_amount and record it on retirement.
DROP FUNCTION IF EXISTS public.approve_expense_claim(uuid, text, text);

CREATE OR REPLACE FUNCTION public.approve_expense_claim(
  p_claim_id uuid,
  p_action text,
  p_note text DEFAULT NULL,
  p_actual_amount numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
  v_claim expense_claims%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;

  IF p_action NOT IN ('APPROVE', 'REJECT', 'RETIRE') THEN
    RAISE EXCEPTION 'Invalid action (APPROVE, REJECT or RETIRE expected)';
  END IF;

  IF NOT (public.has_privilege('expense.manage') OR public.has_privilege('expense.approve')) THEN
    RAISE EXCEPTION 'You need expense.manage or expense.approve to act on expense claims';
  END IF;

  SELECT * INTO v_claim FROM expense_claims WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense claim not found';
  END IF;

  IF v_actor = v_claim.requested_by THEN
    RAISE EXCEPTION 'You cannot approve, reject or retire a claim you raised';
  END IF;

  IF p_action = 'RETIRE' THEN
    IF v_claim.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Only approved claims can be retired';
    END IF;
    IF COALESCE(v_claim.proof_path, '') = '' THEN
      RAISE EXCEPTION 'A proof / invoice attachment is required to retire an expense claim';
    END IF;
    IF p_actual_amount IS NULL OR p_actual_amount < 0 THEN
      RAISE EXCEPTION 'Enter the actual amount spent from the receipt';
    END IF;
    UPDATE expense_claims
       SET status = 'RETIRED',
           retirement_status = 'RETIRED',
           actual_amount_spent = p_actual_amount,
           amount_difference = v_claim.amount - p_actual_amount,
           retired_by = v_actor, retired_at = now(),
           notes = COALESCE(p_note, notes), updated_at = now()
     WHERE id = v_claim.id;
  ELSIF p_action = 'APPROVE' THEN
    IF v_claim.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Only pending claims can be approved';
    END IF;
    UPDATE expense_claims
       SET status = 'APPROVED', approved_by = v_actor, approved_at = now(),
           notes = COALESCE(p_note, notes), updated_at = now()
     WHERE id = v_claim.id;
  ELSE
    IF v_claim.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Only pending claims can be rejected';
    END IF;
    UPDATE expense_claims
       SET status = 'REJECTED', rejected_by = v_actor, rejected_at = now(),
           notes = COALESCE(p_note, notes), updated_at = now()
     WHERE id = v_claim.id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_expense_claim(uuid, text, text, numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_expense_claim(uuid, text, text, numeric) FROM PUBLIC;