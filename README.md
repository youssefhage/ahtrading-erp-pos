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

2) Open Admin:
- http://localhost:3000

3) Login:
- The API container bootstraps an admin user on first run (see logs for `BOOTSTRAP_ADMIN_CREATED`).
- Default email is `admin@ahtrading.local` and a random password is printed unless you set `BOOTSTRAP_ADMIN_PASSWORD`.

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

