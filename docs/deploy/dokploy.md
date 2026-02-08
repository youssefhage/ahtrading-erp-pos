# Dokploy Deployment (Production)

This repo is designed to be deployed to Dokploy as a Docker Compose app.

## Services

- `db` (Postgres)
- `api` (FastAPI)
- `worker` (background workers: outbox processing, AI tasks, etc.)
- `admin` (Next.js Admin UI)

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

## POS Offline (12h Worst Case)

Registers should:
- Press **Sync** at the start of the day (items, customers, promotions, cashiers, config, exchange rate).
- Re-sync whenever internet returns (outbox submission is idempotent).

If you require strict “shift open/close” tracking during outages, we should add offline shift open/close events (currently shift open/close calls the backend directly).

