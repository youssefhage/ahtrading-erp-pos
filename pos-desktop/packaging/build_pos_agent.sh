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

rm -rf build dist
$python_bin -m PyInstaller --noconfirm pos-desktop/packaging/pos_agent.spec

echo "[pos-agent] built:"
ls -la dist | sed -n '1,50p'

