/*
# WhatsApp location-based attendance workflow
Adds pending trigger storage and geofenced WhatsApp clock-in/out via location sharing.
*/

CREATE TABLE IF NOT EXISTS whatsapp_pending_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_digits text NOT NULL,
  wa_id text,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('CLOCK_IN','CLOCK_OUT')),
  expires_at timestamptz NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_pending_phone ON whatsapp_pending_triggers (phone_digits, expires_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_pending_wa ON whatsapp_pending_triggers (wa_id, expires_at);

ALTER TABLE whatsapp_pending_triggers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_whatsapp_pending" ON whatsapp_pending_triggers FOR SELECT TO authenticated
  USING (public.has_any_privilege(ARRAY['admin.settings']));
CREATE POLICY "write_whatsapp_pending" ON whatsapp_pending_triggers FOR ALL TO authenticated
  USING (public.has_any_privilege(ARRAY['admin.settings']))
  WITH CHECK (public.has_any_privilege(ARRAY['admin.settings']));

-- geofenced WhatsApp clock-in/out using location
CREATE OR REPLACE FUNCTION public.whatsapp_clock_with_location(
  p_phone text,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_emp employees%ROWTYPE;
  v_trigger whatsapp_pending_triggers%ROWTYPE;
  v_zone text;
  v_min text;
  v_res jsonb;
  v_now timestamptz := now();
BEGIN
  v_digits := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_digits) < 7 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_PHONE', 'message', 'Missing or invalid sender number.');
  END IF;

  -- resolve employee
  SELECT e.* INTO v_emp FROM employees e
  WHERE e.employment_status = 'ACTIVE'
    AND (
      right(regexp_replace(COALESCE(e.phone,''),'[^0-9]','','g'),10)=right(v_digits,10)
      OR right(regexp_replace(COALESCE(e.secondary_phone,''),'[^0-9]','','g'),10)=right(v_digits,10)
    )
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT e.* INTO v_emp FROM employees e
    WHERE e.employment_status = 'ACTIVE'
      AND EXISTS (
        SELECT 1 FROM employee_emergency_contacts c
        WHERE c.employee_id=e.id
          AND right(regexp_replace(COALESCE(c.phone,''),'[^0-9]','','g'),10)=right(v_digits,10)
      )
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_EMPLOYEE',
      'message', 'This number is not linked to an active employee.');
  END IF;

  -- find pending trigger
  SELECT * INTO v_trigger FROM whatsapp_pending_triggers
  WHERE phone_digits = right(v_digits,10)
    AND processed_at IS NULL
    AND expires_at > v_now
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- also try by wa_id if stored? but we pass phone; fallback to last trigger by employee? not stored
    RETURN jsonb_build_object('ok', false, 'code', 'NO_PENDING',
      'message', 'No pending clock request found. Send "clock in" or "clock out" first.');
  END IF;

  -- find valid zone
  IF p_lat IS NULL OR p_lng IS NULL THEN
    UPDATE whatsapp_pending_triggers SET processed_at = v_now WHERE id = v_trigger.id;
    RETURN jsonb_build_object('ok', false, 'code', 'NO_LOCATION',
      'message', 'Location not received. Please share your location again.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.attendance_zones(v_emp.id, p_lat, p_lng)) THEN
    UPDATE whatsapp_pending_triggers SET processed_at = v_now WHERE id = v_trigger.id;
    RETURN jsonb_build_object('ok', false, 'code', 'NO_CONFIG',
      'message', 'Attendance location is not configured.');
  END IF;

  SELECT z.zone_name INTO v_zone
  FROM public.attendance_zones(v_emp.id, p_lat, p_lng) z
  WHERE z.distance_m <= z.radius_m
  ORDER BY z.distance_m ASC
  LIMIT 1;

  IF v_zone IS NULL THEN
    SELECT round(z.distance_m)::text INTO v_min
    FROM public.attendance_zones(v_emp.id, p_lat, p_lng) z
    ORDER BY z.distance_m ASC
    LIMIT 1;
    UPDATE whatsapp_pending_triggers SET processed_at = v_now WHERE id = v_trigger.id;
    RETURN jsonb_build_object('ok', false, 'code', 'OUTSIDE',
      'message', 'You are outside every approved attendance zone (nearest ~' || COALESCE(v_min,'0') || ' m away).');
  END IF;

  -- record punch
  v_res := public.record_attendance_punch(v_emp.id, v_trigger.action, p_lat, p_lng, p_accuracy, v_zone, 'WHATSAPP');
  UPDATE whatsapp_pending_triggers SET processed_at = v_now WHERE id = v_trigger.id;

  RETURN v_res || jsonb_build_object(
    'employee_id', v_emp.id,
    'employee_name', btrim(v_emp.first_name || ' ' || v_emp.last_name),
    'zone', v_zone
  );
END $$;

GRANT EXECUTE ON FUNCTION public.whatsapp_clock_with_location(text,numeric,numeric,numeric) TO service_role;
