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

## Sidecar (recommended)
For real distribution, bundle the POS agent as a sidecar binary (built via PyInstaller):

```bash
./pos-desktop/packaging/build_pos_agent.sh
```

Then copy `dist/pos-agent` into `apps/pos-desktop/src-tauri/bin/` before building.

