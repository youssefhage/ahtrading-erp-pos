# On-Prem + POS Onboarding (Automated)

This repo includes a guided onboarding runner that sets up the on-prem local-node stack and provisions POS devices, without touching your cloud/Dokploy deployment.

## Installer (recommended)

Use the installer launcher:

```bash
./scripts/setup_installer.sh
```

Or (recommended for stores) install **Setup Desktop** from the downloads page and run it. Setup Desktop can run without a repo clone (it ships a bundled local-node stack that pulls prebuilt images).

## Windows Prereqs (If Using The Zip Runner)

If you're running the fallback zip runner (`run_setup.ps1`) on Windows:

- Install **Docker Desktop** and make sure it is running.
- Install **Python 3.11+** and ensure it's on `PATH`.
  - Recommended: `winget install -e --id Python.Python.3.11`
  - In the Python installer, check **Add python.exe to PATH** and install the **Python Launcher (py)**.

You can select:
1. Full setup (On-Prem + POS)
2. On-Prem only
3. POS only

## Direct Runner

If you prefer, you can still run the onboarding runner directly.

From the repo root:

```bash
./scripts/onboard_onprem_pos.sh
```

The script will:
1. Generate `deploy/edge/.env.edge` (with strong random secrets).
2. Start the local-node stack via Docker Compose.
3. Wait for the API to become healthy.
4. Login as the bootstrap admin.
5. Register POS devices automatically.
6. Export POS "device packs" you can use to configure registers.

## Output

On success, it creates:
- `deploy/edge/onboarding/<timestamp>/pos-device-packs/*.json`
  - Ready-to-use configs for the Python POS agent.
- `deploy/edge/onboarding/<timestamp>/tauri-launcher-prefill.json`
  - Paste into the POS Desktop launcher using the Setup Pack field.

Security note: device packs contain `device_token` secrets. Keep the folder private.

## Safer Defaults

- MinIO is bound to localhost by default (not exposed to LAN): `MINIO_BIND_IP=127.0.0.1`.
  - If you need LAN access for troubleshooting, set `MINIO_BIND_IP=0.0.0.0` in `deploy/edge/.env.edge`.
- The default cloud API URL for sync is `https://app.melqard.com/api`.

## Common Overrides

```bash
./scripts/onboard_onprem_pos.sh \
  --api-port 8001 \
  --admin-port 3000 \
  --edge-api-url-for-pos "http://192.168.1.50:8001" \
  --device-count 3
```

## Compose Mode (Build vs Images)

- `--compose-mode build` (default): builds Docker images locally from this repo (developer workflow).
- `--compose-mode images`: pulls prebuilt Docker images from GHCR (recommended for store installs).

Example:

```bash
./scripts/onboard_onprem_pos.sh --compose-mode images
```

## Node -> Cloud Sync

If you enable sync during onboarding, the script will set:
- `EDGE_SYNC_TARGET_URL` (cloud API base URL)
- `EDGE_SYNC_KEY` (shared secret)
- `EDGE_SYNC_NODE_ID` (store identifier)

Cloud-side enablement must be tenant-scoped:
- Single-tenant cloud: set `EDGE_SYNC_KEY` and `EDGE_SYNC_COMPANY_ID` (same company as the store).
- Multi-tenant cloud: set `EDGE_SYNC_KEY_BY_COMPANY` with per-company secrets.
- Optional hardening: set `EDGE_SYNC_NODE_COMPANY_MAP` to pin each node id to one company id.
