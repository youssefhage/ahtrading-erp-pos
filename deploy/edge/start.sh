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

docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml up -d
docker compose --env-file "$env_file" -f deploy/docker-compose.edge.yml ps

