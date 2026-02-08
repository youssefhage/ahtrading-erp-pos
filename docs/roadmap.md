# Roadmap

## Current Status (2026-02-08)

We have a working end-to-end POS + ERP foundation (RLS, outbox worker, dual-currency, GL posting, Admin UI).

The immediate focus is to reduce operational drift and productize the Admin UI:
- Platform audits and execution backlog:
  - `docs/audits/platform-audit-2026-02-07.md`
  - `docs/audits/platform-audit-2026-02-08-deep-dive.md`
- Admin UI/UX phased plan:
  - `docs/admin-ui-ux-audit.md`
 - AI layer is now visibly embedded in core screens (items/AP/expiry + dashboard counts) as a practical assist layer.

## Near-Term Focus (Next 2-4 Weeks)

1) Ops reliability and observability
- Worker/job health surfaced in Admin (heartbeat + failed runs + last activity)
- Structured logging + correlation ids
- Restore drills + post-restore verification checklist (already started)

2) Admin UI: Document-first rebuild
- Continue converting high-usage modules to document routes:
  - Sales Invoices, Supplier Invoices (started)
  - Purchase Orders, Goods Receipts, Items, Customers
- Centralize error parsing + consistent empty/error states

3) Data integrity and auditability
- Expand audit trail coverage and surface timeline per document in Admin
- Close remaining “free-string” validation drift (keep inputs strict)

4) AI-assisted ingestion (Purchases)
- Telegram/WhatsApp invoice upload -> AI draft Supplier Invoice (async fill + human review)
- Supplier item code/name aliasing to improve matching and reduce noisy item creation
- “Price impact” and margin-risk insights on new supplier invoices

## Phase 0: Foundation
- Define COA templates (Lebanese + IFRS stub + custom template tooling)
- Dual-currency data model finalized
- VAT rules and reporting format defined
- POS offline sync protocol finalized

## Phase 1: Core MVP
- Companies, users, roles, permissions
- Inventory + warehouse
- Purchasing (PO, GRN, supplier invoice)
- Sales + POS offline (invoice, receipt, return)
- GL auto-posting
- VAT reports in LBP

## Phase 2: Operations
- CRM, loyalty
- Pricing engine and promotions
- Intercompany issuing workflow
- Consolidated reporting

## Phase 3: AI Automation
- AI purchase recommendations
- AI inventory alerts
- AI CRM follow-up suggestions
- Auto-execute workflows with approval gates

## Phase 4: Optimization
- Advanced analytics
- Forecasting and demand planning
- Multi-warehouse support
