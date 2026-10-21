/*
# Passport & Multiple Guarantors

1. Employees
   - passport_number, passport_issue_date, passport_expiry_date
   - passport_file_path, passport_file_name (stored in employee-documents bucket)

2. Employee guarantors - support multiple guarantors per employee, each with
   their own passport details and passport document upload.
*/

-- 1) Employees passport fields
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS passport_number text,
  ADD COLUMN IF NOT EXISTS passport_issue_date date,
  ADD COLUMN IF NOT EXISTS passport_expiry_date date,
  ADD COLUMN IF NOT EXISTS passport_file_path text,
  ADD COLUMN IF NOT EXISTS passport_file_name text;

-- 2) Guarantors - allow multiple, add passport support
ALTER TABLE employee_guarantors
  ADD COLUMN IF NOT EXISTS passport_number text,
  ADD COLUMN IF NOT EXISTS passport_issue_date date,
  ADD COLUMN IF NOT EXISTS passport_expiry_date date,
  ADD COLUMN IF NOT EXISTS passport_file_path text,
  ADD COLUMN IF NOT EXISTS passport_file_name text;

-- Drop the old index assumption; multiple rows allowed now
-- (keep index for lookup performance)
CREATE INDEX IF NOT EXISTS idx_emp_guarantors_employee ON employee_guarantors(employee_id);
