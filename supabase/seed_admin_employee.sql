/*
# Default admin employee

Creates the default SUPER_ADMIN login used to access the system.

- Email:    noah.linus@constrabase.com
- Password: <replace the placeholder below with a strong password>
- Role:     SUPER_ADMIN (has_privilege() returns true for every key)

Run AFTER the schema exists (supabase/full_bootstrap.sql, or all migrations)
and after pgcrypto is installed - the password is stored hashed via
extensions.crypt.

Idempotent: re-running never overwrites an existing employee row.
SECURITY: change this password after the first login (change-password screen).
*/

INSERT INTO employees (
  employee_id, first_name, last_name, email,
  employment_type, employment_status, hire_date, role, password_hash
) VALUES (
  'ADM-001', 'Noah', 'Linus', 'noah.linus@constrabase.com',
  'FULL_TIME', 'ACTIVE', current_date, 'SUPER_ADMIN',
  extensions.crypt('<STRONG_PASSWORD>', extensions.gen_salt('bf', 10))
)
ON CONFLICT (email) DO NOTHING;

-- If the row already existed without a usable password (the INSERT above
-- skips existing emails), uncomment the statement below to (re)set it:
-- UPDATE employees
--    SET role = 'SUPER_ADMIN',
--        password_hash = extensions.crypt('<STRONG_PASSWORD>', extensions.gen_salt('bf', 10)),
--        must_change_password = false,
--        employment_status = 'ACTIVE',
--        updated_at = now()
--  WHERE email = 'noah.linus@constrabase.com';
