# Platform Audit Update (2026-02-08)

Repo: `/Users/Youssef/oDocuments/Business/Codex POS`

This document is an update to `docs/audits/platform-audit-2026-02-07.md` after merging feature work into `main`.

## What Changed On Main

- Merged `codex/phase2-3-ux-ai-accounting` into `main`.
- Added security + DB invariant fixes (see "Fixed Findings" below).

## Fixed Findings (Previously P0/P1)

### 1) POS Desktop Agent LAN Exposure (P0) - Mitigated By Default

- Default bind host changed from `0.0.0.0` to `127.0.0.1`.
- New CLI flag `--host` (and env `POS_HOST`) added to explicitly opt-in to LAN exposure.

File: `pos-desktop/agent.py`

Residual risk:
- If you run with `--host 0.0.0.0`, the local HTTP API is still unauthenticated. Consider adding a local PIN/session or shared-secret header for LAN mode.

### 2) Auth Sessions Plaintext Tokens (P0) - Fixed

- Session tokens are now generated using strong randomness and stored as a one-way hash (`sha256:<hex>`).
- Legacy plaintext sessions are still accepted temporarily (only for rows that are not hashed).

Files:
- `backend/app/routers/auth.py`
- `backend/app/deps.py`
- `backend/app/security.py`

### 3) One Open Shift Per Device (P1) - Fixed

- Added a partial unique index enforcing a single `status='open'` shift per `(company_id, device_id)`.

Files:
- `backend/db/migrations/053_pos_shifts_one_open_per_device.sql`
- `backend/scripts/init_db.sh`

## Open Findings

### A) Admin App Dependency Vulnerability (High)

Previously, `npm audit --omit=dev` reported a high severity vulnerability in `next`.

Folder:
- `apps/admin`

Recommended remediation:
- Upgraded Next.js to `16.1.6` and `npm audit --omit=dev` is now clean.

### B) React Hook Exhaustive Deps Warnings (Low)

`next lint` reports multiple `react-hooks/exhaustive-deps` warnings in the Admin app.

Folder:
- `apps/admin/app/**`

### C) Python venv pip Wrapper Broken (Low / Ops)

`.venv/bin/pip` previously had a stale interpreter path; upgrading `pip` regenerated the wrapper with the correct path.
