/*
# Procurement module

Vendor catalog + purchase orders with line items.

1. `procurement_vendors` — supplier master (name, contacts, tax id, status).
2. `purchase_orders` — PO header: vendor, requested_by, dates, status
   (DRAFT | PENDING_APPROVAL | APPROVED | RECEIVED | CANCELLED), notes.
3. `purchase_order_items` — line items with quantity/unit_price/total.
4. Security — read + write gated to the new `procurement.manage` privilege
   (registered in privilege_definitions below for the access-manager UI).
*/

-- ============================================================
-- 0. Privilege registration
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order)
VALUES ('procurement.manage', 'Procurement', 'Manage procurement', 'Manage vendors, purchase orders and requisitions', 67)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 1. Vendors
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  tax_id text,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE procurement_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "insert_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "update_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "delete_procurement_vendors" ON procurement_vendors;

CREATE POLICY "select_procurement_vendors" ON procurement_vendors FOR SELECT TO authenticated
  USING (public.has_privilege('procurement.manage'));

CREATE POLICY "insert_procurement_vendors" ON procurement_vendors FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('procurement.manage'));

CREATE POLICY "update_procurement_vendors" ON procurement_vendors FOR UPDATE TO authenticated
  USING (public.has_privilege('procurement.manage'))
  WITH CHECK (public.has_privilege('procurement.manage'));

CREATE POLICY "delete_procurement_vendors" ON procurement_vendors FOR DELETE TO authenticated
  USING (public.has_privilege('procurement.manage'));

-- ============================================================
-- 2. Purchase orders
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE,
  vendor_id uuid REFERENCES procurement_vendors(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  department_name text,
  order_date date DEFAULT CURRENT_DATE,
  expected_delivery date,
  status text NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "insert_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "update_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "delete_purchase_orders" ON purchase_orders;

CREATE POLICY "select_purchase_orders" ON purchase_orders FOR SELECT TO authenticated
  USING (public.has_privilege('procurement.manage'));

CREATE POLICY "insert_purchase_orders" ON purchase_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('procurement.manage'));

CREATE POLICY "update_purchase_orders" ON purchase_orders FOR UPDATE TO authenticated
  USING (public.has_privilege('procurement.manage'))
  WITH CHECK (public.has_privilege('procurement.manage'));

CREATE POLICY "delete_purchase_orders" ON purchase_orders FOR DELETE TO authenticated
  USING (public.has_privilege('procurement.manage'));

-- ============================================================
-- 3. Purchase order line items
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  description text,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (purchase_order_id, item_name)
);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "insert_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "update_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "delete_purchase_order_items" ON purchase_order_items;

CREATE POLICY "select_purchase_order_items" ON purchase_order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ));

CREATE POLICY "insert_purchase_order_items" ON purchase_order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ));

CREATE POLICY "update_purchase_order_items" ON purchase_order_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ));

CREATE POLICY "delete_purchase_order_items" ON purchase_order_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po
     WHERE po.id = purchase_order_id AND public.has_privilege('procurement.manage')
  ));