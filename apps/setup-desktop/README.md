# Setup Desktop (Tauri)

This is a lightweight Tauri “installer app” that automates on-prem local-node setup and POS provisioning.

Goal: make hybrid setup (cloud + on-prem backup) easy for non-technical users:
- Bring up the local node stack on an on-prem server (Docker).
- Register POS devices and export “setup packs” for POS terminals.

Important note:
- This does **not** install Docker Desktop or Python for you automatically. It will preflight-check for them and guide you.
- Today, it runs the onboarding runner from the repo (because the local-node docker-compose builds images from source).
  Later we can ship a standalone local-node distro that pulls prebuilt images.

## Dev

1. Install Rust toolchain (once): https://rustup.rs
2. Install deps:
   - `cd apps/setup-desktop`
   - `npm i`
3. Run:
   - `npm run dev`

## Build

- `npm run build`

### Installer builds
- macOS DMG:
  - `npm run build:dmg`
- Windows installers (`.exe` via NSIS and `.msi`):
  - `npm run build:windows`

Artifacts are generated under:
- `apps/setup-desktop/src-tauri/target/release/bundle/dmg/`
- `apps/setup-desktop/src-tauri/target/release/bundle/nsis/`
- `apps/setup-desktop/src-tauri/target/release/bundle/msi/`
