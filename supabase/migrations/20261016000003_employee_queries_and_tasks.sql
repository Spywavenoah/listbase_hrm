-- Employee queries and assigned tasks.
--
-- Backs the "history" view on an employee's profile: queries raised against
-- them, and tasks assigned to them. Both are visible to the owning employee,
-- their managers and HR.

-- ============================================================
-- 1. Queries
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'GENERAL',
  details text,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'RESPONDED', 'CLOSED')),
  raised_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  response text,
  responded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  responded_at timestamptz,
  raised_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE employee_queries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_employee_queries_employee ON employee_queries(employee_id, raised_at);

DROP POLICY IF EXISTS "select_employee_queries" ON employee_queries;
DROP POLICY IF EXISTS "insert_employee_queries" ON employee_queries;
DROP POLICY IF EXISTS "update_employee_queries" ON employee_queries;
DROP POLICY IF EXISTS "delete_employee_queries" ON employee_queries;
CREATE POLICY "select_employee_queries" ON employee_queries FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id()
         OR public.has_any_privilege(ARRAY['employees.view_all', 'employees.manage', 'admin.settings']));
CREATE POLICY "insert_employee_queries" ON employee_queries FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']));
CREATE POLICY "update_employee_queries" ON employee_queries FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']));
CREATE POLICY "delete_employee_queries" ON employee_queries FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']));

-- ============================================================
-- 2. Tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  due_date date,
  assigned_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE employee_tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_employee_tasks_employee ON employee_tasks(employee_id, created_at);

DROP POLICY IF EXISTS "select_employee_tasks" ON employee_tasks;
DROP POLICY IF EXISTS "insert_employee_tasks" ON employee_tasks;
DROP POLICY IF EXISTS "update_employee_tasks" ON employee_tasks;
DROP POLICY IF EXISTS "delete_employee_tasks" ON employee_tasks;
CREATE POLICY "select_employee_tasks" ON employee_tasks FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id()
         OR public.has_any_privilege(ARRAY['employees.view_all', 'employees.manage', 'admin.settings']));
CREATE POLICY "insert_employee_tasks" ON employee_tasks FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']));
-- The assignee may update their own task (e.g. progress / completion); HR may manage all.
CREATE POLICY "update_employee_tasks" ON employee_tasks FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id()
         OR public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']))
  WITH CHECK (employee_id = public.current_employee_id()
              OR public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']));
CREATE POLICY "delete_employee_tasks" ON employee_tasks FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['employees.manage', 'admin.settings']));
