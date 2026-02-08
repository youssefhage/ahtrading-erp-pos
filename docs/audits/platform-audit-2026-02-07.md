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

### 2) Validation Drift: Too Many “Free Strings” For Enums/Status

Finding:
- Many request fields are untyped strings (currency/rate types/status), then cast by SQL or assumed by code.
- Invalid values will surface as DB errors (500s) instead of 400s, and data quality becomes inconsistent.

Recommended fix:
- Use Pydantic `Literal[...]` / Enums for: currency codes, rate_type, doc_status, payment methods (or validated set per company), movement types, etc.

### 3) Delta Sync Cursors Are Not Based On “Last Seen Change”

Finding:
- Some delta endpoints return `next_cursor = datetime.utcnow().isoformat()` instead of “max changed_at observed”.
- This risks missing updates around boundary times and can create cursor drift.

Recommended fix:
- Return `next_cursor` = max `changed_at` from rows, plus stable ordering and a tie-breaker (id).

## Module Review: Implemented vs Missing Useful Data

This section focuses on “variables” (fields/columns) and missing metadata that make the platform robust in real operations.

### Catalog / Items

#### Current “Item” Variables (Implemented)

Backend item master data is minimal:
- `items`: `sku`, `barcode` (legacy), `name`, `unit_of_measure`, `tax_code_id`, `reorder_point`, `reorder_qty`, `created_at`, `updated_at`.
- `item_barcodes`: multiple barcodes with `qty_factor` (pack/case support), `label`, `is_primary`, timestamps.
- Pricing:
  - `item_prices` (generic) with effective dates.
  - `price_lists` and `price_list_items` (per customer price list support).
- `item_suppliers` mapping exists (lead time, min order qty, last cost).

#### Missing “Item” Variables That Usually Matter

These are the most common fields you’ll eventually need for a robust POS/ERP. They can be added incrementally, but you should decide the “v1 canonical item model” now to avoid constant churn.

Identity and lifecycle:
- `is_active` (soft deactivate)
- `item_type` (stocked, non-stock/service, bundle/kit)
- `category_id` (and category tree), `brand`, `tags`
- `description`, `short_name` (receipt-friendly)

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

Expiry and lot tracking (user specifically asked about expiry):
- `track_batches` boolean
- `track_expiry` boolean
- `default_shelf_life_days` (for auto-expiry on receiving)
- `min_shelf_life_days_for_sale` (block sale if too close to expiry)
- `expiry_warning_days` (for reports + dashboards)

Inventory planning:
- `min_stock`, `max_stock` per warehouse (not only reorder point)
- `preferred_supplier_id` (even if item_suppliers exists)
- `replenishment_lead_time_days` per warehouse (optional)

Operational extras:
- Image / media references
- `weight`, `volume` (for logistics)
- “External IDs” for integrations (supplier SKU, ERP code, barcode standards)

#### Expiry Date: What’s Implemented vs What’s Missing

Implemented:
- `batches` table has `batch_no` and `expiry_date`.
- Inbound flows can capture batches:
  - Purchases and POS processor can create/find batches and write `batch_id` to `goods_receipt_lines`, `supplier_invoice_lines`, and `stock_moves`.
- Outbound stock moves allocate batches FEFO (earliest expiry first) during sale posting in the worker.

Missing (practical operations gaps):
- No item-level enforcement to require batch/expiry capture for specific items.
- POS UI does not select/confirm batch at sale time; FEFO is server-side “best effort” and may not match physical batch selection.
- No “expiry monitoring” module:
  - Expiring stock reports, blocked sale rules, write-off flows for expired goods.
- `batches` metadata is minimal:
  - No `received_at`, no supplier reference, no “quarantine/hold” status, no location/bin, no cost trace per batch.

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
- Negative stock policy per item/warehouse (block vs allow)
- Reserved/committed quantities (orders, allocations)
- Cycle counts / stock counts:
  - count sessions, count lines, variances, approvals, posting to GL
- Bin/location support (if warehouses are large):
  - location_id on stock moves and batch placement

Traceability:
- Stock move “reason codes” (structured) vs free-text
- User attribution on stock moves (`created_by_user_id`)
- Links to document lines (line-level `source_line_id`)

Expiry/lot:
- “Lot status” (available/quarantine/expired)
- Expiry-based picking rules configurable per warehouse

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
- Discounts per line and header (fixed + percent)
- Promotion application trace:
  - which promotion/price-list was applied, why, and what the “pre-discount” price was
- Line-level tax breakdown (if some items have different VAT treatments)
- UOM and pack handling at line level (barcode qty_factor was used)

Receipts and compliance:
- Receipt printing metadata (receipt sequence per POS, printer info)
- Fiscal/VAT invoice required fields if needed (jurisdiction dependent)

Payments:
- Payment references:
  - card authorization code, transfer reference, bank txn id
- Split tenders are supported structurally, but:
  - no normalization table for “payment types” vs free strings
  - no explicit settlement currency metadata per payment

Customer and sales ops:
- Salesperson_id, channel, delivery/shipping fields (if needed)
- Branch_id on invoice (derivable from device, but storing it improves reporting and audit)

Returns/refunds:
- Refund payments are not modeled as first-class “refund transactions” (today you have return documents + `refund_method` string).
- Restocking fee, reason codes, and return condition flags are missing.

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
- Requested_by / approved_by / approved_at
- Expected delivery date, receiving date, supplier reference numbers
- PO to GR to Invoice matching (3-way match):
  - quantities matched, price variance, hold/unhold controls

Costs:
- Landed cost allocation (freight, customs, handling)
- Supplier rebates/discounts and accruals

Supplier master data (also relevant here):
- Address, VAT/tax identifiers, payment/bank details, contact person(s)

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
- No accounting dimensions:
  - branch, warehouse, cost center, department, project
- No “document attachment” capability (invoice scans, approvals).

Close and controls:
- Stronger journal immutability rules (prevent edits after posting).
- Audit trail coverage is partial (audit_logs exists but not used for every business mutation).

### Banking / Reconciliation

#### Current Variables (Implemented)
- `bank_accounts` linked to GL accounts.
- `bank_transactions` with basic reconciliation fields (`matched_journal_id`, `matched_at`).

#### Missing Useful Banking Data
Traceability and integration:
- No `source_type/source_id` on `bank_transactions` to link origin (sales payment, supplier payment, import).
- No import batch metadata (statement source, file id, imported_by).

### POS Offline Sync

#### What’s Strong
- Outbox pattern is implemented end-to-end.
- Device-scoped config endpoint exists (`/pos/config`).
- POS pulls catalog + customers + cashiers + promotions and caches locally.

#### What’s Missing / Fragile
- POS pull uses snapshots; delta endpoints exist for catalog/customers/promotions but POS does not use them yet.
- No inbox application loop is implemented in POS (backend has inbox tables/endpoints; POS agent currently does not pull/apply inbox events).
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
- “Contact person(s)” model (multiple contacts per customer).
- Consent/marketing preferences (if applicable).
- Merge/dedup support (common in real-world operations).

### Suppliers

Implemented:
- Basic supplier identity + payment terms days.

Missing useful data:
- Address, VAT number, bank/payment instructions, contacts.
- Supplier status (`is_active`), default currency, lead time defaults.
- Supplier invoice reference uniqueness per company (often needs a uniqueness constraint by supplier + invoice_no).

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
- Password reset flow + session invalidation strategy (all sessions after reset).
- MFA (optional but recommended for admin users).
- “User profile” fields (name, phone) and deactivation reason/time.
- Audit logs coverage is partial; many mutations do not write `audit_logs`.

### Reporting

Implemented:
- VAT, trial balance, GL, inventory valuation and other reporting endpoints exist (per docs/UI pages).

Missing useful reports (especially for expiry and operations):
- Expiry dashboard: “expiring in N days” by warehouse/batch, expired stock write-offs.
- Cash reconciliation report per shift (expected vs counted) with drill-down.
- AR/AP aging (docs folders exist in Admin UI, but ensure API + SQL views match).
- Margin reporting: sales by item with COGS (requires consistent cost capture and warehouse attribution).

### AI Layer (Recommendations + Actions)

Implemented:
- Tables exist for events, recommendations, actions; executor has governance gates (auto_execute, caps).

Missing useful data / controls:
- Stronger “approval” workflow states (requested, approved, queued, executed, rejected) with reasons.
- Explainability metadata (why the recommendation was made; features used).
- Safer idempotency: avoid creating duplicate purchase orders/prices if executor retries.

## Suggested Next Steps (Practical)

1) Security + invariants sprint (P0/P1): POS agent binding/auth, hashed auth sessions, shift uniqueness constraint, stronger validation.
2) Item master data sprint: implement item flags for batch/expiry tracking and essential commercial fields (is_active, category/brand, pack info).
3) Expiry end-to-end: receiving enforcement for tracked items, expiry dashboards/reports, and optional POS batch selection rules.
4) Document metadata consistency: created_by/posted_by/exchange_rate population for system journals and documents.
