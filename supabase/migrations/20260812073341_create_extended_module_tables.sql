/*
# Create Extended Module Tables

This migration adds 4 new tables to support sub-routes referenced in the sidebar:

1. **Holidays** — company-wide holiday calendar for the Leave module
2. **Performance Goals** — individual employee goals linked to reviews
3. **Training Courses** — course catalog for the Training module
4. **Training Enrollments** — per-employee course enrollment tracking

All tables have RLS enabled with full CRUD policies for authenticated users,
matching the existing multi-user HR system pattern.
*/

-- Holidays
CREATE TABLE IF NOT EXISTS holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  holiday_date date NOT NULL,
  description text,
  is_recurring boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);
DROP POLICY IF EXISTS "select_holidays" ON holidays;
CREATE POLICY "select_holidays" ON holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_holidays" ON holidays FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_holidays" ON holidays FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_holidays" ON holidays FOR DELETE TO authenticated USING (true);

-- Performance Goals
CREATE TABLE IF NOT EXISTS performance_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  target_date date,
  status text DEFAULT 'IN_PROGRESS',
  progress integer DEFAULT 0,
  review_cycle text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE performance_goals ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_perf_goals_employee ON performance_goals(employee_id);
CREATE INDEX IF NOT EXISTS idx_perf_goals_status ON performance_goals(status);
DROP POLICY IF EXISTS "select_performance_goals" ON performance_goals;
CREATE POLICY "select_performance_goals" ON performance_goals FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_performance_goals" ON performance_goals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_performance_goals" ON performance_goals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_performance_goals" ON performance_goals FOR DELETE TO authenticated USING (true);

-- Training Courses
CREATE TABLE IF NOT EXISTS training_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text,
  description text,
  is_mandatory boolean DEFAULT false,
  duration_hours integer,
  instructor text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE training_courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_training_courses" ON training_courses;
CREATE POLICY "select_training_courses" ON training_courses FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_training_courses" ON training_courses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_training_courses" ON training_courses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_training_courses" ON training_courses FOR DELETE TO authenticated USING (true);

-- Training Enrollments
CREATE TABLE IF NOT EXISTS training_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status text DEFAULT 'ENROLLED',
  enrolled_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  progress integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(course_id, employee_id)
);
ALTER TABLE training_enrollments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_training_enrollments_course ON training_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_employee ON training_enrollments(employee_id);
DROP POLICY IF EXISTS "select_training_enrollments" ON training_enrollments;
CREATE POLICY "select_training_enrollments" ON training_enrollments FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_training_enrollments" ON training_enrollments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_training_enrollments" ON training_enrollments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_training_enrollments" ON training_enrollments FOR DELETE TO authenticated USING (true);