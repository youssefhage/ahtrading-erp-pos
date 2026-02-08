# Restore Drill (Postgres Volume) (Dokploy / Docker Compose)

Goal: prove we can restore the system after a server failure or operator mistake.

This repo uses a Postgres data volume (`pgdata`). The exact backup mechanism depends on your VPS/Dokploy setup, but the drill should always include:
- restore the volume
- run migrations (`init_db.sh` runs automatically on boot)
- verify Admin login + basic flows

## 1) Before You Start

- Ensure the backup you’re restoring is from a known timestamp.
- Ensure you know the current production environment variables:
  - `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
  - `APP_DB_USER`, `APP_DB_PASSWORD`

## 2) Restore Steps (General)

1) Stop the app (api/worker/admin) so the DB is not being written to.
2) Restore the Postgres data volume (`pgdata`) using your backup tool/provider.
3) Start the stack.
4) Confirm migrations are applied:
   - `schema_migrations` exists and has recent entries.
5) Verify app health endpoints.
6) Verify a basic business workflow:
   - login
   - open a company
   - create a draft sales invoice and post it
   - confirm inventory/GL updated

## 3) Verification Commands (Compose)

From the repo root:

```bash
docker compose up -d --build
curl -fsS "http://localhost:3000/api/health"

docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT COUNT(*) FROM schema_migrations;"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 10;"
```

## 4) What “Success” Looks Like

- Admin UI loads.
- Login works (or password reset procedure works).
- Worker is running and processing outbox events.
- No missing-column errors in logs after boot.

## 5) Common Failure Modes

- Restored volume is older than the running code expects:
  - Fix: deploy the matching code version, or run with code that can migrate forward.
- Missing/incorrect `APP_DB_USER` credentials:
  - Symptoms: RLS-related permission errors.
  - Fix: ensure `init_db.sh` ran and that `APP_DB_USER` exists with required grants.

