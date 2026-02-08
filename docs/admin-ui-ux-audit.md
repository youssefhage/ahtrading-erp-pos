# Admin UI/UX Audit (Web Admin)

Last updated: 2026-02-09

Scope: Web Admin (`apps/admin`). Review focuses on usability for real operations (wholesale/warehouse/accounting), consistency, speed, error clarity, and reducing “operator mistakes”.

This audit is intentionally pragmatic: it prioritizes changes that reduce confusion and bad data entry, not visual polish for its own sake.

## What’s Working Well

- Navigation shell is strong:
  - Collapsible sidebar, module grouping, health indicator, and command palette (`Cmd/Ctrl+K`) in `apps/admin/components/app-shell.tsx`.
  - “Lite vs Full” navigation is a good idea for operators vs admins.
- The design token system is coherent and readable:
  - Semantic tokens and the `ui-*` primitives (tables/selects/controls) in `apps/admin/app/globals.css`.
  - The token-lint script to prevent palette drift exists (`apps/admin/scripts/check-design-tokens.mjs`).
- Document-first patterns are already emerging and should become the standard:
  - Sales invoices: list/new/[id]/edit (`apps/admin/app/sales/invoices/...`)
  - Supplier invoices: list/new/[id]/edit (`apps/admin/app/purchasing/supplier-invoices/...`)
  - These are the best UX building blocks we should replicate for other modules.
- DataTable is a good reusable primitive:
  - Sorting, global search, column visibility persistence (`apps/admin/components/data-table.tsx`).

## Rating Guide

- Critical: blocks daily work, causes high operator confusion, increases the chance of financial/inventory mistakes, or makes the product feel unreliable.
- Less critical: meaningful friction that slows work or reduces trust, but there are workarounds.
- Nice to have: polish, convenience, or “power user” capabilities.

## Critical Improvements

1) Make “document-first” consistent across modules
- Problem:
  - Several high-usage workflows are still “split view inside one page” with querystring selection and heavy dialog state.
  - This makes deep-linking, back-button behavior, and “open in new tab” unreliable and increases QA surface.
- Evidence:
  - Purchase Orders: `apps/admin/app/purchasing/purchase-orders/page.tsx`
  - Goods Receipts: `apps/admin/app/purchasing/goods-receipts/page.tsx`
  - Suppliers: list/detail is still in one page and uses a clickable table row: `apps/admin/app/partners/suppliers/page.tsx`
- Fix:
  - Convert to `/list`, `/new`, `/[id]`, `/[id]/edit` routes (same pattern as sales/supplier invoices).
  - Standardize “Draft vs Posted/Voided” lifecycle UI and primary action placements.

2) Replace raw “Status” `<pre>` error surfaces with productized error/empty states
- Problem:
  - Many screens render raw exception strings and JSON in a “Status” card. This reads like a debug console and makes the system feel fragile.
- Evidence:
  - Common pattern across most pages (Sales, Purchasing, Accounting reports, System tools), for example:
    - `apps/admin/app/sales/invoices/page.tsx`
    - `apps/admin/app/purchasing/supplier-invoices/page.tsx`
    - `apps/admin/app/inventory/stock/page.tsx`
    - `apps/admin/app/system/outbox/page.tsx`
- Fix:
  - Introduce a single shared component:
    - `ErrorBanner` or `Callout` with:
      - friendly headline (“Permission missing”, “API offline”, “Invalid input”, “Not configured”)
      - “Details” expander for the raw text
      - “Retry” button
  - Use `ApiError.status` from `apps/admin/lib/api.ts` to specialize messages for 401/403/409/422.

3) Searchable selects / command-driven picking for large master data
- Problem:
  - In warehouse/purchasing flows, `<select>` for items/suppliers/warehouses will not scale once there are hundreds or thousands of items.
  - This becomes a hard blocker for speed and accuracy.
- Evidence:
  - PO/GRN drafts use `<select className="ui-select">` with all items/suppliers in memory:
    - `apps/admin/app/purchasing/purchase-orders/page.tsx`
    - `apps/admin/app/purchasing/goods-receipts/page.tsx`
- Fix:
  - Introduce a reusable `Combobox` (async search, keyboard friendly).
  - Add server endpoints for “typeahead search” (items/suppliers) if needed.
  - Default behavior: show recent items, then search.
- Executed (v1):
  - Sales Invoice Draft and Supplier Invoice Draft now use a keyboard-friendly searchable Item Picker (SKU/name/barcode), show UOM by default, and auto-fill unit price/cost.
  - Added `GET /pricing/catalog` so Admin can fetch “effective prices” (default price list fallback) without needing POS device auth.

4) Automation / AI features still read like internal tooling
- Problem:
  - “AI Hub”, “Copilot”, “Ops Copilot” expose raw JSON and require interpretation.
  - This is dangerous because it trains users to ignore the system, which reduces adoption of the AI layer we want.
- Evidence:
  - `apps/admin/app/automation/ai-hub/page.tsx`
  - `apps/admin/app/automation/ops-copilot/page.tsx`
  - `apps/admin/app/automation/copilot/page.tsx`
- Fix:
  - Keep JSON only behind “View raw” toggles.
  - Convert core lists to a scannable queue:
    - Recommendation type, why it fired, suggested action, risk level, and a single primary action (Approve/Reject/Open doc).

5) Accessibility and interaction correctness for “clickable rows” and plain `<button>`
- Problem:
  - Some list rows are clickable without being keyboard accessible (table row `onClick`), which breaks accessibility and feels inconsistent.
  - There are also plain `<button>` elements without explicit `type`, which can accidentally submit forms when inside `<form>`.
- Evidence:
  - Clickable table row:
    - `apps/admin/app/partners/suppliers/page.tsx`
    - `apps/admin/app/catalog/item-categories/page.tsx`
  - Plain `<button>` without type:
    - `apps/admin/app/dashboard/page.tsx` (ok because not in a form)
    - `apps/admin/app/login/page.tsx` (ok because not in a form)
    - `apps/admin/app/accounting/banking/reconciliation/page.tsx` (needs review)
- Fix:
  - Use links/buttons inside cells, not `<tr onClick>`.
  - Add `type="button"` for non-submit actions when inside forms.

## Less Critical Improvements

1) Standardize page structure and reduce duplication
- Many pages re-implement the same patterns (filters toolbar, refresh button, pagination, “New Draft”).
- Introduce:
  - `Page`, `PageHeader`, `Toolbar`, `Section`, `EmptyState`.
- Benefit: consistency, faster feature development, fewer regressions.

2) Expand and enforce color rules for status semantics
- The design-token lint bans slate/white (good), but status colors still use raw Tailwind greens/reds in some places (dashboard, login).
- Consider extending `check-design-tokens.mjs` to also forbid `text-green-*`, `bg-green-*`, `text-red-*`, `bg-red-*` in TS/TSX, pushing everyone to semantic status tokens.

3) Make “company selection” human-friendly
- Company select shows UUIDs only (`apps/admin/app/company/select/page.tsx`).
- At minimum show company name/slug, and allow searching (future multi-company operators).

4) Unify “numbers and dates” entry ergonomics
- Some pages use strong numeric parsing, others accept raw strings and show generic errors.
- Add consistent number inputs:
  - quick set buttons (0, 1, 10)
  - always show currency label next to amount inputs
  - consistent date pickers and ISO display formatting

## Nice To Have

- Saved views and filters per table (beyond column visibility).
- Bulk actions:
  - bulk approve AI recs, bulk set “inactive”, bulk price updates by category.
- Keyboard shortcuts for common actions:
  - New invoice, add line, post/submit, search focus.
- “Help mode” overlays for new users:
  - what drafts mean, what posting does (stock + GL), and what holds mean (AP guardrails).

## Suggested Implementation Order (Pragmatic)

1) Standard UI primitives:
- Add `ErrorBanner`, `EmptyState`, `PageHeader`, `Toolbar`.
2) Convert the remaining high-usage purchasing flows to document-first routes:
- Purchase Orders, Goods Receipts, Suppliers.
3) Add searchable combobox picking for large master data:
- Items + suppliers in PO/GRN and invoice draft editors.
4) Productize Automation/AI views:
- Queue-first views, raw JSON behind toggles, clearer “why” and “what next”.
- Copilot: chat UI with:
  - Clear "what it can/can't do"
  - Suggested prompts by role (owner, accountant, store manager)
  - Cards that render as tables/charts instead of JSON dumps

Also introduce feature gating:

- If AI is disabled or keys are missing, show a setup screen with steps and links to system config.

### E) Sidebar becomes task-first, not module-first

Goal: reduce overwhelm and make navigation faster.

- Top: global search, favorites, recent docs.
- Core modules: Sales, Purchasing, Inventory, Accounting, System.
- Each module opens into a sub-nav (or a "module home" page) rather than showing every screen at once.
- Show context at the top: active company name, branch, warehouse.

## Implementation Plan (Phased)

### Phase 0: Instrumentation + Error Stabilization (1-2 days)

- API error parsing and consistent error UI.
- Toast notifications for success/failure.
- Replace raw `<pre>` error boxes with an error component that supports "Copy details".

### Phase 1: Visual System Consistency (2-4 days)

- Convert all remaining `slate-*`/`bg-white` to semantic tokens.
- Extended design-token lint to also block Tailwind `sky-*` palette usage in TS/TSX (use `primary` tokens instead).
- Implement `Page`, `PageHeader`, `Toolbar`, `EmptyState`.
- Normalize tables and forms.

### Phase 2: Sales Invoice Rebuild (3-6 days)

- Implement list view and document view routes.
- Replace nested dialogs with routes and a single confirmation modal where needed.
- Organize the document view into tabs and a totals summary.

### Phase 3: Purchasing + Items follow the same template (3-8 days)

- Purchase Orders, Supplier Invoices, Items, Customers.

### Phase 4: Portal/Automation Productization (3-7 days)

- Ops Portal redesign.
- AI Hub redesign with readable tables and safer interactions.
- Copilot cards rendering improvements + setup gating.

## Success Criteria

- A new user can create a Sales Invoice without needing guidance.
- Each document has one place to view "everything related to it".
- Theme looks coherent across pages.
- "Errors" become rare, and when they happen they tell the user what to do next.
