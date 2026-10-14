-- Pay components may target a specific employee (custom, one-off components)
-- in addition to the shared company-wide catalog.

ALTER TABLE pay_components
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_pay_components_employee ON pay_components(employee_id);
