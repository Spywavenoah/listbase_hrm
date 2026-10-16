/*
# Projects & offshore workforce management

Adds a Projects module covering project setup, workforce deployment and
offshore allowance administration.

 1. `projects`             — project register: name, code (auto PRJ-00001),
                             client, description, **location name + latitude /
                             longitude**, offshore flag, window and status.
 2. `project_workforce`    — the interval register that is the source of truth
                             for offshore days: one row per employee per project
                             with `start_date` and an optional `end_date`
                             (NULL = still deployed).
                             Populated two ways:
                               • APPEND  — add extra employee to the workforce
                               • SHUFFLE — a replacement, written alongside a
                                           `project_shuffles` entry.
 3. `project_shuffles`     — audit trail of every shuffle. Each entry records the
                             start + end date of the employee being replaced and
                             the start date of the employee taking over.
 4. `offshore_allowances`  — offshore allowance setup: a **per-day amount**,
                             optionally scoped to one project (NULL = the default
                             for every project), effective-dated so rates can be
                             changed over time.
 5. `project_offshore_report(p_from, p_to, p_project_id, p_employee_id)`
                           — RPC used by the reports menu. Expands every offshore
                             deployment into individual calendar days inside the
                             requested time frame, resolves the allowance amount
                             that was in force on each day (project-specific rate
                             wins over the default), then returns:
                               • offshore days per employee per project
                               • offshore allowance (days x rate) per employee
                                 per project
                             Roll-ups "per employee" and "per project" are simple
                             sums of these rows.

New privileges: `projects.view`, `projects.manage`, `projects.allowance`.
*/

-- ============================================================
-- 1. Privilege catalog entries
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('projects.view',      'Projects', 'View projects & reports',         'Read projects, workforce deployments and offshore reports', 140),
  ('projects.manage',    'Projects', 'Manage projects & workforce',     'Create projects, maintain their location and shuffle or append workforce', 142),
  ('projects.allowance', 'Projects', 'Manage offshore allowance setup', 'Configure offshore allowance rates and their effective periods', 144)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. Projects
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  name text NOT NULL,
  description text,
  client_name text,
  location_name text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_offshore boolean NOT NULL DEFAULT true,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'PLANNING',
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT projects_status_check
    CHECK (status IN ('PLANNING','ACTIVE','ON_HOLD','COMPLETED','CLOSED')),
  CONSTRAINT projects_dates_check
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT projects_coords_check CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_code ON projects (lower(code));
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_offshore ON projects (is_offshore);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Project workforce (start / end intervals)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_workforce (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role text,
  start_date date NOT NULL,
  end_date date,
  source text NOT NULL DEFAULT 'APPEND',
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT project_workforce_source_check
    CHECK (source IN ('APPEND','SHUFFLE','INITIAL')),
  CONSTRAINT project_workforce_dates_check
    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_project_workforce_project ON project_workforce (project_id);
CREATE INDEX IF NOT EXISTS idx_project_workforce_employee ON project_workforce (employee_id);
CREATE INDEX IF NOT EXISTS idx_project_workforce_active
  ON project_workforce (project_id, employee_id) WHERE end_date IS NULL;

ALTER TABLE project_workforce ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Workforce shuffle history
-- ============================================================
CREATE TABLE IF NOT EXISTS project_shuffles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  replaced_workforce_id uuid REFERENCES project_workforce(id) ON DELETE SET NULL,
  replaced_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  replace_start_date date NOT NULL,
  replace_end_date date NOT NULL,
  new_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  new_workforce_id uuid REFERENCES project_workforce(id) ON DELETE SET NULL,
  new_start_date date NOT NULL,
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT project_shuffles_replace_dates_check
    CHECK (replace_end_date >= replace_start_date)
);

CREATE INDEX IF NOT EXISTS idx_project_shuffles_project ON project_shuffles (project_id);
CREATE INDEX IF NOT EXISTS idx_project_shuffles_replaced ON project_shuffles (replaced_employee_id);
CREATE INDEX IF NOT EXISTS idx_project_shuffles_new ON project_shuffles (new_employee_id);

ALTER TABLE project_shuffles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. Offshore allowance setup
-- ============================================================
CREATE TABLE IF NOT EXISTS offshore_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric(16,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT offshore_allowances_amount_check CHECK (amount >= 0),
  CONSTRAINT offshore_allowances_dates_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_offshore_allowances_project ON offshore_allowances (project_id);
CREATE INDEX IF NOT EXISTS idx_offshore_allowances_active
  ON offshore_allowances (is_active, effective_from);

ALTER TABLE offshore_allowances ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_projects_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_projects ON projects;
CREATE TRIGGER trg_touch_projects BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION public.touch_projects_updated_at();

DROP TRIGGER IF EXISTS trg_touch_project_workforce ON project_workforce;
CREATE TRIGGER trg_touch_project_workforce BEFORE UPDATE ON project_workforce
FOR EACH ROW EXECUTE FUNCTION public.touch_projects_updated_at();

DROP TRIGGER IF EXISTS trg_touch_offshore_allowances ON offshore_allowances;
CREATE TRIGGER trg_touch_offshore_allowances BEFORE UPDATE ON offshore_allowances
FOR EACH ROW EXECUTE FUNCTION public.touch_projects_updated_at();

-- ============================================================
-- 7. Auto project code (PRJ-00001)
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS project_code_seq;

CREATE OR REPLACE FUNCTION public.generate_project_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_next bigint;
  v_code text;
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    LOOP
      v_next := nextval('project_code_seq');
      v_code := 'PRJ-' || lpad(v_next::text, 5, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM projects WHERE code = v_code);
    END LOOP;
    NEW.code := v_code;
  ELSE
    NEW.code := upper(btrim(NEW.code));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_project_code ON projects;
CREATE TRIGGER trg_generate_project_code BEFORE INSERT ON projects
FOR EACH ROW EXECUTE FUNCTION public.generate_project_code();

-- ============================================================
-- 8. Offshore days + offshore allowance report
-- ============================================================
CREATE OR REPLACE FUNCTION public.project_offshore_report(
  p_from date,
  p_to date,
  p_project_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL
)
RETURNS TABLE (
  employee_id uuid,
  employee_name text,
  project_id uuid,
  project_code text,
  project_name text,
  offshore_days integer,
  allowance_amount numeric,
  currency text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH range_days AS (
    -- every calendar day in the requested time frame
    SELECT generate_series(
             COALESCE(p_from, CURRENT_DATE),
             COALESCE(p_to, COALESCE(p_from, CURRENT_DATE)),
             interval '1 day'
           )::date AS d
  ),
  covered AS (
    -- one row per offshore employee/project/day inside the frame
    SELECT pw.employee_id, pw.project_id, rd.d
    FROM range_days rd
    JOIN project_workforce pw
      ON rd.d >= pw.start_date
     AND (pw.end_date IS NULL OR rd.d <= pw.end_date)
    JOIN projects pr
      ON pr.id = pw.project_id
    WHERE pr.is_offshore
      AND (p_project_id IS NULL OR pw.project_id = p_project_id)
      AND (p_employee_id IS NULL OR pw.employee_id = p_employee_id)
  )
  SELECT
    c.employee_id,
    trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) AS employee_name,
    c.project_id,
    pr.code AS project_code,
    pr.name AS project_name,
    count(*)::integer AS offshore_days,
    coalesce(sum(r.amount), 0)::numeric AS allowance_amount,
    coalesce(max(r.currency), 'USD') AS currency
  FROM covered c
  JOIN projects pr ON pr.id = c.project_id
  JOIN employees e ON e.id = c.employee_id
  -- the rate in force on that specific day: project-specific beats the default
  LEFT JOIN LATERAL (
    SELECT oa.amount, oa.currency
    FROM offshore_allowances oa
    WHERE oa.is_active
      AND oa.effective_from <= c.d
      AND (oa.effective_to IS NULL OR oa.effective_to >= c.d)
      AND (oa.project_id IS NULL OR oa.project_id = c.project_id)
    ORDER BY (oa.project_id IS NOT NULL) DESC, oa.effective_from DESC
    LIMIT 1
  ) r ON true
  GROUP BY c.employee_id, c.project_id, pr.code, pr.name, e.first_name, e.last_name
  ORDER BY pr.code, employee_name;
$$;

GRANT EXECUTE ON FUNCTION public.project_offshore_report(date, date, uuid, uuid) TO authenticated;

-- ============================================================
-- 9. Row level security
-- ============================================================
CREATE POLICY "select_projects" ON projects FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','projects.allowance','admin.settings','admin.reports_read']));

CREATE POLICY "insert_projects" ON projects FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "update_projects" ON projects FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "delete_projects" ON projects FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "select_project_workforce" ON project_workforce FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','admin.settings','admin.reports_read']));

CREATE POLICY "insert_project_workforce" ON project_workforce FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "update_project_workforce" ON project_workforce FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "delete_project_workforce" ON project_workforce FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "select_project_shuffles" ON project_shuffles FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','admin.settings','admin.reports_read']));

CREATE POLICY "insert_project_shuffles" ON project_shuffles FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "delete_project_shuffles" ON project_shuffles FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

-- read access also covers report callers, who need the rates to total allowance
CREATE POLICY "select_offshore_allowances" ON offshore_allowances FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','projects.allowance','admin.settings','admin.reports_read']));

CREATE POLICY "write_offshore_allowances" ON offshore_allowances FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.allowance','projects.manage','admin.settings']));
