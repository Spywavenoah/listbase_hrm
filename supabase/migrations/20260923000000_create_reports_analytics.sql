/*
# Reports & Analytics — aggregated data source

Backs the `/reports` dashboard with live, privilege-gated aggregates.

- `reports_analytics(p_months)` — SECURITY DEFINER function returning a JSON
  payload of all dashboard series (headcount, hires/exits, payroll cost,
  department distribution, attendance, leave and recruitment funnels).
- The function is guarded by `has_privilege('admin.reports')` so raw
  organization-wide aggregates (including payroll totals) are never exposed
  to employees without report-builder access.

Conventions followed:
- `SET search_path = public`
- `SECURITY DEFINER` (like `set_employee_access`, `current_employee_id`)
- grant to `authenticated`, revoke from PUBLIC
*/

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
  IF NOT public.has_privilege('admin.reports') THEN
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