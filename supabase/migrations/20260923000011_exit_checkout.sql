/*
# Entry / Exit Checkout Tracking

Full offboarding checkpoint for equipment, credentials, access, clearance and
exit interviews, plus hire/exit date overrides.

1. `employee_exit_checkouts` — one record per (departing) employee with exit
   type, exit date override, last working day override, reason, interview flag.
2. `exit_checklist_items` — itemized clearance checklist. A trigger seeds the
   standard defaults (equipment, ID badge, credentials, system access, email
   inbox handover, department clearance, exit interview, final pay).
3. Security — read gated to `employees.view_all`/`employees.manage` (or self);
   write gated to `employees.manage` only, mirroring the employee detail tabs.

"Entry" tracking remains the onboarding pipeline (onboarding_templates /
employee_onboarding_progress); this migration adds the symmetric exit path.
*/

-- ============================================================
-- 1. Exit checkout master
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_exit_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  exit_type text,                       -- VOLUNTARY | INVOLUNTARY | RETIREMENT | LAYOFF | OTHER
  exit_date date,                       -- actual exit / override
  last_working_day date,                -- override of the computed last day
  reason text,
  rehire_eligible boolean DEFAULT true,
  interview_completed boolean DEFAULT false,
  interview_notes text,
  status text NOT NULL DEFAULT 'PENDING', -- PENDING | IN_PROGRESS | COMPLETED
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE employee_exit_checkouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_employee_exit_checkouts" ON employee_exit_checkouts;
DROP POLICY IF EXISTS "insert_employee_exit_checkouts" ON employee_exit_checkouts;
DROP POLICY IF EXISTS "update_employee_exit_checkouts" ON employee_exit_checkouts;
DROP POLICY IF EXISTS "delete_employee_exit_checkouts" ON employee_exit_checkouts;

CREATE POLICY "select_employee_exit_checkouts" ON employee_exit_checkouts FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id()
         OR public.has_privilege('employees.view_all')
         OR public.has_privilege('employees.manage'));

CREATE POLICY "insert_employee_exit_checkouts" ON employee_exit_checkouts FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('employees.manage'));

CREATE POLICY "update_employee_exit_checkouts" ON employee_exit_checkouts FOR UPDATE TO authenticated
  USING (public.has_privilege('employees.manage'))
  WITH CHECK (public.has_privilege('employees.manage'));

CREATE POLICY "delete_employee_exit_checkouts" ON employee_exit_checkouts FOR DELETE TO authenticated
  USING (public.has_privilege('employees.manage'));

-- ============================================================
-- 2. Checkout checklist items
-- ============================================================
CREATE TABLE IF NOT EXISTS exit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id uuid NOT NULL REFERENCES employee_exit_checkouts(id) ON DELETE CASCADE,
  item_key text NOT NULL,               -- EQUIPMENT | ID_BADGE | CREDENTIALS | ACCESS | EMAIL_INBOX | CLEARANCE | EXIT_INTERVIEW | FINAL_PAY
  is_cleared boolean NOT NULL DEFAULT false,
  cleared_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  cleared_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (checkout_id, item_key)
);

ALTER TABLE exit_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_exit_checklist_items" ON exit_checklist_items;
DROP POLICY IF EXISTS "insert_exit_checklist_items" ON exit_checklist_items;
DROP POLICY IF EXISTS "update_exit_checklist_items" ON exit_checklist_items;
DROP POLICY IF EXISTS "delete_exit_checklist_items" ON exit_checklist_items;

CREATE POLICY "select_exit_checklist_items" ON exit_checklist_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id
       AND (c.employee_id = public.current_employee_id()
            OR public.has_privilege('employees.view_all')
            OR public.has_privilege('employees.manage'))
  ));

CREATE POLICY "insert_exit_checklist_items" ON exit_checklist_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id AND public.has_privilege('employees.manage')
  ));

CREATE POLICY "update_exit_checklist_items" ON exit_checklist_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id AND public.has_privilege('employees.manage')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id AND public.has_privilege('employees.manage')
  ));

CREATE POLICY "delete_exit_checklist_items" ON exit_checklist_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employee_exit_checkouts c
     WHERE c.id = checkout_id AND public.has_privilege('employees.manage')
  ));

-- ============================================================
-- 3. Seed default checklist on new checkout
-- ============================================================
CREATE OR REPLACE FUNCTION public._seed_exit_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.exit_checklist_items (checkout_id, item_key) VALUES
    (NEW.id, 'EQUIPMENT'),
    (NEW.id, 'ID_BADGE'),
    (NEW.id, 'CREDENTIALS'),
    (NEW.id, 'ACCESS'),
    (NEW.id, 'EMAIL_INBOX'),
    (NEW.id, 'CLEARANCE'),
    (NEW.id, 'EXIT_INTERVIEW'),
    (NEW.id, 'FINAL_PAY');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_exit_checklist ON employee_exit_checkouts;
CREATE TRIGGER trg_seed_exit_checklist
  AFTER INSERT ON employee_exit_checkouts
  FOR EACH ROW
  EXECUTE FUNCTION public._seed_exit_checklist();