#!/usr/bin/env bash
set -euo pipefail

# Hard reset the EDGE stack (drops Postgres + MinIO volumes).
# Use this when you want to wipe demo/UAT data and start clean.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

env_file="$root_dir/deploy/edge/.env.edge"
if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file" >&2
  echo "Create it from: $root_dir/deploy/edge/.env.edge.example" >&2
  exit 2
fi

echo "[edge] STOP + DELETE VOLUMES (pgdata/minio_data)..."
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml down -v --remove-orphans

echo "[edge] START fresh..."
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml up -d --build
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml ps

echo "[edge] ok"

