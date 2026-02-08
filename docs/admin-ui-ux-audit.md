# Admin UI/UX Audit (Web Admin)

Last updated: 2026-02-08

## North Star (ERPNext-Like Flow)

ERPNext's "document" model is a good target for this admin:

- List view that is fast, filterable, and scannable.
- A single "document view" where everything about a record is organized and readable.
- Clear primary actions (Draft, Submit/Post, Cancel, Print, Email) with predictable permissions.
- Consistent layout across modules: Sales Invoice, Purchase Order, Item, Customer, etc.
- Errors that are actionable and not noisy.

## Key Findings

### 1) Inconsistent UI language and styling

The app currently mixes:

- Semantic tokens (`bg-background`, `text-foreground`, etc.) introduced for theme support.
- Hard-coded Tailwind palettes (`text-slate-*`, `bg-white`, `border-slate-*`) scattered across pages.
- Custom utility classes (`ui-*`) that sometimes assume dark styling.

Result: pages look like they belong to different apps, and theme changes amplify inconsistencies.

### 2) Workflow screens try to do "everything, everywhere"

Several pages combine list + detail + create/edit + advanced actions in a single component with many modal states.
Example: Sales Invoices screen.

Result: cognitive overload, brittle state, and the back button/refresh behavior is unreliable.

### 3) Excessive modal/dialog usage and nesting

Dialogs are used for many workflows that should be first-class routes (create, edit, post/submit).

Result: stacked overlays, focus issues, confusing navigation, and harder QA.

### 4) Error handling is noisy and inconsistent

Many pages store raw error strings in `status` and display them in a "Status" card.

Result: users see technical output frequently and lose confidence in the system.

### 5) Portal/Automation features feel like debug tools

Pages such as:

- `apps/admin/app/automation/ops-copilot/page.tsx`
- `apps/admin/app/automation/copilot/page.tsx`
- `apps/admin/app/automation/ai-hub/page.tsx`

...render raw JSON blobs, hard-coded "slate/white" styling, and show frequent API errors without guidance.

Result: the feature appears unreliable and difficult to understand, even when the backend is working.

## Recommendations

### A) Establish a small, enforceable design system

Goal: eliminate palette drift and make screens visually coherent.

- Ban direct grays/palettes in app code. Use semantic tokens only.
- Expand tokens to cover: `surface`, `surface-2`, `muted`, `divider`, `focus`, `danger/success/warning`.
- Standardize typography scale, spacing, and table density.

Deliverables:

- `Page` wrapper (width, padding, vertical rhythm).
- `PageHeader` (title, subtitle, breadcrumbs, actions).
- `Toolbar` (search, filters, view toggles, bulk actions).
- `EmptyState` (no data, no access, not configured, error).
- `Toast` system (success/error feedback).

### B) Adopt a Document-First information architecture

Goal: make screens feel like ERPNext: organized, predictable, readable.

Routes:

- `/sales/invoices` (List view)
- `/sales/invoices/new` (Create draft)
- `/sales/invoices/[id]` (Document view)
- `/sales/invoices/[id]/edit` (Edit draft)
- `/sales/invoices/[id]/post` (Submit/Post flow)

Document view layout (template):

- Header: document title + status pill + primary action.
- Left column: key metadata (customer, dates, warehouse, currency, terms).
- Main tabs:
  - Items
  - Taxes
  - Payments
  - Accounting (GL preview or postings)
  - Attachments
  - Timeline/Audit
- Right column (optional): totals summary, warnings, quick actions.

### C) Fix errors first (stability pass)

Goal: reduce error frequency and make remaining errors understandable.

- Centralize API error parsing and show friendly messages (with a "details" expander).
- Add per-screen empty/error states (not raw `<pre>`).
- Add retry and "health" hints: "API offline", "feature not configured", "permission missing".
- Add lightweight client-side logging (console plus optional backend event endpoint later).

### D) Redesign the Portal/Automation experience

Goal: make portal features feel productized, not like internal debug pages.

Replace "raw JSON screens" with:

- Ops Portal dashboard: outbox health, failed events, negative inventory, period locks, recommended actions.
- AI Hub: three clear sections:
  - Recommendations queue (scannable table, filters, detail drawer)
  - Actions execution (status, retries, reason, clear next step)
  - Schedules (human-readable scheduler UI, not raw JSON)
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
