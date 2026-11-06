/*
# Inventory receiving + material issue receipts

Brings the two controlled warehouse workflows from the reference procurement
app into the inventory module:

1. Goods Receipt Notes (GRN) with a three-stage lifecycle:
   create delivery -> inspect lines -> acknowledge and post accepted stock.
2. Material issue receipts with partial issuance against an approved material
   request, plus recipient/signed-copy acknowledgement and an event history.
3. Availability checks respect `inventory_stock.reserved_quantity`.

New tables:
  inventory_receipts / inventory_receipt_items
  material_issue_receipts / material_issue_receipt_items / material_issue_events

New RPCs:
  create_inventory_receipt(...)
  inspect_inventory_receipt(...)
  acknowledge_inventory_receipt(...)
  issue_material_request_partial(...)
  acknowledge_material_issue_receipt(...)

Existing privileges are reused:
  inventory.view / inventory.manage / inventory.move / inventory.issue
*/

-- ============================================================
-- 1. Goods receipt header + lines
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  warehouse_id uuid NOT NULL REFERENCES inventory_warehouses(id) ON DELETE RESTRICT,
  supplier_name text,
  source_reference text,             -- PO number / waybill reference
  delivery_note_ref text,
  po_document_ref text,
  received_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'PENDING_INSPECTION',
  inspection_remarks text,
  inspected_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  inspected_at timestamptz,
  acknowledged_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  acknowledgement_remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_receipts_status_check
    CHECK (status IN ('PENDING_INSPECTION','INSPECTED','ACKNOWLEDGED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS inventory_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES inventory_receipts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  delivered_qty numeric(14,2) NOT NULL CHECK (delivered_qty > 0),
  accepted_qty numeric(14,2),
  rejected_qty numeric(14,2),
  verdict text,
  outcome text,
  inspection_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, item_id),
  CONSTRAINT inventory_receipt_items_verdict_check
    CHECK (verdict IS NULL OR verdict IN ('CONFORMING','DAMAGED','INCORRECT_SPEC','SHORTAGE','EXCESS')),
  CONSTRAINT inventory_receipt_items_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('ACCEPTED','ACCEPTED_WITH_COMMENT','REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_receipts_status ON inventory_receipts (status);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_warehouse ON inventory_receipts (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipts_date ON inventory_receipts (received_date);
CREATE INDEX IF NOT EXISTS idx_inventory_receipt_items_receipt ON inventory_receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS idx_inventory_receipt_items_item ON inventory_receipt_items (item_id);

DROP TRIGGER IF EXISTS trg_touch_inventory_receipts ON inventory_receipts;
CREATE TRIGGER trg_touch_inventory_receipts
BEFORE UPDATE ON inventory_receipts
FOR EACH ROW EXECUTE FUNCTION public.touch_inventory_updated_at();

-- ============================================================
-- 2. Material issue receipts + event history
-- ============================================================
ALTER TABLE material_request_items ADD COLUMN IF NOT EXISTS quantity_approved numeric(14,2);
UPDATE material_request_items
   SET quantity_approved = quantity_requested
 WHERE quantity_approved IS NULL;

CREATE TABLE IF NOT EXISTS material_issue_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  request_id uuid NOT NULL REFERENCES material_requests(id) ON DELETE RESTRICT,
  issued_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  recipient_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  recipient_name text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  acknowledgement_method text,
  signed_document_url text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_issue_receipts_method_check
    CHECK (acknowledgement_method IS NULL OR acknowledgement_method IN ('RECIPIENT','SIGNED_COPY'))
);

CREATE TABLE IF NOT EXISTS material_issue_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES material_issue_receipts(id) ON DELETE CASCADE,
  request_item_id uuid NOT NULL REFERENCES material_request_items(id) ON DELETE RESTRICT,
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, request_item_id)
);

CREATE TABLE IF NOT EXISTS material_issue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  event text NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_issue_receipts_request ON material_issue_receipts (request_id);
CREATE INDEX IF NOT EXISTS idx_material_issue_receipts_issued ON material_issue_receipts (issued_at);
CREATE INDEX IF NOT EXISTS idx_material_issue_receipt_items_receipt ON material_issue_receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS idx_material_issue_receipt_items_line ON material_issue_receipt_items (request_item_id);
CREATE INDEX IF NOT EXISTS idx_material_issue_events_request ON material_issue_events (request_id);

-- ============================================================
-- 3. Row level security
-- ============================================================
ALTER TABLE inventory_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_issue_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_issue_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_issue_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_receipts_read ON inventory_receipts;
DROP POLICY IF EXISTS inventory_receipts_write ON inventory_receipts;
DROP POLICY IF EXISTS inventory_receipts_delete ON inventory_receipts;
CREATE POLICY inventory_receipts_read ON inventory_receipts
  FOR SELECT USING (
    public.has_any_privilege(ARRAY['inventory.view','inventory.manage','inventory.move','inventory.issue','admin.settings'])
  );
CREATE POLICY inventory_receipts_write ON inventory_receipts
  FOR ALL USING (
    public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings'])
  )
  WITH CHECK (
    public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings'])
  );
CREATE POLICY inventory_receipts_delete ON inventory_receipts
  FOR DELETE USING (
    public.has_any_privilege(ARRAY['inventory.manage','admin.settings'])
  );

DROP POLICY IF EXISTS inventory_receipt_items_read ON inventory_receipt_items;
DROP POLICY IF EXISTS inventory_receipt_items_write ON inventory_receipt_items;
CREATE POLICY inventory_receipt_items_read ON inventory_receipt_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM inventory_receipts r
       WHERE r.id = receipt_id
         AND public.has_any_privilege(ARRAY['inventory.view','inventory.manage','inventory.move','inventory.issue','admin.settings'])
    )
  );
CREATE POLICY inventory_receipt_items_write ON inventory_receipt_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM inventory_receipts r
       WHERE r.id = receipt_id
         AND public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inventory_receipts r
       WHERE r.id = receipt_id
         AND public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings'])
    )
  );

DROP POLICY IF EXISTS material_issue_receipts_read ON material_issue_receipts;
DROP POLICY IF EXISTS material_issue_receipts_write ON material_issue_receipts;
CREATE POLICY material_issue_receipts_read ON material_issue_receipts
  FOR SELECT USING (
    recipient_employee_id = public.current_employee_id()
    OR EXISTS (
      SELECT 1 FROM material_requests mr
       WHERE mr.id = request_id
         AND (
           mr.requested_by = public.current_employee_id()
           OR public.has_any_privilege(ARRAY['inventory.view','inventory.manage','inventory.move','inventory.issue','admin.settings'])
         )
    )
  );
-- Acknowledging is done through acknowledge_material_issue_receipt(), which
-- checks that the caller is the named recipient or a warehouse officer.
CREATE POLICY material_issue_receipts_write ON material_issue_receipts
  FOR ALL USING (
    public.has_any_privilege(ARRAY['inventory.manage','inventory.issue','admin.settings'])
  )
  WITH CHECK (
    public.has_any_privilege(ARRAY['inventory.manage','inventory.issue','admin.settings'])
  );

DROP POLICY IF EXISTS material_issue_receipt_items_read ON material_issue_receipt_items;
DROP POLICY IF EXISTS material_issue_receipt_items_write ON material_issue_receipt_items;
CREATE POLICY material_issue_receipt_items_read ON material_issue_receipt_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM material_issue_receipts r
       WHERE r.id = receipt_id
         AND (
           r.recipient_employee_id = public.current_employee_id()
           OR EXISTS (
             SELECT 1 FROM material_requests mr
              WHERE mr.id = r.request_id
                AND (
                  mr.requested_by = public.current_employee_id()
                  OR public.has_any_privilege(ARRAY['inventory.view','inventory.manage','inventory.move','inventory.issue','admin.settings'])
                )
           )
         )
    )
  );
CREATE POLICY material_issue_receipt_items_write ON material_issue_receipt_items
  FOR ALL USING (
    public.has_any_privilege(ARRAY['inventory.manage','inventory.issue','admin.settings'])
  )
  WITH CHECK (
    public.has_any_privilege(ARRAY['inventory.manage','inventory.issue','admin.settings'])
  );

DROP POLICY IF EXISTS material_issue_events_read ON material_issue_events;
DROP POLICY IF EXISTS material_issue_events_write ON material_issue_events;
CREATE POLICY material_issue_events_read ON material_issue_events
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
CREATE POLICY material_issue_events_write ON material_issue_events
  FOR ALL USING (
    public.has_any_privilege(ARRAY['inventory.manage','inventory.issue','admin.settings'])
  )
  WITH CHECK (
    public.has_any_privilege(ARRAY['inventory.manage','inventory.issue','admin.settings'])
  );

-- ============================================================
-- 4. Create a goods receipt (delivery registration)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_inventory_receipt(
  p_warehouse_id uuid,
  p_rows jsonb,
  p_supplier_name text DEFAULT NULL,
  p_source_reference text DEFAULT NULL,
  p_delivery_note_ref text DEFAULT NULL,
  p_po_document_ref text DEFAULT NULL,
  p_received_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_number text;
  v_count integer := 0;
  v_seen uuid[] := ARRAY[]::uuid[];
  r jsonb;
  v_item uuid;
  v_qty numeric;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to register goods receipts';
  END IF;

  IF p_warehouse_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM inventory_warehouses WHERE id = p_warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'Select an active receiving warehouse';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Add at least one delivered item';
  END IF;
  IF jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION 'A receipt may contain at most 200 items';
  END IF;

  v_number := 'GRN-' || to_char(COALESCE(p_received_date, CURRENT_DATE), 'YYYYMMDD') || '-'
              || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO inventory_receipts (
    id, receipt_number, warehouse_id, supplier_name, source_reference,
    delivery_note_ref, po_document_ref, received_by, received_date
  ) VALUES (
    v_id, v_number, p_warehouse_id, nullif(trim(p_supplier_name), ''),
    nullif(trim(p_source_reference), ''), nullif(trim(p_delivery_note_ref), ''),
    nullif(trim(p_po_document_ref), ''), public.current_employee_id(),
    COALESCE(p_received_date, CURRENT_DATE)
  );

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_item := (r ->> 'item_id')::uuid;
    v_qty := COALESCE((r ->> 'quantity')::numeric, 0);

    IF v_item IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Every delivered item needs a positive quantity';
    END IF;
    IF v_item = ANY(v_seen) THEN
      RAISE EXCEPTION 'An item may appear only once on a receipt';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM inventory_items WHERE id = v_item AND is_active) THEN
      RAISE EXCEPTION 'Select an active inventory item';
    END IF;

    INSERT INTO inventory_receipt_items (receipt_id, item_id, delivered_qty)
    VALUES (v_id, v_item, v_qty);

    v_seen := array_append(v_seen, v_item);
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Add at least one delivered item';
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_inventory_receipt(uuid, jsonb, text, text, text, text, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_inventory_receipt(uuid, jsonb, text, text, text, text, date) FROM PUBLIC;

-- ============================================================
-- 5. Inspect a goods receipt line by line
-- ============================================================
CREATE OR REPLACE FUNCTION public.inspect_inventory_receipt(
  p_receipt_id uuid,
  p_rows jsonb,
  p_remarks text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt inventory_receipts%ROWTYPE;
  v_delivered numeric;
  v_accepted numeric;
  v_rejected numeric;
  v_verdict text;
  v_outcome text;
  v_comment text;
  v_item uuid;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
  v_expected integer;
  r jsonb;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to inspect goods receipts';
  END IF;

  SELECT * INTO v_receipt FROM inventory_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goods receipt not found';
  END IF;
  IF v_receipt.status <> 'PENDING_INSPECTION' THEN
    RAISE EXCEPTION 'Only a receipt pending inspection can be inspected (current status: %)', v_receipt.status;
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Inspect every delivered item';
  END IF;

  SELECT count(*) INTO v_expected FROM inventory_receipt_items WHERE receipt_id = p_receipt_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_item := (r ->> 'item_id')::uuid;
    v_verdict := upper(COALESCE(nullif(trim(r ->> 'verdict'), ''), 'CONFORMING'));
    v_outcome := upper(COALESCE(nullif(trim(r ->> 'outcome'), ''), 'ACCEPTED'));
    v_comment := nullif(trim(COALESCE(r ->> 'comment', '')), '');

    SELECT delivered_qty INTO v_delivered
      FROM inventory_receipt_items
     WHERE receipt_id = p_receipt_id AND item_id = v_item
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inspection lines must belong to this receipt';
    END IF;
    IF v_item = ANY(v_seen) THEN
      RAISE EXCEPTION 'Do not repeat an inspection item';
    END IF;

    v_accepted := COALESCE((r ->> 'accepted_qty')::numeric, v_delivered);

    IF v_accepted < 0 OR v_accepted > v_delivered THEN
      RAISE EXCEPTION 'Accepted quantity cannot exceed the delivered quantity';
    END IF;
    IF v_verdict NOT IN ('CONFORMING','DAMAGED','INCORRECT_SPEC','SHORTAGE','EXCESS') THEN
      RAISE EXCEPTION 'Choose a valid inspection verdict';
    END IF;
    IF v_outcome NOT IN ('ACCEPTED','ACCEPTED_WITH_COMMENT','REJECTED') THEN
      RAISE EXCEPTION 'Choose a valid receiving decision';
    END IF;

    v_rejected := v_delivered - v_accepted;

    IF v_outcome = 'ACCEPTED' AND (v_rejected > 0 OR v_verdict <> 'CONFORMING') THEN
      RAISE EXCEPTION 'Use "accepted with comment" when there is a discrepancy';
    END IF;
    IF v_outcome = 'ACCEPTED_WITH_COMMENT' AND v_comment IS NULL THEN
      RAISE EXCEPTION 'Add a comment for a conditional acceptance';
    END IF;
    IF v_outcome = 'REJECTED' AND v_accepted > 0 THEN
      RAISE EXCEPTION 'Rejected items must have zero accepted quantity';
    END IF;
    IF v_outcome = 'REJECTED' AND v_comment IS NULL THEN
      RAISE EXCEPTION 'Add a comment explaining the rejection';
    END IF;

    UPDATE inventory_receipt_items
       SET accepted_qty = v_accepted,
           rejected_qty = v_rejected,
           verdict = v_verdict,
           outcome = v_outcome,
           inspection_comment = v_comment
     WHERE receipt_id = p_receipt_id AND item_id = v_item;

    v_seen := array_append(v_seen, v_item);
    v_count := v_count + 1;
  END LOOP;

  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'Inspect every delivered item before completing the inspection';
  END IF;

  UPDATE inventory_receipts
     SET status = 'INSPECTED',
         inspected_by = public.current_employee_id(),
         inspected_at = now(),
         inspection_remarks = nullif(trim(p_remarks), ''),
         updated_at = now()
   WHERE id = p_receipt_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inspect_inventory_receipt(uuid, jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.inspect_inventory_receipt(uuid, jsonb, text) FROM PUBLIC;

-- ============================================================
-- 6. Acknowledge a receipt and post accepted quantities
-- ============================================================
CREATE OR REPLACE FUNCTION public.acknowledge_inventory_receipt(
  p_receipt_id uuid,
  p_remarks text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt inventory_receipts%ROWTYPE;
  v_total numeric := 0;
  v_incomplete integer;
  r RECORD;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to acknowledge goods receipts';
  END IF;

  SELECT * INTO v_receipt FROM inventory_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goods receipt not found';
  END IF;
  IF v_receipt.status <> 'INSPECTED' THEN
    RAISE EXCEPTION 'Only an inspected receipt can be acknowledged (current status: %)', v_receipt.status;
  END IF;

  SELECT count(*) INTO v_incomplete
    FROM inventory_receipt_items
   WHERE receipt_id = p_receipt_id
     AND (outcome IS NULL OR accepted_qty IS NULL OR rejected_qty IS NULL);

  IF v_incomplete > 0 THEN
    RAISE EXCEPTION 'Complete all inspection decisions first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM inventory_receipt_items
     WHERE receipt_id = p_receipt_id AND accepted_qty > 0
  ) THEN
    RAISE EXCEPTION 'A receipt with no accepted quantity cannot post stock';
  END IF;

  FOR r IN
    SELECT iri.item_id, iri.accepted_qty, ii.unit_cost
      FROM inventory_receipt_items iri
      JOIN inventory_items ii ON ii.id = iri.item_id
     WHERE iri.receipt_id = p_receipt_id
       AND iri.accepted_qty > 0
  LOOP
    PERFORM public.record_inventory_movement(
      'RECEIPT', r.item_id, v_receipt.warehouse_id, NULL, r.accepted_qty, r.unit_cost,
      v_receipt.receipt_number,
      'Goods receipt acknowledged' ||
        CASE WHEN v_receipt.supplier_name IS NOT NULL THEN ' · ' || v_receipt.supplier_name ELSE '' END,
      NULL, NULL, v_receipt.received_date
    );
    v_total := v_total + r.accepted_qty;
  END LOOP;

  UPDATE inventory_receipts
     SET status = 'ACKNOWLEDGED',
         acknowledged_by = public.current_employee_id(),
         acknowledged_at = now(),
         acknowledgement_remarks = nullif(trim(p_remarks), ''),
         updated_at = now()
   WHERE id = p_receipt_id;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_inventory_receipt(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.acknowledge_inventory_receipt(uuid, text) FROM PUBLIC;

-- ============================================================
-- 7. Partial material issue against an approved request
-- ============================================================
CREATE OR REPLACE FUNCTION public.issue_material_request_partial(
  p_request_id uuid,
  p_lines jsonb,
  p_recipient_employee_id uuid DEFAULT NULL,
  p_recipient_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req material_requests%ROWTYPE;
  v_receipt_id uuid := gen_random_uuid();
  v_number text;
  v_line material_request_items%ROWTYPE;
  v_line_id uuid;
  v_qty numeric;
  v_approved numeric;
  v_available numeric;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
  v_recipient uuid;
  v_recipient_name text;
  v_all_issued boolean;
  r jsonb;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['inventory.issue','inventory.manage','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to issue material requests';
  END IF;

  SELECT * INTO v_req FROM material_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Material request not found';
  END IF;
  IF v_req.status NOT IN ('APPROVED','PARTIALLY_ISSUED') THEN
    RAISE EXCEPTION 'Only an approved request with outstanding quantities can be issued (current status: %)', v_req.status;
  END IF;
  IF v_req.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'This request has no warehouse to issue from';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Enter at least one issue quantity';
  END IF;

  v_recipient := COALESCE(p_recipient_employee_id, v_req.requested_by);
  IF v_recipient IS NOT NULL THEN
    SELECT COALESCE(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Employee')
      INTO v_recipient_name
      FROM employees
     WHERE id = v_recipient;
  END IF;
  v_recipient_name := COALESCE(
    nullif(trim(p_recipient_name), ''),
    v_recipient_name,
    nullif(trim(v_req.purpose), ''),
    'Not recorded'
  );

  v_number := 'MIN-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-'
              || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO material_issue_receipts (
    id, receipt_number, request_id, issued_by, recipient_employee_id, recipient_name
  ) VALUES (
    v_receipt_id, v_number, p_request_id, public.current_employee_id(), v_recipient, v_recipient_name
  );

  FOR r IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := COALESCE((r ->> 'request_item_id')::uuid, (r ->> 'id')::uuid);
    v_qty := COALESCE((r ->> 'quantity')::numeric, 0);

    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_line
      FROM material_request_items
     WHERE id = v_line_id AND request_id = p_request_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Issue lines must belong to this material request';
    END IF;
    IF v_line_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'Do not repeat a material issue line';
    END IF;

    v_approved := COALESCE(v_line.quantity_approved, v_line.quantity_requested);
    IF v_qty > (v_approved - COALESCE(v_line.quantity_issued, 0)) + 0.0001 THEN
      RAISE EXCEPTION 'Issue quantity for % exceeds the approved outstanding quantity', v_line.item_name;
    END IF;

    SELECT COALESCE(quantity, 0) - COALESCE(reserved_quantity, 0)
      INTO v_available
      FROM inventory_stock
     WHERE item_id = v_line.item_id AND warehouse_id = v_req.warehouse_id;
    v_available := COALESCE(v_available, 0);

    IF v_qty > v_available THEN
      RAISE EXCEPTION 'Insufficient available stock for %: % available, % requested',
        v_line.item_name, v_available, v_qty;
    END IF;

    INSERT INTO material_issue_receipt_items (receipt_id, request_item_id, quantity)
    VALUES (v_receipt_id, v_line_id, v_qty);

    UPDATE material_request_items
       SET quantity_issued = COALESCE(quantity_issued, 0) + v_qty
     WHERE id = v_line_id;

    PERFORM public.record_inventory_movement(
      'ISSUE', v_line.item_id, v_req.warehouse_id, NULL, v_qty, NULL,
      v_number,
      'Issued against material request ' || v_req.request_number,
      NULL, NULL, CURRENT_DATE
    );

    v_seen := array_append(v_seen, v_line_id);
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Enter at least one positive issue quantity';
  END IF;

  SELECT bool_and(COALESCE(quantity_issued, 0) >= COALESCE(quantity_approved, quantity_requested))
    INTO v_all_issued
    FROM material_request_items
   WHERE request_id = p_request_id
     AND COALESCE(quantity_requested, 0) > 0;

  UPDATE material_requests
     SET status = CASE WHEN COALESCE(v_all_issued, false) THEN 'ISSUED' ELSE 'PARTIALLY_ISSUED' END,
         issued_by = public.current_employee_id(),
         issued_at = now(),
         updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO material_issue_events (request_id, actor_id, event, comment)
  VALUES (
    p_request_id,
    public.current_employee_id(),
    'Materials issued',
    v_number || ' · ' || v_count || ' line(s) · Receiver: ' || v_recipient_name
  );

  RETURN v_receipt_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_material_request_partial(uuid, jsonb, uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_material_request_partial(uuid, jsonb, uuid, text) FROM PUBLIC;

-- ============================================================
-- 8. Acknowledge a material issue receipt
-- ============================================================
CREATE OR REPLACE FUNCTION public.acknowledge_material_issue_receipt(
  p_receipt_id uuid,
  p_method text DEFAULT 'RECIPIENT',
  p_comment text DEFAULT NULL,
  p_signed_document_url text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt material_issue_receipts%ROWTYPE;
  v_actor uuid := public.current_employee_id();
  v_method text := upper(COALESCE(nullif(trim(p_method), ''), 'RECIPIENT'));
BEGIN
  SELECT * INTO v_receipt FROM material_issue_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Material issue receipt not found';
  END IF;
  IF v_receipt.acknowledged_at IS NOT NULL THEN
    RAISE EXCEPTION 'This receipt has already been acknowledged';
  END IF;
  IF NOT (
    v_actor = v_receipt.recipient_employee_id
    OR public.has_any_privilege(ARRAY['inventory.issue','inventory.manage','admin.settings'])
  ) THEN
    RAISE EXCEPTION 'Only the named recipient or a warehouse officer can acknowledge this receipt';
  END IF;
  IF v_method NOT IN ('RECIPIENT','SIGNED_COPY') THEN
    RAISE EXCEPTION 'Choose a valid acknowledgement method';
  END IF;
  IF v_method = 'SIGNED_COPY' AND nullif(trim(p_signed_document_url), '') IS NULL THEN
    RAISE EXCEPTION 'Upload the signed receipt before recording a signed-copy acknowledgement';
  END IF;

  UPDATE material_issue_receipts
     SET acknowledged_by = v_actor,
         acknowledged_at = now(),
         acknowledgement_method = v_method,
         signed_document_url = nullif(trim(p_signed_document_url), ''),
         comment = nullif(trim(p_comment), '')
   WHERE id = p_receipt_id;

  INSERT INTO material_issue_events (request_id, actor_id, event, comment)
  VALUES (
    v_receipt.request_id,
    v_actor,
    'Receipt acknowledged',
    v_receipt.receipt_number || ' · ' ||
      CASE WHEN v_method = 'SIGNED_COPY' THEN 'signed copy' ELSE 'recipient confirmation' END
  );

  IF NOT EXISTS (
    SELECT 1 FROM material_issue_receipts
     WHERE request_id = v_receipt.request_id AND acknowledged_at IS NULL
  ) THEN
    UPDATE material_requests
       SET status = 'COMPLETED', updated_at = now()
     WHERE id = v_receipt.request_id AND status = 'ISSUED';
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_material_issue_receipt(uuid, text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.acknowledge_material_issue_receipt(uuid, text, text, text) FROM PUBLIC;
