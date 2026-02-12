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
