/*
# Inventory receiving documents

Adds the document trail required by the reference receiving workflow:

- Waybill (delivery note) uploaded when a delivery is registered.
- PO document / attachment uploaded when a delivery is registered.
- MRI (material receiving inspection) report uploaded when inspection is
  completed.

Documents are stored in a dedicated `inventory-documents` bucket because the
existing `inventory-items` bucket only accepts product pictures (images up to
5 MB).

New columns on inventory_receipts:
  delivery_note_url, po_document_url, mri_document_url

New RPC:
  attach_inventory_receipt_document(receipt_id, kind, url)

Existing privileges are reused:
  inventory.view / inventory.manage / inventory.move / inventory.issue
*/

-- ============================================================
-- 1. Receiving document columns
-- ============================================================
ALTER TABLE inventory_receipts ADD COLUMN IF NOT EXISTS delivery_note_url text;
ALTER TABLE inventory_receipts ADD COLUMN IF NOT EXISTS po_document_url text;
ALTER TABLE inventory_receipts ADD COLUMN IF NOT EXISTS mri_document_url text;

-- ============================================================
-- 2. Dedicated inventory document bucket (public read, 20 MB)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inventory-documents',
  'inventory-documents',
  true,
  20971520, -- 20 MB
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS inventory_documents_read ON storage.objects;
CREATE POLICY inventory_documents_read ON storage.objects
  FOR SELECT USING (bucket_id = 'inventory-documents');

DROP POLICY IF EXISTS inventory_documents_insert ON storage.objects;
CREATE POLICY inventory_documents_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'inventory-documents'
    AND public.has_any_privilege(ARRAY['inventory.manage','inventory.move','inventory.issue','admin.settings'])
  );

DROP POLICY IF EXISTS inventory_documents_update ON storage.objects;
CREATE POLICY inventory_documents_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'inventory-documents'
    AND public.has_any_privilege(ARRAY['inventory.manage','inventory.move','inventory.issue','admin.settings'])
  );

DROP POLICY IF EXISTS inventory_documents_delete ON storage.objects;
CREATE POLICY inventory_documents_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'inventory-documents'
    AND public.has_any_privilege(ARRAY['inventory.manage','inventory.move','inventory.issue','admin.settings'])
  );

-- ============================================================
-- 3. Attach a document to a goods receipt
-- ============================================================
CREATE OR REPLACE FUNCTION public.attach_inventory_receipt_document(
  p_receipt_id uuid,
  p_kind text,
  p_url text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := upper(COALESCE(nullif(trim(p_kind), ''), ''));
  v_url text := nullif(trim(p_url), '');
  v_status text;
BEGIN
  IF NOT public.has_any_privilege(ARRAY['inventory.manage','inventory.move','admin.settings']) THEN
    RAISE EXCEPTION 'You do not have permission to attach receiving documents';
  END IF;

  IF v_kind NOT IN ('WAYBILL','PO','MRI') THEN
    RAISE EXCEPTION 'Choose a valid receiving document type';
  END IF;
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Upload a document before attaching it';
  END IF;

  SELECT status INTO v_status FROM inventory_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goods receipt not found';
  END IF;
  IF v_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cancelled receipts cannot be changed';
  END IF;

  UPDATE inventory_receipts
     SET delivery_note_url = CASE WHEN v_kind = 'WAYBILL' THEN v_url ELSE delivery_note_url END,
         po_document_url = CASE WHEN v_kind = 'PO' THEN v_url ELSE po_document_url END,
         mri_document_url = CASE WHEN v_kind = 'MRI' THEN v_url ELSE mri_document_url END,
         updated_at = now()
   WHERE id = p_receipt_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_inventory_receipt_document(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.attach_inventory_receipt_document(uuid, text, text) FROM PUBLIC;
