/*
# Procurement module — full lifecycle

Extends the basic procurement module (migration 20260923000014) with the complete
source-to-pay workflow:

Requisition -> RFQ -> Supplier quotations -> Evaluation -> Purchase order
           -> Goods receipt -> Quality inspection -> Invoice (3-way match)
           -> Payment request -> Contract (for services / framework)

Actor references (requester, evaluator, inspector, ...) always point at the
existing `employees` table. Vendors reuse `procurement_vendors`. Approval runs
through the generic workflow engine (module keys `procurement.*`).

## Permissions
Each lifecycle stage is gated by a dedicated privilege (all *also* open to the
legacy `procurement.manage`):

- `procurement.dashboard`        — view dashboard + read the module
- `procurement.requisition_create` / `procurement.requisition_approve`
- `procurement.rfq_manage`
- `procurement.quotation_manage` / `procurement.quotation_evaluate`
- `procurement.po_create` / `procurement.po_approve`
- `procurement.receive` / `procurement.inspect`
- `procurement.invoice_manage` / `procurement.invoice_approve`
- `procurement.payment_create` / `procurement.payment_approve`
- `procurement.contract_manage` / `procurement.settings`
- `procurement.manage` (legacy — full control)
*/

-- ============================================================
-- 0. Privilege registration
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order)
VALUES
  ('procurement.dashboard',        'Procurement', 'View procurement dashboard',      'View procurement KPIs and full module read access', 68),
  ('procurement.requisition_create','Procurement','Create & submit requisitions',    'Create, edit and submit purchase requisitions', 69),
  ('procurement.requisition_approve','Procurement','Approve requisitions',           'Approve or reject purchase requisitions', 70),
  ('procurement.rfq_manage',       'Procurement', 'Manage RFQs',                     'Create and issue requests for quotation', 71),
  ('procurement.quotation_manage', 'Procurement', 'Manage quotations',               'Record and edit supplier quotations', 72),
  ('procurement.quotation_evaluate','Procurement','Evaluate quotations',             'Score quotations and select the winning supplier', 73),
  ('procurement.po_create',        'Procurement', 'Create purchase orders',          'Create and edit purchase orders', 74),
  ('procurement.po_approve',       'Procurement', 'Approve purchase orders',         'Approve or reject purchase orders', 75),
  ('procurement.receive',          'Procurement', 'Receive goods & services',        'Record goods receipts against purchase orders', 76),
  ('procurement.inspect',          'Procurement', 'Inspect goods',                   'Record quality inspection results for receipts', 77),
  ('procurement.invoice_manage',   'Procurement', 'Manage supplier invoices',        'Register and verify supplier invoices', 78),
  ('procurement.invoice_approve',  'Procurement', 'Approve invoices',                'Approve supplier invoices for payment', 79),
  ('procurement.payment_create',   'Procurement', 'Create payment requests',         'Create and submit payment requests', 80),
  ('procurement.payment_approve',  'Procurement', 'Approve payment requests',        'Approve or reject payment requests', 81),
  ('procurement.contract_manage',  'Procurement', 'Manage contracts',                'Create and manage supplier contracts', 82),
  ('procurement.settings',         'Procurement', 'Manage procurement settings',     'Manage categories and evaluation criteria', 83)
ON CONFLICT (key) DO NOTHING;

-- Convenience predicate: does the caller hold *any* procurement permission?
CREATE OR REPLACE FUNCTION public.has_procurement_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_privilege(ARRAY[
    'procurement.manage',
    'procurement.dashboard',
    'procurement.requisition_create',
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
    'procurement.settings'
  ]);
$$;

GRANT EXECUTE ON FUNCTION public.has_procurement_access() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_procurement_access() FROM PUBLIC;

-- ============================================================
-- 1. Categories
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE procurement_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_categories" ON procurement_categories;
DROP POLICY IF EXISTS "insert_procurement_categories" ON procurement_categories;
DROP POLICY IF EXISTS "update_procurement_categories" ON procurement_categories;
DROP POLICY IF EXISTS "delete_procurement_categories" ON procurement_categories;

CREATE POLICY "select_procurement_categories" ON procurement_categories FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_categories" ON procurement_categories FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));
CREATE POLICY "update_procurement_categories" ON procurement_categories FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));
CREATE POLICY "delete_procurement_categories" ON procurement_categories FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));

-- ============================================================
-- 2. Requisitions
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  req_number text NOT NULL UNIQUE,
  requester_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  category_id uuid REFERENCES procurement_categories(id) ON DELETE SET NULL,
  purchase_type text NOT NULL DEFAULT 'GOODS',
  priority text NOT NULL DEFAULT 'NORMAL',
  purpose text,
  business_justification text,
  delivery_location text,
  required_delivery_date date,
  currency text NOT NULL DEFAULT 'USD',
  estimated_total numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT',
  approved_at timestamptz,
  remarks text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_requisition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES procurement_requisitions(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  item_name text NOT NULL,
  description text,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  uom text DEFAULT 'EA',
  estimated_unit_price numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  preferred_vendor_id uuid REFERENCES procurement_vendors(id) ON DELETE SET NULL,
  delivery_requirements text
);

CREATE INDEX IF NOT EXISTS idx_requisitions_status ON procurement_requisitions (status);
CREATE INDEX IF NOT EXISTS idx_requisitions_requester ON procurement_requisitions (requester_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_dept ON procurement_requisitions (department_id);

ALTER TABLE procurement_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_requisition_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_requisitions" ON procurement_requisitions;
DROP POLICY IF EXISTS "insert_procurement_requisitions" ON procurement_requisitions;
DROP POLICY IF EXISTS "update_procurement_requisitions" ON procurement_requisitions;
DROP POLICY IF EXISTS "delete_procurement_requisitions" ON procurement_requisitions;

CREATE POLICY "select_procurement_requisitions" ON procurement_requisitions FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_requisitions" ON procurement_requisitions FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage']));
CREATE POLICY "update_procurement_requisitions" ON procurement_requisitions FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.requisition_approve', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.requisition_approve', 'procurement.manage']));
CREATE POLICY "delete_procurement_requisitions" ON procurement_requisitions FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_requisition_items" ON procurement_requisition_items;
DROP POLICY IF EXISTS "insert_procurement_requisition_items" ON procurement_requisition_items;
DROP POLICY IF EXISTS "update_procurement_requisition_items" ON procurement_requisition_items;
DROP POLICY IF EXISTS "delete_procurement_requisition_items" ON procurement_requisition_items;

CREATE POLICY "select_procurement_requisition_items" ON procurement_requisition_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_requisitions r WHERE r.id = requisition_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_requisition_items" ON procurement_requisition_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_requisitions r
     WHERE r.id = requisition_id
       AND public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage'])
       AND r.status = 'DRAFT'));
CREATE POLICY "update_procurement_requisition_items" ON procurement_requisition_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_requisitions r
     WHERE r.id = requisition_id
       AND public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage'])
       AND r.status = 'DRAFT'))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_requisitions r
     WHERE r.id = requisition_id
       AND public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage'])
       AND r.status = 'DRAFT'));
CREATE POLICY "delete_procurement_requisition_items" ON procurement_requisition_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_requisitions r
     WHERE r.id = requisition_id
       AND public.has_any_privilege(ARRAY['procurement.requisition_create', 'procurement.manage'])
       AND r.status = 'DRAFT'));

-- ============================================================
-- 3. RFQs
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number text NOT NULL UNIQUE,
  requisition_id uuid REFERENCES procurement_requisitions(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  issue_date date DEFAULT CURRENT_DATE,
  deadline date,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'DRAFT',
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_rfq_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES procurement_rfqs(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES procurement_vendors(id) ON DELETE CASCADE,
  invited_at timestamptz DEFAULT now(),
  responded boolean NOT NULL DEFAULT false,
  UNIQUE (rfq_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_rfqs_status ON procurement_rfqs (status);

ALTER TABLE procurement_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_rfq_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_rfqs" ON procurement_rfqs;
DROP POLICY IF EXISTS "insert_procurement_rfqs" ON procurement_rfqs;
DROP POLICY IF EXISTS "update_procurement_rfqs" ON procurement_rfqs;
DROP POLICY IF EXISTS "delete_procurement_rfqs" ON procurement_rfqs;

CREATE POLICY "select_procurement_rfqs" ON procurement_rfqs FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_rfqs" ON procurement_rfqs FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']));
CREATE POLICY "update_procurement_rfqs" ON procurement_rfqs FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']));
CREATE POLICY "delete_procurement_rfqs" ON procurement_rfqs FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_rfq_vendors" ON procurement_rfq_vendors;
DROP POLICY IF EXISTS "insert_procurement_rfq_vendors" ON procurement_rfq_vendors;
DROP POLICY IF EXISTS "update_procurement_rfq_vendors" ON procurement_rfq_vendors;
DROP POLICY IF EXISTS "delete_procurement_rfq_vendors" ON procurement_rfq_vendors;

CREATE POLICY "select_procurement_rfq_vendors" ON procurement_rfq_vendors FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_rfq_vendors" ON procurement_rfq_vendors FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id
      AND public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']) AND f.status = 'DRAFT'));
CREATE POLICY "update_procurement_rfq_vendors" ON procurement_rfq_vendors FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id
      AND public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.quotation_manage', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id
      AND public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.quotation_manage', 'procurement.manage'])));
CREATE POLICY "delete_procurement_rfq_vendors" ON procurement_rfq_vendors FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_rfqs f WHERE f.id = rfq_id
      AND public.has_any_privilege(ARRAY['procurement.rfq_manage', 'procurement.manage']) AND f.status = 'DRAFT'));

-- ============================================================
-- 4. Quotations
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_ref text NOT NULL UNIQUE,
  rfq_id uuid REFERENCES procurement_rfqs(id) ON DELETE SET NULL,
  vendor_id uuid NOT NULL REFERENCES procurement_vendors(id) ON DELETE CASCADE,
  submitted_at timestamptz,
  valid_until date,
  currency text NOT NULL DEFAULT 'USD',
  payment_terms text,
  lead_time_days integer,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  delivery_cost numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT',
  notes text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES procurement_quotations(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  item_name text NOT NULL,
  description text,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  uom text DEFAULT 'EA',
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  lead_time_days integer
);

CREATE INDEX IF NOT EXISTS idx_quotations_status ON procurement_quotations (status);
CREATE INDEX IF NOT EXISTS idx_quotations_rfq ON procurement_quotations (rfq_id);

ALTER TABLE procurement_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_quotations" ON procurement_quotations;
DROP POLICY IF EXISTS "insert_procurement_quotations" ON procurement_quotations;
DROP POLICY IF EXISTS "update_procurement_quotations" ON procurement_quotations;
DROP POLICY IF EXISTS "delete_procurement_quotations" ON procurement_quotations;

CREATE POLICY "select_procurement_quotations" ON procurement_quotations FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_quotations" ON procurement_quotations FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']));
CREATE POLICY "update_procurement_quotations" ON procurement_quotations FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.quotation_evaluate', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.quotation_evaluate', 'procurement.manage']));
CREATE POLICY "delete_procurement_quotations" ON procurement_quotations FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_quotation_items" ON procurement_quotation_items;
DROP POLICY IF EXISTS "insert_procurement_quotation_items" ON procurement_quotation_items;
DROP POLICY IF EXISTS "update_procurement_quotation_items" ON procurement_quotation_items;
DROP POLICY IF EXISTS "delete_procurement_quotation_items" ON procurement_quotation_items;

CREATE POLICY "select_procurement_quotation_items" ON procurement_quotation_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_quotation_items" ON procurement_quotation_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id
      AND public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']) AND q.status = 'DRAFT'));
CREATE POLICY "update_procurement_quotation_items" ON procurement_quotation_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id
      AND public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']) AND q.status = 'DRAFT'))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id
      AND public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']) AND q.status = 'DRAFT'));
CREATE POLICY "delete_procurement_quotation_items" ON procurement_quotation_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id
      AND public.has_any_privilege(ARRAY['procurement.quotation_manage', 'procurement.manage']) AND q.status = 'DRAFT'));

-- ============================================================
-- 5. Evaluation
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_evaluation_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  weight numeric(5,2) NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES procurement_quotations(id) ON DELETE CASCADE,
  evaluator_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES procurement_evaluation_criteria(id) ON DELETE CASCADE,
  score numeric(5,2) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (quotation_id, evaluator_id, criterion_id)
);

ALTER TABLE procurement_evaluation_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_evaluation_criteria" ON procurement_evaluation_criteria;
DROP POLICY IF EXISTS "insert_procurement_evaluation_criteria" ON procurement_evaluation_criteria;
DROP POLICY IF EXISTS "update_procurement_evaluation_criteria" ON procurement_evaluation_criteria;
DROP POLICY IF EXISTS "delete_procurement_evaluation_criteria" ON procurement_evaluation_criteria;

CREATE POLICY "select_procurement_evaluation_criteria" ON procurement_evaluation_criteria FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_evaluation_criteria" ON procurement_evaluation_criteria FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));
CREATE POLICY "update_procurement_evaluation_criteria" ON procurement_evaluation_criteria FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));
CREATE POLICY "delete_procurement_evaluation_criteria" ON procurement_evaluation_criteria FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.settings', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_evaluations" ON procurement_evaluations;
DROP POLICY IF EXISTS "insert_procurement_evaluations" ON procurement_evaluations;
DROP POLICY IF EXISTS "update_procurement_evaluations" ON procurement_evaluations;
DROP POLICY IF EXISTS "delete_procurement_evaluations" ON procurement_evaluations;

CREATE POLICY "select_procurement_evaluations" ON procurement_evaluations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_quotations q WHERE q.id = quotation_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_evaluations" ON procurement_evaluations FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_privilege(ARRAY['procurement.quotation_evaluate', 'procurement.manage'])
    AND evaluator_id = public.current_employee_id());
CREATE POLICY "update_procurement_evaluations" ON procurement_evaluations FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.quotation_evaluate', 'procurement.manage']) AND evaluator_id = public.current_employee_id())
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.quotation_evaluate', 'procurement.manage']) AND evaluator_id = public.current_employee_id());
CREATE POLICY "delete_procurement_evaluations" ON procurement_evaluations FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.quotation_evaluate', 'procurement.manage']) AND evaluator_id = public.current_employee_id());

-- ============================================================
-- 6. Purchase orders — extend the existing table
-- ============================================================
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS requisition_id uuid REFERENCES procurement_requisitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES procurement_quotations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS uom text DEFAULT 'EA',
  ADD COLUMN IF NOT EXISTS received_qty numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_qty numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_qty numeric(12,2) NOT NULL DEFAULT 0;

-- Replace the manage-only policies with granular ones
DROP POLICY IF EXISTS "select_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "insert_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "update_purchase_orders" ON purchase_orders;
DROP POLICY IF EXISTS "delete_purchase_orders" ON purchase_orders;

CREATE POLICY "select_purchase_orders" ON purchase_orders FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_purchase_orders" ON purchase_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.manage']));
CREATE POLICY "update_purchase_orders" ON purchase_orders FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.po_approve', 'procurement.receive', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.po_approve', 'procurement.receive', 'procurement.manage']));
CREATE POLICY "delete_purchase_orders" ON purchase_orders FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.manage']));

DROP POLICY IF EXISTS "select_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "insert_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "update_purchase_order_items" ON purchase_order_items;
DROP POLICY IF EXISTS "delete_purchase_order_items" ON purchase_order_items;

CREATE POLICY "select_purchase_order_items" ON purchase_order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id AND public.has_procurement_access()));
CREATE POLICY "insert_purchase_order_items" ON purchase_order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.manage']) AND po.status = 'DRAFT'));
CREATE POLICY "update_purchase_order_items" ON purchase_order_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.po_approve', 'procurement.receive', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.po_approve', 'procurement.receive', 'procurement.manage'])));
CREATE POLICY "delete_purchase_order_items" ON purchase_order_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND public.has_any_privilege(ARRAY['procurement.po_create', 'procurement.manage']) AND po.status = 'DRAFT'));

-- ============================================================
-- 6b. Vendors — replace the manage-only policies with granular ones
--     (the vendors manage page keeps write access, all procurement
--     roles get read access for referencing suppliers)
-- ============================================================
DROP POLICY IF EXISTS "select_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "insert_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "update_procurement_vendors" ON procurement_vendors;
DROP POLICY IF EXISTS "delete_procurement_vendors" ON procurement_vendors;

CREATE POLICY "select_procurement_vendors" ON procurement_vendors FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_vendors" ON procurement_vendors FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('procurement.manage'));
CREATE POLICY "update_procurement_vendors" ON procurement_vendors FOR UPDATE TO authenticated
  USING (public.has_privilege('procurement.manage'))
  WITH CHECK (public.has_privilege('procurement.manage'));
CREATE POLICY "delete_procurement_vendors" ON procurement_vendors FOR DELETE TO authenticated
  USING (public.has_privilege('procurement.manage'));

-- ============================================================
-- 7. Goods receipts + quality inspection
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  received_date date DEFAULT CURRENT_DATE,
  received_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  delivery_note_number text,
  warehouse text,
  status text NOT NULL DEFAULT 'RECEIVED',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES procurement_receipts(id) ON DELETE CASCADE,
  po_item_id uuid REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity_received numeric(12,2) NOT NULL DEFAULT 0,
  quantity_accepted numeric(12,2) NOT NULL DEFAULT 0,
  quantity_rejected numeric(12,2) NOT NULL DEFAULT 0,
  rejection_reason text
);

CREATE INDEX IF NOT EXISTS idx_receipts_po ON procurement_receipts (po_id);

ALTER TABLE procurement_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_receipts" ON procurement_receipts;
DROP POLICY IF EXISTS "insert_procurement_receipts" ON procurement_receipts;
DROP POLICY IF EXISTS "update_procurement_receipts" ON procurement_receipts;
DROP POLICY IF EXISTS "delete_procurement_receipts" ON procurement_receipts;

CREATE POLICY "select_procurement_receipts" ON procurement_receipts FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_receipts" ON procurement_receipts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage']));
CREATE POLICY "update_procurement_receipts" ON procurement_receipts FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage']));
CREATE POLICY "delete_procurement_receipts" ON procurement_receipts FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_receipt_items" ON procurement_receipt_items;
DROP POLICY IF EXISTS "insert_procurement_receipt_items" ON procurement_receipt_items;
DROP POLICY IF EXISTS "update_procurement_receipt_items" ON procurement_receipt_items;
DROP POLICY IF EXISTS "delete_procurement_receipt_items" ON procurement_receipt_items;

CREATE POLICY "select_procurement_receipt_items" ON procurement_receipt_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_receipt_items" ON procurement_receipt_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id
      AND public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage'])));
CREATE POLICY "update_procurement_receipt_items" ON procurement_receipt_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id
      AND public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id
      AND public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage'])));
CREATE POLICY "delete_procurement_receipt_items" ON procurement_receipt_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_receipts r WHERE r.id = receipt_id
      AND public.has_any_privilege(ARRAY['procurement.receive', 'procurement.manage'])));

CREATE TABLE IF NOT EXISTS procurement_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_number text NOT NULL UNIQUE,
  receipt_id uuid NOT NULL REFERENCES procurement_receipts(id) ON DELETE RESTRICT,
  inspector_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  inspection_date date DEFAULT CURRENT_DATE,
  result text NOT NULL DEFAULT 'PASS',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_inspection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES procurement_inspections(id) ON DELETE CASCADE,
  receipt_item_id uuid REFERENCES procurement_receipt_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  inspected_qty numeric(12,2) NOT NULL DEFAULT 0,
  accepted_qty numeric(12,2) NOT NULL DEFAULT 0,
  rejected_qty numeric(12,2) NOT NULL DEFAULT 0,
  criteria text,
  result text NOT NULL DEFAULT 'PASS'
);

ALTER TABLE procurement_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_inspection_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_inspections" ON procurement_inspections;
DROP POLICY IF EXISTS "insert_procurement_inspections" ON procurement_inspections;
DROP POLICY IF EXISTS "update_procurement_inspections" ON procurement_inspections;
DROP POLICY IF EXISTS "delete_procurement_inspections" ON procurement_inspections;

CREATE POLICY "select_procurement_inspections" ON procurement_inspections FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_inspections" ON procurement_inspections FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage']));
CREATE POLICY "update_procurement_inspections" ON procurement_inspections FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage']));
CREATE POLICY "delete_procurement_inspections" ON procurement_inspections FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_inspection_items" ON procurement_inspection_items;
DROP POLICY IF EXISTS "insert_procurement_inspection_items" ON procurement_inspection_items;
DROP POLICY IF EXISTS "update_procurement_inspection_items" ON procurement_inspection_items;
DROP POLICY IF EXISTS "delete_procurement_inspection_items" ON procurement_inspection_items;

CREATE POLICY "select_procurement_inspection_items" ON procurement_inspection_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_inspection_items" ON procurement_inspection_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id
      AND public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage'])));
CREATE POLICY "update_procurement_inspection_items" ON procurement_inspection_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id
      AND public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id
      AND public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage'])));
CREATE POLICY "delete_procurement_inspection_items" ON procurement_inspection_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_inspections i WHERE i.id = inspection_id
      AND public.has_any_privilege(ARRAY['procurement.inspect', 'procurement.manage'])));

-- ============================================================
-- 8. Supplier invoices + payment requests
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  supplier_invoice_ref text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES procurement_vendors(id) ON DELETE RESTRICT,
  po_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  invoice_date date,
  due_date date,
  currency text NOT NULL DEFAULT 'USD',
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'REGISTERED',
  match_status text NOT NULL DEFAULT 'PENDING',
  approved_at timestamptz,
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES procurement_invoices(id) ON DELETE CASCADE,
  po_item_id uuid REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 0,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON procurement_invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_po ON procurement_invoices (po_id);

ALTER TABLE procurement_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_invoices" ON procurement_invoices;
DROP POLICY IF EXISTS "insert_procurement_invoices" ON procurement_invoices;
DROP POLICY IF EXISTS "update_procurement_invoices" ON procurement_invoices;
DROP POLICY IF EXISTS "delete_procurement_invoices" ON procurement_invoices;

CREATE POLICY "select_procurement_invoices" ON procurement_invoices FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_invoices" ON procurement_invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage']));
CREATE POLICY "update_procurement_invoices" ON procurement_invoices FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.invoice_approve', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.invoice_approve', 'procurement.manage']));
CREATE POLICY "delete_procurement_invoices" ON procurement_invoices FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage']));

DROP POLICY IF EXISTS "select_procurement_invoice_items" ON procurement_invoice_items;
DROP POLICY IF EXISTS "insert_procurement_invoice_items" ON procurement_invoice_items;
DROP POLICY IF EXISTS "update_procurement_invoice_items" ON procurement_invoice_items;
DROP POLICY IF EXISTS "delete_procurement_invoice_items" ON procurement_invoice_items;

CREATE POLICY "select_procurement_invoice_items" ON procurement_invoice_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id AND public.has_procurement_access()));
CREATE POLICY "insert_procurement_invoice_items" ON procurement_invoice_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id
      AND public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage'])));
CREATE POLICY "update_procurement_invoice_items" ON procurement_invoice_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id
      AND public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage'])))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id
      AND public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage'])));
CREATE POLICY "delete_procurement_invoice_items" ON procurement_invoice_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM procurement_invoices i WHERE i.id = invoice_id
      AND public.has_any_privilege(ARRAY['procurement.invoice_manage', 'procurement.manage'])));

CREATE TABLE IF NOT EXISTS procurement_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_ref text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES procurement_invoices(id) ON DELETE RESTRICT,
  requested_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  request_date date DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  payment_method text,
  status text NOT NULL DEFAULT 'DRAFT',
  payment_reference text,
  paid_at timestamptz,
  approved_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON procurement_payment_requests (status);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON procurement_payment_requests (invoice_id);

ALTER TABLE procurement_payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_payment_requests" ON procurement_payment_requests;
DROP POLICY IF EXISTS "insert_procurement_payment_requests" ON procurement_payment_requests;
DROP POLICY IF EXISTS "update_procurement_payment_requests" ON procurement_payment_requests;
DROP POLICY IF EXISTS "delete_procurement_payment_requests" ON procurement_payment_requests;

CREATE POLICY "select_procurement_payment_requests" ON procurement_payment_requests FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_payment_requests" ON procurement_payment_requests FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.payment_create', 'procurement.manage']));
CREATE POLICY "update_procurement_payment_requests" ON procurement_payment_requests FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.payment_create', 'procurement.payment_approve', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.payment_create', 'procurement.payment_approve', 'procurement.manage']));
CREATE POLICY "delete_procurement_payment_requests" ON procurement_payment_requests FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.payment_create', 'procurement.manage']));

-- ============================================================
-- 9. Contracts
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_ref text NOT NULL UNIQUE,
  vendor_id uuid NOT NULL REFERENCES procurement_vendors(id) ON DELETE RESTRICT,
  po_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  start_date date,
  end_date date,
  value numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  payment_terms text,
  status text NOT NULL DEFAULT 'DRAFT',
  renewal_reminder_enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE procurement_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_contracts" ON procurement_contracts;
DROP POLICY IF EXISTS "insert_procurement_contracts" ON procurement_contracts;
DROP POLICY IF EXISTS "update_procurement_contracts" ON procurement_contracts;
DROP POLICY IF EXISTS "delete_procurement_contracts" ON procurement_contracts;

CREATE POLICY "select_procurement_contracts" ON procurement_contracts FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_contracts" ON procurement_contracts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.contract_manage', 'procurement.manage']));
CREATE POLICY "update_procurement_contracts" ON procurement_contracts FOR UPDATE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.contract_manage', 'procurement.manage']))
  WITH CHECK (public.has_any_privilege(ARRAY['procurement.contract_manage', 'procurement.manage']));
CREATE POLICY "delete_procurement_contracts" ON procurement_contracts FOR DELETE TO authenticated
  USING (public.has_any_privilege(ARRAY['procurement.contract_manage', 'procurement.manage']));

-- ============================================================
-- 10. Documents (file references)
-- ============================================================
CREATE TABLE IF NOT EXISTS procurement_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_type text NOT NULL,
  ref_id uuid NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text,
  file_size integer,
  uploaded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proc_documents_ref ON procurement_documents (ref_type, ref_id);

ALTER TABLE procurement_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_procurement_documents" ON procurement_documents;
DROP POLICY IF EXISTS "insert_procurement_documents" ON procurement_documents;
DROP POLICY IF EXISTS "update_procurement_documents" ON procurement_documents;
DROP POLICY IF EXISTS "delete_procurement_documents" ON procurement_documents;

CREATE POLICY "select_procurement_documents" ON procurement_documents FOR SELECT TO authenticated
  USING (public.has_procurement_access());
CREATE POLICY "insert_procurement_documents" ON procurement_documents FOR INSERT TO authenticated
  WITH CHECK (public.has_procurement_access());
CREATE POLICY "update_procurement_documents" ON procurement_documents FOR UPDATE TO authenticated
  USING (public.has_procurement_access())
  WITH CHECK (public.has_procurement_access());
CREATE POLICY "delete_procurement_documents" ON procurement_documents FOR DELETE TO authenticated
  USING (public.has_procurement_access());

-- ============================================================
-- 11. Minimal employee lookup for procurement pickers
--     (avoids widening employees RLS for non-HR roles)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_procurement_employee_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
  v_emp RECORD;
BEGIN
  IF public.current_employee_id() IS NULL OR NOT public.has_procurement_access() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_emp IN
    SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email,
           d.name AS department_name, p.name AS position_name
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN positions p ON p.id = e.position_id
     WHERE COALESCE(e.employment_status, '') <> 'TERMINATED'
     ORDER BY e.first_name, e.last_name
  LOOP
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id',              v_emp.id,
      'employee_id',     v_emp.employee_id,
      'name',            trim(v_emp.first_name || ' ' || v_emp.last_name),
      'email',           v_emp.email,
      'department_name', v_emp.department_name,
      'position_name',   v_emp.position_name
    ));
  END LOOP;

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_procurement_employee_list() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_procurement_employee_list() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_procurement_access() FROM PUBLIC;

-- ============================================================
-- 12. Workflow engine integration
-- ============================================================

-- Propagate final verdict from workflow_instances to procurement records.
DROP TRIGGER IF EXISTS trg_apply_workflow_result ON workflow_instances;
CREATE OR REPLACE FUNCTION public.apply_workflow_result_to_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('APPROVED', 'REJECTED') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NEW.module_key = 'leave' THEN
      UPDATE leave_requests
         SET status = NEW.status,
             approved_at = CASE WHEN NEW.status = 'APPROVED' THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = NEW.record_id;
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
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_workflow_result
AFTER UPDATE ON workflow_instances
FOR EACH ROW EXECUTE FUNCTION public.apply_workflow_result_to_record();

-- One default approval chain per module, so ON CONFLICT (module_key, name) below resolves.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definitions_module_name
  ON workflow_definitions (module_key, name);

-- Default procurement approval chains (Manager / HR Admin / Super Admin step),
-- enabled by default so the module works out of the box. Configure in
-- Settings > Workflows once live.
DO $$
DECLARE v_def uuid;
BEGIN
  -- Requisition approval
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Requisition Approval', 'procurement.requisition', 'request.submitted',
    'Default purchase requisition approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'procurement.requisition' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'procurement.requisition', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'procurement.requisition');

  -- Purchase order approval
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Purchase Order Approval', 'procurement.purchase_order', 'po.submitted',
    'Default purchase order approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'procurement.purchase_order' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'procurement.purchase_order', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'procurement.purchase_order');

  -- Invoice approval
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Invoice Approval', 'procurement.invoice', 'invoice.registered',
    'Default supplier invoice approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'procurement.invoice' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'procurement.invoice', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'procurement.invoice');

  -- Payment request approval
  INSERT INTO workflow_definitions (name, module_key, trigger_event, description, is_active)
  VALUES (
    'Payment Approval', 'procurement.payment', 'payment.submitted',
    'Default payment request approval chain', true
  ) ON CONFLICT (module_key, name) DO NOTHING RETURNING id INTO v_def;
  IF v_def IS NULL THEN SELECT id INTO v_def FROM workflow_definitions WHERE module_key = 'procurement.payment' LIMIT 1; END IF;
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 1, 'MANAGER'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def);
  INSERT INTO workflow_steps (workflow_definition_id, sort_order, approver_role)
  SELECT v_def, 2, 'HR_ADMIN'
    WHERE NOT EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.workflow_definition_id = v_def AND ws.sort_order = 2);
  INSERT INTO module_workflow_config (module_key, is_enabled, workflow_definition_id)
  SELECT 'procurement.payment', true, v_def
    WHERE NOT EXISTS (SELECT 1 FROM module_workflow_config mc WHERE mc.module_key = 'procurement.payment');
END;
$$;

-- Contact lookups for email notifications of procurement approvals.
INSERT INTO mail_templates (event_key, subject, body_html, variables)
VALUES
  ('procurement.requisition.submitted', 'Requisition {{req_number}} submitted for approval', '<p>Requisition <strong>{{req_number}}</strong> was submitted by {{requester}} and is awaiting your approval.</p>', '["req_number","requester"]')
ON CONFLICT (event_key) DO NOTHING;