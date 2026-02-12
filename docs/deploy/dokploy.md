# Dokploy Deployment (Production)

This repo is designed to be deployed to Dokploy as a Docker Compose app.

## Services

- `db` (Postgres)
- `api` (FastAPI)
- `worker` (background workers: outbox processing, AI tasks, etc.)
- `admin` (Next.js Admin UI)
- `downloads` (NGINX host for desktop installers + updater manifests)

POS registers run **locally** (POS agent + local SQLite) and sync to the backend when online.

## Dokploy Setup

1. In Dokploy, create or reuse the **AH Trading** project and its `production` environment.
2. Create a **Compose** app pointing to this repo.
3. Set Compose path to:
   - `deploy/docker-compose.dokploy.yml`
4. Configure env vars (Dokploy UI: Env):
   - `POSTGRES_DB` (example: `ahtrading`)
   - `POSTGRES_USER` (example: `ahtrading`)
   - `POSTGRES_PASSWORD` (strong password)
   - `APP_DB_USER` (example: `ahapp`)
   - `APP_DB_PASSWORD` (strong password)
   - `APP_ENV=prod`
   - `BOOTSTRAP_ADMIN=0` (recommended)
5. Domains:
   - Admin UI: map to service `admin` port `3000`
   - API: map to service `api` port `8000`
   - Downloads: map to service `downloads` port `80` (for `download.melqard.com`)

## Desktop Updater Hosting (`download.melqard.com`)

This stack already supports Tauri desktop publishing through the API + shared volume model:

- CI uploads artifacts to `POST /api/updates/upload` on `app.melqard.com`.
- API writes files into shared volume `/updates`.
- `download.melqard.com` serves `/updates/*` through the `downloads` service.

Required env vars in Dokploy:

- `UPDATES_PUBLISH_KEY`: shared secret used by CI when calling `/api/updates/upload`.
- `UPDATES_DIR=/updates` (default in code, keep explicit in production).

GitHub Actions secret required:

- `UPDATES_PUBLISH_KEY` (must match Dokploy env).

Release flow:

1. Bump desktop app version in both Tauri configs.
2. Push a tag matching `desktop-v*` (example: `desktop-v0.0.2`).
3. Workflow `.github/workflows/desktop-build-and-publish.yml` builds desktop installers + updater bundles.
4. Workflow runs `scripts/publish_desktop_release.py`, uploading:
   - versioned bundles under `/updates/pos/<version>/` and `/updates/portal/<version>/`
   - stable installers (`*-latest.*`)
   - updater manifests (`/updates/pos/latest.json`, `/updates/portal/latest.json`)

## One-Time Bootstrap (Admin User)

Recommended approach: bootstrap once, then set `BOOTSTRAP_ADMIN=0`.

1. Temporarily set:
   - `BOOTSTRAP_ADMIN=1`
   - `BOOTSTRAP_ADMIN_EMAIL=<your email>`
   - `BOOTSTRAP_ADMIN_PASSWORD=<strong password>`
   - `BOOTSTRAP_ADMIN_RESET_PASSWORD=0`
2. Deploy once.
3. Log in, verify access, then set `BOOTSTRAP_ADMIN=0` and redeploy.

## Backups (Required)

- Ensure Dokploy (or the VPS) is taking automated backups of the Postgres volume backing `pgdata`.
- Do a restore drill before go-live.
  - See: `docs/deploy/restore-drill.md`

## POS Offline (12h Worst Case)

Registers should:
- Press **Sync** at the start of the day (items, customers, promotions, cashiers, config, exchange rate).
- Re-sync whenever internet returns (outbox submission is idempotent).

If you require strict “shift open/close” tracking during outages, we should add offline shift open/close events (currently shift open/close calls the backend directly).
