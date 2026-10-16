/*
# Geofenced attendance, grouped shuffles, material usage, and WhatsApp clock-in

Migration 12 builds on migration 11 (projects/offshore) and delivers four things:

  A. Grouped workforce & shuffles
     • `project_workforce_batches` — one entry per workforce Append (many employees).
     • `project_workforce.batch_id` — links each deployment row to its batch.
     • `project_shuffle_requests` + `project_shuffle_items` — a shuffle is now a
       single request that can contain many replaced/replacement employees.
       (The old flat `project_shuffles` table is back-filled then dropped.)

  B. Geofenced attendance
     • `projects.geofence_radius_m` — per-project radius in metres.
     • `attendance_facilities` — organisation "approved" facilities (name, coords,
       radius) that staff who are not on a project may clock in from.
     • `attendance` gains clock-in/out coordinates, accuracy, matched zone and a
       `source` column (WEB / WHATSAPP / MANUAL).
     • `clock_attendance(...)` RPC validates the caller is inside an approved
       facility OR one of their active project geofences before recording.

  C. Material request usage classification
     • `material_requests.usage_category` (PROJECT, PLANT_MACHINERY, UTILITY,
       OFFICE_ADMIN_WELFARE, COMMUNITY_RELATIONS, ICT_FLOW_LAB, GENERAL)
       and `material_requests.project_id` when the usage is a project.

  D. WhatsApp clock-in
     • `employees.secondary_phone` — second contact number.
     • `whatsapp_attendance_rules` — listening phrases mapped to CLOCK_IN/CLOCK_OUT.
     • `whatsapp_clock_attendance(phone, message)` RPC — resolves the sender to an
       active employee (primary phone, secondary phone or an emergency contact),
       matches a phrase, and records the punch (bypasses geofence).
*/

-- ============================================================
-- A. Grouped workforce & shuffles
-- ============================================================
CREATE TABLE IF NOT EXISTS project_workforce_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  batch_type text NOT NULL DEFAULT 'APPEND',
  notes text,
  effective_date date,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_workforce_batches_type_check
    CHECK (batch_type IN ('APPEND','SHUFFLE','INITIAL'))
);

CREATE INDEX IF NOT EXISTS idx_project_workforce_batches_project
  ON project_workforce_batches (project_id);

ALTER TABLE project_workforce
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES project_workforce_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_workforce_batch ON project_workforce (batch_id);

CREATE TABLE IF NOT EXISTS project_shuffle_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES project_workforce_batches(id) ON DELETE SET NULL,
  notes text,
  effective_date date,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_shuffle_requests_project
  ON project_shuffle_requests (project_id);

CREATE TABLE IF NOT EXISTS project_shuffle_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES project_shuffle_requests(id) ON DELETE CASCADE,
  replaced_workforce_id uuid REFERENCES project_workforce(id) ON DELETE SET NULL,
  replaced_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  replace_start_date date NOT NULL,
  replace_end_date date NOT NULL,
  new_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  new_workforce_id uuid REFERENCES project_workforce(id) ON DELETE SET NULL,
  new_start_date date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_shuffle_items_dates_check
    CHECK (replace_end_date >= replace_start_date)
);

CREATE INDEX IF NOT EXISTS idx_project_shuffle_items_request
  ON project_shuffle_items (request_id);

-- back-fill the legacy flat table (if it still exists) then remove it
DO $$
DECLARE r record; v_req uuid;
BEGIN
  IF to_regclass('public.project_shuffles') IS NOT NULL THEN
    FOR r IN SELECT * FROM project_shuffles LOOP
      INSERT INTO project_shuffle_requests (project_id, notes, effective_date, created_by, created_at)
      VALUES (r.project_id, r.notes, COALESCE(r.new_start_date, r.replace_end_date), r.created_by, r.created_at)
      RETURNING id INTO v_req;
      INSERT INTO project_shuffle_items
        (request_id, replaced_workforce_id, replaced_employee_id, replace_start_date, replace_end_date,
         new_employee_id, new_workforce_id, new_start_date, notes)
      VALUES
        (v_req, r.replaced_workforce_id, r.replaced_employee_id, r.replace_start_date, r.replace_end_date,
         r.new_employee_id, r.new_workforce_id, r.new_start_date, r.notes);
    END LOOP;
  END IF;
END $$;

DROP TABLE IF EXISTS project_shuffles CASCADE;

-- ============================================================
-- B. Geofenced attendance
-- ============================================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS geofence_radius_m numeric(10,1);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_geofence_check') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_geofence_check
      CHECK (
        geofence_radius_m IS NULL
        OR (geofence_radius_m >= 0 AND latitude IS NOT NULL AND longitude IS NOT NULL)
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS attendance_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  latitude numeric(9,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  radius_m numeric(10,1) NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_facilities_coords_check
    CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180),
  CONSTRAINT attendance_facilities_radius_check CHECK (radius_m >= 0)
);

CREATE INDEX IF NOT EXISTS idx_attendance_facilities_active
  ON attendance_facilities (is_active);

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_in_lat numeric(9,6);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_in_lng numeric(9,6);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_in_accuracy numeric(10,2);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_in_zone text;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_out_lat numeric(9,6);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_out_lng numeric(9,6);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_out_accuracy numeric(10,2);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_out_zone text;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'WEB';

-- ============================================================
-- C. Material request usage classification
-- ============================================================
ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS usage_category text;
ALTER TABLE material_requests
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_requests_usage_check') THEN
    ALTER TABLE material_requests ADD CONSTRAINT material_requests_usage_check
      CHECK (
        usage_category IS NULL OR usage_category IN (
          'PROJECT','PLANT_MACHINERY','UTILITY','OFFICE_ADMIN_WELFARE',
          'COMMUNITY_RELATIONS','ICT_FLOW_LAB','GENERAL'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_material_requests_usage ON material_requests (usage_category);
CREATE INDEX IF NOT EXISTS idx_material_requests_project ON material_requests (project_id);

-- ============================================================
-- D. WhatsApp clock-in inputs
-- ============================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS secondary_phone text;

CREATE TABLE IF NOT EXISTS whatsapp_attendance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase text NOT NULL,
  action text NOT NULL,
  match_type text NOT NULL DEFAULT 'CONTAINS',
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_attendance_rules_action_check CHECK (action IN ('CLOCK_IN','CLOCK_OUT')),
  CONSTRAINT whatsapp_attendance_rules_match_check CHECK (match_type IN ('EXACT','STARTS_WITH','CONTAINS'))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_rules_active ON whatsapp_attendance_rules (is_active, priority);

-- ============================================================
-- E. updated_at triggers
-- ============================================================
DROP TRIGGER IF EXISTS trg_touch_project_workforce_batches ON project_workforce_batches;
CREATE TRIGGER trg_touch_project_workforce_batches BEFORE UPDATE ON project_workforce_batches
FOR EACH ROW EXECUTE FUNCTION public.touch_projects_updated_at();

DROP TRIGGER IF EXISTS trg_touch_project_shuffle_requests ON project_shuffle_requests;
CREATE TRIGGER trg_touch_project_shuffle_requests BEFORE UPDATE ON project_shuffle_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_projects_updated_at();

DROP TRIGGER IF EXISTS trg_touch_attendance_facilities ON attendance_facilities;
CREATE TRIGGER trg_touch_attendance_facilities BEFORE UPDATE ON attendance_facilities
FOR EACH ROW EXECUTE FUNCTION public.touch_projects_updated_at();

DROP TRIGGER IF EXISTS trg_touch_whatsapp_attendance_rules ON whatsapp_attendance_rules;
CREATE TRIGGER trg_touch_whatsapp_attendance_rules BEFORE UPDATE ON whatsapp_attendance_rules
FOR EACH ROW EXECUTE FUNCTION public.touch_projects_updated_at();

-- ============================================================
-- F. Row level security
-- ============================================================
ALTER TABLE project_workforce_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_shuffle_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_shuffle_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_attendance_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_workforce_batches" ON project_workforce_batches FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','admin.settings','admin.reports_read']));
CREATE POLICY "write_workforce_batches" ON project_workforce_batches FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "select_shuffle_requests" ON project_shuffle_requests FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','admin.settings','admin.reports_read']));
CREATE POLICY "write_shuffle_requests" ON project_shuffle_requests FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "select_shuffle_items" ON project_shuffle_items FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.view','projects.manage','admin.settings','admin.reports_read']));
CREATE POLICY "write_shuffle_items" ON project_shuffle_items FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['projects.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['projects.manage','admin.settings']));

CREATE POLICY "select_attendance_facilities" ON attendance_facilities FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "write_attendance_facilities" ON attendance_facilities FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['attendance.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['attendance.manage','admin.settings']));

CREATE POLICY "select_whatsapp_rules" ON whatsapp_attendance_rules FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['admin.settings']));
CREATE POLICY "write_whatsapp_rules" ON whatsapp_attendance_rules FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['admin.settings']));

-- ============================================================
-- G. Geofence + attendance functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.haversine_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$$;

-- every approved zone that applies to an employee for a given point
CREATE OR REPLACE FUNCTION public.attendance_zones(
  p_employee_id uuid, p_lat double precision, p_lng double precision
) RETURNS TABLE (zone_name text, zone_type text, distance_m double precision, radius_m double precision)
LANGUAGE sql STABLE
AS $$
  SELECT af.name, 'FACILITY',
         public.haversine_m(p_lat, p_lng, af.latitude::double precision, af.longitude::double precision),
         af.radius_m::double precision
  FROM attendance_facilities af
  WHERE af.is_active
  UNION ALL
  SELECT pr.name, 'PROJECT',
         public.haversine_m(p_lat, p_lng, pr.latitude::double precision, pr.longitude::double precision),
         pr.geofence_radius_m::double precision
  FROM projects pr
  JOIN project_workforce pw
    ON pw.project_id = pr.id
   AND pw.employee_id = p_employee_id
   AND pw.start_date <= CURRENT_DATE
   AND (pw.end_date IS NULL OR pw.end_date >= CURRENT_DATE)
  WHERE pr.latitude IS NOT NULL
    AND pr.longitude IS NOT NULL
    AND pr.geofence_radius_m IS NOT NULL;
$$;

-- writes a single punch (assumes all validation already done)
CREATE OR REPLACE FUNCTION public.record_attendance_punch(
  p_employee_id uuid, p_action text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL, p_accuracy numeric DEFAULT NULL,
  p_zone text DEFAULT NULL, p_source text DEFAULT 'WEB'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row attendance%ROWTYPE;
  v_date date := CURRENT_DATE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_row FROM attendance WHERE employee_id = p_employee_id AND date = v_date FOR UPDATE;

  IF p_action = 'CLOCK_IN' THEN
    IF FOUND AND v_row.clock_in IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_IN', 'message', 'You have already clocked in today.');
    END IF;
    IF FOUND THEN
      UPDATE attendance SET
        clock_in = v_now, status = 'PRESENT',
        source = COALESCE(p_source, source),
        clock_in_lat = p_lat, clock_in_lng = p_lng,
        clock_in_accuracy = p_accuracy, clock_in_zone = p_zone, updated_at = now()
      WHERE id = v_row.id;
    ELSE
      INSERT INTO attendance
        (employee_id, date, clock_in, status, source, clock_in_lat, clock_in_lng, clock_in_accuracy, clock_in_zone)
      VALUES
        (p_employee_id, v_date, v_now, 'PRESENT', p_source, p_lat, p_lng, p_accuracy, p_zone);
    END IF;
    RETURN jsonb_build_object('ok', true, 'action', 'CLOCK_IN', 'date', v_date,
      'time', to_char(v_now, 'HH24:MI'), 'zone', p_zone, 'source', p_source);

  ELSIF p_action = 'CLOCK_OUT' THEN
    IF NOT FOUND OR v_row.clock_in IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_IN', 'message', 'You have not clocked in today.');
    END IF;
    IF v_row.clock_out IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_OUT', 'message', 'You have already clocked out today.');
    END IF;
    UPDATE attendance SET
      clock_out = v_now,
      work_hours = round(extract(epoch FROM (v_now - v_row.clock_in)) / 3600.0, 2),
      source = COALESCE(p_source, source),
      clock_out_lat = p_lat, clock_out_lng = p_lng,
      clock_out_accuracy = p_accuracy, clock_out_zone = p_zone, updated_at = now()
    WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', true, 'action', 'CLOCK_OUT', 'date', v_date,
      'time', to_char(v_now, 'HH24:MI'), 'zone', p_zone, 'source', p_source);
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTION', 'message', 'Unknown action.');
END $$;

-- geofence-enforced clock in/out
CREATE OR REPLACE FUNCTION public.clock_attendance(
  p_action text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL, p_accuracy numeric DEFAULT NULL,
  p_source text DEFAULT 'WEB', p_employee_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.current_employee_id();
  v_target uuid;
  v_bypass boolean := false;
  v_zone text;
  v_min text;
BEGIN
  IF p_employee_id IS NOT NULL AND p_employee_id IS DISTINCT FROM v_actor THEN
    IF NOT public.has_any_privilege(ARRAY['attendance.manage','admin.settings']) THEN
      RAISE EXCEPTION 'You are not allowed to clock in/out for another employee';
    END IF;
    v_target := p_employee_id;
    v_bypass := true;
  ELSE
    v_target := COALESCE(p_employee_id, v_actor);
  END IF;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'You are not signed in';
  END IF;

  IF NOT v_bypass THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      RAISE EXCEPTION 'Location is required to clock in/out. Enable location access and try again.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.attendance_zones(v_target, p_lat, p_lng)) THEN
      RAISE EXCEPTION 'Attendance location is not configured. Ask an administrator to set the facility or project coordinates.';
    END IF;

    SELECT z.zone_name INTO v_zone
    FROM public.attendance_zones(v_target, p_lat, p_lng) z
    WHERE z.distance_m <= z.radius_m
    ORDER BY z.distance_m ASC
    LIMIT 1;

    IF v_zone IS NULL THEN
      SELECT round(z.distance_m)::text INTO v_min
      FROM public.attendance_zones(v_target, p_lat, p_lng) z
      ORDER BY z.distance_m ASC
      LIMIT 1;
      RAISE EXCEPTION 'You are outside every approved attendance zone (nearest approved location is % m away).', v_min;
    END IF;
  END IF;

  RETURN public.record_attendance_punch(v_target, p_action, p_lat, p_lng, p_accuracy, v_zone, p_source);
END $$;

GRANT EXECUTE ON FUNCTION public.clock_attendance(text, numeric, numeric, numeric, text, uuid) TO authenticated;

-- WhatsApp clock in/out (resolves sender -> active employee, matches a phrase)
CREATE OR REPLACE FUNCTION public.whatsapp_clock_attendance(p_phone text, p_message text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_emp employees%ROWTYPE;
  v_rule whatsapp_attendance_rules%ROWTYPE;
  v_res jsonb;
BEGIN
  v_digits := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_digits) < 7 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_PHONE', 'message', 'Missing or invalid sender number.');
  END IF;

  SELECT e.* INTO v_emp FROM employees e
  WHERE e.employment_status = 'ACTIVE'
    AND (
      right(regexp_replace(COALESCE(e.phone, ''), '[^0-9]', '', 'g'), 10) = right(v_digits, 10)
      OR right(regexp_replace(COALESCE(e.secondary_phone, ''), '[^0-9]', '', 'g'), 10) = right(v_digits, 10)
    )
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT e.* INTO v_emp FROM employees e
    WHERE e.employment_status = 'ACTIVE'
      AND EXISTS (
        SELECT 1 FROM employee_emergency_contacts c
        WHERE c.employee_id = e.id
          AND right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = right(v_digits, 10)
      )
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_EMPLOYEE',
      'message', 'This number is not linked to an active employee.');
  END IF;

  SELECT r.* INTO v_rule FROM whatsapp_attendance_rules r
  WHERE r.is_active
    AND (
      (r.match_type = 'EXACT' AND lower(btrim(p_message)) = lower(btrim(r.phrase)))
      OR (r.match_type = 'STARTS_WITH' AND lower(btrim(p_message)) LIKE lower(btrim(r.phrase)) || '%')
      OR (r.match_type = 'CONTAINS' AND lower(btrim(p_message)) LIKE '%' || lower(btrim(r.phrase)) || '%')
    )
  ORDER BY r.priority ASC, length(r.phrase) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_RULE',
      'message', 'No matching clock instruction.',
      'employee_name', btrim(v_emp.first_name || ' ' || v_emp.last_name));
  END IF;

  v_res := public.record_attendance_punch(v_emp.id, v_rule.action, NULL, NULL, NULL, NULL, 'WHATSAPP');
  RETURN v_res || jsonb_build_object(
    'employee_id', v_emp.id,
    'employee_name', btrim(v_emp.first_name || ' ' || v_emp.last_name),
    'matched_phrase', v_rule.phrase
  );
END $$;

GRANT EXECUTE ON FUNCTION public.whatsapp_clock_attendance(text, text) TO service_role;
