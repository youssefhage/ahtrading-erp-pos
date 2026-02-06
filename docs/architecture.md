# AH Trading ERP/POS System Architecture (v1)

## 1) Goals and Constraints
- Small FMCG wholesale + retail business inspired by Costco.
- Operate in Lebanon with dual currency (USD + LBP) required for every core flow.
- VAT must be computed and reported in LBP.
- Two companies today, more possible later. Strict isolation of company data.
- Rare cases: sell/issue from a different company (controlled intercompany flow).
- Offline-first POS with poor internet, zero downtime for sales.
- Low-spec POS hardware (4 GB RAM), must be fast and stable.
- Modular system with AI agents that can recommend and (optionally) auto-execute.
- Support Lebanese COA, IFRS-style COA, and custom COA templates.
- Multilingual COA labels (Arabic/English/French) already available.

## 2) Core Principles
- Offline-first: POS never blocks on the network.
- Dual-currency ledger: store both currencies and the exchange rate at transaction time.
- Company isolation: strong boundaries at data and API layers.
- Auditability: immutable ledger entries and full change history.
- Modular monolith first: split into services only when needed.

## 3) Architecture Overview
### 3.1 Logical Modules (Monolith)
- Auth and User Management
- Company and Branch Management
- Chart of Accounts (COA)
- General Ledger (GL)
- AP/AR
- Inventory and Warehousing
- Purchasing
- Sales and POS
- CRM and Loyalty
- Pricing and Promotions
- Tax and Compliance (Lebanon VAT)
- Reporting and Analytics
- AI Agent Orchestration
- Integration Layer (imports, exports, payments)

### 3.2 Physical Components
- POS Desktop App (offline-capable)
- Web App (management, reporting, configuration)
- Core API server
- Background workers (sync, reporting, AI)
- Database (PostgreSQL)
- Local POS cache DB (SQLite)

## 4) Offline POS Design
### 4.1 Local Cache
- Lightweight local SQLite on each POS workstation.
- Cached data: items, prices, active promotions, customer list (optional), tax rules.
- Write-ahead queue for orders, returns, payments, cash movements, and end-of-day.

### 4.2 Sync Model
- Outbox pattern on POS: pending events sync when online.
- Inbound updates from server are applied incrementally.
- Conflict policy: POS never overwrites authoritative server data; updates are replayed.
- Each event is idempotent with a unique UUID.

### 4.3 Availability
- POS can run fully offline for a full day.
- End-of-day sync reconciles sales, payments, and inventory updates.

## 5) Multi-Company Isolation
- All domain records include company_id.
- Database Row-Level Security (RLS) enforces access.
- API scopes requests to a single company by default.
- Only allowed multi-company views: consolidated reporting and admin dashboards.

## 6) Intercompany Issuing (Rare Cases)
### 6.1 Use Case
- Sale is processed in company A, but items must be issued from company B.

### 6.2 Solution
- Intercompany document workflow:
  - Source sale document in company A
  - Issue or stock decrement in company B
  - Auto-generated intercompany journal entries
  - Settlement accounts track balances between companies

### 6.3 Controls
- Requires explicit user permission and audit logging.
- Optional approval workflow for cross-company transactions.

## 7) Dual Currency Ledger (USD + LBP)
### 7.1 Transaction Fields
Every financial document stores:
- amount_usd
- amount_lbp
- exchange_rate_at_time
- pricing_currency
- settlement_currency
- tax_currency (LBP required)

### 7.2 Rate Source
- Daily rate table per company
- Support multiple rate types: official, market, internal
- Each document locks the rate at time of creation

### 7.3 VAT Reporting
- VAT is always computed and stored in LBP
- Reports use LBP as the base

## 8) Chart of Accounts (COA)
### 8.1 Template-Based COA
- COA templates are stored separately:
  - Lebanese COA template
  - IFRS-style COA template
  - Custom COA templates

### 8.2 Company COA
- Each company selects a template to initialize its COA
- Company COA can be customized without affecting templates
- Multilingual labels per account: ar, en, fr

### 8.3 COA Mapping
- Mapping layer links local accounts to IFRS for consolidated reporting
- Versioned mappings for audit and reporting history

## 9) Data Model (Simplified)
### 9.1 Core Tables
- companies
- branches
- users
- roles
- permissions

### 9.2 Accounting
- coa_templates
- coa_template_accounts
- company_coa_accounts
- company_coa_versions
- coa_mappings
- gl_journals
- gl_entries

### 9.3 Sales
- sales_orders
- sales_invoices
- sales_payments
- sales_returns

### 9.4 Purchasing
- purchase_orders
- goods_receipts
- supplier_invoices
- supplier_payments

### 9.5 Inventory
- items
- item_prices
- warehouses
- stock_moves
- batches

### 9.6 Intercompany
- intercompany_documents
- intercompany_settlements

## 10) AI Agent Orchestration
### 10.1 Core Idea
- Every business event emits a structured event
- AI agents consume events and propose actions

### 10.2 Agents
- AI Purchase: reorder suggestions, supplier selection
- AI Sales/CRM: customer follow-ups, discount recommendations
- AI Inventory: detect shrinkage, stockout risk
- AI Fulfillment: optimize picking and delivery

### 10.3 Auto-Execute vs Recommend
- Configurable per company and per agent
- Require approvals for high-risk actions
- Full audit trail for all AI-triggered actions

## 11) Security and Audit
- RLS per company for database safety
- Full audit logs for critical actions
- Immutable ledger entries
- Strong role-based permissions

## 12) Suggested Deployment
### 12.1 On-Prem Core
- Local server in-store (or in warehouse) for reliability
- POS devices connect to local server

### 12.2 Cloud Sync (Optional)
- Periodic sync to cloud for backups and remote access
- Cloud acts as secondary site

## 13) Next Steps
- Import Lebanese COA reference file
- Finalize data schema for dual-currency documents
- Define POS offline sync protocol
- Build initial MVP modules: POS, Inventory, Purchasing, Accounting

