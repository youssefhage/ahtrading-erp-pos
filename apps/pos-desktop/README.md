# POS Desktop (Tauri)

Native wrapper intended for slow POS desktops:
- Runs two local POS agents (official + unofficial) on `127.0.0.1`.
- Opens the unified pilot UI in a native window.
- Agents persist offline queue data in per-company SQLite files under the app data dir.

## Dev
This expects you to have the POS agent available (either Python or a built `pos-agent`).

```bash
cd apps/pos-desktop
npm install
npm run dev
```

## Build
```bash
cd apps/pos-desktop
npm install
npm run build
```

## Setup Pack (recommended for onboarding)

## Quick Setup (recommended)
If you have a cloud API and a user account with permission `pos:manage`, you can onboard a terminal without copying tokens:
1. Enter API URL (example: `https://app.melqard.com/api`)
2. Login
3. Select Official + Unofficial companies (and optional branch)
4. Generate Setup + Start POS

The app will register POS devices and write the local agent config automatically.

The on-prem onboarding runner exports:
- `deploy/edge/onboarding/<timestamp>/tauri-launcher-prefill.json`

Tip: generate this with the installer launcher:
```bash
./scripts/setup_installer.sh
```

In POS Desktop, paste this JSON into the **Setup Pack** box and click **Apply Pack**.
This auto-fills:
- Edge API URL
- Official/Unofficial company IDs
- Device IDs + tokens

### Installer builds
- macOS DMG:
  ```bash
  cd apps/pos-desktop
  npm install
  npm run build:dmg
  ```
- Windows installers (`.exe` via NSIS and `.msi`):
  ```bash
  cd apps/pos-desktop
  npm install
  npm run build:windows
  ```

Artifacts are generated under:
- `apps/pos-desktop/src-tauri/target/release/bundle/dmg/`
- `apps/pos-desktop/src-tauri/target/release/bundle/nsis/`
- `apps/pos-desktop/src-tauri/target/release/bundle/msi/`

## Sidecar (recommended)
For real distribution, POS bundles the `pos-agent` sidecar binary (built via PyInstaller).
The build now auto-prepares this sidecar before creating installers.

```bash
./pos-desktop/packaging/build_pos_agent.sh
```
