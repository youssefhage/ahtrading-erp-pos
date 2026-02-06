# System Blueprint

## 1) Solution Shape
A modular monolith with clear domain boundaries, designed to run on-prem for reliability and optionally sync to cloud for backups and remote access.

## 2) Core Modules
- Company & Branch Management
- User, Roles, Permissions
- Chart of Accounts (template-based)
- General Ledger + AP/AR
- Purchasing
- Inventory + Warehouse
- Sales & POS
- Pricing & Promotions
- CRM & Loyalty
- Tax & Compliance (Lebanon VAT)
- Reporting & BI
- Intercompany Transactions
- AI Agent Orchestration

## 3) Deployment Topology
- On-Prem Core Server (primary, always available)
- POS Desktop Clients (offline-first)
- Web Admin + Management UI (LAN + VPN)
- Optional Cloud Sync (secondary for backups + remote access)

## 4) Data Isolation Strategy
- All tables include `company_id`.
- Database Row-Level Security (RLS) prevents cross-company leakage.
- API enforces company-scoped tokens by default.
- Cross-company operations require explicit elevated permission.

## 5) Offline Strategy
- POS writes to local SQLite cache.
- Outbox queue flushes when online.
- Inbound updates apply incrementally.
- Conflict resolution follows server authority and idempotent events.

## 6) Dual Currency Strategy
- Every document stores USD amount, LBP amount, and exchange rate at time of transaction.
- VAT always computed/stored in LBP.
- Daily rates stored per company; multiple rate types supported.

## 7) Intercompany Issuing
- Intercompany document workflow posts:
  - Sale in company A
  - Issue/stock decrement in company B
  - Auto-journal entries
  - Settlement balances tracked between companies

## 8) AI Automation
- Agents operate on event stream.
- Auto-execute can be enabled per agent with thresholds and approvals.
- All AI actions are logged and reversible when possible.
