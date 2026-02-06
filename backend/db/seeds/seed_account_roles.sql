BEGIN;

INSERT INTO account_roles (code, description) VALUES
  ('AR','Accounts Receivable'),
  ('AP','Accounts Payable'),
  ('CASH','Cash'),
  ('BANK','Bank'),
  ('SALES','Sales Revenue'),
  ('SALES_RETURNS','Sales Returns'),
  ('VAT_PAYABLE','VAT Payable'),
  ('VAT_RECOVERABLE','VAT Recoverable'),
  ('INVENTORY','Inventory'),
  ('COGS','Cost of Goods Sold'),
  ('INV_ADJ','Inventory Adjustments'),
  ('ROUNDING','Rounding Differences'),
  ('INTERCO_AR','Intercompany Receivable'),
  ('INTERCO_AP','Intercompany Payable'),
  ('GRNI','Goods Received Not Invoiced')
ON CONFLICT (code) DO NOTHING;

COMMIT;
