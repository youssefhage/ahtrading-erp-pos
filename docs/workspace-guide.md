# Workspace Guide

## Purpose
This guide helps new contributors find the right files quickly and avoid editing the wrong layer.

## Top-Level Map
- `apps/admin` web ERP app (Next.js)
- `apps/pos-desktop` desktop wrapper (Tauri) and desktop release versioning
- `apps/setup-desktop` desktop onboarding installer (Tauri)
- `backend` FastAPI API, workers, DB migrations/seeds
- `pos-desktop/ui` shared POS frontend UI (Svelte)
- `deploy` deployment helpers and on-prem docs
- `docs` product, architecture, and API references
- `scripts` utility scripts (imports, ops helpers)

## POS: Shared UI vs Desktop
- Shared POS UI source: `pos-desktop/ui/src`
- Desktop wrapper source: `apps/pos-desktop`
- Important: web POS and desktop POS use the same UI in `pos-desktop/ui/src`.
- If you need a visual or UX change for both, edit `pos-desktop/ui/src`.

## Where To Edit
- POS visual/UI behavior: `pos-desktop/ui/src/components` and `pos-desktop/ui/src/App.svelte`
- POS desktop app packaging/version: `apps/pos-desktop/package.json`, `apps/pos-desktop/src-tauri/tauri.conf.json`, `apps/pos-desktop/src-tauri/Cargo.toml`
- API/business logic: `backend/app`
- Admin ERP pages: `apps/admin/app`

## Local/Generated Paths (Do Not Depend On)
- `.cache/` local cache, machine-specific
- `dist/` and build outputs, generated
- `**/node_modules/`, `.venv/`, `.pytest_cache/`, `__pycache__/`

## Contributor Rules
- Keep logic changes separate from UI-only changes when possible.
- When changing POS desktop behavior, verify if the same behavior also affects web POS.
- Bump POS desktop version files for every desktop release change:
  - `apps/pos-desktop/package.json`
  - `apps/pos-desktop/src-tauri/tauri.conf.json`
  - `apps/pos-desktop/src-tauri/Cargo.toml`

## Quick Commands
- POS UI build/test:
  - `cd pos-desktop/ui && npm run build`
  - `cd pos-desktop/ui && npm run test:unified`
- API dev stack:
  - `docker compose up --build`
