-- GL journal metadata for manual journals and better auditability.

ALTER TABLE gl_journals
  ADD COLUMN IF NOT EXISTS memo text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_gl_journals_company_date
  ON gl_journals (company_id, journal_date DESC, journal_no);

CREATE INDEX IF NOT EXISTS idx_gl_journals_company_source
  ON gl_journals (company_id, source_type, source_id);

