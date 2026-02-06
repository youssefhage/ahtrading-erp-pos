# Data Model (Proposed)

## 1) Conventions
- Use UUID primary keys.
- Include `company_id` on all business tables.
- Monetary fields are numeric with explicit currency columns.
- Use UTC timestamps; store local time only for UI convenience.

## 2) Currency Model
### Core Fields
- `amount_usd` numeric(18,4)
- `amount_lbp` numeric(18,2)
- `exchange_rate` numeric(18,6)
- `rate_type` enum('official','market','internal')
- `pricing_currency` enum('USD','LBP')
- `settlement_currency` enum('USD','LBP')

### Rule
- Every financial document stores both currencies and the rate at creation time.

## 3) Company + Security
### companies
- id, name, legal_name, registration_no, vat_no, default_currency

### branches
- id, company_id, name, address

### users
- id, email, hashed_password

### roles
- id, company_id, name

### permissions
- id, code, description

### role_permissions
- role_id, permission_id

### user_roles
- user_id, role_id

## 4) COA (Template + Company)
### coa_templates
- id, code, name, description, default_language

### coa_template_accounts
- id, template_id, account_code, name_ar, name_en, name_fr
- normal_balance_raw
- is_postable_default (bool)

### company_coa_accounts
- id, company_id, account_code
- name_ar, name_en, name_fr
- normal_balance (enum: debit|credit|both|none)
- is_postable (bool)
- parent_account_id (nullable)
- template_account_id (nullable)

### coa_mappings
- id, company_id
- source_account_id, target_template_account_id
- mapping_type (direct|aggregate)
- effective_from, effective_to

## 5) General Ledger
### gl_journals
- id, company_id, journal_no, source_type, source_id
- journal_date, currency_usd, currency_lbp, rate_type

### gl_entries
- id, journal_id, account_id
- debit_usd, credit_usd, debit_lbp, credit_lbp
- tax_code_id (nullable)
- memo

## 6) Tax + VAT
### tax_codes
- id, company_id, name, rate, tax_type
- reporting_currency (LBP)

### tax_lines
- id, source_type, source_id
- tax_code_id, base_usd, base_lbp, tax_usd, tax_lbp

## 7) Inventory
### items
- id, company_id, sku, barcode, name
- unit_of_measure, tax_code_id
- reorder_point, reorder_qty

### item_prices
- id, item_id, price_usd, price_lbp
- effective_from, effective_to

### warehouses
- id, company_id, name, location

### stock_moves
- id, company_id, item_id, warehouse_id
- qty_in, qty_out, unit_cost_usd, unit_cost_lbp
- source_type, source_id

## 8) Customers & Suppliers
### customers
- id, company_id, name, phone, email
- credit_limit_usd, credit_limit_lbp
- credit_balance_usd, credit_balance_lbp
- loyalty_points

### customer_loyalty_ledger
- id, company_id, customer_id
- source_type, source_id, points, created_at

### suppliers
- id, company_id, name, phone, email

### item_suppliers
- id, company_id, item_id, supplier_id
- is_primary, lead_time_days, min_order_qty
- last_cost_usd, last_cost_lbp

## 9) Sales
### sales_orders
- id, company_id, customer_id, status
- total_usd, total_lbp, exchange_rate

### sales_invoices
- id, company_id, invoice_no, status
- total_usd, total_lbp, exchange_rate

### sales_invoice_lines
- id, invoice_id, item_id, qty
- unit_price_usd, unit_price_lbp
- line_total_usd, line_total_lbp

### sales_payments
- id, invoice_id, method, amount_usd, amount_lbp

## 10) Purchasing
### purchase_orders
- id, company_id, supplier_id, status
- total_usd, total_lbp, exchange_rate

### purchase_order_lines
- id, company_id, purchase_order_id, item_id, qty
- unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp

### supplier_invoices
- id, company_id, invoice_no, status
- total_usd, total_lbp, exchange_rate

## 11) Intercompany
### intercompany_documents
- id, source_company_id, issue_company_id, sell_company_id
- source_type, source_id
- settlement_status

### intercompany_settlements
- id, from_company_id, to_company_id
- amount_usd, amount_lbp, exchange_rate
- journal_id

## 12) POS Offline
### pos_devices
- id, company_id, branch_id, device_code

### pos_events_outbox
- id, device_id, event_type, payload_json, created_at

### pos_events_inbox
- id, device_id, event_type, payload_json, applied_at

## 13) AI
### events
- id, company_id, event_type, payload_json

### ai_recommendations
- id, company_id, agent_code, recommendation_json, status

### ai_actions
- id, company_id, agent_code, action_json, status

### ai_agent_settings
- company_id, agent_code, auto_execute, max_amount_usd, max_actions_per_day
