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
- Completed (2026-02-09): Purchase Orders, Goods Receipts, Suppliers now follow consistent list/new/[id]/edit routes.
- Completed (2026-02-09): Items + Customers now follow the same route pattern (reduces dialog state, improves deep-linking and QA).
- Completed (2026-02-09): Standardized “Attachments” and “Timeline/Audit” across document-style pages (Sales, Purchasing, Catalog, Partners) so operators always know where to look.
- Keep tightening error/empty states (use `ApiError.status` mapping + “Details” expander everywhere).

2) Purchasing: make invoice ingestion feel flawless
- Completed (2026-02-09): invoice extraction moved to async background jobs:
  - Upload returns immediately (draft + attachment, queued).
  - Worker fills lines later (import status is visible on the draft).
- Completed (2026-02-09, v1): Matching UX (human-in-the-loop):
  - Worker prepares `pending_review` import lines (`supplier_invoice_import_lines`) with suggested matches per line.
  - Admin draft editor renders “Imported Lines (Review)” with:
    - suggested match + confidence
    - item typeahead override per line
    - skip/unskip + “Apply Lines” (creates real invoice lines + learns aliases/costs).
  - Dev-only helper: `mock_extract=true` on upload to test the full review/apply loop without `OPENAI_API_KEY`.

3) Margin + price intelligence (wholesale-grade)
- Completed (2026-02-09, v1 foundation): Auto-generate “price impact” tasks when costs change:
  - DB trigger logs meaningful avg-cost changes into `item_cost_change_log`.
  - New worker agent `AI_PRICE_IMPACT` runs hourly and creates actionable review tasks (AI Hub queue).
  - Admin page: `Inventory → Cost Changes` (backed by `GET /pricing/cost-changes`).
- Next: surface recommended price updates directly in the item editor and add “sell price change log” views.

4) Audit coverage completion (business-grade)
- Ensure all document lifecycle actions write `audit_logs`:
  - draft create/update, post/submit, cancel/void, hold/unhold, payment create/cancel, attachments uploaded.

5) Go-live hardening (practical)
- Preflight is now largely green; remaining common blocker is POS device setup.
- Completed (2026-02-09, v1): “Create first POS device” wizard improvements in `System → POS Devices` (branch picker + copy-ready `pos-desktop/config.json` snippet).

## Next 1-3 Months (Competitive Differentiators)

1) WhatsApp ingestion (mirror Telegram pattern)
- Keep off-by-default and secret-gated.
- Reuse the same invoice import pipeline and attachment storage.
- Completed (2026-02-09, v1): `POST /integrations/whatsapp/webhook` (secret-gated file upload → creates draft supplier invoice via async + review pipeline).

2) Landed cost allocation (real COGS)
- Capture freight/customs/handling per shipment and allocate to items/batches.
- Drive more accurate margin reporting and pricing decisions.
- Completed (2026-02-09, v1): Landed Cost docs + allocation:
  - API: `POST /inventory/landed-costs/drafts`, `POST /inventory/landed-costs/{id}/post`
  - Allocation updates GRN line landed-cost totals + batch cost layers; best-effort avg-cost bump when stock is still on-hand.
  - Admin UI: `Inventory → Landed Costs` (list/new/view) with Timeline.

3) 3-way match v2 (AP controls)
- Completed (2026-02-09, v2 foundation):
  - Qty and unit-cost variance checks now auto-hold (409) with structured hold_details (reasons + thresholds).
  - Thresholds are company-configurable via `company_settings.key='ap_3way_match'` (defaults remain conservative).
  - Unhold endpoint now supports an optional reason (captured in audit logs).
- Next: tax variance and richer “ordered vs received vs invoiced” visibility by PO line (UI + reports).

4) Proactive ops dashboards
- “What needs attention today” views:
  - expiring stock, negative stock risk, unposted drafts, held invoices, cash reconciliation anomalies.
- Completed (2026-02-09, v1):
  - API: `GET /reports/attention`
  - Admin: `System → Needs Attention` (queue-first ops view)

## Longer Term (6-12 Months)

- Demand planning and automated replenishment suggestions.
- Client notification workflows (approve a price change set, then notify wholesale clients).
- Multi-warehouse advanced operations: bins, pick/pack, transfers, receiving placement workflows.
- AI automation with approval gates:
  - approve and execute routine fixes (data hygiene), with caps, explainability, and rollback hooks.
