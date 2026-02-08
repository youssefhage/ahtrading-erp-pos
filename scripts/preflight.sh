#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

fail=0
strict=0

if [[ "${1:-}" == "--strict" ]]; then
  strict=1
fi

say() { printf "%s\n" "$*"; }
warn() { printf "WARN: %s\n" "$*" >&2; }
err() { printf "ERROR: %s\n" "$*" >&2; }

want_py="$(cat .python-version 2>/dev/null || true)"
want_node="$(cat .nvmrc 2>/dev/null || true)"

py_cmd="python3"
if [[ "$want_py" == "3.11" ]] && command -v python3.11 >/dev/null 2>&1; then
  py_cmd="python3.11"
fi
py_ver="$("$py_cmd" --version 2>/dev/null || true)"
node_ver="$(node --version 2>/dev/null || true)"

if [[ -n "$want_py" ]]; then
  if [[ "$py_ver" != "Python ${want_py}"* ]]; then
    warn "Python mismatch: want ${want_py} (see .python-version), got: ${py_ver:-missing} (checked ${py_cmd})"
    fail=1
  else
    say "OK: Python ${want_py} (${py_cmd})"
  fi
fi

if [[ -n "$want_node" ]]; then
  # want_node is like "20"; node_ver is like "v20.11.0"
  if [[ "$node_ver" != "v${want_node}."* ]]; then
    warn "Node mismatch: want ${want_node} (see .nvmrc), got: ${node_ver:-missing}"
    fail=1
  else
    say "OK: Node ${want_node}"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  warn "docker not found (Docker Compose quickstart won't work)."
  fail=1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  warn "docker compose not available (try installing Docker Desktop / Compose v2)."
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  if [[ "$strict" -eq 1 ]]; then
    err "Preflight checks failed (--strict)."
    exit 2
  fi
  warn "Preflight warnings found. Run again with --strict to fail on mismatches."
fi

say "Preflight OK."
