/*
# Inventory Module — multi-warehouse stock management

Adds a full inventory subsystem that sits alongside the rest of the ERP:

1. `inventory_warehouses`  — physical/virtual stock locations (multiple per company).
2. `inventory_categories`  — structured grouping for stockable items.
3. `inventory_items`       — the inventory/SKU catalogue (optionally linked to a
                             procurement master `items` row).
4. `inventory_stock`       — on-hand quantity per (item, warehouse).
5. `inventory_movements`   — immutable ledger of every stock movement
                             (receipts, issues, transfers, adjustments, returns).

A single SECURITY DEFINER RPC, `record_inventory_movement(...)`, atomically
writes the ledger row and updates on-hand quantities so stock can never drift.

New privileges: `inventory.view`, `inventory.manage`, `inventory.move`,
`inventory.settings`.
*/

-- ============================================================
-- 1. Privilege catalog entries
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('inventory.view',     'Inventory', 'View inventory',           'Read warehouses, items, stock levels and movement history', 200),
  ('inventory.manage',   'Inventory', 'Manage inventory',         'Create and edit inventory items and stock records', 202),
  ('inventory.move',     'Inventory', 'Record stock movements',   'Record receipts, issues, transfers and adjustments', 204),
  ('inventory.settings', 'Inventory', 'Manage warehouses & setup','Create warehouses and organise inventory categories', 206)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. Warehouses
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'MAIN',            -- MAIN, BRANCH, TRANSIT, QUARANTINE, VIRTUAL
  address text,
  city text,
  state text,
  country text,
  phone text,
  manager_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_warehouses_code ON inventory_warehouses (upper(code));
CREATE INDEX IF NOT EXISTS idx_inventory_warehouses_active ON inventory_warehouses (is_active);

ALTER TABLE inventory_warehouses ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Categories
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_categories_name ON inventory_categories (lower(name));
CREATE INDEX IF NOT EXISTS idx_inventory_categories_active ON inventory_categories (is_active);

ALTER TABLE inventory_categories ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Items (inventory catalogue)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,   -- optional link to procurement master
  category_id uuid REFERENCES inventory_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  sku text,
  barcode text,
  uom text NOT NULL DEFAULT 'EA',
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  reorder_level numeric(14,2) NOT NULL DEFAULT 0,
  reorder_quantity numeric(14,2) NOT NULL DEFAULT 0,
  is_tracked boolean NOT NULL DEFAULT false,             -- batch / serial tracked
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_sku ON inventory_items (upper(sku)) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_item ON inventory_items (item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items (category_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_active ON inventory_items (is_active);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. Stock (on hand per item + warehouse)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
  quantity numeric(14,2) NOT NULL DEFAULT 0,
  reserved_quantity numeric(14,2) NOT NULL DEFAULT 0,
  bin_location text,
  reorder_level numeric(14,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (item_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_item ON inventory_stock (item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_warehouse ON inventory_stock (warehouse_id);

ALTER TABLE inventory_stock ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. Movements (immutable ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type text NOT NULL,                 -- RECEIPT, ISSUE, ADJUSTMENT, TRANSFER, RETURN, OPENING
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES inventory_warehouses(id) ON DELETE RESTRICT,
  dest_warehouse_id uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL,
  quantity numeric(14,2) NOT NULL DEFAULT 0,   -- signed effect on the source warehouse
  resulting_quantity numeric(14,2),
  unit_cost numeric(14,2),
  total_cost numeric(16,2),
  reference text,
  notes text,
  batch_no text,
  expiry_date date,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  performed_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements (item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_warehouse ON inventory_movements (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements (movement_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_date ON inventory_movements (movement_date);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_inventory_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_inventory_warehouses ON inventory_warehouses;
CREATE TRIGGER trg_touch_inventory_warehouses
BEFORE UPDATE ON inventory_warehouses
FOR EACH ROW EXECUTE FUNCTION public.touch_inventory_updated_at();

DROP TRIGGER IF EXISTS trg_touch_inventory_categories ON inventory_categories;
CREATE TRIGGER trg_touch_inventory_categories
BEFORE UPDATE ON inventory_categories
FOR EACH ROW EXECUTE FUNCTION public.touch_inventory_updated_at();

DROP TRIGGER IF EXISTS trg_touch_inventory_items ON inventory_items;
CREATE TRIGGER trg_touch_inventory_items
BEFORE UPDATE ON inventory_items
FOR EACH ROW EXECUTE FUNCTION public.touch_inventory_updated_at();

DROP TRIGGER IF EXISTS trg_touch_inventory_stock ON inventory_stock;
CREATE TRIGGER trg_touch_inventory_stock
BEFORE UPDATE ON inventory_stock
FOR EACH ROW EXECUTE FUNCTION public.touch_inventory_updated_at();

-- ============================================================
-- 8. Row level security
-- ============================================================
-- Read access: any inventory privilege (or admin).
-- Warehouses / categories writes: inventory.settings / inventory.manage / admin.
-- Items writes: inventory.manage / admin.
-- Movements writes: through the RPC (grants handled below); direct writes limited.

DROP POLICY IF EXISTS "select_inventory_warehouses" ON inventory_warehouses;
DROP POLICY IF EXISTS "insert_inventory_warehouses" ON inventory_warehouses;
DROP POLICY IF EXISTS "update_inventory_warehouses" ON inventory_warehouses;
DROP POLICY IF EXISTS "delete_inventory_warehouses" ON inventory_warehouses;
CREATE POLICY "select_inventory_warehouses" ON inventory_warehouses FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.view','inventory.manage','inventory.move','inventory.settings','admin.settings']));
CREATE POLICY "insert_inventory_warehouses" ON inventory_warehouses FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['inventory.manage','inventory.settings','admin.settings']));
CREATE POLICY "update_inventory_warehouses" ON inventory_warehouses FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.manage','inventory.settings','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['inventory.manage','inventory.settings','admin.settings']));
CREATE POLICY "delete_inventory_warehouses" ON inventory_warehouses FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.manage','inventory.settings','admin.settings']));

DROP POLICY IF EXISTS "select_inventory_categories" ON inventory_categories;
DROP POLICY IF EXISTS "insert_inventory_categories" ON inventory_categories;
DROP POLICY IF EXISTS "update_inventory_categories" ON inventory_categories;
DROP POLICY IF EXISTS "delete_inventory_categories" ON inventory_categories;
CREATE POLICY "select_inventory_categories" ON inventory_categories FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "insert_inventory_categories" ON inventory_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['inventory.manage','inventory.settings','admin.settings']));
CREATE POLICY "update_inventory_categories" ON inventory_categories FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.manage','inventory.settings','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['inventory.manage','inventory.settings','admin.settings']));
CREATE POLICY "delete_inventory_categories" ON inventory_categories FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.manage','inventory.settings','admin.settings']));

DROP POLICY IF EXISTS "select_inventory_items" ON inventory_items;
DROP POLICY IF EXISTS "insert_inventory_items" ON inventory_items;
DROP POLICY IF EXISTS "update_inventory_items" ON inventory_items;
DROP POLICY IF EXISTS "delete_inventory_items" ON inventory_items;
CREATE POLICY "select_inventory_items" ON inventory_items FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "insert_inventory_items" ON inventory_items FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['inventory.manage','admin.settings']));
CREATE POLICY "update_inventory_items" ON inventory_items FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.manage','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['inventory.manage','admin.settings']));
CREATE POLICY "delete_inventory_items" ON inventory_items FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.manage','admin.settings']));

DROP POLICY IF EXISTS "select_inventory_stock" ON inventory_stock;
DROP POLICY IF EXISTS "insert_inventory_stock" ON inventory_stock;
DROP POLICY IF EXISTS "update_inventory_stock" ON inventory_stock;
DROP POLICY IF EXISTS "delete_inventory_stock" ON inventory_stock;
CREATE POLICY "select_inventory_stock" ON inventory_stock FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.view','inventory.manage','inventory.move','admin.settings']));
CREATE POLICY "insert_inventory_stock" ON inventory_stock FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings']));
CREATE POLICY "update_inventory_stock" ON inventory_stock FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings']));
CREATE POLICY "delete_inventory_stock" ON inventory_stock FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.manage','admin.settings']));

DROP POLICY IF EXISTS "select_inventory_movements" ON inventory_movements;
DROP POLICY IF EXISTS "insert_inventory_movements" ON inventory_movements;
CREATE POLICY "select_inventory_movements" ON inventory_movements FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['inventory.view','inventory.manage','inventory.move','admin.settings']));
CREATE POLICY "insert_inventory_movements" ON inventory_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings']));

-- ============================================================
-- 9. Movement RPC — atomic ledger + stock update
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_type text,
  p_item_id uuid,
  p_warehouse_id uuid,
  p_dest_warehouse_id uuid DEFAULT NULL,
  p_quantity numeric DEFAULT 0,
  p_unit_cost numeric DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_batch_no text DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_movement_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text := upper(trim(p_type));
  v_actor uuid := public.current_employee_id();
  v_current numeric := 0;
  v_new numeric := 0;
  v_delta numeric := 0;
  v_qty numeric := COALESCE(p_quantity, 0);
  v_cost numeric := COALESCE(p_unit_cost, 0);
  v_movement_id uuid;
  v_total numeric;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to record inventory movements';
  END IF;

  IF v_type NOT IN ('RECEIPT','ISSUE','ADJUSTMENT','TRANSFER','RETURN','OPENING') THEN
    RAISE EXCEPTION 'Invalid movement type: %', p_type;
  END IF;

  IF p_item_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and warehouse are required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM inventory_items WHERE id = p_item_id) THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM inventory_warehouses WHERE id = p_warehouse_id) THEN
    RAISE EXCEPTION 'Warehouse not found';
  END IF;

  IF v_type = 'TRANSFER' THEN
    IF p_dest_warehouse_id IS NULL OR p_dest_warehouse_id = p_warehouse_id THEN
      RAISE EXCEPTION 'A different destination warehouse is required for transfers';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM inventory_warehouses WHERE id = p_dest_warehouse_id) THEN
      RAISE EXCEPTION 'Destination warehouse not found';
    END IF;
  END IF;

  IF v_qty < 0 THEN
    RAISE EXCEPTION 'Quantity cannot be negative';
  END IF;

  SELECT COALESCE(quantity, 0) INTO v_current
    FROM inventory_stock
   WHERE item_id = p_item_id AND warehouse_id = p_warehouse_id;
  v_current := COALESCE(v_current, 0);

  IF v_type IN ('RECEIPT', 'OPENING', 'RETURN') THEN
    v_delta := v_qty;
  ELSIF v_type = 'ISSUE' THEN
    v_delta := -v_qty;
  ELSIF v_type = 'TRANSFER' THEN
    v_delta := -v_qty;
  ELSIF v_type = 'ADJUSTMENT' THEN
    v_delta := v_qty - v_current;   -- p_quantity is the new counted quantity
  END IF;

  v_new := v_current + v_delta;

  IF v_new < 0 THEN
    RAISE EXCEPTION 'Insufficient stock: % on hand, % requested', v_current, v_qty;
  END IF;

  v_total := CASE WHEN v_type IN ('RECEIPT', 'OPENING', 'RETURN') THEN v_qty * v_cost ELSE NULL END;

  INSERT INTO inventory_movements (
    movement_type, item_id, warehouse_id, dest_warehouse_id, quantity,
    resulting_quantity, unit_cost, total_cost, reference, notes,
    batch_no, expiry_date, movement_date, performed_by
  ) VALUES (
    v_type, p_item_id, p_warehouse_id, p_dest_warehouse_id, v_delta,
    v_new, v_cost, v_total, p_reference, p_notes,
    p_batch_no, p_expiry_date, COALESCE(p_movement_date, CURRENT_DATE), v_actor
  ) RETURNING id INTO v_movement_id;

  INSERT INTO inventory_stock (item_id, warehouse_id, quantity, updated_at)
  VALUES (p_item_id, p_warehouse_id, v_new, now())
  ON CONFLICT (item_id, warehouse_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

  IF v_type = 'TRANSFER' THEN
    INSERT INTO inventory_stock (item_id, warehouse_id, quantity, updated_at)
    VALUES (p_item_id, p_dest_warehouse_id, v_qty, now())
    ON CONFLICT (item_id, warehouse_id)
    DO UPDATE SET quantity = inventory_stock.quantity + EXCLUDED.quantity, updated_at = now();
  END IF;

  RETURN v_movement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_inventory_movement(text, uuid, uuid, uuid, numeric, numeric, text, text, text, date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_inventory_movement(text, uuid, uuid, uuid, numeric, numeric, text, text, text, date, date) FROM PUBLIC;

-- ============================================================
-- 10. Seed starter data (idempotent)
-- ============================================================
INSERT INTO inventory_warehouses (code, name, type, city, state, country, is_active, is_default)
VALUES ('MAIN', 'Main Warehouse', 'MAIN', NULL, NULL, NULL, true, true)
ON CONFLICT DO NOTHING;

INSERT INTO inventory_categories (code, name, description) VALUES
  ('GEN', 'General', 'General purpose stock items'),
  ('ICT', 'ICT', 'Computers, peripherals and ICT consumables'),
  ('STA', 'Stationery', 'Office stationery and paper'),
  ('FUR', 'Furniture', 'Office furniture and fittings'),
  ('CON', 'Consumables', 'Day-to-day consumable supplies')
ON CONFLICT DO NOTHING;

INSERT INTO inventory_items (category_id, name, sku, uom, unit_cost, reorder_level, reorder_quantity)
SELECT c.id, v.name, v.sku, v.uom, v.unit_cost, v.reorder_level, v.reorder_quantity
FROM (VALUES
  ('Stationery', 'A4 Paper Ream',   'STA-0001', 'REAM', 4.50, 20, 50),
  ('ICT',        'Toner Cartridge',  'ICT-0001', 'EA',   65.00, 5, 15),
  ('General',    'Ballpoint Pen (Blue)', 'STA-0002', 'EA', 0.60, 50, 200),
  ('Furniture',  'Office Chair',     'FUR-0001', 'EA',   120.00, 2, 5)
) AS v(category, name, sku, uom, unit_cost, reorder_level, reorder_quantity)
JOIN inventory_categories c ON c.name = v.category
ON CONFLICT DO NOTHING;
