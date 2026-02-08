# Extended Platform Audit (Deep Dive) (2026-02-08)

Repo: `/Users/Youssef/oDocuments/Business/Codex POS`

This document is a deeper, repo-wide audit that complements:
- `docs/audits/platform-audit-2026-02-07.md` (core platform audit)
- `docs/audits/platform-audit-2026-02-08.md` (post-merge update)
- `docs/admin-ui-ux-audit.md` (admin UX audit + phased plan)

Scope here: runtime/CI correctness, migration reliability, worker robustness, deploy/ops, admin productization risks, and cross-cutting security/integrity issues that are not just “missing features”.

## Executive Summary

The platform foundation is strong: RLS, offline outbox processing, dual-currency concepts, and an expanding Admin UI.

The biggest long-term risk right now is **operational drift**: code is already depending on schema changes and runtime assumptions, but the bootstrap pipeline (migrations, versioning, local runtime versions, logging, tests) was not strict enough to guarantee correctness in a fresh deploy or a restore scenario.

This audit focuses on closing that gap so we can safely scale features without “mystery breakage”.

## P0 (Must Fix)

### 1) DB Migration Drift Can Break Fresh Environments

Finding:
- `backend/scripts/init_db.sh` previously ran an explicit hardcoded list of migrations.
- Newer migrations present in `backend/db/migrations/` could be accidentally omitted, while application/worker code already uses new columns/indexes (example: `stock_moves.move_date` is referenced by the worker).

Impact:
- Fresh deploys or restored DBs can boot with an incomplete schema and crash at runtime.

Executed (2026-02-08):
- Updated `backend/scripts/init_db.sh` to run **all** numeric migrations in sorted order (`backend/db/migrations/[0-9][0-9][0-9]_*.sql`) before seeds.

Residual work:
- Extend `bootstrap_existing_versions()` coverage for newer migrations only if we need to support “existing DB without schema_migrations” scenarios more broadly.
- Consider adding a “schema sanity check” step (smoke query for required columns/indexes) after init.

### 2) Runtime Version Drift (Local vs Docker/CI)

Finding:
- Docker/CI are Python 3.11 (`backend/Dockerfile` + `.github/workflows/ci.yml`).
- Some backend code already uses Python 3.10+ syntax (example: `str | None` in the worker), which will fail on Python 3.9 environments.
- Node runtime is pinned to Node 20 in CI/Docker, but local environments may vary.

Impact:
- “Works in Docker but not locally” becomes common, slows development, and hides production-like failures.

Executed (2026-02-08):
- Added `.python-version` = `3.11`
- Added `.nvmrc` = `20`

Residual work:
- Document these in the root README “Dev prerequisites”.
- Added a lightweight preflight script (`scripts/preflight.sh`) to warn (or `--strict` fail) when local runtime versions don’t match `.python-version` / `.nvmrc`.

### 3) User Input Can Trigger 500s (Enum Cast / FK / Constraint Errors)

Finding:
- The DB uses enums and constraints (e.g., `currency_code`, `rate_type`, `doc_status`), but many request fields remain free-form strings in Pydantic models.
- Invalid inputs can bubble up as DB errors, causing 500s instead of 4xx “your input is invalid”.

Impact:
- Noisy errors, poor UX, and brittle integrations.

Executed (2026-02-08):
- Added FastAPI exception handlers in `backend/app/main.py` mapping common Postgres errors to:
  - `400` for invalid enum casts / FK violations / check violations
  - `409` for unique violations

Residual work:
- Add proper request-level validation (Pydantic `Literal`/enums + coercion), so errors are caught before hitting DB.
- Unify error envelopes and surface better messages in Admin UI.

## P1 (High Priority)

### 1) Password Reset Should Revoke Existing Sessions

Finding:
- `backend/scripts/reset_user_password.py` resets a user password but did not revoke sessions.
- `backend/scripts/bootstrap_admin.py` can reset passwords, but also did not revoke sessions.

Impact:
- Old session cookies/tokens remain valid until expiry after a password reset.

Executed (2026-02-08):
- Updated both scripts to `UPDATE auth_sessions SET is_active = false WHERE user_id = ...` after resetting.

Residual work:
- Added API endpoints to revoke sessions:
  - `POST /auth/logout-all` (current user)
  - `POST /users/{user_id}/sessions/revoke` (admin, company-scoped)
- Added a bulk revoke endpoint for incident response:
  - `POST /users/sessions/revoke-all` (admin, company-scoped)
- Sessions are now revoked automatically on role/permission changes so access changes apply immediately.

### 2) Worker Scheduling Errors Were Silent

Finding:
- The worker loop intentionally continues on background scheduling failures, but errors weren’t logged.

Impact:
- Background jobs can fail for long periods with no visibility in Dokploy logs.

Executed (2026-02-08):
- Updated `backend/workers/worker_service.py` to log scheduling exceptions to stderr with a traceback.

Residual work:
- Added basic structured JSON logs and request correlation ids:
  - API emits `X-Request-Id` and logs `http.request` JSON lines.
  - Worker emits JSON logs for key error events.
- Added a DB heartbeat row (`worker_heartbeats`) written by the worker, plus:
  - `GET /config/worker-heartbeats` (direct)
  - `GET /ai/copilot/overview` now includes worker heartbeat + background job health for the Admin Ops view.

## P2 (Important, Not Urgent)

### 1) Migration + Seed Governance

Finding:
- Migrations are SQL scripts run in order; seeds are idempotent but order-sensitive.

Risk:
- Seeds can become brittle as we add more reference data and per-company configuration.

Recommendation:
- Keep seeds explicit and minimal; move “bootstrap master data” behind a dedicated admin action where possible (so production installs can control what is created).
- Add restore drill documentation: how to recreate `schema_migrations` correctly after a restore if needed.

### 2) Attachments Stored in Postgres

Finding:
- `document_attachments.bytes` stores file blobs in Postgres (bytea), capped to 5MB in API.

Tradeoff:
- Good for on-prem simplicity, but DB bloat becomes real over time (backups, vacuum, replication).

Recommendation:
- Keep v1 (cap is good), but plan for v2:
  - Store metadata in Postgres
  - Store bytes in filesystem/object storage (MinIO/S3) with signed URLs

### 3) Admin UI Productization Is In Progress (Good Direction)

Current direction (observed):
- Design token enforcement via `apps/admin/scripts/check-design-tokens.mjs` and consistent theme tokens in `apps/admin/app/globals.css`.
- Document-first routes emerging (e.g., `/sales/invoices/new`, `/sales/invoices/[id]`, etc.) aligning with `docs/admin-ui-ux-audit.md`.

Risks to watch:
- Ensure all “must-exist” tooling/scripts are tracked in git (design token script, new UI components, migrations).
- Reduce large single-file pages and push shared “DocumentView” patterns into reusable components to avoid regressions.

## Execution Backlog (Suggested Order)

1) Ops correctness:
- Add a post-migration schema smoke test in CI (bring up stack, hit `/health`, run a minimal DB query that touches required columns/indexes).
- Add a restore drill doc: how to backup/restore `pgdata`, verify migrations, and verify Admin login.

2) Validation hardening:
- Introduce shared Pydantic enums for `currency_code`, `rate_type`, `doc_status`, and payment methods with coercion.
- Make list endpoints validate filters (`status`, etc.) and return 400/422 on invalid values.
  - Started: `GET /sales/invoices` and `GET /purchases/invoices` now type `status` as `DocStatus` (invalid values are rejected before DB).

3) Observability:
- Add structured logging in API + worker.
- Add an ops page in Admin that surfaces: failed outbox events, last worker activity, failing background jobs, and period locks.

4) Security tightening:
- Session revocation endpoints for admins.
- Consider `FORCE ROW LEVEL SECURITY` where safe, and review any remaining uses of the admin DB connection for least privilege.

## What Was Executed Immediately

- `backend/scripts/init_db.sh`: run all numeric migrations automatically (prevents drift).
- `backend/scripts/reset_user_password.py`: revoke sessions after reset.
- `backend/scripts/bootstrap_admin.py`: revoke sessions after reset.
- `backend/workers/worker_service.py`: log scheduling exceptions instead of silent pass.
- `backend/app/main.py`: map common Postgres errors to 4xx/409 instead of 500.
- Added `.python-version` (3.11) and `.nvmrc` (20) to align local dev with CI/Docker.

## Additional Execution (2026-02-08)

- Added shared request validation types for currency/rate/status/payment method and applied them across core routers:
  - `backend/app/validation.py`
  - `backend/app/routers/companies.py`
  - `backend/app/routers/config.py`
  - `backend/app/routers/sales.py`
  - `backend/app/routers/purchases.py`
  - `backend/app/routers/banking.py`
  - `backend/app/routers/pricing.py`
- Fixed a runtime bug in `/purchases/payments` where the supplier payment journal referenced an undefined `exchange_rate` variable (now uses 0, consistent with customer payments).
- POS agent: prevent LAN token leakage by gating GET `/api/*` behind the local PIN session when LAN-exposed, and always redacting secrets from `/api/config` responses:
  - `pos-desktop/agent.py`
- POS agent: mitigate browser-based localhost/LAN abuse by:
  - Removing wildcard CORS (`Access-Control-Allow-Origin: *`) and only emitting CORS headers for trusted origins.
  - Rejecting disallowed `Origin` headers for `/api/*` requests (CSRF/cross-site protection).
  - Restricting `/receipt/last` to loopback-only (never served over LAN).
- Worker: prevent crashes by logging (and continuing) when outbox processing fails for a company:
  - `backend/workers/worker_service.py`
