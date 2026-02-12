#!/usr/bin/env bash
set -euo pipefail

# Sets GitHub Actions secrets required for macOS code signing + notarization
# and Tauri updater signing, using the GitHub CLI (`gh`).
#
# Requirements:
# - gh installed
# - gh authenticated: `gh auth login`
# - Apple Developer ID Application certificate exported as .p12
# - Apple notarization app-specific password
#
# This script does NOT print secret values.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() {
  echo "error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

need_cmd gh
need_cmd base64
need_cmd tr

cd "$ROOT_DIR"

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated."
  echo "Run: gh auth login"
  exit 2
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [ -z "${REPO:-}" ]; then
  die "could not detect repo (run inside a git repo with a GitHub remote)"
fi
echo "Repo: $REPO"

TAURI_KEY_FILE="$ROOT_DIR/.secrets/tauri_updater.key"
TAURI_PW_FILE="$ROOT_DIR/.secrets/tauri_updater_password.txt"

if [ ! -f "$TAURI_KEY_FILE" ]; then
  die "missing Tauri updater key: $TAURI_KEY_FILE"
fi

echo "Setting Tauri updater signing secrets..."
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" --body-file "$TAURI_KEY_FILE" >/dev/null
if [ -f "$TAURI_PW_FILE" ]; then
  # Password may be empty; still set it for CI consistency.
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO" --body "$(cat "$TAURI_PW_FILE")" >/dev/null
else
  echo "warning: $TAURI_PW_FILE not found; skipping TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
fi

echo ""
echo "Apple signing/notarization secrets..."
read -r -p "Path to Developer ID Application .p12 (exported from Keychain): " P12_PATH
P12_PATH="$(echo "${P12_PATH:-}" | sed 's/^~/'"$HOME"'/')"
if [ -z "${P12_PATH:-}" ] || [ ! -f "$P12_PATH" ]; then
  die "p12 not found: $P12_PATH"
fi

read -r -s -p "P12 export password: " P12_PASSWORD
echo ""
read -r -p "Apple ID email (for notarization): " APPLE_ID
read -r -s -p "Apple app-specific password (for notarization): " APPLE_PASSWORD
echo ""
read -r -p "Apple Team ID (e.g. AMB876WD9R): " APPLE_TEAM_ID
read -r -p "Signing identity (e.g. Developer ID Application: Company (TEAMID)): " APPLE_SIGNING_IDENTITY

if [ -z "${P12_PASSWORD:-}" ]; then
  die "P12 password is required"
fi
if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
  die "APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID are required"
fi
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  die "APPLE_SIGNING_IDENTITY is required"
fi

# Base64 the .p12 into a single line.
APPLE_CERTIFICATE_B64="$(base64 -i "$P12_PATH" | tr -d '\n')"

echo "Setting Apple secrets..."
gh secret set APPLE_CERTIFICATE --repo "$REPO" --body "$APPLE_CERTIFICATE_B64" >/dev/null
gh secret set APPLE_CERTIFICATE_PASSWORD --repo "$REPO" --body "$P12_PASSWORD" >/dev/null
gh secret set APPLE_ID --repo "$REPO" --body "$APPLE_ID" >/dev/null
gh secret set APPLE_PASSWORD --repo "$REPO" --body "$APPLE_PASSWORD" >/dev/null
gh secret set APPLE_TEAM_ID --repo "$REPO" --body "$APPLE_TEAM_ID" >/dev/null
gh secret set APPLE_SIGNING_IDENTITY --repo "$REPO" --body "$APPLE_SIGNING_IDENTITY" >/dev/null

echo ""
echo "Done."
echo "Next: bump the desktop app version(s), push, then push a desktop-v* tag to trigger the build & publish workflow."

