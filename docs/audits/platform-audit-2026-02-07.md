# Platform Audit (2026-02-07)

Scope: review core components (DB schema + migrations, FastAPI routers/workers, Admin UI API usage, POS desktop agent) and identify (1) implementation quality, (2) missing or inconsistent metadata, and (3) missing “useful” business data across Sales, Inventory, Purchases, Accounting, and related modules.

Repo: `/Users/Youssef/oDocuments/Business/Codex POS`

## Executive Summary

The platform foundation is strong for an offline-first POS + ERP:

- Postgres RLS is broadly enabled and consistently scoped via `app.current_company_id`.
- An outbox worker processes POS events idempotently into authoritative documents + GL.
- Dual-currency amounts (USD/LBP) and exchange-rate concepts exist across key flows.
- Doc numbering exists server-side (`document_sequences`).
- POS catalog endpoints support barcodes, promotions, and price lists.

However, there are a few high-risk gaps (security + DB invariants) and several “business robustness” gaps (missing master-data fields, missing document metadata, and incomplete lot/expiry handling end-to-end).

## Status Update (2026-02-08)

This audit was actively executed on 2026-02-08. Summary of where we stand:

- Closed/mitigated the top security findings:
  - POS desktop agent is now localhost-bound by default, LAN exposure requires explicit host config, and LAN requests require a local PIN session.
  - Auth sessions are now strong random tokens stored as one-way hashes (legacy plaintext fallback supported).
  - Admin/session incident-response controls exist (logout-all, revoke user sessions, revoke all company sessions) and sessions are revoked on role/permission changes.
- Closed key DB invariants and drift risks:
  - “One open shift per device” enforced at the DB level.
  - POS delta sync cursors follow the “max changed_at + id tie-breaker” pattern (verified).
- Ops/productization progress (high signal for reliability):
  - Worker heartbeat + job health surfaced in Ops Copilot.
  - Structured JSON logs + `X-Request-Id` correlation added (API + Admin + worker).
  - `/health` now checks DB connectivity (503 when DB is down).
  - Admin has an Audit Logs page backed by a new `/reports/audit-logs` endpoint; audit log coverage expanded for Users and Config mutations.
- Business robustness progress (schema + traceability):
  - Item master data v2 is implemented: lifecycle + category + brand + expiry/batch tracking flags (already in `055_item_masterdata_v2.sql`).
  - POS offline sync uses delta endpoints and applies/ACKs inbox events (the earlier “missing delta/inbox loop” note is now outdated).
  - Stock move traceability expanded (created_by user/device/cashier + reason + line-level source hooks).
  - Bank transactions traceability expanded (`source_type/source_id` + import batch metadata); sales/supplier payments now write linked bank transactions.
  - Sales/payments commercial metadata added (discount fields + UOM/pack fields on invoice lines; payment reference fields on payments).
  - Expiry/lot operations strengthened:
    - Lot status + batch receiving metadata are implemented and enforced in FEFO allocation (quarantine/expired not eligible).
    - Warehouse-level “min shelf-life days for sale” default is implemented and enforced during allocation.
    - Cycle count now supports batch/expiry-tracked items (per-batch counts).
  - Sales document metadata expanded:
    - Sales invoices store `branch_id` (from POS device when available).
    - Receipt printing metadata can be persisted (`receipt_no/seq/printer/printed_at/meta`).
  - Returns robustness:
    - Structured return reasons table exists and returns can store `reason_id/reason/condition` (header + line-level).
  - Purchasing workflow metadata expanded:
    - Purchase orders support `supplier_ref`, `expected_delivery_date`, and requested/approved attribution.
    - Purchase orders now store `warehouse_id` (required for incoming/committed inventory reporting).
    - Goods receipts support `supplier_ref` and `received_at/received_by`.
  - Purchasing matching controls expanded:
    - Supplier invoices now support hold/unhold (manual) and auto-hold on suspicious 3-way match variance during posting.
  - AI embedded insights (practical “assist” layer in core screens):
    - Added deterministic, SQL-driven recommendation agents:
      - `AI_DATA_HYGIENE` (items missing key master data such as barcode, tax code, shelf-life, primary supplier)
      - `AI_AP_GUARD` (supplier invoices on hold; invoices due soon with outstanding balances)
      - `AI_EXPIRY_OPS` (batches expiring soon with stock on hand + operational suggestions)
    - Embedded “AI Insights” cards in Admin (non-blocking if `ai:read` is missing):
      - Items: `AI_DATA_HYGIENE`
      - Supplier Invoices: `AI_AP_GUARD`
      - Inventory Alerts: `AI_EXPIRY_OPS`
      - Dashboard: pending AI recommendation counts (via `GET /ai/recommendations/summary`)
- AI-assisted purchasing import (v1):
    - Admin can upload a supplier invoice image/PDF and auto-generate a draft Supplier Invoice.
    - The original file is always attached to the draft invoice (auditability/rollback).
    - Draft editor and list UX improvements:
      - Draft edit screen shows attachments inline (View/Download) so users can reconcile while editing.
      - Draft edit screen supports uploading additional attachments (supporting docs, scans, credit notes, etc.).
      - Supplier invoice list shows an attachment count badge (paperclip) for quick scanning.
    - Supplier-provided item code/name are preserved on invoice lines and a supplier→item alias table is populated for future matching.
    - Import robustness:
      - If AI extraction yields a supplier vendor reference that already exists for that supplier, the draft keeps `supplier_ref` blank and returns a warning (prevents import failures).
    - AI can surface “price impact” signals (e.g. large cost increases) as recommendations for review.
    - Item name “AI Suggest” exists in the Items editor to normalize/enhance messy names (LLM if configured, deterministic fallback otherwise).
    - Telegram webhook receiver exists (off-by-default) to support “send invoice to bot → create draft invoice” workflows (future WhatsApp can mirror this pattern).
    - Company policy gate exists to disable external AI processing while keeping “draft + attachment” imports working:
      - `company_settings.key='ai'` with `allow_external_processing` (Admin: `System → Config → AI Policy`).
- Admin data-entry UX (speed + convenience):
  - Added an Admin pricing catalog endpoint `GET /pricing/catalog` that returns items with effective prices (default price list fallback + item_prices) and full barcode lists (mirrors POS `/pos/catalog` logic but session-authenticated).
  - Sales Invoice Draft editor: replaced SKU-memorization flow with a fast searchable item picker (SKU/name/barcode), auto-shows UOM, and auto-fills unit price (editable).
  - Supplier Invoice Draft editor: same searchable item picker + UOM; auto-fills unit cost from supplier’s last cost when available (editable), with caching to avoid repeated calls.
- Go-live readiness tooling (to reduce “day-1 surprises”):
  - Added `GET /config/preflight` and a Web Admin UI at `System → Go-Live` that shows red/warn/ok checks (warehouses, account defaults, today’s exchange rate, payment method mappings, POS devices, etc).
  - Added a dev-only demo seeding tool `POST /devtools/demo-data/import` (404 outside `local/dev`) and a “Seed Demo Data” button in `System → Go-Live` for rapid operator testing.
  - Added a Playwright E2E flow (skipped unless `E2E_EMAIL`/`E2E_PASSWORD` are set) to validate “seed demo data → create draft invoice” end-to-end.
- Local run sanity check:
  - `docker compose up -d` starts `db`, `api`, `worker`, `admin`, and `pos-agent`.
  - Verify with `docker compose ps` and `GET /health` on the mapped API port.

Remaining work in this audit is mostly “business robustness” (expiry/lot operations, document metadata completeness, richer audit timelines for all mutations, and deeper ERP workflows).

## Status Update (2026-02-09)

Additional execution completed on 2026-02-09 (Admin UX + scalability):

- Removed remaining clickable-row patterns (`<tr onClick>`) and standardized on explicit buttons/links (keyboard accessible).
- Replaced remaining raw “Status” `<pre>` panels across Admin with `ErrorBanner` + a “View raw” expander (uses `ApiError.status` for 401/403/409/422).
- Sales Invoice Draft editor now uses a pricing-aware async item picker backed by `GET /pricing/catalog/typeahead` (no longer loads the full pricing catalog into memory), while still auto-filling unit price and showing UOM.
- Standardized “Attachments” + “Timeline” UI across document pages, with a permission-aware Timeline endpoint (`GET /audit/logs`) so timelines don’t require report permissions.
- Converted Items + Customers to the same document-first route pattern (`/list|new|[id]|[id]/edit`) to reduce dialog state and improve deep-linking/back-button behavior.
- Supplier invoice import now supports async background extraction (draft is created immediately with the original attachment; the worker fills lines later and updates `import_status`).
- POS device setup friction reduced: `System → POS Devices` now offers a Branch picker (no UUID copy/paste) and a copy-ready `pos-desktop/config.json` snippet after registration/token reset.

## P0 (Must Fix)

### 1) POS Desktop Agent Is Exposed On LAN (No Local Auth)

Finding:
- POS agent binds to `0.0.0.0` and serves unauthenticated local HTTP endpoints.
- Any device on the same network can call the POS agent’s local endpoints (create sale/return/outbox events), which later sync to the backend using the stored device token.

Evidence:
- `pos-desktop/agent.py` binds to all interfaces: `ThreadingHTTPServer(("0.0.0.0", args.port), Handler)`.

Recommended fix:
- Bind to `127.0.0.1` by default and require an explicit `--host 0.0.0.0` to expose.
- Add a simple local auth gate (PIN session, shared secret, or OS-local-only binding).
- Consider requiring cashier verification before creating sale/return events.

Executed (2026-02-08):
- POS agent now binds to `127.0.0.1` by default (LAN exposure requires explicit `--host 0.0.0.0` or `POS_HOST=0.0.0.0`).
- When LAN-exposed (or when `require_admin_pin=true`), GET + POST `/api/*` are gated behind a local admin PIN session (`X-POS-Session`).
- Removed wildcard CORS and reject disallowed `Origin` headers for `/api/*` to mitigate browser-based localhost/LAN attacks.
- `/receipt/last` is now loopback-only (never served over LAN).

### 2) Auth Sessions: Plaintext Token Storage + Weak Token Shape

Finding:
- Session token is a UUID4 stored as plaintext in `auth_sessions.token`.
- If DB is leaked/logged, tokens are immediately reusable until expiry.

Evidence:
- Token generated as `uuid.uuid4()` in `backend/app/routers/auth.py`.
- Stored as `token text NOT NULL UNIQUE` in `backend/db/migrations/014_auth_sessions.sql`.

Recommended fix:
- Generate tokens using `secrets.token_urlsafe(32+)`.
- Store only a token hash (similar to `pos_devices.device_token_hash`).
- Add “last_seen_at” or rotate token on sensitive events (password reset, company switch, role changes).

Executed (2026-02-08):
- Auth login now uses `secrets.token_urlsafe(32)` and stores sessions as a one-way hash (`sha256:...`) via `hash_session_token()`.
- Session validation hashes the presented bearer/cookie token and matches against the stored hash (with a legacy plaintext fallback).
- Added session revocation controls:
  - `POST /auth/logout-all` (current user)
  - `POST /users/{user_id}/sessions/revoke` (admin)
  - `POST /users/sessions/revoke-all` (admin, company-scoped incident response)
  - Sessions are revoked on role/permission changes (so access changes apply immediately).

## P1 (High Priority)

### 1) DB Constraint Missing: “One Open Shift Per Device”

Finding:
- `/pos/shifts/open` checks for an open shift, then inserts.
- Without a DB partial unique constraint, concurrent requests can create multiple open shifts.

Evidence:
- App-level check + insert in `backend/app/routers/pos.py`.
- `pos_shifts` table has no unique index enforcing single open shift in `backend/db/migrations/017_pos_shifts.sql`.

Recommended fix:
- Add partial unique index: `(company_id, device_id) WHERE status='open'`.

Executed (2026-02-08):
- Added DB partial unique index `ux_pos_shifts_one_open_per_device` via `backend/db/migrations/053_pos_shifts_one_open_per_device.sql`.

### 2) Validation Drift: Too Many “Free Strings” For Enums/Status

Finding:
- Many request fields are untyped strings (currency/rate types/status), then cast by SQL or assumed by code.
- Invalid values will surface as DB errors (500s) instead of 400s, and data quality becomes inconsistent.

Recommended fix:
- Use Pydantic `Literal[...]` / Enums for: currency codes, rate_type, doc_status, payment methods (or validated set per company), movement types, etc.

Executed (2026-02-08):
- Added shared validation types in `backend/app/validation.py` (currency/rate/status/payment method, etc.) and applied them across core routers.
- Added FastAPI exception handlers to map common Postgres errors to 4xx/409 to reduce 500s as a backstop.

### 3) Delta Sync Cursors Are Not Based On “Last Seen Change”

Finding:
- Some delta endpoints return `next_cursor = datetime.utcnow().isoformat()` instead of “max changed_at observed”.
- This risks missing updates around boundary times and can create cursor drift.

Recommended fix:
- Return `next_cursor` = max `changed_at` from rows, plus stable ordering and a tie-breaker (id).

Status (2026-02-08):
- Verified POS delta endpoints (`/pos/*/delta`) use `(changed_at, id)` ordering and return `next_cursor`/`next_cursor_id` from the last row observed (not `utcnow`).
- Keep this as a standard for any future delta endpoints outside the POS router.

## Module Review: Implemented vs Missing Useful Data

This section focuses on “variables” (fields/columns) and missing metadata that make the platform robust in real operations.

### Catalog / Items

#### Current “Item” Variables (Implemented)

Item master data v2 is implemented (incremental, backwards compatible):
- `items` core identity:
  - `sku`, `barcode` (legacy), `name`, `unit_of_measure`, `tax_code_id`
  - lifecycle + merchandising: `is_active`, `category_id`, `brand`, `short_name`, `description`
  - tracking policy: `track_batches`, `track_expiry`, `default_shelf_life_days`, `min_shelf_life_days_for_sale`, `expiry_warning_days`
  - planning: `reorder_point`, `reorder_qty`
- `item_barcodes`: multiple barcodes with `qty_factor` (pack/case support), `label`, `is_primary`, timestamps.
- Pricing:
  - `item_prices` (generic) with effective dates.
  - `price_lists` and `price_list_items` (per customer price list support).
- `item_suppliers` mapping exists (lead time, min order qty, last cost).
- `item_categories` exists (category tree).
- `item_images` exists (v1 image/media reference).

#### Missing “Item” Variables That Usually Matter

These are the most common fields you’ll eventually need for a robust POS/ERP. They can be added incrementally, but you should decide the “v1 canonical item model” now to avoid constant churn.

Identity and lifecycle:
- `item_type` (stocked, non-stock/service, bundle/kit)
  - Implemented v1: `items.item_type` (enum: `stocked|service|bundle`) + Admin edit field.
- `tags` (or a simple tagging model)
  - Implemented v1: `items.tags` (text[]) + Admin edit field (comma-separated).

Units and packaging:
- Base UOM is present (`unit_of_measure`) but missing:
  - Secondary UOMs (purchase vs sales UOM)
  - UOM conversions beyond barcode `qty_factor`
  - `case_pack_qty`, `inner_pack_qty` (explicit)

Tax and compliance:
- `tax_category` or explicit VAT rules per item (exempt/zero-rated/standard)
- `excise` flags if applicable

Costing and valuation:
- `costing_method` (avg, fifo, standard) or at least a flag for future
- `standard_cost_usd/lbp` (optional)
- `min_margin_pct` / pricing rules (optional)

Inventory planning:
- `min_stock`, `max_stock` per warehouse (not only reorder point)
- `preferred_supplier_id` (even if item_suppliers exists)
- `replenishment_lead_time_days` per warehouse (optional)

Operational extras:
- `weight`, `volume` (for logistics)
- “External IDs” for integrations (supplier SKU, ERP code, barcode standards)

#### Expiry Date: What’s Implemented vs What’s Missing

Implemented:
- `batches` table has `batch_no` and `expiry_date`.
- Inbound flows can capture batches:
  - Purchases and POS processor can create/find batches and write `batch_id` to `goods_receipt_lines`, `supplier_invoice_lines`, and `stock_moves`.
- Outbound stock moves allocate batches FEFO (earliest expiry first) during sale posting in the worker.

Missing (practical operations gaps):
- Item-level enforcement now exists in core flows:
  - Receiving enforces `track_batches/track_expiry` (and can auto-derive expiry from `default_shelf_life_days`).
  - Inventory adjustments enforce batch capture for tracked items.
  - POS sale posting allocates FEFO and supports explicit line-level batch/expiry in the payload when provided.
- Implemented v1 (2026-02-09): server-side policy + API support for manual lot selection vs auto-FEFO:
  - Company inventory policy `company_settings.key='inventory'.require_manual_lot_selection` (Admin: System → Config → Inventory Policy)
  - POS helper endpoint `GET /pos/items/{item_id}/batches?warehouse_id=...` to list eligible batches + on-hand in FEFO order (for expiry-managed items, lots without expiry are hidden)
  - Worker enforces manual selection when the policy is enabled (tracked items must specify `batch_no` and/or `expiry_date`)
  - Remaining (product): POS UI pick/confirm flow for physical picking.
- Expiry monitoring module exists:
  - Admin expiry alerts UI exists (`/inventory/alerts`).
  - Expiry write-off endpoint exists (`POST /inventory/writeoff/expiry`).
- `batches` metadata is minimal:
  - Progress: batch operational metadata is now implemented:
    - timestamps (`created_at/updated_at`)
    - receiving attribution (`received_at`, `received_source_type/source_id`, `received_supplier_id`)
    - lot status (`status`: available/quarantine/expired + `hold_reason/notes`)
  - Implemented v1 (2026-02-09):
    - Receiving can capture bin placement: `goods_receipt_lines.location_id` + Admin Goods Receipt Draft editor supports line-level Location selection (and optional landed cost totals per line).
    - Intra-warehouse bin moves are supported: `/inventory/transfer` allows same-warehouse transfers when locations differ (and validates location IDs belong to the specified warehouses).
    - Per-batch cost trace is implemented: `batch_cost_layers` + recording on goods receipt posting + `GET /inventory/batches/{batch_id}/cost-layers`.
  - Remaining: landed cost allocation workflows and vendor rebates/credits per batch.

### Inventory / Warehousing

#### Current Variables (Implemented)
- `stock_moves` supports:
  - `qty_in`, `qty_out`
  - unit costs (auto-filled from avg costing if missing)
  - `warehouse_id`, optional `batch_id`
  - `source_type/source_id` to trace the originating document
- Moving-average costing summary exists:
  - `item_warehouse_costs`: `on_hand_qty`, `avg_cost_usd/lbp`.
- Inventory endpoints support:
  - Stock summary (by warehouse and optionally by batch)
  - Adjustments and transfers with GL postings and audit logs

#### Missing Useful Inventory Data / Features
Operational control:
- Negative stock policy (block vs allow):
  - Implemented v1: company default via `company_settings key='inventory'` (`allow_negative_stock`) + per-item override (`items.allow_negative_stock`).
  - Implemented v1: per-warehouse override (`warehouses.allow_negative_stock` nullable; NULL means inherit).
- Reserved/committed quantities (orders, allocations):
  - Implemented v1: draft sales invoices can explicitly reserve stock (`sales_invoices.reserve_stock`).
  - Inventory stock summary now returns `reserved_qty`, `qty_available`, and `incoming_qty` (from posted POs minus posted receipts).
- Cycle counts / stock counts:
  - Implemented v1 (posts variances to GL) and now supports batch/expiry-tracked items (per-batch counts via `batch_id` / `batch_no+expiry_date`).
- Bin/location support (if warehouses are large):
  - location_id on stock moves and batch placement
  - Implemented v1: `warehouse_locations` master table + optional `stock_moves.location_id` + Admin management page (`System → Warehouse Locations`).
  - Implemented v1 (2026-02-09): receiving UI (Admin goods receipts line Locations) + intra-warehouse moves (location-aware transfers).
  - Implemented v1 (2026-02-09): operational location listing endpoint for day-to-day flows: `GET /inventory/warehouses/{warehouse_id}/locations` (active bins only).
  - Remaining (product): pick/pack confirmation UX and tighter location-aware allocation rules.

Traceability:
- Stock move “reason codes” (structured) vs free-text:
  - Implemented schema (`stock_move_reasons` + `stock_moves.reason_id/reason`).
- Attribution:
  - Implemented on `stock_moves` (`created_by_user_id`, `created_by_device_id`, `created_by_cashier_id`) and populated in core flows.
- Links to document lines (line-level `source_line_id`):
  - Implemented schema (`source_line_type/source_line_id`) and populated for POS sale/return lines and goods receipt lines; remaining routers can be extended incrementally.

Expiry/lot:
- “Lot status” (available/quarantine/expired):
  - Implemented and enforced in allocation (quarantined/expired batches are not eligible for FEFO).
- Expiry-based picking rules configurable per warehouse:
  - Implemented v1: `warehouses.min_shelf_life_days_for_sale_default` enforced during allocation.

### Sales (Invoices, Payments, Returns)

#### Current Variables (Implemented)
Sales documents include:
- `sales_invoices`: totals, currencies, rate, invoice/due dates, plus `warehouse_id`, `device_id`, `shift_id`, `cashier_id`, `source_event_id`.
- `sales_invoice_lines`: qty + unit price totals (dual currency), references item.
- `tax_lines`: `source_type/source_id`, `tax_code_id`, base/tax amounts, `tax_date`.
- `sales_payments`: method + amounts.
- `sales_returns`: return doc metadata + warehouse/device/shift/refund_method/cashier + `sales_return_lines`.

#### Missing Useful Sales Data
Line-level commercial detail:
- Discounts per line and header (fixed + percent):
  - Implemented schema on `sales_invoices` + `sales_invoice_lines` (discount totals + line discount fields). POS/Admin still needs to populate these consistently.
- Promotion application trace:
  - Implemented schema on `sales_invoice_lines` (`applied_promotion_id`, `applied_promotion_item_id`, `applied_price_list_id`), but POS pricing engine still needs to populate it.
- Line-level tax breakdown (if some items have different VAT treatments)
- UOM and pack handling at line level:
  - Implemented schema on `sales_invoice_lines` (`uom`, `qty_factor`) so barcode pack conversions can be persisted per sale line.

Receipts and compliance:
- Receipt printing metadata (receipt sequence per POS, printer info):
  - Implemented: `sales_invoices.receipt_no/receipt_seq/receipt_printer/receipt_printed_at/receipt_meta`.
- Fiscal/VAT invoice required fields if needed (jurisdiction dependent)

Payments:
- Payment references:
  - Implemented on payments (`reference`, `auth_code`, `provider`, `settlement_currency`, `captured_at`).
  - Bank transactions now support `source_type/source_id` and can be linked to payment journals for reconciliation.
- Split tenders are supported structurally, but:
  - payment methods are normalized via `payment_method_mappings` (still missing richer per-method metadata and settlement workflows)

Customer and sales ops:
- Salesperson_id, channel, delivery/shipping fields (if needed)
- Branch_id on invoice (derivable from device, but storing it improves reporting and audit):
  - Implemented: `sales_invoices.branch_id` (backfilled from POS device when available).

Returns/refunds:
- Refund payments are not modeled as first-class “refund transactions” (today you have return documents + `refund_method` string).
- Return reason codes and condition flags:
  - Implemented: `sales_return_reasons` + `sales_returns.reason_id/reason/return_condition` + `sales_return_lines.reason_id/line_condition`.
- Implemented v1 (2026-02-09): restocking fee + first-class refund transactions:
  - `sales_returns.restocking_fee_usd/lbp/reason` and GL posting support (requires account default `RESTOCK_FEES` when fee is non-zero).
  - New `sales_refunds` table; POS return processing writes refund transactions and optionally linked bank transactions (when `bank_account_id` is provided).
  - Admin Sales Returns page displays restocking fee + net refund + refund transaction list.

### Purchases (PO, GRN, Supplier Invoice, Payments)

#### Current Variables (Implemented)
Purchasing flows are implemented with strong basics:
- POs: doc numbers, lines, posting/draft flows.
- Goods receipts: warehouse, lines, and batch/expiry capture (via `batch_id`).
- Supplier invoices: tax code selection persisted, invoice/due dates, batch capture on lines.
- Supplier payments: method + amounts (and optional bank account usage in API).
- Inventory costing: inbound stock moves update average cost.

#### Missing Useful Purchases Data
Procurement workflow:
- Requested_by / approved_by / approved_at:
  - Implemented v1 on `purchase_orders` (`requested_by_user_id/requested_at`, `approved_by_user_id/approved_at`).
- Expected delivery date, receiving date, supplier reference numbers:
  - Implemented v1:
    - `purchase_orders.expected_delivery_date`, `purchase_orders.supplier_ref`, `purchase_orders.requested_*`, `purchase_orders.approved_*`
    - `goods_receipts.supplier_ref`, `goods_receipts.received_at/received_by_user_id`
- PO to GR to Invoice matching (3-way match):
  - Implemented v1 starter: PO detail now includes ordered vs received vs invoiced quantities (qty-only).
  - Implemented v1: price variance detection (auto-hold on post) + manual hold/unhold controls for supplier invoices.

Costs:
- Landed cost allocation (freight, customs, handling)
- Supplier rebates/discounts and accruals

Supplier master data (also relevant here):
- Address, VAT/tax identifiers, payment/bank details (contacts are implemented via `party_contacts`).
- Supplier-provided item identifiers (SKU/name) and a consistent matching model across imports/EDI:
  - Implemented v1: `supplier_invoice_lines.supplier_item_code/supplier_item_name`.
  - Implemented v1: `supplier_item_aliases` table to learn supplier→item mappings over time (improves matching and reduces noisy item creation).

### Accounting / GL

#### Current Variables (Implemented)
- Manual journals with dual-currency lines, rounding logic, period locks.
- GL journals have:
  - `source_type/source_id`
  - `memo` and `created_by_user_id`
  - `exchange_rate` column exists for auditability.

#### Missing Useful Accounting Data
Consistency:
- System-generated journals often do not populate `exchange_rate` and `created_by_user_id`.
- Some flows use `rate_type='market'` everywhere even when actual rate type differs.

Dimensions:
- Basic dimensions exist on `gl_entries`:
  - `branch_id`, `warehouse_id` (useful for reporting and auditability).
- Still missing richer dimensions:
  - cost center, department, project, etc.
  - Implemented v1 (2026-02-09): cost centers + projects:
    - New master tables `cost_centers`, `projects`
    - `gl_entries.cost_center_id/project_id`
    - Admin UI to manage dimensions (System → Dimensions)
    - Manual journal UI supports selecting dimensions per line.
- Document attachments are implemented (`document_attachments` table; bytes stored in Postgres in v1).

Close and controls:
- Stronger journal immutability rules (prevent edits after posting):
  - Implemented v1: DB triggers block UPDATE/DELETE on `gl_journals` and `gl_entries` (use reversal/void journals instead).
- Audit trail coverage is partial (audit_logs exists but not used for every business mutation).
  - Progress (2026-02-08): added audit logs for Users/roles/permissions mutations and Config mutations (tax codes, exchange rates, account defaults, payment method mappings), plus an Admin audit feed page.

### Banking / Reconciliation

#### Current Variables (Implemented)
- `bank_accounts` linked to GL accounts.
- `bank_transactions` with basic reconciliation fields (`matched_journal_id`, `matched_at`).

#### Missing Useful Banking Data
Traceability and integration:
- Implemented:
  - `bank_transactions.source_type/source_id` to link origins (sales payment, supplier payment, integrations).
  - Import batch metadata (`bank_statement_import_batches` + `bank_transactions.import_batch_id/import_row_no/imported_by_user_id/imported_at`).

### POS Offline Sync

#### What’s Strong
- Outbox pattern is implemented end-to-end.
- Device-scoped config endpoint exists (`/pos/config`).
- POS pulls catalog + customers + cashiers + promotions and caches locally.

#### What’s Missing / Fragile
- POS sync is delta-first for catalog/customers/promotions and falls back to snapshot if delta fails.
- POS agent pulls/applies inbox events and ACKs them back to the backend.
- Local security (see P0).

## Cross-Cutting Metadata Checklist (What You Want “Everywhere”)

If the goal is “robust platform for business”, decide a consistent metadata standard across all documents and master tables.

Recommended baseline fields:
- `created_at`, `updated_at`
- `created_by_user_id`, `updated_by_user_id`
- `posted_at`, `posted_by_user_id`
- `canceled_at`, `canceled_by_user_id`, `cancel_reason`
- `notes` (human text), `tags` (optional)
- `external_ref` / `source_ref` (supplier invoice ref, import id, POS receipt id)
- `source_type`, `source_id` (already present in key places; extend to banking + more)

## “Others” (Still Important)

### Customers

Implemented:
- Credit limits/balances, loyalty points, membership fields, per-customer price list, updated_at for delta sync.

Missing useful data:
- Address book (billing/shipping), city/region, VAT/tax identifiers (if B2B), customer type (retail/wholesale), assigned salesperson.
- “Contact person(s)” model is implemented (`party_contacts`) but needs UX/productization per customer.
- Consent/marketing preferences (if applicable).
- Merge/dedup support (common in real-world operations).

### Suppliers

Implemented:
- Basic supplier identity + payment terms days.

Missing useful data:
- Address, VAT number, bank/payment instructions.
- Contacts and supplier status are implemented (`party_contacts`, `suppliers.is_active`), but need UX/productization and validation rules (e.g., required VAT for B2B).
- Supplier invoice vendor reference uniqueness:
  - Implemented via `supplier_invoices.supplier_ref` (unique per supplier when present).

### Companies / Branches / Warehouses

Implemented:
- Company has legal identifiers and currency defaults.
- Branch and warehouse exist but are light.

Missing useful data:
- Branch-level configuration:
  - default warehouse per branch, VAT/tax profile overrides (if needed), invoice prefixes per branch, operating hours.
- Warehouse metadata:
  - address/location, capacity/binning flags, “is_virtual” warehouses for adjustments.

### Users / Roles / Permissions

Implemented:
- Roles and permissions exist and are used in many endpoints.
- Sessions support active company context.

Missing useful data / controls:
- Password reset now revokes sessions (scripts updated); API supports session revocation (logout-all and admin revokes).
- MFA (optional but recommended for admin users).
- “User profile” fields (name, phone) and deactivation reason/time.
- Audit logs coverage is partial; many mutations do not write `audit_logs`.
  - Progress (2026-02-08): Users/config now write audit logs; remaining gaps are mainly document lifecycle + master data + approvals.

### Reporting

Implemented:
- VAT, trial balance, GL, inventory valuation and other reporting endpoints exist (per docs/UI pages).

Missing useful reports (especially for expiry and operations):
- Expiry monitoring exists (alerts UI + expiry write-off endpoint), but a richer dashboard/reporting view is still needed:
  - “expiring in N days” by warehouse/batch, and operational write-off drill-downs.
- Cash reconciliation report per shift (expected vs counted) with drill-down:
  - Implemented v1: shift cash reconciliation now includes cash sales + cash refunds + cash movements, and Admin shows a breakdown.
- AR/AP aging (docs folders exist in Admin UI, but ensure API + SQL views match).
- Margin reporting: sales by item with COGS:
  - Implemented API v1: `GET /reports/sales/margin-by-item` (filters: date range + optional warehouse/branch).

### AI Layer (Recommendations + Actions)

Implemented:
- Tables exist for events, recommendations, actions; executor has governance gates (auto_execute, caps).
- Added embedded “AI Insights” across core operational modules (items/AP/expiry) using deterministic agents (no auto-actions).
- Added `GET /ai/recommendations/summary` to support lightweight “pending AI” counts in the Admin dashboard.
- AI-assisted invoice ingestion (v1):
  - `POST /purchases/invoices/drafts/import-file` creates a draft Supplier Invoice from an uploaded image/PDF and always attaches the original document.
  - Generates `AI_PURCHASE_INVOICE_INSIGHTS` recommendations when it detects meaningful supplier cost increases.
- AI-assisted item naming (v1):
  - `POST /items/name-suggestions` returns improved item-name suggestions for messy strings (LLM if configured; deterministic fallback).
  - Company policy gate exists (`company_settings.key='ai'` / `allow_external_processing`) to disable external AI processing when desired.

Missing useful data / controls:
- Stronger “approval” workflow states (requested, approved, queued, executed, rejected) with reasons.
- Explainability metadata (why the recommendation was made; features used).
- Safer idempotency: avoid creating duplicate purchase orders/prices if executor retries.
  - Implemented v1 (2026-02-09):
    - Decisions now store optional reason/notes (API accepts `reason`/`notes` on `/ai/recommendations/{id}/decide`).
    - Deterministic agents now include `explain` metadata in `recommendation_json` (why + signals).
    - Executor is idempotent for POs and item prices via `source_type='ai_action'`/`source_id=action_id` and result tracking on `ai_actions`.

## Suggested Next Steps (Practical)

1) Inventory operations hardening:
   - reserved/committed quantities (orders/allocations) and “available to sell” reporting
   - bin/location support (optional) + per-warehouse negative-stock override (optional)
   - POS-facing UX/policies for manual lot selection vs auto-FEFO
2) Purchasing 3-way match v1:
   - per-PO line matched qty (ordered vs received vs invoiced)
   - variance detection (qty/price) and a simple hold/unhold workflow on supplier invoices
3) Accounting controls + dimensions:
   - journal immutability rules (prevent edits after posting; reverse via explicit void journal)
   - add richer dimensions (cost center / project) and propagate from documents to GL entries
4) Audit coverage completion:
   - ensure all high-value business mutations (docs + master data) emit `audit_logs`
5) AI governance v1:
   - approval workflow states + clearer explainability + stronger idempotency for executor retries
