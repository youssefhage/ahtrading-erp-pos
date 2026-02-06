-- Add company_id to tax_lines for RLS isolation

ALTER TABLE tax_lines ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE tax_lines tl
SET company_id = tc.company_id
FROM tax_codes tc
WHERE tl.tax_code_id = tc.id AND tl.company_id IS NULL;

ALTER TABLE tax_lines ALTER COLUMN company_id SET NOT NULL;

DROP POLICY IF EXISTS tax_lines_isolation ON tax_lines;
CREATE POLICY tax_lines_isolation ON tax_lines USING (company_id = app_current_company_id());
