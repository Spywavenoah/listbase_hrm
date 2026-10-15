/*
# Training certification document uploads.

1. Adds `document_path` to `employee_certifications` so the stored storage
   object can be located (and cleaned up) alongside the public `document_url`.
2. Creates a public-read `certification-documents` storage bucket for
   certificate images, mirroring the `inventory-items` product-picture bucket.
   Uploads/updates/deletes are gated by `training.manage` / `admin.settings`.
*/

-- ============================================================
-- 1. Certification document metadata
-- ============================================================
ALTER TABLE public.employee_certifications
  ADD COLUMN IF NOT EXISTS document_path text;

-- ============================================================
-- 2. Certification documents storage bucket (public read)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'certification-documents',
  'certification-documents',
  true,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS certification_documents_read ON storage.objects;
CREATE POLICY certification_documents_read ON storage.objects
  FOR SELECT USING (bucket_id = 'certification-documents');

DROP POLICY IF EXISTS certification_documents_insert ON storage.objects;
CREATE POLICY certification_documents_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'certification-documents'
    AND public.has_any_privilege(ARRAY['training.manage','admin.settings'])
  );

DROP POLICY IF EXISTS certification_documents_update ON storage.objects;
CREATE POLICY certification_documents_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'certification-documents'
    AND public.has_any_privilege(ARRAY['training.manage','admin.settings'])
  );

DROP POLICY IF EXISTS certification_documents_delete ON storage.objects;
CREATE POLICY certification_documents_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'certification-documents'
    AND public.has_any_privilege(ARRAY['training.manage','admin.settings'])
  );
