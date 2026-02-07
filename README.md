# AH Trading POS/ERP (On-Prem First)

This repo is an offline-first POS + ERP foundation for AH Trading (Lebanon), built around:
- FastAPI + PostgreSQL (RLS) as the source of truth
- A background worker that processes POS outbox events into documents + GL
- A Next.js (App Router) admin ERP UI using shadcn/ui-style components
- A lightweight POS desktop agent (Python + SQLite + static UI) for early pilots

## Quickstart (Local Dev)
1) Start the stack:
```bash
docker compose up --build
```

If you have port conflicts on your machine, override ports:
```bash
DB_PORT=5433 API_PORT=8001 ADMIN_PORT=3001 docker compose up --build
```

2) Open Admin:
- http://localhost:3000 (or `ADMIN_PORT`)

3) Login:
- The API container bootstraps an admin user on first run (see logs for `BOOTSTRAP_ADMIN_CREATED`).
- Default email is `admin@ahtrading.local` and a random password is printed unless you set `BOOTSTRAP_ADMIN_PASSWORD`.
- If you lost the initial password, you can reset it by setting:
  - `BOOTSTRAP_ADMIN_PASSWORD=...`
  - `BOOTSTRAP_ADMIN_RESET_PASSWORD=1`
  then restarting the `api` container (the bootstrap script is idempotent unless reset is requested).

4) Backend:
- Direct: http://localhost:8000 (or `API_PORT`)
- Via Admin proxy: http://localhost:3000/api/health

## DB / RLS Notes
- The stack creates a non-superuser app DB role (default: `ahapp`) so Postgres RLS policies are actually enforced.
- Override via env vars (example):
```bash
APP_DB_USER=ahapp APP_DB_PASSWORD=change-me docker compose up --build
```

## POS Device Setup (Dev)
1) Login to get a bearer token: `POST /auth/login`
2) Register a POS device: `POST /pos/devices/register`
3) Configure the POS agent at `pos-desktop/config.json` (or `POST /api/config`)
4) Run the POS agent:
```bash
python3 pos-desktop/agent.py
```
Open: http://localhost:7070

## Notes
- Migrations + seeds are applied via `backend/scripts/init_db.sh`.
- Master data is bootstrapped for usability (default warehouse, VAT code, account defaults).
- For real deployments, review account defaults, exchange rate sources, and auth/session hardening.
