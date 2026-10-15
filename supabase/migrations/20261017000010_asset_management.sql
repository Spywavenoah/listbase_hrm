/*
# Asset Management expansion — fleet, plant, machinery & ICT

Grows the simple `assets` register into a full asset lifecycle module:

 1. `asset_categories`            — categorise assets (Automobile, Plant & Machinery,
                                    ICT, Furniture, …) with a depreciation policy.
 2. `assets` gains category, location, picture, barcode and depreciation columns;
    asset number + barcode are auto-generated and printable.
 3. `asset_vehicle_profiles`      — vehicle/engine attributes (engine cc, plugs,
                                    fuel type, plate, odometer) for automobiles.
 4. `asset_repairs`               — repair history with cost implications.
 5. `asset_fuel_logs`             — fuel/petrol consumption with automatic
                                    km-per-litre and a peer + own-trend anomaly
                                    warning (same plugs / similar engine size /
                                    similar odometer band).
 6. `asset_maintenance_schedules` — preventive maintenance (recurring calendar,
                                    meter interval, or one-time date) with an
                                    early warning window.
 7. `asset_maintenance_logs`      — completed maintenance; `complete_maintenance`
                                    rolls the schedule forward.
 8. `vehicle_requests`            — vehicle booking routed through the generic
                                    approval workflow (`assets.vehicle_request`);
                                    the requester chooses who authorizes and who
                                    gives final approval.

New privileges: `assets.view`, `assets.repairs`, `assets.fleet`,
`assets.maintenance`, `assets.request`. A public `asset-images` storage bucket
holds asset pictures.
*/

-- ============================================================
-- 1. Privilege catalog entries
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('assets.view',        'Assets', 'View assets',             'Read the asset register, categories and history', 128),
  ('assets.manage',      'Assets', 'Manage assets',           'Manage the asset catalog, assignments and categories', 130),
  ('assets.repairs',     'Assets', 'Manage repairs',          'Record repairs and their cost implications', 132),
  ('assets.fleet',       'Assets', 'Manage fleet & fuel',     'Manage vehicles and record fuel consumption', 134),
  ('assets.maintenance', 'Assets', 'Manage maintenance',      'Set up preventive maintenance and log completed work', 136),
  ('assets.request',     'Assets', 'Request vehicles',        'Raise vehicle requests', 138)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. Asset categories
-- ============================================================
CREATE TABLE IF NOT EXISTS asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  name text NOT NULL,
  asset_class text NOT NULL DEFAULT 'OTHER',              -- AUTOMOBILE, PLANT_MACHINERY, ICT, FURNITURE, OFFICE, OTHER
  description text,
  depreciation_method text NOT NULL DEFAULT 'STRAIGHT_LINE', -- STRAIGHT_LINE, REDUCING_BALANCE, NONE
  default_useful_life_years int,
  default_rate numeric(6,2),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_categories_name ON asset_categories (lower(name));
CREATE INDEX IF NOT EXISTS idx_asset_categories_active ON asset_categories (is_active);

ALTER TABLE asset_categories ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Extend assets
-- ============================================================
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES asset_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS salvage_value numeric(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS useful_life_years int,
  ADD COLUMN IF NOT EXISTS depreciation_method text DEFAULT 'STRAIGHT_LINE',
  ADD COLUMN IF NOT EXISTS depreciation_rate numeric(6,2),
  ADD COLUMN IF NOT EXISTS depreciation_value numeric(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS depreciation_date date,
  ADD COLUMN IF NOT EXISTS book_value numeric(16,2),
  ADD COLUMN IF NOT EXISTS notes text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_barcode ON assets (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets (category_id);

-- ============================================================
-- 4. Vehicle profiles (1:1 with an automobile asset)
-- ============================================================
CREATE TABLE IF NOT EXISTS asset_vehicle_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
  plate_number text,
  make text,
  model text,
  manufacture_year int,
  fuel_type text DEFAULT 'PETROL',                          -- PETROL, DIESEL, CNG, HYBRID, ELECTRIC
  engine_capacity_cc numeric(10,2),
  num_plugs int,
  tank_capacity numeric(10,2),
  odometer numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_vehicle_profiles_asset ON asset_vehicle_profiles (asset_id);

ALTER TABLE asset_vehicle_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. Repairs
-- ============================================================
CREATE TABLE IF NOT EXISTS asset_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  repair_number text,
  repair_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL,
  vendor text,
  cost numeric(16,2) NOT NULL DEFAULT 0,
  downtime_days int,
  status text NOT NULL DEFAULT 'COMPLETED',                 -- OPEN, IN_PROGRESS, COMPLETED, CANCELLED
  odometer numeric(12,2),
  performed_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  recorded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_repairs_asset ON asset_repairs (asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_repairs_date ON asset_repairs (repair_date);
CREATE INDEX IF NOT EXISTS idx_asset_repairs_status ON asset_repairs (status);

ALTER TABLE asset_repairs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. Fuel logs
-- ============================================================
CREATE TABLE IF NOT EXISTS asset_fuel_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT CURRENT_DATE,
  odometer numeric(12,2) NOT NULL,
  previous_odometer numeric(12,2),
  distance numeric(12,2),
  litres numeric(12,2) NOT NULL,
  unit_cost numeric(12,2),
  total_cost numeric(16,2),
  fuel_type text DEFAULT 'PETROL',
  station text,
  receipt_no text,
  issued_to uuid REFERENCES employees(id) ON DELETE SET NULL,   -- driver / recipient
  mileage_band text,                                             -- LOW / MEDIUM / HIGH (by odometer)
  efficiency numeric(10,3),                                      -- distance / litres (km per litre)
  expected_efficiency numeric(10,3),
  own_avg_efficiency numeric(10,3),
  peer_avg_efficiency numeric(10,3),
  anomaly_flag boolean NOT NULL DEFAULT false,
  anomaly_reason text,
  recorded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_fuel_logs_asset ON asset_fuel_logs (asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_fuel_logs_date ON asset_fuel_logs (log_date);
CREATE INDEX IF NOT EXISTS idx_asset_fuel_logs_anomaly ON asset_fuel_logs (anomaly_flag);

ALTER TABLE asset_fuel_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. Preventive maintenance schedules
-- ============================================================
CREATE TABLE IF NOT EXISTS asset_maintenance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  schedule_type text NOT NULL DEFAULT 'PREVENTIVE',        -- PREVENTIVE, CORRECTIVE, INSPECTION
  recurrence text NOT NULL DEFAULT 'RECURRING',            -- RECURRING (calendar), INTERVAL (meter), ONE_TIME (specific date)
  interval_days int,
  interval_meter numeric(12,2),
  lead_days int NOT NULL DEFAULT 7,                        -- early alert window
  next_due_date date,
  next_due_meter numeric(12,2),
  last_completed_date date,
  last_completed_meter numeric(12,2),
  estimated_cost numeric(16,2),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_maint_schedules_asset ON asset_maintenance_schedules (asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_maint_schedules_due ON asset_maintenance_schedules (next_due_date);
CREATE INDEX IF NOT EXISTS idx_asset_maint_schedules_active ON asset_maintenance_schedules (is_active);

ALTER TABLE asset_maintenance_schedules ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS asset_maintenance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES asset_maintenance_schedules(id) ON DELETE SET NULL,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  performed_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  cost numeric(16,2) DEFAULT 0,
  meter numeric(12,2),
  vendor text,
  performed_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  next_due_date date,
  next_due_meter numeric(12,2),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_maint_logs_asset ON asset_maintenance_logs (asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_maint_logs_schedule ON asset_maintenance_logs (schedule_id);

ALTER TABLE asset_maintenance_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. Vehicle requests
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text,
  requested_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  purpose text NOT NULL,
  destination text,
  departure_at timestamptz,
  return_at timestamptz,
  passengers int NOT NULL DEFAULT 1,
  driver_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'DRAFT',                    -- DRAFT, PENDING, APPROVED, REJECTED, ASSIGNED, COMPLETED, CANCELLED
  notes text,
  approved_at timestamptz,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_requests_status ON vehicle_requests (status);
CREATE INDEX IF NOT EXISTS idx_vehicle_requests_requester ON vehicle_requests (requested_by);

ALTER TABLE vehicle_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS vehicle_request_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES vehicle_requests(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  name text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_request_passengers_request ON vehicle_request_passengers (request_id);

ALTER TABLE vehicle_request_passengers ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 9. updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_asset_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_asset_categories ON asset_categories;
CREATE TRIGGER trg_touch_asset_categories BEFORE UPDATE ON asset_categories
FOR EACH ROW EXECUTE FUNCTION public.touch_asset_updated_at();

DROP TRIGGER IF EXISTS trg_touch_asset_vehicle_profiles ON asset_vehicle_profiles;
CREATE TRIGGER trg_touch_asset_vehicle_profiles BEFORE UPDATE ON asset_vehicle_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_asset_updated_at();

DROP TRIGGER IF EXISTS trg_touch_asset_repairs ON asset_repairs;
CREATE TRIGGER trg_touch_asset_repairs BEFORE UPDATE ON asset_repairs
FOR EACH ROW EXECUTE FUNCTION public.touch_asset_updated_at();

DROP TRIGGER IF EXISTS trg_touch_asset_fuel_logs ON asset_fuel_logs;
CREATE TRIGGER trg_touch_asset_fuel_logs BEFORE UPDATE ON asset_fuel_logs
FOR EACH ROW EXECUTE FUNCTION public.touch_asset_updated_at();

DROP TRIGGER IF EXISTS trg_touch_asset_maint_schedules ON asset_maintenance_schedules;
CREATE TRIGGER trg_touch_asset_maint_schedules BEFORE UPDATE ON asset_maintenance_schedules
FOR EACH ROW EXECUTE FUNCTION public.touch_asset_updated_at();

DROP TRIGGER IF EXISTS trg_touch_vehicle_requests ON vehicle_requests;
CREATE TRIGGER trg_touch_vehicle_requests BEFORE UPDATE ON vehicle_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_asset_updated_at();

-- ============================================================
-- 10. Auto asset number + barcode
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS asset_tag_seq;

CREATE OR REPLACE FUNCTION public.generate_asset_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix text;
  v_next bigint;
  v_tag text;
BEGIN
  IF NEW.asset_tag IS NULL OR btrim(NEW.asset_tag) = '' THEN
    SELECT NULLIF(upper(btrim(code)), '') INTO v_prefix
      FROM asset_categories WHERE id = NEW.category_id;
    v_prefix := COALESCE(v_prefix, 'AST');
    LOOP
      v_next := nextval('asset_tag_seq');
      v_tag := v_prefix || '-' || lpad(v_next::text, 5, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM assets WHERE asset_tag = v_tag);
    END LOOP;
    NEW.asset_tag := v_tag;
  END IF;

  IF NEW.barcode IS NULL OR btrim(NEW.barcode) = '' THEN
    NEW.barcode := NEW.asset_tag;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_asset_number ON assets;
CREATE TRIGGER trg_generate_asset_number BEFORE INSERT ON assets
FOR EACH ROW EXECUTE FUNCTION public.generate_asset_number();

-- ============================================================
-- 11. Automatic depreciation (straight line / reducing balance)
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_asset_depreciation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_years numeric;
  v_accum numeric;
  v_book numeric;
  v_annual numeric;
  v_depr_date date;
BEGIN
  IF NEW.purchase_value IS NULL OR NEW.purchase_date IS NULL THEN
    IF NEW.book_value IS NULL THEN NEW.book_value := NEW.purchase_value; END IF;
    RETURN NEW;
  END IF;

  v_depr_date := COALESCE(NEW.depreciation_date, CURRENT_DATE);
  NEW.depreciation_date := v_depr_date;
  v_years := GREATEST((v_depr_date - NEW.purchase_date)::numeric / 365.25, 0);
  v_accum := 0;
  v_book := NEW.purchase_value;

  IF NEW.depreciation_method = 'STRAIGHT_LINE' THEN
    IF COALESCE(NEW.useful_life_years, 0) > 0 THEN
      v_annual := GREATEST(NEW.purchase_value - COALESCE(NEW.salvage_value, 0), 0) / NEW.useful_life_years;
      v_accum := LEAST(v_annual * v_years, GREATEST(NEW.purchase_value - COALESCE(NEW.salvage_value, 0), 0));
      v_book := NEW.purchase_value - v_accum;
    END IF;
  ELSIF NEW.depreciation_method = 'REDUCING_BALANCE' THEN
    IF COALESCE(NEW.depreciation_rate, 0) > 0 THEN
      v_book := GREATEST(NEW.purchase_value * power(1 - (NEW.depreciation_rate / 100.0), v_years), COALESCE(NEW.salvage_value, 0));
      v_accum := NEW.purchase_value - v_book;
    END IF;
  END IF;

  NEW.depreciation_value := round(v_accum, 2);
  NEW.book_value := round(v_book, 2);
  NEW.current_value := round(v_book, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_asset_depreciation ON assets;
CREATE TRIGGER trg_compute_asset_depreciation BEFORE INSERT OR UPDATE ON assets
FOR EACH ROW EXECUTE FUNCTION public.compute_asset_depreciation();

-- ============================================================
-- 12. Fuel metrics + anomaly detection (peer + own trend)
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_fuel_log_metrics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_odo numeric;
  v_dist numeric;
  v_eff numeric;
  v_own_avg numeric;
  v_peer_avg numeric;
  v_cc numeric;
  v_plugs int;
  v_fuel text;
  v_band text;
  v_tol constant numeric := 0.20;   -- engine size tolerance ±20%
  v_drop constant numeric := 0.20;  -- flag when 20% worse than the benchmark
BEGIN
  -- Mileage band from the odometer reading.
  IF NEW.odometer < 50000 THEN v_band := 'LOW';
  ELSIF NEW.odometer < 200000 THEN v_band := 'MEDIUM';
  ELSE v_band := 'HIGH';
  END IF;
  NEW.mileage_band := v_band;

  -- Previous fill for this vehicle (highest odometer below the current one).
  SELECT odometer INTO v_prev_odo
    FROM asset_fuel_logs
   WHERE asset_id = NEW.asset_id
     AND (NEW.id IS NULL OR id <> NEW.id)
     AND odometer < NEW.odometer
   ORDER BY odometer DESC
   LIMIT 1;

  NEW.previous_odometer := v_prev_odo;
  IF v_prev_odo IS NOT NULL AND NEW.odometer > v_prev_odo AND COALESCE(NEW.litres, 0) > 0 THEN
    v_dist := NEW.odometer - v_prev_odo;
    v_eff := round(v_dist / NEW.litres, 3);
    NEW.distance := v_dist;
    NEW.efficiency := v_eff;
  ELSE
    NEW.distance := NULL;
    NEW.efficiency := NULL;
  END IF;

  -- This vehicle's own trailing average (last 6 fills).
  SELECT round(avg(s.efficiency), 3) INTO v_own_avg
    FROM (
      SELECT efficiency FROM asset_fuel_logs
       WHERE asset_id = NEW.asset_id
         AND (NEW.id IS NULL OR id <> NEW.id)
         AND efficiency IS NOT NULL
       ORDER BY log_date DESC, created_at DESC
       LIMIT 6
    ) s;
  NEW.own_avg_efficiency := v_own_avg;

  -- Vehicle attributes for peer matching.
  SELECT engine_capacity_cc, num_plugs, COALESCE(fuel_type, 'PETROL')
    INTO v_cc, v_plugs, v_fuel
    FROM asset_vehicle_profiles WHERE asset_id = NEW.asset_id;

  -- Peer average: other vehicles with same plugs + fuel + similar engine size + same band.
  SELECT round(avg(f.efficiency), 3) INTO v_peer_avg
    FROM asset_fuel_logs f
    JOIN asset_vehicle_profiles p ON p.asset_id = f.asset_id
   WHERE f.asset_id <> NEW.asset_id
     AND f.efficiency IS NOT NULL
     AND p.num_plugs IS NOT DISTINCT FROM v_plugs
     AND COALESCE(p.fuel_type, 'PETROL') = v_fuel
     AND (CASE WHEN f.odometer < 50000 THEN 'LOW' WHEN f.odometer < 200000 THEN 'MEDIUM' ELSE 'HIGH' END) = v_band
     AND v_cc IS NOT NULL AND p.engine_capacity_cc IS NOT NULL
     AND abs(p.engine_capacity_cc - v_cc) <= v_cc * v_tol;
  NEW.peer_avg_efficiency := v_peer_avg;

  -- Decision: worse than peers OR worse than own trend.
  NEW.anomaly_flag := false;
  NEW.anomaly_reason := NULL;
  IF NEW.efficiency IS NOT NULL THEN
    NEW.expected_efficiency := COALESCE(v_peer_avg, v_own_avg);
    IF v_peer_avg IS NOT NULL AND v_peer_avg > 0 AND NEW.efficiency < v_peer_avg * (1 - v_drop) THEN
      NEW.anomaly_flag := true;
      NEW.anomaly_reason := format(
        'Fuel efficiency %s km/L is %s%% below similar vehicles (peer average %s km/L).',
        NEW.efficiency, round((1 - NEW.efficiency / v_peer_avg) * 100), v_peer_avg);
    ELSIF v_own_avg IS NOT NULL AND v_own_avg > 0 AND NEW.efficiency < v_own_avg * (1 - v_drop) THEN
      NEW.anomaly_flag := true;
      NEW.anomaly_reason := format(
        'Fuel efficiency %s km/L is %s%% below this vehicle''s own average (%s km/L).',
        NEW.efficiency, round((1 - NEW.efficiency / v_own_avg) * 100), v_own_avg);
    END IF;
  ELSE
    NEW.expected_efficiency := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_fuel_log_metrics ON asset_fuel_logs;
CREATE TRIGGER trg_compute_fuel_log_metrics BEFORE INSERT OR UPDATE ON asset_fuel_logs
FOR EACH ROW EXECUTE FUNCTION public.compute_fuel_log_metrics();

-- ============================================================
-- 13. Complete a maintenance schedule (roll it forward)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_maintenance(
  p_schedule_id uuid,
  p_performed_date date DEFAULT CURRENT_DATE,
  p_cost numeric DEFAULT 0,
  p_meter numeric DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_vendor text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sched asset_maintenance_schedules%ROWTYPE;
  v_actor uuid := public.current_employee_id();
  v_next_date date;
  v_next_meter numeric;
  v_log_id uuid;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['assets.maintenance','assets.manage','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to complete maintenance';
  END IF;

  SELECT * INTO v_sched FROM asset_maintenance_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maintenance schedule not found'; END IF;

  IF v_sched.recurrence = 'RECURRING' THEN
    v_next_date := COALESCE(p_performed_date, CURRENT_DATE) + COALESCE(v_sched.interval_days, 0);
    v_next_meter := v_sched.next_due_meter;
  ELSIF v_sched.recurrence = 'INTERVAL' THEN
    v_next_meter := COALESCE(p_meter, v_sched.next_due_meter, 0) + COALESCE(v_sched.interval_meter, 0);
    v_next_date := CASE WHEN COALESCE(v_sched.interval_days, 0) > 0
                        THEN COALESCE(p_performed_date, CURRENT_DATE) + v_sched.interval_days
                        ELSE NULL END;
  ELSE -- ONE_TIME
    v_next_date := NULL;
    v_next_meter := NULL;
  END IF;

  INSERT INTO asset_maintenance_logs (
    schedule_id, asset_id, performed_date, description, cost, meter, vendor, performed_by, next_due_date, next_due_meter
  ) VALUES (
    v_sched.id, v_sched.asset_id, COALESCE(p_performed_date, CURRENT_DATE), p_description, COALESCE(p_cost, 0),
    p_meter, p_vendor, v_actor, v_next_date, v_next_meter
  ) RETURNING id INTO v_log_id;

  UPDATE asset_maintenance_schedules
     SET last_completed_date = COALESCE(p_performed_date, CURRENT_DATE),
         last_completed_meter = COALESCE(p_meter, last_completed_meter),
         next_due_date = v_next_date,
         next_due_meter = v_next_meter,
         is_active = CASE WHEN v_sched.recurrence = 'ONE_TIME' THEN false ELSE is_active END,
         updated_at = now()
   WHERE id = v_sched.id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_maintenance(uuid, date, numeric, numeric, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_maintenance(uuid, date, numeric, numeric, text, text) FROM PUBLIC;

-- ============================================================
-- 14. Row level security
-- ============================================================
DROP POLICY IF EXISTS "select_assets" ON assets;
DROP POLICY IF EXISTS "insert_assets" ON assets;
DROP POLICY IF EXISTS "update_assets" ON assets;
DROP POLICY IF EXISTS "delete_assets" ON assets;
CREATE POLICY "select_assets" ON assets FOR SELECT TO authenticated
  USING (assigned_to = public.current_employee_id()
         OR public.has_any_privilege(ARRAY['assets.view','assets.manage','admin.settings','admin.reports_read']));
CREATE POLICY "insert_assets" ON assets FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['assets.manage','admin.settings']));
CREATE POLICY "update_assets" ON assets FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['assets.manage','admin.settings']));
CREATE POLICY "delete_assets" ON assets FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','admin.settings']));

DROP POLICY IF EXISTS "select_asset_categories" ON asset_categories;
DROP POLICY IF EXISTS "insert_asset_categories" ON asset_categories;
DROP POLICY IF EXISTS "update_asset_categories" ON asset_categories;
DROP POLICY IF EXISTS "delete_asset_categories" ON asset_categories;
CREATE POLICY "select_asset_categories" ON asset_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_asset_categories" ON asset_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['assets.manage','admin.settings']));
CREATE POLICY "update_asset_categories" ON asset_categories FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['assets.manage','admin.settings']));
CREATE POLICY "delete_asset_categories" ON asset_categories FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','admin.settings']));

DROP POLICY IF EXISTS "select_asset_vehicle_profiles" ON asset_vehicle_profiles;
DROP POLICY IF EXISTS "write_asset_vehicle_profiles" ON asset_vehicle_profiles;
CREATE POLICY "select_asset_vehicle_profiles" ON asset_vehicle_profiles FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.view','assets.manage','assets.fleet','assets.maintenance','admin.settings']));
CREATE POLICY "write_asset_vehicle_profiles" ON asset_vehicle_profiles FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','assets.fleet','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['assets.manage','assets.fleet','admin.settings']));

DROP POLICY IF EXISTS "select_asset_repairs" ON asset_repairs;
DROP POLICY IF EXISTS "write_asset_repairs" ON asset_repairs;
CREATE POLICY "select_asset_repairs" ON asset_repairs FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.view','assets.manage','assets.repairs','assets.maintenance','admin.settings']));
CREATE POLICY "write_asset_repairs" ON asset_repairs FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','assets.repairs','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['assets.manage','assets.repairs','admin.settings']));

DROP POLICY IF EXISTS "select_asset_fuel_logs" ON asset_fuel_logs;
DROP POLICY IF EXISTS "write_asset_fuel_logs" ON asset_fuel_logs;
CREATE POLICY "select_asset_fuel_logs" ON asset_fuel_logs FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.view','assets.manage','assets.fleet','admin.settings']));
CREATE POLICY "write_asset_fuel_logs" ON asset_fuel_logs FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','assets.fleet','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['assets.manage','assets.fleet','admin.settings']));

DROP POLICY IF EXISTS "select_asset_maint_schedules" ON asset_maintenance_schedules;
DROP POLICY IF EXISTS "write_asset_maint_schedules" ON asset_maintenance_schedules;
CREATE POLICY "select_asset_maint_schedules" ON asset_maintenance_schedules FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.view','assets.manage','assets.maintenance','admin.settings']));
CREATE POLICY "write_asset_maint_schedules" ON asset_maintenance_schedules FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','assets.maintenance','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['assets.manage','assets.maintenance','admin.settings']));

DROP POLICY IF EXISTS "select_asset_maint_logs" ON asset_maintenance_logs;
DROP POLICY IF EXISTS "write_asset_maint_logs" ON asset_maintenance_logs;
CREATE POLICY "select_asset_maint_logs" ON asset_maintenance_logs FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.view','assets.manage','assets.maintenance','admin.settings']));
CREATE POLICY "write_asset_maint_logs" ON asset_maintenance_logs FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','assets.maintenance','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['assets.manage','assets.maintenance','admin.settings']));

DROP POLICY IF EXISTS "select_vehicle_requests" ON vehicle_requests;
DROP POLICY IF EXISTS "insert_vehicle_requests" ON vehicle_requests;
DROP POLICY IF EXISTS "update_vehicle_requests" ON vehicle_requests;
DROP POLICY IF EXISTS "delete_vehicle_requests" ON vehicle_requests;
CREATE POLICY "select_vehicle_requests" ON vehicle_requests FOR SELECT TO authenticated
  USING (requested_by = public.current_employee_id()
         OR created_by = public.current_employee_id()
         OR public.has_any_privilege(ARRAY['assets.view','assets.manage','assets.request','admin.settings']));
CREATE POLICY "insert_vehicle_requests" ON vehicle_requests FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['assets.request','assets.manage','admin.settings']));
CREATE POLICY "update_vehicle_requests" ON vehicle_requests FOR UPDATE TO authenticated
  USING (requested_by = public.current_employee_id()
         OR public.has_any_privilege(ARRAY['assets.request','assets.manage','admin.settings']))
  WITH CHECK (requested_by = public.current_employee_id()
         OR public.has_any_privilege(ARRAY['assets.request','assets.manage','admin.settings']));
CREATE POLICY "delete_vehicle_requests" ON vehicle_requests FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.manage','admin.settings']));

DROP POLICY IF EXISTS "select_vehicle_request_passengers" ON vehicle_request_passengers;
DROP POLICY IF EXISTS "write_vehicle_request_passengers" ON vehicle_request_passengers;
CREATE POLICY "select_vehicle_request_passengers" ON vehicle_request_passengers FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.view','assets.manage','assets.request','admin.settings'])
         OR EXISTS (SELECT 1 FROM vehicle_requests vr
                     WHERE vr.id = request_id
                       AND (vr.requested_by = public.current_employee_id() OR vr.created_by = public.current_employee_id())));
CREATE POLICY "write_vehicle_request_passengers" ON vehicle_request_passengers FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['assets.request','assets.manage','admin.settings'])
         OR EXISTS (SELECT 1 FROM vehicle_requests vr
                     WHERE vr.id = request_id
                       AND (vr.requested_by = public.current_employee_id() OR vr.created_by = public.current_employee_id())))
  WITH CHECK (public.has_any_privilege(ARRAY['assets.request','assets.manage','admin.settings'])
         OR EXISTS (SELECT 1 FROM vehicle_requests vr
                     WHERE vr.id = request_id
                       AND (vr.requested_by = public.current_employee_id() OR vr.created_by = public.current_employee_id())));

-- ============================================================
-- 15. Workflow integration for vehicle requests
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_workflow_result_to_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('APPROVED', 'REJECTED') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM set_config('app.workflow_approved', NEW.record_id::text, true);

    IF NEW.module_key = 'leave' THEN
      UPDATE leave_requests
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'leave.encashment' THEN
      UPDATE leave_encashment_requests
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'expense' THEN
      UPDATE expense_claims
         SET status = NEW.status,
             approved_by = CASE WHEN NEW.status = 'APPROVED' THEN public.current_employee_id() ELSE approved_by END,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE approved_at END,
             rejected_by = CASE WHEN NEW.status = 'REJECTED' THEN public.current_employee_id() ELSE rejected_by END,
             rejected_at = CASE WHEN NEW.status = 'REJECTED' THEN now() ELSE rejected_at END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'employee.change_request' THEN
      IF NEW.status = 'APPROVED' THEN
        PERFORM public.apply_employee_change_request(NEW.record_id);
        UPDATE employee_change_requests
           SET status = 'APPROVED',
               reviewed_by = public.current_employee_id(),
               reviewed_at = now()
         WHERE id = NEW.record_id;
      ELSE
        UPDATE employee_change_requests
           SET status = 'REJECTED',
               reviewed_by = public.current_employee_id(),
               reviewed_at = now()
         WHERE id = NEW.record_id;
      END IF;
    ELSIF NEW.module_key = 'procurement.requisition' THEN
      UPDATE procurement_requisitions
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'procurement.purchase_order' THEN
      UPDATE purchase_orders
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'procurement.invoice' THEN
      UPDATE procurement_invoices
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'procurement.payment' THEN
      UPDATE procurement_payment_requests
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'recruitment.requisition' THEN
      UPDATE recruitment_requisitions
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'inventory.material_request' THEN
      UPDATE material_requests
         SET status = NEW.status,
             updated_at = now()
       WHERE id = NEW.record_id;
    ELSIF NEW.module_key = 'assets.vehicle_request' THEN
      UPDATE vehicle_requests
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE approved_at END,
             updated_at = now()
       WHERE id = NEW.record_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_workflow_result ON workflow_instances;
CREATE TRIGGER trg_apply_workflow_result
AFTER UPDATE ON workflow_instances
FOR EACH ROW EXECUTE FUNCTION public.apply_workflow_result_to_record();

-- Default vehicle request chain (2 steps). The requester overrides the actors
-- at submission time (authorizer + approver) via set_workflow_actors.
DO $$
DECLARE v_def uuid;
BEGIN
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Vehicle Request Approval', 'assets.vehicle_request', 'request.submitted',
    'Default vehicle request approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'assets.vehicle_request' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'assets.vehicle_request', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'assets.vehicle_request');
END;
$$;

-- ============================================================
-- 16. Asset picture storage bucket (public read)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'asset-images',
  'asset-images',
  true,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS asset_images_read ON storage.objects;
CREATE POLICY asset_images_read ON storage.objects
  FOR SELECT USING (bucket_id = 'asset-images');

DROP POLICY IF EXISTS asset_images_insert ON storage.objects;
CREATE POLICY asset_images_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'asset-images'
    AND public.has_any_privilege(ARRAY['assets.manage','admin.settings'])
  );

DROP POLICY IF EXISTS asset_images_update ON storage.objects;
CREATE POLICY asset_images_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'asset-images'
    AND public.has_any_privilege(ARRAY['assets.manage','admin.settings'])
  );

DROP POLICY IF EXISTS asset_images_delete ON storage.objects;
CREATE POLICY asset_images_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'asset-images'
    AND public.has_any_privilege(ARRAY['assets.manage','admin.settings'])
  );

-- ============================================================
-- 17. Seed asset categories (idempotent)
-- ============================================================
INSERT INTO asset_categories (code, name, asset_class, description, depreciation_method, default_useful_life_years, default_rate)
VALUES
  ('AUTO',  'Automobiles',            'AUTOMOBILE',      'Cars, vans, trucks and other vehicles', 'REDUCING_BALANCE', 8,  25.00),
  ('PLANT', 'Plant & Machinery',       'PLANT_MACHINERY', 'Generators, heavy plant and production machinery', 'STRAIGHT_LINE', 10, NULL),
  ('ICT',   'ICT Equipment',           'ICT',             'Computers, servers, network and ICT gadgets', 'STRAIGHT_LINE', 4, NULL),
  ('FUR',   'Furniture & Fittings',    'FURNITURE',       'Office furniture and fittings', 'STRAIGHT_LINE', 10, NULL),
  ('OFF',   'Office Equipment',        'OFFICE',          'Printers, scanners and general office equipment', 'STRAIGHT_LINE', 5, NULL),
  ('OTH',   'Other Assets',            'OTHER',           'Assets that do not fit the other categories', 'STRAIGHT_LINE', 5, NULL)
ON CONFLICT DO NOTHING;
