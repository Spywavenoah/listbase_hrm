/*
# Inventory enhancements: item media + barcode, rack/balance/history/expiry,
# low & over-stock thresholds, and warehouse Material Requests.

1. `inventory_items` gains `image_url`, `max_stock_level` (over-stock warning),
   `expiry_warning_days`; `barcode` is auto-generated when blank.
2. `inventory_stock` gains `expiry_date` (soonest batch expiry) so the system can
   warn early; `bin_location` doubles as the rack/aisle location.
3. `record_inventory_movement` maintains `expiry_date` on receipts and now lets
   `inventory.issue` holders deduct stock.
4. `material_requests` + `material_request_items` — a multi-line request to release
   warehouse stock, routed through the generic approval workflow
   (`inventory.material_request`); `issue_material_request` deducts stock when the
   warehouse releases it.
5. Inventory privileges `inventory.request` / `inventory.issue` and a public
   `inventory-items` storage bucket for product pictures.
*/

-- ============================================================
-- 1. Item media, thresholds & barcode
-- ============================================================
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS max_stock_level numeric(14,2),
  ADD COLUMN IF NOT EXISTS expiry_warning_days integer NOT NULL DEFAULT 30;

CREATE SEQUENCE IF NOT EXISTS inventory_barcode_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_inventory_barcode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.barcode IS NULL OR btrim(NEW.barcode) = '' THEN
    NEW.barcode := 'INV' || lpad(nextval('inventory_barcode_seq')::text, 8, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_inventory_barcode ON inventory_items;
CREATE TRIGGER trg_generate_inventory_barcode
BEFORE INSERT ON inventory_items
FOR EACH ROW EXECUTE FUNCTION public.generate_inventory_barcode();

-- Backfill existing items that have no barcode.
UPDATE inventory_items
   SET barcode = 'INV' || lpad(nextval('inventory_barcode_seq')::text, 8, '0')
 WHERE barcode IS NULL OR btrim(barcode) = '';

-- ============================================================
-- 2. Stock-level expiry tracking
-- ============================================================
ALTER TABLE inventory_stock
  ADD COLUMN IF NOT EXISTS expiry_date date;

CREATE INDEX IF NOT EXISTS idx_inventory_stock_expiry
  ON inventory_stock (expiry_date)
  WHERE expiry_date IS NOT NULL;

-- ============================================================
-- 3. record_inventory_movement: track expiry + allow inventory.issue
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
  v_exp date;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['inventory.manage','inventory.move','inventory.issue','procurement.receive','admin.settings']) THEN
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

  -- Only inbound movements carry an expiry date forward onto the stock balance.
  v_exp := CASE WHEN v_type IN ('RECEIPT', 'OPENING', 'RETURN') THEN p_expiry_date ELSE NULL END;

  INSERT INTO inventory_movements (
    movement_type, item_id, warehouse_id, dest_warehouse_id, quantity,
    resulting_quantity, unit_cost, total_cost, reference, notes,
    batch_no, expiry_date, movement_date, performed_by
  ) VALUES (
    v_type, p_item_id, p_warehouse_id, p_dest_warehouse_id, v_delta,
    v_new, v_cost, v_total, p_reference, p_notes,
    p_batch_no, p_expiry_date, COALESCE(p_movement_date, CURRENT_DATE), v_actor
  ) RETURNING id INTO v_movement_id;

  INSERT INTO inventory_stock (item_id, warehouse_id, quantity, expiry_date, updated_at)
  VALUES (p_item_id, p_warehouse_id, v_new, v_exp, now())
  ON CONFLICT (item_id, warehouse_id)
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    expiry_date = CASE
      WHEN EXCLUDED.expiry_date IS NULL THEN inventory_stock.expiry_date
      WHEN inventory_stock.expiry_date IS NULL THEN EXCLUDED.expiry_date
      ELSE LEAST(inventory_stock.expiry_date, EXCLUDED.expiry_date)
    END,
    updated_at = now();

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
-- 4. Privileges
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('inventory.request', 'Inventory', 'Create material requests', 'Raise material requests to release items from a warehouse', 208),
  ('inventory.issue',   'Inventory', 'Issue warehouse items',     'Approve and issue material requests, deducting stock', 210)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. Material requests (multi-line warehouse release + workflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS material_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE,
  requested_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES inventory_warehouses(id) ON DELETE SET NULL,
  purpose text,
  required_date date,
  priority text NOT NULL DEFAULT 'NORMAL',
  status text NOT NULL DEFAULT 'PENDING',
  notes text,
  workflow_instance_id uuid,
  issued_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  item_name text NOT NULL,
  uom text,
  quantity_requested numeric(14,2) NOT NULL DEFAULT 0,
  quantity_issued numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_requests_status ON material_requests (status);
CREATE INDEX IF NOT EXISTS idx_material_requests_requester ON material_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_material_request_items_request ON material_request_items (request_id);
CREATE INDEX IF NOT EXISTS idx_material_request_items_item ON material_request_items (item_id);

DROP TRIGGER IF EXISTS trg_material_requests_updated_at ON material_requests;
CREATE TRIGGER trg_material_requests_updated_at
BEFORE UPDATE ON material_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_inventory_updated_at();

ALTER TABLE material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_requests_read ON material_requests;
CREATE POLICY material_requests_read ON material_requests
  FOR SELECT USING (
    requested_by = public.current_employee_id()
    OR public.has_any_privilege(ARRAY['inventory.view','inventory.manage','inventory.move','inventory.issue','admin.settings'])
  );

DROP POLICY IF EXISTS material_requests_insert ON material_requests;
CREATE POLICY material_requests_insert ON material_requests
  FOR INSERT WITH CHECK (
    requested_by = public.current_employee_id()
    OR public.has_any_privilege(ARRAY['inventory.manage','inventory.request','admin.settings'])
  );

DROP POLICY IF EXISTS material_requests_update ON material_requests;
CREATE POLICY material_requests_update ON material_requests
  FOR UPDATE USING (
    requested_by = public.current_employee_id()
    OR public.has_any_privilege(ARRAY['inventory.manage','inventory.issue','admin.settings'])
  );

DROP POLICY IF EXISTS material_requests_delete ON material_requests;
CREATE POLICY material_requests_delete ON material_requests
  FOR DELETE USING (
    public.has_any_privilege(ARRAY['inventory.manage','admin.settings'])
    OR (requested_by = public.current_employee_id() AND status IN ('PENDING','DRAFT','CANCELLED'))
  );

DROP POLICY IF EXISTS material_request_items_read ON material_request_items;
CREATE POLICY material_request_items_read ON material_request_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM material_requests mr
       WHERE mr.id = request_id
         AND (
           mr.requested_by = public.current_employee_id()
           OR public.has_any_privilege(ARRAY['inventory.view','inventory.manage','inventory.move','inventory.issue','admin.settings'])
         )
    )
  );

DROP POLICY IF EXISTS material_request_items_write ON material_request_items;
CREATE POLICY material_request_items_write ON material_request_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM material_requests mr
       WHERE mr.id = request_id
         AND (
           mr.requested_by = public.current_employee_id()
           OR public.has_any_privilege(ARRAY['inventory.manage','inventory.request','inventory.issue','admin.settings'])
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM material_requests mr
       WHERE mr.id = request_id
         AND (
           mr.requested_by = public.current_employee_id()
           OR public.has_any_privilege(ARRAY['inventory.manage','inventory.request','inventory.issue','admin.settings'])
         )
    )
  );

-- Issue an approved material request: deduct stock for each line.
CREATE OR REPLACE FUNCTION public.issue_material_request(p_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req material_requests%ROWTYPE;
  v_count integer := 0;
  r RECORD;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['inventory.issue','inventory.manage','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to issue material requests';
  END IF;

  SELECT * INTO v_req FROM material_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material request not found'; END IF;
  IF v_req.status = 'ISSUED' THEN RETURN 0; END IF;
  IF v_req.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only approved material requests can be issued (current status: %)', v_req.status;
  END IF;
  IF v_req.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'This request has no warehouse to issue from';
  END IF;

  FOR r IN
    SELECT id, item_id, quantity_requested
      FROM material_request_items
     WHERE request_id = p_request_id AND COALESCE(quantity_requested, 0) > 0
  LOOP
    PERFORM public.record_inventory_movement(
      'ISSUE', r.item_id, v_req.warehouse_id, NULL, r.quantity_requested, NULL,
      v_req.request_number,
      'Issued against material request ' || v_req.request_number,
      NULL, NULL, CURRENT_DATE
    );
    UPDATE material_request_items
       SET quantity_issued = r.quantity_requested
     WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE material_requests
     SET status = 'ISSUED',
         issued_by = public.current_employee_id(),
         issued_at = now(),
         updated_at = now()
   WHERE id = p_request_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_material_request(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_material_request(uuid) FROM PUBLIC;

-- ============================================================
-- 6. Workflow integration for material requests
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
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_workflow_result ON workflow_instances;
CREATE TRIGGER trg_apply_workflow_result
AFTER UPDATE ON workflow_instances
FOR EACH ROW EXECUTE FUNCTION public.apply_workflow_result_to_record();

-- Default approval chain for material requests (Manager -> HR Admin), enabled.
DO $$
DECLARE v_def uuid;
BEGIN
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Material Request Approval', 'inventory.material_request', 'request.submitted',
    'Default warehouse material request approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'inventory.material_request' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'inventory.material_request', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'inventory.material_request');
END;
$$;

-- ============================================================
-- 7. Product picture storage bucket (public read)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inventory-items',
  'inventory-items',
  true,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS inventory_items_images_read ON storage.objects;
CREATE POLICY inventory_items_images_read ON storage.objects
  FOR SELECT USING (bucket_id = 'inventory-items');

DROP POLICY IF EXISTS inventory_items_images_insert ON storage.objects;
CREATE POLICY inventory_items_images_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'inventory-items'
    AND public.has_any_privilege(ARRAY['inventory.manage','admin.settings'])
  );

DROP POLICY IF EXISTS inventory_items_images_update ON storage.objects;
CREATE POLICY inventory_items_images_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'inventory-items'
    AND public.has_any_privilege(ARRAY['inventory.manage','admin.settings'])
  );

DROP POLICY IF EXISTS inventory_items_images_delete ON storage.objects;
CREATE POLICY inventory_items_images_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'inventory-items'
    AND public.has_any_privilege(ARRAY['inventory.manage','admin.settings'])
  );
