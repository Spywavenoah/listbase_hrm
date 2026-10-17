/*
# Mandatory training: enrol employees who become active later

A mandatory course was only pushed to the employees who were ACTIVE when it was
created. This adds an employees trigger so that any employee who becomes ACTIVE
afterwards is enrolled, given a deadline and notified (dashboard + email) via
the same `assign_training_course` path.

Additive only; uses the existing idempotent assignment/dedupe logic.
*/

CREATE OR REPLACE FUNCTION public.enroll_mandatory_training_for_employee()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_course record;
  v_count integer := 0;
BEGIN
  IF NEW.employment_status <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.employment_status = 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  FOR v_course IN SELECT id FROM training_courses WHERE is_mandatory LOOP
    PERFORM public.assign_training_course(v_course.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enroll_mandatory_training ON employees;
CREATE TRIGGER trg_enroll_mandatory_training
  AFTER INSERT OR UPDATE OF employment_status ON employees
  FOR EACH ROW EXECUTE FUNCTION public.enroll_mandatory_training_for_employee();

COMMENT ON FUNCTION public.enroll_mandatory_training_for_employee() IS
  'Enrols a newly ACTIVE employee into every mandatory training course and notifies them.';
