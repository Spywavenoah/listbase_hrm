/*
# Fix RLS Policies for No-Auth App (Retry)

This app has NO sign-in screen, so the browser always uses the anon key.
All existing policies are scoped `TO authenticated` only, which means every
INSERT/UPDATE/DELETE from the frontend fails with "new row violates row-level
security policy."

This migration dynamically drops ALL existing policies on ALL tables in the
public schema, then recreates them with `TO anon, authenticated` so the
anon-key client can read and write. `USING (true)` / `WITH CHECK (true)` is
acceptable because this is a single-tenant HR system with intentionally shared data.
*/

-- Step 1: Drop ALL existing policies on ALL public tables dynamically
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Step 2: Recreate all policies with TO anon, authenticated
-- system_settings
CREATE POLICY "select_system_settings" ON system_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_system_settings" ON system_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_system_settings" ON system_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_system_settings" ON system_settings FOR DELETE TO anon, authenticated USING (true);

-- mail_templates
CREATE POLICY "select_mail_templates" ON mail_templates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_mail_templates" ON mail_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_mail_templates" ON mail_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_mail_templates" ON mail_templates FOR DELETE TO anon, authenticated USING (true);

-- field_definitions
CREATE POLICY "select_field_definitions" ON field_definitions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_field_definitions" ON field_definitions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_field_definitions" ON field_definitions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_field_definitions" ON field_definitions FOR DELETE TO anon, authenticated USING (true);

-- field_values
CREATE POLICY "select_field_values" ON field_values FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_field_values" ON field_values FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_field_values" ON field_values FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_field_values" ON field_values FOR DELETE TO anon, authenticated USING (true);

-- departments
CREATE POLICY "select_departments" ON departments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_departments" ON departments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_departments" ON departments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_departments" ON departments FOR DELETE TO anon, authenticated USING (true);

-- positions
CREATE POLICY "select_positions" ON positions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_positions" ON positions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_positions" ON positions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_positions" ON positions FOR DELETE TO anon, authenticated USING (true);

-- employees
CREATE POLICY "select_employees" ON employees FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_employees" ON employees FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_employees" ON employees FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_employees" ON employees FOR DELETE TO anon, authenticated USING (true);

-- employee_documents
CREATE POLICY "select_employee_documents" ON employee_documents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_employee_documents" ON employee_documents FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_employee_documents" ON employee_documents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_employee_documents" ON employee_documents FOR DELETE TO anon, authenticated USING (true);

-- onboarding_templates
CREATE POLICY "select_onboarding_templates" ON onboarding_templates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_onboarding_templates" ON onboarding_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_onboarding_templates" ON onboarding_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_onboarding_templates" ON onboarding_templates FOR DELETE TO anon, authenticated USING (true);

-- onboarding_steps
CREATE POLICY "select_onboarding_steps" ON onboarding_steps FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_onboarding_steps" ON onboarding_steps FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_onboarding_steps" ON onboarding_steps FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_onboarding_steps" ON onboarding_steps FOR DELETE TO anon, authenticated USING (true);

-- employee_onboarding_progress
CREATE POLICY "select_onboarding_progress" ON employee_onboarding_progress FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_onboarding_progress" ON employee_onboarding_progress FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_onboarding_progress" ON employee_onboarding_progress FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_onboarding_progress" ON employee_onboarding_progress FOR DELETE TO anon, authenticated USING (true);

-- workflow_definitions
CREATE POLICY "select_workflow_definitions" ON workflow_definitions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_workflow_definitions" ON workflow_definitions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_definitions" ON workflow_definitions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_definitions" ON workflow_definitions FOR DELETE TO anon, authenticated USING (true);

-- workflow_steps
CREATE POLICY "select_workflow_steps" ON workflow_steps FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_workflow_steps" ON workflow_steps FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_steps" ON workflow_steps FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_steps" ON workflow_steps FOR DELETE TO anon, authenticated USING (true);

-- workflow_instances
CREATE POLICY "select_workflow_instances" ON workflow_instances FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_workflow_instances" ON workflow_instances FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_instances" ON workflow_instances FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_instances" ON workflow_instances FOR DELETE TO anon, authenticated USING (true);

-- workflow_actions
CREATE POLICY "select_workflow_actions" ON workflow_actions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_workflow_actions" ON workflow_actions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_workflow_actions" ON workflow_actions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_workflow_actions" ON workflow_actions FOR DELETE TO anon, authenticated USING (true);

-- module_workflow_config
CREATE POLICY "select_module_workflow_config" ON module_workflow_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_module_workflow_config" ON module_workflow_config FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_module_workflow_config" ON module_workflow_config FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_module_workflow_config" ON module_workflow_config FOR DELETE TO anon, authenticated USING (true);

-- audit_log (no update/delete - append-only)
CREATE POLICY "select_audit_log" ON audit_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_audit_log" ON audit_log FOR INSERT TO anon, authenticated WITH CHECK (true);

-- leave_types
CREATE POLICY "select_leave_types" ON leave_types FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_leave_types" ON leave_types FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_leave_types" ON leave_types FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_leave_types" ON leave_types FOR DELETE TO anon, authenticated USING (true);

-- leave_requests
CREATE POLICY "select_leave_requests" ON leave_requests FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_leave_requests" ON leave_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_leave_requests" ON leave_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_leave_requests" ON leave_requests FOR DELETE TO anon, authenticated USING (true);

-- attendance
CREATE POLICY "select_attendance" ON attendance FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_attendance" ON attendance FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_attendance" ON attendance FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_attendance" ON attendance FOR DELETE TO anon, authenticated USING (true);

-- assets
CREATE POLICY "select_assets" ON assets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_assets" ON assets FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_assets" ON assets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_assets" ON assets FOR DELETE TO anon, authenticated USING (true);

-- pay_components
CREATE POLICY "select_pay_components" ON pay_components FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_pay_components" ON pay_components FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_pay_components" ON pay_components FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_pay_components" ON pay_components FOR DELETE TO anon, authenticated USING (true);

-- payroll_runs
CREATE POLICY "select_payroll_runs" ON payroll_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_payroll_runs" ON payroll_runs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_payroll_runs" ON payroll_runs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_payroll_runs" ON payroll_runs FOR DELETE TO anon, authenticated USING (true);

-- payslips
CREATE POLICY "select_payslips" ON payslips FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_payslips" ON payslips FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_payslips" ON payslips FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_payslips" ON payslips FOR DELETE TO anon, authenticated USING (true);

-- recruitment_jobs
CREATE POLICY "select_recruitment_jobs" ON recruitment_jobs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_recruitment_jobs" ON recruitment_jobs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_recruitment_jobs" ON recruitment_jobs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_recruitment_jobs" ON recruitment_jobs FOR DELETE TO anon, authenticated USING (true);

-- candidates
CREATE POLICY "select_candidates" ON candidates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_candidates" ON candidates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_candidates" ON candidates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_candidates" ON candidates FOR DELETE TO anon, authenticated USING (true);

-- performance_reviews
CREATE POLICY "select_performance_reviews" ON performance_reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_performance_reviews" ON performance_reviews FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_performance_reviews" ON performance_reviews FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_performance_reviews" ON performance_reviews FOR DELETE TO anon, authenticated USING (true);

-- holidays
CREATE POLICY "select_holidays" ON holidays FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_holidays" ON holidays FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_holidays" ON holidays FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_holidays" ON holidays FOR DELETE TO anon, authenticated USING (true);

-- performance_goals
CREATE POLICY "select_performance_goals" ON performance_goals FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_performance_goals" ON performance_goals FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_performance_goals" ON performance_goals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_performance_goals" ON performance_goals FOR DELETE TO anon, authenticated USING (true);

-- training_courses
CREATE POLICY "select_training_courses" ON training_courses FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_training_courses" ON training_courses FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_training_courses" ON training_courses FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_training_courses" ON training_courses FOR DELETE TO anon, authenticated USING (true);

-- training_enrollments
CREATE POLICY "select_training_enrollments" ON training_enrollments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_training_enrollments" ON training_enrollments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_training_enrollments" ON training_enrollments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_training_enrollments" ON training_enrollments FOR DELETE TO anon, authenticated USING (true);