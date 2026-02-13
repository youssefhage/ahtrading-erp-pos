#!/usr/bin/env bash
set -euo pipefail

# Build the POS agent binary using PyInstaller.
# Outputs to dist/pos-agent (or dist/pos-agent.exe on Windows).

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

python_bin="${PYTHON:-python3}"

echo "[pos-agent] using: $($python_bin --version)"
$python_bin -m pip install --upgrade pip >/dev/null
$python_bin -m pip install pyinstaller bcrypt >/dev/null

# Build the Svelte UI first (packaged agent serves pos-desktop/ui/dist).
if command -v npm >/dev/null 2>&1; then
  echo "[pos-agent] building UI (pos-desktop/ui)..."
  (cd pos-desktop/ui && npm ci && npm run build)
else
  echo "[pos-agent] warning: npm not found; skipping UI build. Ensure pos-desktop/ui/dist exists." >&2
fi

rm -rf build dist
$python_bin -m PyInstaller --noconfirm pos-desktop/packaging/pos_agent.spec

echo "[pos-agent] built:"
ls -la dist | sed -n '1,50p'
