# Backend (Foundation)

## Purpose
Initial backend foundation for AH Trading ERP/POS, focused on the database schema, COA templates, and RLS security.

## Requirements
- PostgreSQL 13+ (with pgcrypto extension)
- Python 3.9+ (for seed generation)
- Python dependencies: `backend/requirements.txt`

## Initialize DB (manual)
1) Create database and user
2) Apply migrations from `backend/db/migrations` in order
3) Apply seeds from `backend/db/seeds` in this order:
   - `seed_coa_lebanon.sql`
   - `seed_account_roles.sql`
   - `seed_companies.sql`
   - `seed_company_coa.sql`
   - `seed_bootstrap_master_data.sql`

## Initialize DB (scripted)
```bash
DATABASE_URL=postgresql://localhost/ahtrading \\
  backend/scripts/init_db.sh
```

## Bootstrap Admin (first login)
The DB contains no users by default. For a dev/local environment you can enable the bootstrap admin creator:
```bash
BOOTSTRAP_ADMIN=1 \\
BOOTSTRAP_ADMIN_EMAIL=admin@ahtrading.local \\
BOOTSTRAP_ADMIN_PASSWORD='change-me' \\
DATABASE_URL=postgresql://localhost/ahtrading \\
  backend/scripts/init_db.sh
```
If `BOOTSTRAP_ADMIN_PASSWORD` is omitted, a random password is generated and printed to stdout.

## Notes
- All tables include `company_id` where applicable.
- RLS is enabled; app must set `app.current_company_id` per request.
- API requests use `X-Company-Id` header for company-scoped endpoints.

## Run API (optional)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

## Permissions
Endpoints are protected by permission codes (see `/users/permissions`).
Assign permissions to roles with `/users/roles/permissions`.

## Register POS Device (example)
```bash
curl -X POST \"http://localhost:8000/pos/devices/register?company_id=00000000-0000-0000-0000-000000000001&branch_id=00000000-0000-0000-0000-000000000011&device_code=POS-01\" \\
  -H \"X-Company-Id: 00000000-0000-0000-0000-000000000001\" \\
  -H \"Authorization: Bearer <token>\"
```
Returns `id` and a one-time `token` you must set as `device_id` and `device_token` in the POS config.

## POS Event Processing (worker)
Process pending POS events for a company:
```bash
python3 backend/workers/pos_processor.py \\
  --db postgresql://localhost/ahtrading \\
  --company-id 00000000-0000-0000-0000-000000000001
```

## Payment Method Mapping
Ensure payment methods map to account roles (CASH/BANK/AR) in `payment_method_mappings`.
Use `POST /config/payment-methods` to upsert per company.

## POS Shifts
Use `/pos/shifts/open` and `/pos/shifts/{id}/close` (device auth) to track cash drawers.

## AI Agent Runner (stub)
```bash
python3 backend/workers/ai_agent_runner.py \\
  --db postgresql://localhost/ahtrading \\
  --company-id 00000000-0000-0000-0000-000000000001
```

## AI Inventory Agent
```bash
python3 backend/workers/ai_inventory.py \\
  --db postgresql://localhost/ahtrading \\
  --company-id 00000000-0000-0000-0000-000000000001
```

## AI Purchase Agent
```bash
python3 backend/workers/ai_purchase.py \\
  --db postgresql://localhost/ahtrading \\
  --company-id 00000000-0000-0000-0000-000000000001
```

## AI CRM Agent
```bash
python3 backend/workers/ai_crm.py \\
  --db postgresql://localhost/ahtrading \\
  --company-id 00000000-0000-0000-0000-000000000001 \\
  --inactive-days 60
```

## AI Action Executor
```bash
python3 backend/workers/ai_action_executor.py \\
  --db postgresql://localhost/ahtrading \\
  --company-id 00000000-0000-0000-0000-000000000001
```

## Import Account Defaults
```bash
python3 backend/scripts/import_account_defaults.py \\
  --db postgresql://localhost/ahtrading \\
  --company-id 00000000-0000-0000-0000-000000000001 \\
  --csv docs/coa/account_defaults_template.csv
```
