#!/usr/bin/env bash
set -euo pipefail

# Hard reset EDGE stack (drops Postgres + MinIO volumes) and re-import AH Trading ERPNext exports.
# Use this to wipe old demo/UAT data and get a clean, realistic dataset for pilot sessions.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

env_file="$root_dir/deploy/edge/.env.edge"
if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file" >&2
  echo "Create it from: $root_dir/deploy/edge/.env.edge.example" >&2
  exit 2
fi

# Load env for convenience (API_PORT).
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

api_port="${API_PORT:-8001}"

echo "[edge] STOP + DELETE VOLUMES (pgdata/minio_data)..."
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml down -v --remove-orphans

echo "[edge] START fresh..."
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml up -d --build

echo "[edge] Waiting for API health on http://127.0.0.1:${api_port}/health ..."
deadline=$((SECONDS + 240))
until curl -fsS "http://127.0.0.1:${api_port}/health" >/dev/null 2>&1; do
  if [[ "$SECONDS" -ge "$deadline" ]]; then
    echo "[edge] API did not become healthy in time." >&2
    docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml ps >&2 || true
    exit 1
  fi
  sleep 2
done

echo "[edge] Importing ERPNext exports from ./Data AH Trading ..."
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml --profile tools run --rm tools \
  python3 backend/scripts/import_erpnext_ah_trading.py --apply --data-dir /data/ah

echo "[edge] ok"

