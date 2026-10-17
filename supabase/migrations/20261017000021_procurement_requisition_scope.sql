-- ============================================================
-- Migration 21 — Employee sees only their own procurement
-- requisitions by default.
--
-- Every employee receives `procurement.requisition_create` in the
-- default privilege bundle, so the previous
-- `SELECT USING (public.has_procurement_access())` policy let any
-- employee read every requisition (and the requisition items).
--
-- This migration introduces `has_procurement_oversight()` — the
-- procurement privileges that legitimately grant visibility beyond
-- one's own records — and rescopes the requisition tables:
--   * a creator sees only requisitions they raised;
--   * approvers / managers / other procurement roles keep full read.
--
-- Lookup / reference tables (categories, items, vendors, ...) are
-- intentionally left untouched so creators can still build a
-- requisition. Route guards already block creators from the other
-- procurement admin pages.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Oversight helper — has_procurement_access() minus the
--    create-only privilege that every employee holds.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_procurement_oversight()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_privilege(ARRAY[
    'procurement.manage',
    'procurement.dashboard',
    'procurement.requisition_approve',
    'procurement.rfq_manage',
    'procurement.quotation_manage',
    'procurement.quotation_evaluate',
    'procurement.po_create',
    'procurement.po_approve',
    'procurement.receive',
    'procurement.inspect',
    'procurement.invoice_manage',
    'procurement.invoice_approve',
    'procurement.payment_create',
    'procurement.payment_approve',
    'procurement.contract_manage',
    'procurement.settings',
    'admin.settings'
  ]);
$$;

GRANT EXECUTE ON FUNCTION public.has_procurement_oversight() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_procurement_oversight() FROM PUBLIC;

-- ------------------------------------------------------------
-- 2. Requisitions: own records unless the user has oversight.
--    The requester column is `requester_id`.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_procurement_requisitions" ON procurement_requisitions;
CREATE POLICY "select_procurement_requisitions" ON procurement_requisitions FOR SELECT TO authenticated
  USING (
    requester_id = public.current_employee_id()
    OR public.has_procurement_oversight()
  );

-- ------------------------------------------------------------
-- 3. Requisition items inherit the parent requisition's visibility.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "select_procurement_requisition_items" ON procurement_requisition_items;
CREATE POLICY "select_procurement_requisition_items" ON procurement_requisition_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_requisitions r
     WHERE r.id = requisition_id
       AND (r.requester_id = public.current_employee_id()
            OR public.has_procurement_oversight())
  ));
