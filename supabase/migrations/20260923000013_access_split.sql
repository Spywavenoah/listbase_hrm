/*
# Access split: reports read/write + payout read/write flags

Implements:
1. Split `admin.reports` into explicit read vs write privileges:
   - `admin.reports_read`  — view dashboards / analytics
   - `admin.reports_write` — build & export custom reports
   Legacy `admin.reports` is kept as a synonym so existing grants keep working.
   `reports_analytics()` is relaxed to accept any of the three.

2. Payout read/write permission flags:
   - `payroll.payout_read`  — read payout records / disbursement history
   - `payroll.payout_write` — create and approve disbursements
   The set_employee_access RPC already validates keys against
   privilege_definitions, so registering them here is enough for the
   access-manager UI to assign them.
*/

INSERT INTO privilege_definitions (key, category, label, description, sort_order) VALUES
  ('admin.reports_read',  'Admin & System', 'View reports',       'View dashboards and analytics reports', 155),
  ('admin.reports_write', 'Admin & System', 'Build reports',      'Create and run custom reports across modules', 160),
  ('payroll.payout_read', 'Payroll',        'View payouts',       'Read payout records and disbursement history', 105),
  ('payroll.payout_write','Payroll',        'Manage payouts',     'Create and approve payroll disbursements', 106)
ON CONFLICT (key) DO NOTHING;

-- Relax the analytics guard: allow legacy admin.reports or the split view/build keys.
CREATE OR REPLACE FUNCTION public.reports_analytics(p_months integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_p_months integer := GREATEST(LEAST(COALESCE(p_months, 12), 24), 3);
  v_departed_statuses text[] := ARRAY['TERMINATED', 'RESIGNED', 'EXITED', 'DISENGAGED'];
BEGIN
  IF NOT public.has_any_privilege(ARRAY['admin.reports', 'admin.reports_read', 'admin.reports_write']) THEN
    RAISE EXCEPTION 'You do not have permission to view reports';
  END IF;

  WITH months AS (
    SELECT date_trunc('month', d)::date AS month_start
      FROM generate_series(
             date_trunc('month', CURRENT_DATE) - make_interval(months => v_p_months - 1),
             date_trunc('month', CURRENT_DATE),
             interval '1 month'
           ) AS d
  ),
  monthly_series AS (
    SELECT m.month_start,
           to_char(m.month_start, 'YYYY-MM')       AS month_key,
           to_char(m.month_start, 'Mon')           AS label,
           (SELECT count(*)::int FROM employees h
             WHERE date_trunc('month', h.created_at)::date = m.month_start)                        AS hires,
           (SELECT count(*)::int FROM employees x
             WHERE date_trunc('month', x.updated_at)::date = m.month_start
               AND x.employment_status = ANY (v_departed_statuses))                                AS exits,
           (SELECT count(*)::int FROM employees e
             WHERE e.created_at::date <= (m.month_start + interval '1 month' - interval '1 day')::date)        AS headcount
      FROM months m
  ),
  payroll_series AS (
    SELECT date_trunc('month', pay_period_end)::date AS period_start,
           to_char(pay_period_end, 'YYYY-MM')        AS period_key,
           to_char(pay_period_end, 'Mon')            AS label,
           COALESCE(sum(total_gross), 0)             AS gross,
           COALESCE(sum(total_deductions), 0)        AS deductions,
           COALESCE(sum(total_net), 0)               AS net
      FROM payroll_runs
     WHERE status IN ('APPROVED', 'DISBURSED', 'PAID', 'PROCESSED')
     GROUP BY 1, 2, 3
  ),
  department_dist AS (
    SELECT d.name                                             AS department_name,
           count(e.id)::int                                   AS employee_count
      FROM departments d
      LEFT JOIN employees e ON e.department_id = d.id
     GROUP BY d.name
    HAVING count(e.id) > 0
     ORDER BY employee_count DESC, d.name
  ),
  attendance_daily AS (
    SELECT a.date,
           a.status,
           count(*)::int AS cnt
      FROM attendance a
     WHERE a.date >= (CURRENT_DATE - interval '30 days')::date
     GROUP BY a.date, a.status
  ),
  leave_summary AS (
    SELECT lt.name                                                          AS leave_type,
           lt.code,
           count(lr.id)::int                                                AS total_requests,
           count(*) FILTER (WHERE lr.status = 'APPROVED')::int              AS approved,
           count(*) FILTER (WHERE lr.status = 'PENDING')::int               AS pending,
           COALESCE(sum(lr.end_date - lr.start_date + 1)
                    FILTER (WHERE lr.status = 'APPROVED'), 0)               AS approved_days
      FROM leave_types lt
      LEFT JOIN leave_requests lr ON lr.leave_type_id = lt.id
     GROUP BY lt.name, lt.code
    HAVING count(lr.id) > 0
     ORDER BY approved_days DESC
  ),
  recruitment_funnel AS (
    SELECT c.current_stage AS stage,
           count(*)::int   AS cnt
      FROM candidates c
     GROUP BY c.current_stage
     ORDER BY cnt DESC
  ),
  status_dist AS (
    SELECT e.employment_status AS status,
           count(*)::int       AS cnt
      FROM employees e
     GROUP BY e.employment_status
     ORDER BY cnt DESC
  )
  SELECT jsonb_build_object(
    'generated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
    'monthly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month',      ms.month_key,
        'label',      ms.label,
        'hires',      ms.hires,
        'exits',      ms.exits,
        'headcount',  ms.headcount
      ) ORDER BY ms.month_start)
      FROM monthly_series ms
    ), '[]'::jsonb),
    'payroll', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month',       ps.period_key,
        'label',       ps.label,
        'gross',       ps.gross,
        'deductions',  ps.deductions,
        'net',         ps.net
      ) ORDER BY ps.period_start)
      FROM payroll_series ps
    ), '[]'::jsonb),
    'departments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', d.department_name, 'count', d.employee_count) ORDER BY d.employee_count DESC)
      FROM department_dist d
    ), '[]'::jsonb),
    'attendance30d', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',    to_char(a.date, 'YYYY-MM-DD'),
        'status',  a.status,
        'count',   a.cnt
      ) ORDER BY a.date)
      FROM attendance_daily a
    ), '[]'::jsonb),
    'leave', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type',           l.leave_type,
        'code',           l.code,
        'total',          l.total_requests,
        'approved',       l.approved,
        'pending',        l.pending,
        'approved_days',  l.approved_days
      ) ORDER BY l.approved_days DESC)
      FROM leave_summary l
    ), '[]'::jsonb),
    'recruitment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', r.stage, 'count', r.cnt) ORDER BY r.cnt DESC)
      FROM recruitment_funnel r
    ), '[]'::jsonb),
    'status', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status', s.status, 'count', s.cnt) ORDER BY s.cnt DESC)
      FROM status_dist s
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'employees',         (SELECT count(*)::int FROM employees e WHERE NOT (e.employment_status = ANY (v_departed_statuses))),
      'pending_onboarding',(SELECT count(*)::int FROM employees e WHERE e.employment_status IN ('PENDING_VERIFICATION', 'ONBOARDING')),
      'on_leave_today',    (SELECT count(*)::int FROM leave_requests lr WHERE lr.status = 'APPROVED' AND lr.start_date <= CURRENT_DATE AND lr.end_date >= CURRENT_DATE),
      'pending_leave',     (SELECT count(*)::int FROM leave_requests lr WHERE lr.status = 'PENDING'),
      'open_candidates',   (SELECT count(*)::int FROM candidates c WHERE c.current_stage NOT IN ('HIRED', 'REJECTED', 'WITHDRAWN')),
      'assets',            (SELECT count(*)::int FROM assets a WHERE a.status NOT IN ('DISPOSED', 'RETIRED'))
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reports_analytics(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reports_analytics(integer) FROM PUBLIC;

-- Backfill: keep the new read/write split in sync for reports on existing roles.
INSERT INTO employee_privileges (employee_id, privilege_key, granted_by)
SELECT e.id, pk, NULL
  FROM employees e
  CROSS JOIN unnest(ARRAY['admin.reports', 'admin.reports_read', 'admin.reports_write']) AS pk
 WHERE NOT EXISTS (
   SELECT 1 FROM employee_privileges ep
    WHERE ep.employee_id = e.id AND ep.privilege_key = pk
 )
   AND e.role IN ('SUPER_ADMIN', 'HR_ADMIN')
ON CONFLICT DO NOTHING;