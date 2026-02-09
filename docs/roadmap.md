# Roadmap

Last updated: 2026-02-09

Repo: `/Users/Youssef/oDocuments/Business/Codex POS`

## Where We Are Now (What We Achieved)

Core platform is live-quality in the areas that cause real-world breakage:
- Security hardening:
  - POS desktop agent is loopback-bound by default; LAN exposure requires explicit host config and LAN requests are gated behind a local PIN session.
  - Auth sessions use strong random tokens stored as one-way hashes; session revocation controls exist (logout-all, revoke user/company sessions) and sessions are revoked on role/permission changes.
- DB invariants + drift protection:
  - “One open shift per device” enforced at DB level.
  - Bootstrap/migrations now run all numeric migrations in order (prevents fresh-environment drift).
- Ops reliability + observability:
  - Worker heartbeat + job health surfaced in Ops Copilot.
  - Structured JSON logging + `X-Request-Id` correlation.
  - `/health` checks DB connectivity.
- ERP robustness upgrades executed from the audit:
  - Stronger expiry/lot handling (FEFO rules, warehouse shelf-life policy, batch metadata, cycle counts for batch-tracked items).
  - Stock reporting includes reserved/incoming/available and negative-stock policy supports company + warehouse + item overrides.
  - GL immutability enforced via DB triggers.
  - Supplier invoice hold/unhold workflow (auto-hold on variance + manual controls; payments blocked while on hold).
  - Audit logs expanded (users/config/high-value mutations) + Admin audit feed page.
- Practical AI layer embedded into operations (non-blocking, safe-by-default):
  - Deterministic “AI Insights” in Admin: items hygiene, AP guard, expiry ops + dashboard pending counts.
  - AI-assisted purchases ingestion v1:
    - Admin upload (image/PDF) creates a draft supplier invoice, always attaches the original document, preserves supplier item code/name, learns supplier item aliases, and surfaces price-impact insights.
    - Telegram webhook receiver exists (off-by-default) to support “send invoice → create draft”.
  - AI governance:
    - Company setting `company_settings.key='ai'` / `allow_external_processing` can disable external AI processing while keeping “draft + attachment” working.
- Admin UX speed upgrades (daily operator quality-of-life):
  - Added `GET /pricing/catalog` (effective prices + barcodes) for Admin.
  - Sales Invoice Draft + Supplier Invoice Draft: searchable item picking (name/barcode/SKU), UOM shown by default, and unit price/cost auto-fill (editable).
  - Sales Invoice Draft item picking now scales to large catalogs via `GET /pricing/catalog/typeahead` (no full catalog load).
  - Replaced remaining raw “Status” `<pre>` blocks with `ErrorBanner` + “View raw” details (more actionable and less fragile).

Canonical execution documents:
- `/Users/Youssef/oDocuments/Business/Codex POS/docs/audits/platform-audit-2026-02-07.md`
- `/Users/Youssef/oDocuments/Business/Codex POS/docs/audits/platform-audit-2026-02-08-deep-dive.md`
- `/Users/Youssef/oDocuments/Business/Codex POS/docs/admin-ui-ux-audit.md`

## Next 2-4 Weeks (High-ROI, Low-Regret)

1) Admin UI: complete the document-first experience
- Convert Purchase Orders, Goods Receipts, Items, Customers into consistent list/new/[id]/edit routes.
- Standardize “Attachments” and “Timeline/Audit” tabs across documents.
- Centralize API error parsing and replace raw “Status” pre blocks with productized error/empty states.

2) Purchasing: make invoice ingestion feel flawless
- Move invoice extraction to async background jobs:
  - Upload returns immediately (draft + attachment).
  - Worker fills lines later and posts a recommendation with confidence + explainability.
- Matching UX (human-in-the-loop):
  - Show top candidate matches per line and require user confirmation before creating new items.
  - Improve alias learning reliability (code/name normalization, recency weighting).

3) Margin + price intelligence (wholesale-grade)
- Auto-generate “price impact” tasks when costs change:
  - Suggest updated sell prices based on target margin rules (configurable by category/brand/customer segment).
  - Flag client-facing risk (price protection, contract pricing, key accounts).
- Add a small “Price change log” and “Last cost vs current cost” visibility per item and supplier.

4) Audit coverage completion (business-grade)
- Ensure all document lifecycle actions write `audit_logs`:
  - draft create/update, post/submit, cancel/void, hold/unhold, payment create/cancel, attachments uploaded.

## Next 1-3 Months (Competitive Differentiators)

1) WhatsApp ingestion (mirror Telegram pattern)
- Keep off-by-default and secret-gated.
- Reuse the same invoice import pipeline and attachment storage.

2) Landed cost allocation (real COGS)
- Capture freight/customs/handling per shipment and allocate to items/batches.
- Drive more accurate margin reporting and pricing decisions.

3) 3-way match v2 (AP controls)
- Expand variance checks: qty, price, tax; configurable thresholds; audit reasons.
- Better visibility: ordered vs received vs invoiced by PO line and item.

4) Proactive ops dashboards
- “What needs attention today” views:
  - expiring stock, negative stock risk, unposted drafts, held invoices, cash reconciliation anomalies.

## Longer Term (6-12 Months)

- Demand planning and automated replenishment suggestions.
- Client notification workflows (approve a price change set, then notify wholesale clients).
- Multi-warehouse advanced operations: bins, pick/pack, transfers, receiving placement workflows.
- AI automation with approval gates:
  - approve and execute routine fixes (data hygiene), with caps, explainability, and rollback hooks.
