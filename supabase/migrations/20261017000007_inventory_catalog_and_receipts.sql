/*
# Unify the item catalogue + post goods receipts into inventory

Turns `inventory_items` into the single master item catalogue and wires
procurement goods receipts into the stock ledger.

1. Merge the legacy `items` master into `inventory_items` (preserving the legacy
   id in `inventory_items.item_id`) so nothing is lost and procurement dropdowns
   can source from inventory.
2. Add `warehouse_id` / `inventory_posted` to `procurement_receipts`.
3. Allow `procurement.receive` holders to record inventory movements (a goods
   receiver should be able to post a receipt).
4. Add `post_receipt_to_inventory(receipt_id, warehouse_id)` which maps each
   accepted receipt line to an inventory item (by legacy link, then by name, or
   creates one) and records an inventory RECEIPT movement — atomically and
   idempotently.
*/

-- ============================================================
-- 1. Merge legacy `items` into `inventory_items`
-- ============================================================
-- Link existing inventory rows to their legacy master by name.
UPDATE inventory_items ii
   SET item_id = i.id
  FROM items i
 WHERE lower(ii.name) = lower(i.name)
   AND ii.item_id IS NULL;

-- Bring across legacy items that have no inventory counterpart yet.
INSERT INTO inventory_items (item_id, name, sku, uom, unit_cost, description, is_active)
SELECT i.id,
       i.name,
       CASE
         WHEN i.sku IS NOT NULL
          AND EXISTS (SELECT 1 FROM inventory_items x WHERE upper(x.sku) = upper(i.sku))
         THEN NULL
         ELSE i.sku
       END,
       COALESCE(NULLIF(i.uom, ''), 'EA'),
       COALESCE(i.unit_price, 0),
       i.description,
       COALESCE(i.is_active, true)
  FROM items i
 WHERE NOT EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.item_id = i.id)
   AND NOT EXISTS (SELECT 1 FROM inventory_items ii WHERE lower(ii.name) = lower(i.name));

-- ============================================================
-- 2. Receipt linkage columns
-- ============================================================
ALTER TABLE procurement_receipts
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inventory_posted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_receipts_warehouse ON procurement_receipts (warehouse_id);

-- ============================================================
-- 3. record_inventory_movement: also allow procurement.receive
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
  IF NOT public.has_any_privilege(ARRAY['inventory.manage','inventory.move','procurement.receive','admin.settings']) THEN
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
-- 4. Post a goods receipt into inventory
-- ============================================================
CREATE OR REPLACE FUNCTION public.post_receipt_to_inventory(
  p_receipt_id uuid,
  p_warehouse_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt procurement_receipts%ROWTYPE;
  v_wh uuid;
  v_count integer := 0;
  r RECORD;
  v_item uuid;
  v_uom text;
  v_cost numeric;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['inventory.move','inventory.manage','procurement.receive','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to post goods receipts to inventory';
  END IF;

  SELECT * INTO v_receipt FROM procurement_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goods receipt not found';
  END IF;
  IF v_receipt.inventory_posted THEN
    RETURN 0;
  END IF;

  v_wh := COALESCE(
    p_warehouse_id,
    v_receipt.warehouse_id,
    (SELECT id FROM inventory_warehouses WHERE is_default AND is_active ORDER BY created_at LIMIT 1),
    (SELECT id FROM inventory_warehouses WHERE is_active ORDER BY created_at LIMIT 1)
  );
  IF v_wh IS NULL THEN
    RAISE EXCEPTION 'No active warehouse is available to post this receipt into';
  END IF;

  FOR r IN
    SELECT ri.item_name,
           ri.quantity_accepted,
           poi.item_id AS legacy_item_id,
           poi.uom,
           poi.unit_price
      FROM procurement_receipt_items ri
      LEFT JOIN purchase_order_items poi ON poi.id = ri.po_item_id
     WHERE ri.receipt_id = p_receipt_id
       AND COALESCE(ri.quantity_accepted, 0) > 0
  LOOP
    v_uom := COALESCE(NULLIF(r.uom, ''), 'EA');
    v_cost := COALESCE(r.unit_price, 0);
    v_item := NULL;

    IF r.legacy_item_id IS NOT NULL THEN
      SELECT id INTO v_item FROM inventory_items WHERE item_id = r.legacy_item_id LIMIT 1;
    END IF;
    IF v_item IS NULL AND r.item_name IS NOT NULL THEN
      SELECT id INTO v_item FROM inventory_items WHERE lower(name) = lower(r.item_name) LIMIT 1;
    END IF;
    IF v_item IS NULL THEN
      INSERT INTO inventory_items (name, uom, unit_cost, item_id)
      VALUES (COALESCE(r.item_name, 'Unnamed item'), v_uom, v_cost, r.legacy_item_id)
      RETURNING id INTO v_item;
    END IF;

    PERFORM public.record_inventory_movement(
      'RECEIPT', v_item, v_wh, NULL, r.quantity_accepted, v_cost,
      v_receipt.receipt_number,
      'Auto-posted from goods receipt ' || v_receipt.receipt_number,
      NULL, NULL, v_receipt.received_date
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE procurement_receipts
     SET inventory_posted = true,
         warehouse_id = v_wh
   WHERE id = p_receipt_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_receipt_to_inventory(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.post_receipt_to_inventory(uuid, uuid) FROM PUBLIC;
