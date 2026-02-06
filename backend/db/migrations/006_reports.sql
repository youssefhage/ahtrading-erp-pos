-- Reporting views

CREATE OR REPLACE VIEW vat_report_monthly AS
SELECT
  tl.company_id,
  tc.id AS tax_code_id,
  tc.name AS tax_name,
  date_trunc('month', COALESCE(tl.tax_date, tl.created_at))::date AS period,
  SUM(tl.base_lbp) AS base_lbp,
  SUM(tl.tax_lbp) AS tax_lbp
FROM tax_lines tl
JOIN tax_codes tc ON tc.id = tl.tax_code_id
GROUP BY tl.company_id, tc.id, tc.name, date_trunc('month', COALESCE(tl.tax_date, tl.created_at));

CREATE OR REPLACE VIEW gl_trial_balance AS
SELECT
  j.company_id,
  e.account_id,
  SUM(e.debit_usd) AS debit_usd,
  SUM(e.credit_usd) AS credit_usd,
  SUM(e.debit_lbp) AS debit_lbp,
  SUM(e.credit_lbp) AS credit_lbp
FROM gl_entries e
JOIN gl_journals j ON j.id = e.journal_id
GROUP BY j.company_id, e.account_id;
