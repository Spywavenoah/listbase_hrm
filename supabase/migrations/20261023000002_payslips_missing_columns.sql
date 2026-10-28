-- ============================================================
-- Fix: Add missing columns to payslips table
-- ============================================================
-- generate_payroll_run() inserts into employer_cost and
-- employer_contributions, but those columns were never added
-- to the payslips table. This causes the INSERT to fail and
-- no payslips or recorder ledger entries are created.
-- ============================================================

ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS employer_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_contributions jsonb DEFAULT '[]'::jsonb;

-- Ensure existing payslips have valid defaults
UPDATE public.payslips
  SET employer_cost = COALESCE(employer_cost, 0),
      employer_contributions = COALESCE(employer_contributions, '[]'::jsonb);