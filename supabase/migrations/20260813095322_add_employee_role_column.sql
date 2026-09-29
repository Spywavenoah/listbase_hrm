/*
# Add role column to employees table

1. Changes
- Add `role` column (text, default 'EMPLOYEE') to the `employees` table.
- This enables a role-based access system: SUPER_ADMIN, HR_ADMIN, MANAGER, EMPLOYEE.
- Update noah.linus@constrabase.com to role 'SUPER_ADMIN'.
2. Security
- No RLS policy changes needed — the role column is readable by the authenticated user for their own row.
*/

ALTER TABLE employees ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'EMPLOYEE';

UPDATE employees SET role = 'SUPER_ADMIN' WHERE email = 'noah.linus@constrabase.com';
