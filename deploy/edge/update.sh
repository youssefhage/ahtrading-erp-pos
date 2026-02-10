#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

env_file="$root_dir/deploy/edge/.env.edge"
if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file" >&2
  echo "Create it from: $root_dir/deploy/edge/.env.edge.example" >&2
  exit 2
fi

echo "[edge] updating repo (git pull)..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # Pull if a remote is configured; otherwise just rebuild from local.
  if git remote >/dev/null 2>&1 && [[ -n "$(git remote)" ]]; then
    git pull --rebase
  else
    echo "[edge] no git remote configured; skipping git pull."
  fi
else
  echo "[edge] not a git repo; skipping git pull."
fi

echo "[edge] rebuilding + restarting services..."
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml up -d --build
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml ps

echo "[edge] tailing logs (ctrl+c to stop)..."
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml logs -f --tail=120 api worker

