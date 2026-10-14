-- Recruitment requisition rich-text job description.
-- Adds a free-form (HTML) job description field to recruitment requisitions
-- so the role duty/responsibility can be captured during the request.

ALTER TABLE recruitment_requisitions
  ADD COLUMN IF NOT EXISTS job_description text;