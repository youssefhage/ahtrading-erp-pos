#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

# Thin wrapper so non-technical folks can run one command.
python3 scripts/onboard_onprem_pos.py "$@"

