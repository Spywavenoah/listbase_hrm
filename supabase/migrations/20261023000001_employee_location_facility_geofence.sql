-- ============================================================
-- Migration — Employee location/facility assignment + geofence priority
-- ============================================================
--
-- 1. Add location_id to employees (FK to attendance_facilities)
-- 2. Rework attendance_zones() so geofence validation priority is:
--    - If employee is active in a project (project_workforce start_date <= today
--      AND (end_date IS NULL OR end_date >= today)), use ONLY project geofences
--    - Otherwise, use ONLY the employee's assigned facility (employees.location_id)
-- ============================================================

-- 1) Add location_id column to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS location_id uuid
    REFERENCES public.attendance_facilities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_location ON public.employees(location_id);

-- 2) Rework attendance_zones() with project-first priority
CREATE OR REPLACE FUNCTION public.attendance_zones(
  p_employee_id uuid, p_lat double precision, p_lng double precision
) RETURNS TABLE (zone_name text, zone_type text, distance_m double precision, radius_m double precision)
LANGUAGE sql STABLE
AS $$
  -- Determine if employee has an active project assignment today
  WITH active_project AS (
    SELECT 1 AS has_active
    FROM public.project_workforce pw
    WHERE pw.employee_id = p_employee_id
      AND pw.start_date <= CURRENT_DATE
      AND (pw.end_date IS NULL OR pw.end_date >= CURRENT_DATE)
    LIMIT 1
  ),
  employee_facility AS (
    SELECT e.location_id
    FROM public.employees e
    WHERE e.id = p_employee_id
  )
  -- If active project exists, return only project geofences
  SELECT pr.name, 'PROJECT',
         public.haversine_m(p_lat, p_lng, pr.latitude::double precision, pr.longitude::double precision),
         pr.geofence_radius_m::double precision
  FROM public.projects pr
  JOIN public.project_workforce pw ON pw.project_id = pr.id
   AND pw.employee_id = p_employee_id
   AND pw.start_date <= CURRENT_DATE
   AND (pw.end_date IS NULL OR pw.end_date >= CURRENT_DATE)
  JOIN active_project ap ON true
  WHERE pr.latitude IS NOT NULL
    AND pr.longitude IS NOT NULL
    AND pr.geofence_radius_m IS NOT NULL

  UNION ALL

  -- Otherwise, return only the employee's assigned facility
  SELECT af.name, 'FACILITY',
         public.haversine_m(p_lat, p_lng, af.latitude::double precision, af.longitude::double precision),
         af.radius_m::double precision
  FROM public.attendance_facilities af
  JOIN employee_facility ef ON af.id = ef.location_id
  WHERE af.is_active
    AND NOT EXISTS (SELECT 1 FROM active_project);
$$;