-- ============================================================
-- Migration 23 — Vehicle requests: employees see only their own.
--
-- `assets.request` is part of the default privilege bundle granted
-- to EVERY employee, but it was listed in the read-all set of
-- `vehicle_requests` / `vehicle_request_passengers`. As a result any
-- employee could read every colleague's vehicle request and the
-- passengers on it.
--
-- The create permission (`assets.request`) must not grant blanket
-- read access. Reading everyone's requests now requires a genuine
-- fleet/asset oversight privilege (view / manage / fleet / repairs /
-- maintenance / admin). Creators still see the requests they raised
-- or created.
-- ============================================================

-- ------------------------------------------------------------
-- vehicle_requests
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_vehicle_requests" ON vehicle_requests;
CREATE POLICY "select_vehicle_requests" ON vehicle_requests FOR SELECT TO authenticated
  USING (
    requested_by = public.current_employee_id()
    OR created_by = public.current_employee_id()
    OR public.has_any_privilege(ARRAY[
      'assets.view','assets.manage','assets.fleet','assets.repairs','assets.maintenance','admin.settings'
    ])
  );

-- ------------------------------------------------------------
-- vehicle_request_passengers
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_vehicle_request_passengers" ON vehicle_request_passengers;
CREATE POLICY "select_vehicle_request_passengers" ON vehicle_request_passengers FOR SELECT TO authenticated
  USING (
    public.has_any_privilege(ARRAY[
      'assets.view','assets.manage','assets.fleet','assets.repairs','assets.maintenance','admin.settings'
    ])
    OR EXISTS (
      SELECT 1 FROM vehicle_requests vr
       WHERE vr.id = request_id
         AND (vr.requested_by = public.current_employee_id()
              OR vr.created_by = public.current_employee_id())
    )
  );
