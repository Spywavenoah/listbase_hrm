-- Items master + vendor services/tags.
--
-- 1. `items` master table (CRUD). Feeds the item dropdowns used by procurement
--    requisitions, purchase orders and quotations (and future material/inventory
--    modules).
-- 2. Optional `item_id` links on the procurement line-item tables so a chosen
--    master item can be referenced alongside its free-text name.
-- 3. `procurement_vendors.services` / `.tags` arrays for filtering vendors that
--    sell similar items.

-- ============================================================
-- 1. Items master
-- ============================================================
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sku text,
  category text,
  uom text DEFAULT 'EA',
  description text,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_items_name ON items (lower(name));
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
CREATE INDEX IF NOT EXISTS idx_items_active ON items (is_active);

ALTER TABLE items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_items" ON items;
DROP POLICY IF EXISTS "insert_items" ON items;
DROP POLICY IF EXISTS "update_items" ON items;
DROP POLICY IF EXISTS "delete_items" ON items;

-- Everyone signed in can read the catalogue (needed for dropdowns).
CREATE POLICY "select_items" ON items FOR SELECT TO authenticated USING (true);

CREATE POLICY "insert_items" ON items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.manage', 'inventory.manage', 'admin.settings']));

CREATE POLICY "update_items" ON items FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.manage', 'inventory.manage', 'admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.manage', 'inventory.manage', 'admin.settings']));

CREATE POLICY "delete_items" ON items FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.manage', 'inventory.manage', 'admin.settings']));

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.touch_items_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_items_updated_at ON items;
CREATE TRIGGER trg_touch_items_updated_at
BEFORE UPDATE ON items
FOR EACH ROW EXECUTE FUNCTION public.touch_items_updated_at();

-- Seed a small starter catalogue (idempotent).
INSERT INTO items (name, sku, category, uom, unit_price)
VALUES
  ('A4 Paper Ream', 'STA-0001', 'Stationery', 'REAM', 4.50),
  ('Ballpoint Pen (Blue)', 'STA-0002', 'Stationery', 'EA', 0.60),
  ('Toner Cartridge', 'ICT-0001', 'ICT Consumables', 'EA', 65.00),
  ('Laptop - 14"', 'ICT-0002', 'ICT Equipment', 'EA', 950.00),
  ('Office Chair', 'FUR-0001', 'Furniture', 'EA', 120.00)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Link master items to procurement line items
-- ============================================================
ALTER TABLE procurement_requisition_items
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES items(id) ON DELETE SET NULL;
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES items(id) ON DELETE SET NULL;
ALTER TABLE procurement_quotation_items
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_requisition_items_item ON procurement_requisition_items (item_id);
CREATE INDEX IF NOT EXISTS idx_po_items_item ON purchase_order_items (item_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_item ON procurement_quotation_items (item_id);

-- ============================================================
-- 3. Vendor services + tags
-- ============================================================
ALTER TABLE procurement_vendors
  ADD COLUMN IF NOT EXISTS services text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_vendors_services ON procurement_vendors USING GIN (services);
CREATE INDEX IF NOT EXISTS idx_vendors_tags ON procurement_vendors USING GIN (tags);
