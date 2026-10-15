-- Self-service emergency contacts so employees can supply them during onboarding
-- without needing the employees.manage privilege.

CREATE OR REPLACE FUNCTION public.upsert_my_emergency_contact(
  p_name text,
  p_relationship text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_is_primary boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_id uuid;
  v_primary boolean;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to add an emergency contact';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Contact name is required';
  END IF;

  v_primary := COALESCE(p_is_primary, false)
    OR NOT EXISTS (SELECT 1 FROM public.employee_emergency_contacts WHERE employee_id = v_emp);

  IF v_primary THEN
    UPDATE public.employee_emergency_contacts
       SET is_primary = false
     WHERE employee_id = v_emp AND is_primary;
  END IF;

  INSERT INTO public.employee_emergency_contacts (
    employee_id, name, relationship, phone, email, is_primary
  ) VALUES (
    v_emp,
    btrim(p_name),
    NULLIF(btrim(COALESCE(p_relationship, '')), ''),
    NULLIF(btrim(COALESCE(p_phone, '')), ''),
    NULLIF(btrim(COALESCE(p_email, '')), ''),
    v_primary
  )
  RETURNING id INTO v_id;

  IF v_primary THEN
    UPDATE public.employees
       SET emergency_contact_name = btrim(p_name),
           emergency_contact_phone = NULLIF(btrim(COALESCE(p_phone, '')), '')
     WHERE id = v_emp;
  END IF;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.upsert_my_emergency_contact(text, text, text, text, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_my_emergency_contact(text, text, text, text, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.delete_my_emergency_contact(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emp uuid := public.current_employee_id();
  v_was_primary boolean;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to remove an emergency contact';
  END IF;

  SELECT is_primary INTO v_was_primary
    FROM public.employee_emergency_contacts
   WHERE id = p_id AND employee_id = v_emp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Emergency contact not found';
  END IF;

  DELETE FROM public.employee_emergency_contacts
   WHERE id = p_id AND employee_id = v_emp;

  IF v_was_primary THEN
    UPDATE public.employees
       SET emergency_contact_name = NULL,
           emergency_contact_phone = NULL
     WHERE id = v_emp;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_my_emergency_contact(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_my_emergency_contact(uuid) FROM PUBLIC;
