/*
# Employee Health Metrics

Tracks employee vitals over time (weight, height, blood pressure, heart rate)
so the employee Medical page can chart trends across multiple measurement dates.

1. `employee_health_metrics`
- `employee_id` — owner (matches `employees`)
- `measured_on` — the date the reading was taken (defaults to today)
- `weight_kg` / `height_cm` — body measurements
- `systolic` / `diastolic` / `heart_rate` — vitals
- `notes` — optional context (e.g. fasting, post-workout)

2. Security
- RLS mirrors `employee_medical`: select own row or `employees.view_all`;
  insert/update/delete only own row or `employees.manage`.
*/

CREATE TABLE IF NOT EXISTS employee_health_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  measured_on date NOT NULL DEFAULT CURRENT_DATE,
  weight_kg numeric(5,2),
  height_cm numeric(5,1),
  systolic integer CHECK (systolic IS NULL OR (systolic BETWEEN 30 AND 300)),
  diastolic integer CHECK (diastolic IS NULL OR (diastolic BETWEEN 20 AND 200)),
  heart_rate integer CHECK (heart_rate IS NULL OR (heart_rate BETWEEN 20 AND 300)),
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_health_metrics_employee
  ON employee_health_metrics(employee_id, measured_on);

ALTER TABLE employee_health_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_employee_health_metrics" ON employee_health_metrics;
DROP POLICY IF EXISTS "insert_employee_health_metrics" ON employee_health_metrics;
DROP POLICY IF EXISTS "update_employee_health_metrics" ON employee_health_metrics;
DROP POLICY IF EXISTS "delete_employee_health_metrics" ON employee_health_metrics;

CREATE POLICY "select_employee_health_metrics" ON employee_health_metrics FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.view_all'));

CREATE POLICY "insert_employee_health_metrics" ON employee_health_metrics FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

CREATE POLICY "update_employee_health_metrics" ON employee_health_metrics FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'))
  WITH CHECK (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));

CREATE POLICY "delete_employee_health_metrics" ON employee_health_metrics FOR DELETE TO authenticated
  USING (employee_id = public.current_employee_id() OR public.has_privilege('employees.manage'));