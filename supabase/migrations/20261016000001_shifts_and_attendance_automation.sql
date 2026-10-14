-- Shifts module + attendance automation.
--
-- 1. `shifts` reference table: resumption time, closing time, break time and
--    the maximum break duration a shift allows.
-- 2. `employees.shift_id`: assigns an employee to a shift.
-- 3. `attendance` gets ONE row per employee per day (unique) so leave
--    automation and clocking can upsert deterministically.
-- 4. Clock-out is rejected until the employee's shift is due/close
--    (configurable early window; managers/admins bypass).
-- 5. When a leave request is approved the employee's attendance for every day
--    in the range is auto-populated with status LEAVE and a note carrying the
--    leave request id.

-- ============================================================
-- 1. Privilege for shift / attendance administration
-- ============================================================
INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('attendance.manage', 'Attendance', 'Manage attendance',
   'Define shifts and manage attendance records', 10)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. Shifts
-- ============================================================
CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_start time,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  max_break_minutes integer CHECK (max_break_minutes IS NULL OR max_break_minutes >= break_minutes),
  early_clock_out_minutes integer NOT NULL DEFAULT 30 CHECK (early_clock_out_minutes >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_shifts" ON shifts;
DROP POLICY IF EXISTS "insert_shifts" ON shifts;
DROP POLICY IF EXISTS "update_shifts" ON shifts;
DROP POLICY IF EXISTS "delete_shifts" ON shifts;
CREATE POLICY "select_shifts" ON shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_shifts" ON shifts FOR INSERT TO authenticated
  WITH CHECK (public.has_privilege('attendance.manage')
              OR public.has_privilege('employees.manage')
              OR public.has_privilege('admin.settings'));
CREATE POLICY "update_shifts" ON shifts FOR UPDATE TO authenticated
  USING (public.has_privilege('attendance.manage')
         OR public.has_privilege('employees.manage')
         OR public.has_privilege('admin.settings'))
  WITH CHECK (public.has_privilege('attendance.manage')
              OR public.has_privilege('employees.manage')
              OR public.has_privilege('admin.settings'));
CREATE POLICY "delete_shifts" ON shifts FOR DELETE TO authenticated
  USING (public.has_privilege('attendance.manage')
         OR public.has_privilege('employees.manage')
         OR public.has_privilege('admin.settings'));

-- Seed a standard 8am-5pm shift so the module is usable immediately.
INSERT INTO shifts (name, start_time, end_time, break_start, break_minutes, max_break_minutes, early_clock_out_minutes)
VALUES ('Standard (8:00 - 17:00)', '08:00', '17:00', '13:00', 60, 90, 30)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 3. Assign a shift to an employee
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL;

-- ============================================================
-- 4. One attendance row per employee per day
-- ============================================================
DELETE FROM attendance a
 WHERE EXISTS (
   SELECT 1 FROM attendance b
    WHERE b.employee_id = a.employee_id
      AND b.date = a.date
      AND (b.created_at, b.id) > (a.created_at, a.id)
 );

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_employee_date
  ON attendance(employee_id, date);

-- ============================================================
-- 5. Clock-out gate: reopen only when the shift is due/close
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_shift_close_for_clock_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_shift_end timestamptz;
  v_opens_at timestamptz;
  v_actor uuid := public.current_employee_id();
BEGIN
  IF NEW.clock_out IS NOT NULL
     AND OLD.clock_out IS NULL
     AND NEW.clock_out IS DISTINCT FROM OLD.clock_out THEN

    IF v_actor IS NOT NULL
       AND public.has_any_privilege(ARRAY['attendance.manage', 'admin.settings']) THEN
      RETURN NEW;
    END IF;

    SELECT s.* INTO v_shift
      FROM shifts s
      JOIN employees e ON e.shift_id = s.id
     WHERE e.id = NEW.employee_id;

    IF NOT FOUND THEN
      RETURN NEW;  -- no shift assigned: do not restrict
    END IF;

    v_shift_end := (NEW.date::timestamp + v_shift.end_time);
    v_opens_at  := v_shift_end - make_interval(mins => v_shift.early_clock_out_minutes);

    IF now() < v_opens_at THEN
      RAISE EXCEPTION 'Clock-out becomes available at % (your shift closes at %)',
        to_char(v_opens_at, 'HH24:MI'),
        to_char(v_shift_end, 'HH24:MI');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shift_close_for_clock_out ON attendance;
CREATE TRIGGER trg_enforce_shift_close_for_clock_out
BEFORE UPDATE ON attendance
FOR EACH ROW EXECUTE FUNCTION public.enforce_shift_close_for_clock_out();

-- ============================================================
-- 6. Approved leave auto-populates attendance (with the leave id)
-- ============================================================
CREATE OR REPLACE FUNCTION public.populate_attendance_on_leave_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date;
BEGIN
  IF NEW.status = 'APPROVED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'APPROVED') THEN
    v_day := NEW.start_date;
    WHILE v_day <= NEW.end_date LOOP
      INSERT INTO attendance (employee_id, date, status, notes)
      VALUES (
        NEW.employee_id,
        v_day,
        'LEAVE',
        'Auto-filled from approved leave request ' || NEW.id::text
      )
      ON CONFLICT (employee_id, date) DO UPDATE
        SET status = 'LEAVE',
            notes = EXCLUDED.notes,
            updated_at = now();
      v_day := v_day + 1;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_attendance_on_leave ON leave_requests;
CREATE TRIGGER trg_populate_attendance_on_leave
AFTER INSERT OR UPDATE ON leave_requests
FOR EACH ROW EXECUTE FUNCTION public.populate_attendance_on_leave_approval();

REVOKE EXECUTE ON FUNCTION public.enforce_shift_close_for_clock_out() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.populate_attendance_on_leave_approval() FROM PUBLIC;
