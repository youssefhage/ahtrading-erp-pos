#!/usr/bin/env bash
set -euo pipefail

# Removes the com.apple.quarantine attribute from a downloaded DMG (and optionally
# the installed app), so Gatekeeper doesn't show "is damaged and can't be opened"
# during internal testing.
#
# Usage:
#   scripts/mac_fix_dmg_gatekeeper.sh "/Users/you/Downloads/MelqardPOS-Setup-latest.dmg"
#
# Note: This is for internal/testing only. Proper distribution should be
# Developer ID signed + notarized.

DMG_PATH="${1:-}"
if [ -z "${DMG_PATH:-}" ]; then
  echo "usage: $0 /path/to/file.dmg" >&2
  exit 2
fi

if [ ! -f "$DMG_PATH" ]; then
  echo "error: dmg not found: $DMG_PATH" >&2
  exit 2
fi

XATTR_BIN="/usr/bin/xattr"
if [ ! -x "$XATTR_BIN" ]; then
  XATTR_BIN="xattr"
fi

echo "Clearing quarantine on DMG: $DMG_PATH"
$XATTR_BIN -d com.apple.quarantine "$DMG_PATH" 2>/dev/null || true

echo "DMG xattrs:"
ls -l@ "$DMG_PATH" | sed -n '1,10p' || true

echo ""
echo "If you already installed the app to /Applications, you can also clear quarantine there."
echo "Examples:"
echo "  $XATTR_BIN -d com.apple.quarantine \"/Applications/Melqard POS Desktop.app\""
echo "  find \"/Applications/Melqard POS Desktop.app\" -print0 | xargs -0 $XATTR_BIN -d com.apple.quarantine"

