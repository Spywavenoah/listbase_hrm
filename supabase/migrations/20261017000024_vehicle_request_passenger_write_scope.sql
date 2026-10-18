-- ============================================================
-- Migration 24 — Close the remaining read leak on
-- vehicle_request_passengers.
--
-- Migration 23 rescoped the dedicated SELECT policy, but the
-- `write_vehicle_request_passengers` policy is FOR ALL, so its USING
-- clause also filters SELECT. That USING still contained a standalone
-- `has_any_privilege(['assets.request', ...])` branch with no parent
-- check — and `assets.request` is in the default bundle — so every
-- employee could still read all passengers.
--
-- The USING (read/update/delete) branch now requires genuine fleet or
-- asset oversight. Requesters keep write access to passengers on
-- their own requests via WITH CHECK.
-- ============================================================

DROP POLICY IF EXISTS "write_vehicle_request_passengers" ON vehicle_request_passengers;
CREATE POLICY "write_vehicle_request_passengers" ON vehicle_request_passengers FOR ALL TO authenticated
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
  )
  WITH CHECK (
    public.has_any_privilege(ARRAY['assets.request','assets.manage','assets.fleet','admin.settings'])
    OR EXISTS (
      SELECT 1 FROM vehicle_requests vr
       WHERE vr.id = request_id
         AND (vr.requested_by = public.current_employee_id()
              OR vr.created_by = public.current_employee_id())
    )
  );
