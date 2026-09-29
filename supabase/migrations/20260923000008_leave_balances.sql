/*
# Leave Balances

Catch-up accrual / opening-balance adjustments for leave types.

The engine keeps leaving balance simple: `annual_allocation - used days`.
This table lets administrators grant catch-up accrual (opening balances) or
adjust balances per employee + leave type + year, e.g. balancing prior-period
accruals carried into the current leave year.

- `leave_balances` — one row per (employee, leave type, year).
- RLS mirrors `leave_requests`: employees can read their own balances; only
  `leave.manage` can insert/update/delete.
*/

CREATE TABLE IF NOT EXISTS leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year integer NOT NULL DEFAULT date_part('year', CURRENT_DATE)::int,
  opening_balance numeric NOT NULL DEFAULT 0,
  note text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT leave_balances_unique_employee_type_year UNIQUE (employee_id, leave_type_id, year)
);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_type ON leave_balances(leave_type_id);

DROP POLICY IF EXISTS "select_leave_balances" ON leave_balances;
DROP POLICY IF EXISTS "insert_leave_balances" ON leave_balances;
DROP POLICY IF EXISTS "update_leave_balances" ON leave_balances;
DROP POLICY IF EXISTS "delete_leave_balances" ON leave_balances;

CREATE POLICY "select_leave_balances" ON leave_balances FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('leave.manage'));

CREATE POLICY "insert_leave_balances" ON leave_balances FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('leave.manage'));

CREATE POLICY "update_leave_balances" ON leave_balances FOR UPDATE TO authenticated
  USING (public.has_privilege('leave.manage'))
  WITH CHECK (public.has_privilege('leave.manage'));

CREATE POLICY "delete_leave_balances" ON leave_balances FOR DELETE TO authenticated
  USING (public.has_privilege('leave.manage'));

-- Current effective balance for one employee + leave type + year,
-- including the catch-up opening balance. Used by the API layer.
CREATE OR REPLACE FUNCTION public.leave_balance_for(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_year integer
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(lt.annual_allocation, 0)
       + COALESCE((
           SELECT lb.opening_balance
             FROM leave_balances lb
            WHERE lb.employee_id = p_employee_id
              AND lb.leave_type_id = p_leave_type_id
              AND lb.year = p_year
         ), 0)
       - COALESCE((
           SELECT sum(GREATEST((LEAST(lr.end_date, make_date(p_year, 12, 31))
                     - GREATEST(lr.start_date, make_date(p_year, 1, 1)) + 1), 0))
             FROM leave_requests lr
            WHERE lr.employee_id = p_employee_id
              AND lr.leave_type_id = p_leave_type_id
              AND lr.status = 'APPROVED'
              AND lr.start_date <= make_date(p_year, 12, 31)
              AND lr.end_date >= make_date(p_year, 1, 1)
         ), 0)
    FROM leave_types lt
   WHERE lt.id = p_leave_type_id;
$$;

REVOKE ALL ON FUNCTION public.leave_balance_for(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_balance_for(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.leave_balance_for(uuid, uuid, integer) FROM authenticated;