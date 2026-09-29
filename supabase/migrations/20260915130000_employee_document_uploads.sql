-- Employee document uploads: private storage bucket + metadata columns.
-- Bucket holds PDF/JPEG/PNG files; access is governed by the same privilege
-- model as the rest of the app (owners, employees.manage, employees.view_all).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-documents',
  'employee-documents',
  false,
  15728640, -- 15 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- SELECT: owner (via auth.uid()) or anyone holding employees.view_all / manage.
DROP POLICY IF EXISTS employee_docs_select ON storage.objects;
CREATE POLICY employee_docs_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'employee-documents'
    AND (
      owner = auth.uid()
      OR public.has_privilege('employees.view_all')
    )
  );

-- INSERT: managers may upload anywhere; self-service employees may upload only
-- into their own employee-id folder.
DROP POLICY IF EXISTS employee_docs_insert ON storage.objects;
CREATE POLICY employee_docs_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-documents'
    AND (
      public.has_privilege('employees.manage')
      OR (storage.foldername(name))[1] = (SELECT public.current_employee_id()::text)
    )
  );

-- DELETE: owner or managers.
DROP POLICY IF EXISTS employee_docs_delete ON storage.objects;
CREATE POLICY employee_docs_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'employee-documents'
    AND (
      owner = auth.uid()
      OR public.has_privilege('employees.manage')
    )
  );

-- Metadata for real uploaded files (legacy file_url text remains for existing rows).
ALTER TABLE public.employee_documents
  ADD COLUMN IF NOT EXISTS file_path text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_type text,
  ADD COLUMN IF NOT EXISTS file_size bigint;