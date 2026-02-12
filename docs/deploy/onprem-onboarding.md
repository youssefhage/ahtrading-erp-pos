# On-Prem + POS Onboarding (Automated)

This repo includes a guided onboarding runner that sets up the on-prem EDGE stack and provisions POS devices, without touching your cloud/Dokploy deployment.

## Installer (recommended)

Use the installer launcher:

```bash
./scripts/setup_installer.sh
```

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
2. Start the EDGE stack via Docker Compose.
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

## Common Overrides

```bash
./scripts/onboard_onprem_pos.sh \
  --api-port 8001 \
  --admin-port 3000 \
  --edge-api-url-for-pos "http://192.168.1.50:8001" \
  --device-count 3
```

## Edge -> Cloud Sync

If you enable sync during onboarding, the script will set:
- `EDGE_SYNC_TARGET_URL` (cloud API base URL)
- `EDGE_SYNC_KEY` (shared secret)
- `EDGE_SYNC_NODE_ID` (store identifier)

Cloud-side enablement can be done later by setting the same `EDGE_SYNC_KEY` on the cloud API.
