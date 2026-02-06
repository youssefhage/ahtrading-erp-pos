-- AH Trading ERP/POS - Initial Schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums
DO $$ BEGIN
  CREATE TYPE currency_code AS ENUM ('USD','LBP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rate_type AS ENUM ('official','market','internal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE normal_balance AS ENUM ('debit','credit','both','none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doc_status AS ENUM ('draft','posted','canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Core
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  registration_no text,
  vat_no text,
  base_currency currency_code NOT NULL DEFAULT 'USD',
  vat_currency currency_code NOT NULL DEFAULT 'LBP',
  default_rate_type rate_type NOT NULL DEFAULT 'market',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  hashed_password text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  description text
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id),
  PRIMARY KEY (user_id, role_id)
);

-- Exchange Rates
CREATE TABLE IF NOT EXISTS exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  rate_date date NOT NULL,
  rate_type rate_type NOT NULL,
  usd_to_lbp numeric(18,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, rate_date, rate_type)
);

-- COA Templates
CREATE TABLE IF NOT EXISTS coa_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  default_language text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coa_template_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES coa_templates(id) ON DELETE CASCADE,
  account_code text NOT NULL,
  name_ar text,
  name_en text,
  name_fr text,
  normal_balance_raw text,
  is_postable_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, account_code)
);

CREATE TABLE IF NOT EXISTS company_coa_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  version_no integer NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, version_no)
);

CREATE TABLE IF NOT EXISTS company_coa_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  account_code text NOT NULL,
  name_ar text,
  name_en text,
  name_fr text,
  normal_balance normal_balance NOT NULL DEFAULT 'none',
  is_postable boolean NOT NULL DEFAULT true,
  parent_account_id uuid REFERENCES company_coa_accounts(id),
  template_account_id uuid REFERENCES coa_template_accounts(id),
  version_id uuid REFERENCES company_coa_versions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, account_code)
);

CREATE TABLE IF NOT EXISTS coa_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  source_account_id uuid NOT NULL REFERENCES company_coa_accounts(id),
  target_template_account_id uuid NOT NULL REFERENCES coa_template_accounts(id),
  mapping_type text NOT NULL DEFAULT 'direct',
  effective_from date NOT NULL,
  effective_to date
);

-- Customers / Suppliers
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tax
CREATE TABLE IF NOT EXISTS tax_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  rate numeric(6,4) NOT NULL,
  tax_type text NOT NULL,
  reporting_currency currency_code NOT NULL DEFAULT 'LBP'
);

CREATE TABLE IF NOT EXISTS tax_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  tax_code_id uuid NOT NULL REFERENCES tax_codes(id),
  base_usd numeric(18,4) NOT NULL DEFAULT 0,
  base_lbp numeric(18,2) NOT NULL DEFAULT 0,
  tax_usd numeric(18,4) NOT NULL DEFAULT 0,
  tax_lbp numeric(18,2) NOT NULL DEFAULT 0
);

-- Inventory
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  sku text NOT NULL,
  barcode text,
  name text NOT NULL,
  unit_of_measure text NOT NULL,
  tax_code_id uuid REFERENCES tax_codes(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);

CREATE TABLE IF NOT EXISTS item_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price_usd numeric(18,4) NOT NULL DEFAULT 0,
  price_lbp numeric(18,2) NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  effective_to date
);

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  location text
);

CREATE TABLE IF NOT EXISTS batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id),
  batch_no text,
  expiry_date date
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  item_id uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  batch_id uuid REFERENCES batches(id),
  qty_in numeric(18,4) NOT NULL DEFAULT 0,
  qty_out numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost_usd numeric(18,4) NOT NULL DEFAULT 0,
  unit_cost_lbp numeric(18,2) NOT NULL DEFAULT 0,
  source_type text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sales
CREATE TABLE IF NOT EXISTS sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  customer_id uuid REFERENCES customers(id),
  status doc_status NOT NULL DEFAULT 'draft',
  total_usd numeric(18,4) NOT NULL DEFAULT 0,
  total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  exchange_rate numeric(18,6) NOT NULL,
  pricing_currency currency_code NOT NULL DEFAULT 'USD',
  settlement_currency currency_code NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  invoice_no text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  status doc_status NOT NULL DEFAULT 'draft',
  total_usd numeric(18,4) NOT NULL DEFAULT 0,
  total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  exchange_rate numeric(18,6) NOT NULL,
  pricing_currency currency_code NOT NULL DEFAULT 'USD',
  settlement_currency currency_code NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no)
);

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  qty numeric(18,4) NOT NULL,
  unit_price_usd numeric(18,4) NOT NULL DEFAULT 0,
  unit_price_lbp numeric(18,2) NOT NULL DEFAULT 0,
  line_total_usd numeric(18,4) NOT NULL DEFAULT 0,
  line_total_lbp numeric(18,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  method text NOT NULL,
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  invoice_id uuid REFERENCES sales_invoices(id),
  status doc_status NOT NULL DEFAULT 'draft',
  total_usd numeric(18,4) NOT NULL DEFAULT 0,
  total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  exchange_rate numeric(18,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Purchasing
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  supplier_id uuid REFERENCES suppliers(id),
  status doc_status NOT NULL DEFAULT 'draft',
  total_usd numeric(18,4) NOT NULL DEFAULT 0,
  total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  exchange_rate numeric(18,6) NOT NULL,
  pricing_currency currency_code NOT NULL DEFAULT 'USD',
  settlement_currency currency_code NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  supplier_id uuid REFERENCES suppliers(id),
  status doc_status NOT NULL DEFAULT 'draft',
  total_usd numeric(18,4) NOT NULL DEFAULT 0,
  total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  exchange_rate numeric(18,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  invoice_no text NOT NULL,
  supplier_id uuid REFERENCES suppliers(id),
  status doc_status NOT NULL DEFAULT 'draft',
  total_usd numeric(18,4) NOT NULL DEFAULT 0,
  total_lbp numeric(18,2) NOT NULL DEFAULT 0,
  exchange_rate numeric(18,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  method text NOT NULL,
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- General Ledger
CREATE TABLE IF NOT EXISTS gl_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  journal_no text NOT NULL,
  source_type text,
  source_id uuid,
  journal_date date NOT NULL,
  rate_type rate_type NOT NULL DEFAULT 'market',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, journal_no)
);

CREATE TABLE IF NOT EXISTS gl_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES gl_journals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES company_coa_accounts(id),
  debit_usd numeric(18,4) NOT NULL DEFAULT 0,
  credit_usd numeric(18,4) NOT NULL DEFAULT 0,
  debit_lbp numeric(18,2) NOT NULL DEFAULT 0,
  credit_lbp numeric(18,2) NOT NULL DEFAULT 0,
  memo text
);

-- Intercompany
CREATE TABLE IF NOT EXISTS intercompany_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_company_id uuid NOT NULL REFERENCES companies(id),
  issue_company_id uuid NOT NULL REFERENCES companies(id),
  sell_company_id uuid NOT NULL REFERENCES companies(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  settlement_status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intercompany_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_company_id uuid NOT NULL REFERENCES companies(id),
  to_company_id uuid NOT NULL REFERENCES companies(id),
  amount_usd numeric(18,4) NOT NULL DEFAULT 0,
  amount_lbp numeric(18,2) NOT NULL DEFAULT 0,
  exchange_rate numeric(18,6) NOT NULL,
  journal_id uuid REFERENCES gl_journals(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- POS Offline
CREATE TABLE IF NOT EXISTS pos_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  branch_id uuid REFERENCES branches(id),
  device_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, device_code)
);

CREATE TABLE IF NOT EXISTS pos_events_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS pos_events_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
  last_sync_at timestamptz,
  last_event_id uuid
);

-- Audit
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_branches_company ON branches(company_id);
CREATE INDEX IF NOT EXISTS idx_roles_company ON roles(company_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_company ON user_roles(company_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_company_date ON exchange_rates(company_id, rate_date);
CREATE INDEX IF NOT EXISTS idx_company_coa_accounts_company ON company_coa_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_company ON warehouses(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_company ON stock_moves(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_company ON sales_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company ON purchase_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_gl_journals_company ON gl_journals(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_logs(company_id);

-- RLS Helper
CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_company_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- Enable RLS on company-scoped tables
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_coa_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_coa_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE coa_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_events_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_events_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY branches_isolation ON branches USING (company_id = app_current_company_id());
CREATE POLICY roles_isolation ON roles USING (company_id = app_current_company_id());
CREATE POLICY user_roles_isolation ON user_roles USING (company_id = app_current_company_id());
CREATE POLICY exchange_rates_isolation ON exchange_rates USING (company_id = app_current_company_id());
CREATE POLICY company_coa_versions_isolation ON company_coa_versions USING (company_id = app_current_company_id());
CREATE POLICY company_coa_accounts_isolation ON company_coa_accounts USING (company_id = app_current_company_id());
CREATE POLICY coa_mappings_isolation ON coa_mappings USING (company_id = app_current_company_id());
CREATE POLICY customers_isolation ON customers USING (company_id = app_current_company_id());
CREATE POLICY suppliers_isolation ON suppliers USING (company_id = app_current_company_id());
CREATE POLICY tax_codes_isolation ON tax_codes USING (company_id = app_current_company_id());
CREATE POLICY tax_lines_isolation ON tax_lines USING (company_id = app_current_company_id());
CREATE POLICY items_isolation ON items USING (company_id = app_current_company_id());
CREATE POLICY item_prices_isolation ON item_prices USING (item_id IN (SELECT id FROM items WHERE company_id = app_current_company_id()));
CREATE POLICY warehouses_isolation ON warehouses USING (company_id = app_current_company_id());
CREATE POLICY batches_isolation ON batches USING (company_id = app_current_company_id());
CREATE POLICY stock_moves_isolation ON stock_moves USING (company_id = app_current_company_id());
CREATE POLICY sales_orders_isolation ON sales_orders USING (company_id = app_current_company_id());
CREATE POLICY sales_invoices_isolation ON sales_invoices USING (company_id = app_current_company_id());
CREATE POLICY sales_invoice_lines_isolation ON sales_invoice_lines USING (invoice_id IN (SELECT id FROM sales_invoices WHERE company_id = app_current_company_id()));
CREATE POLICY sales_payments_isolation ON sales_payments USING (invoice_id IN (SELECT id FROM sales_invoices WHERE company_id = app_current_company_id()));
CREATE POLICY sales_returns_isolation ON sales_returns USING (company_id = app_current_company_id());
CREATE POLICY purchase_orders_isolation ON purchase_orders USING (company_id = app_current_company_id());
CREATE POLICY goods_receipts_isolation ON goods_receipts USING (company_id = app_current_company_id());
CREATE POLICY supplier_invoices_isolation ON supplier_invoices USING (company_id = app_current_company_id());
CREATE POLICY supplier_payments_isolation ON supplier_payments USING (supplier_invoice_id IN (SELECT id FROM supplier_invoices WHERE company_id = app_current_company_id()));
CREATE POLICY gl_journals_isolation ON gl_journals USING (company_id = app_current_company_id());
CREATE POLICY gl_entries_isolation ON gl_entries USING (journal_id IN (SELECT id FROM gl_journals WHERE company_id = app_current_company_id()));
CREATE POLICY intercompany_documents_isolation ON intercompany_documents USING (source_company_id = app_current_company_id() OR issue_company_id = app_current_company_id() OR sell_company_id = app_current_company_id());
CREATE POLICY intercompany_settlements_isolation ON intercompany_settlements USING (from_company_id = app_current_company_id() OR to_company_id = app_current_company_id());
CREATE POLICY pos_devices_isolation ON pos_devices USING (company_id = app_current_company_id());
CREATE POLICY pos_events_outbox_isolation ON pos_events_outbox USING (device_id IN (SELECT id FROM pos_devices WHERE company_id = app_current_company_id()));
CREATE POLICY pos_events_inbox_isolation ON pos_events_inbox USING (device_id IN (SELECT id FROM pos_devices WHERE company_id = app_current_company_id()));
CREATE POLICY pos_sync_state_isolation ON pos_sync_state USING (device_id IN (SELECT id FROM pos_devices WHERE company_id = app_current_company_id()));
CREATE POLICY audit_logs_isolation ON audit_logs USING (company_id = app_current_company_id());
