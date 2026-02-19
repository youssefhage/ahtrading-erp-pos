# Pilot Runbook (Wed, Feb 11, 2026)

Goal: run a real in-store pilot where POS + Admin remain operational during internet outages, with two companies (Official + Unofficial) and fast on-the-spot debugging.

This runbook assumes **Case 2**:
- One on-prem **Local Node** machine runs `db + api + worker + admin`.
- POS registers run the local POS agent + UI, and talk to the local node over LAN.
- Cloud (Dokploy/Hetzner) is optional for tomorrow; local operations do not depend on it.

## 0) Hardware / Network

- Local node machine: a dedicated mini-PC/laptop in the store, always on.
- UPS: strongly recommended for the local node machine + router.
- LAN: all registers must reach the local node on the same network.
- Printer: test on the cashier machine(s) (printing is local).

Recommendation:
- Give the local node a stable address:
  - DHCP reservation in the router (preferred), or static IP.
  - Example: `192.168.1.10`
- If possible, use a friendly name:
  - `ah-edge.local` (mDNS) or router DNS name `ah-edge`.

## 1) Start Local Node (db + api + worker + admin)

On the local node machine:

```bash
cd "/Users/Youssef/oDocuments/Business/Codex POS"

# Create edge env file:
cp deploy/edge/.env.edge.example deploy/edge/.env.edge
# Edit deploy/edge/.env.edge (passwords, admin email, etc.)

# Start services (production-like compose)
deploy/edge/start.sh

# Follow logs in two terminals
docker compose --env-file deploy/edge/.env.edge -f deploy/docker-compose.edge.yml logs -f api
docker compose --env-file deploy/edge/.env.edge -f deploy/docker-compose.edge.yml logs -f worker
```

Health checks:
- API: `http://<EDGE_IP>:8001/health`
- Admin: `http://<EDGE_IP>:3000`

## 2) Import ERPNext Data (Local Node DB)

Import into the local node DB after the API is healthy.

If running from inside the API container:
```bash
docker compose exec api python3 backend/scripts/import_erpnext_ah_trading.py \
  --db "$APP_DATABASE_URL" \
  --data-dir "Data AH Trading"
```

Notes:
- Items are imported by the `Company` column (Official vs Unofficial).
- Customers are shared and imported into both companies.

## 3) Create/Verify Master Setup (in Admin)

In Admin (`http://<EDGE_IP>:3000`):
- Confirm companies exist:
  - `AH Trading Official`
  - `AH Trading Unofficial`
- Create at least:
  - 1 warehouse per company (or reuse seeded default if present)
  - POS devices (one per register) per company
  - Cashiers and PINs
- Confirm VAT/tax setup if needed.

## 4) Configure Each Register (POS Agent)

On each POS register machine:

Option A (recommended): **Melqard POS Desktop** (Tauri)
1. Install the latest POS Desktop from the downloads page.
2. Paste the `tauri-launcher-prefill.json` (from onboarding output) into the **Setup Pack** field.
3. Start agents (Official + Unofficial) from the Desktop app and open the cashier UI.

Option B (manual): run two Python agents (example ports)
1. Create a per-company POS agent config (two agents):
   - Official agent config points to Official company/device on the local node.
   - Unofficial agent config points to Unofficial company/device on the local node.

2. Set `api_base_url` to the local API:
   - `http://<EDGE_IP>:8001`
   - or `http://ah-edge.local:8001`

3. Run two agents:
```bash
cd "/Users/Youssef/oDocuments/Business/Codex POS/pos-desktop"

# Official agent
python3 agent.py --init-db --db ./pos.official.sqlite --config ./config.official.json
python3 agent.py --db ./pos.official.sqlite --config ./config.official.json --port 7070

# Unofficial agent
python3 agent.py --init-db --db ./pos.unofficial.sqlite --config ./config.unofficial.json
python3 agent.py --db ./pos.unofficial.sqlite --config ./config.unofficial.json --port 7072
```

4. Open the unified cashier UI:
- `http://127.0.0.1:7070`

5. In the UI header, open **Other Agent** and set it to:
   - `http://127.0.0.1:7072` (or the LAN hostname/port on the same machine)

## 5) “Start of Day” Checklist (per register)

- Open unified UI.
- Enter Cashier PIN (logs into both agents).
- Press `Sync Pull` then `Sync Push`.
- Confirm the top status pills show both agents:
  - `Sync: Off Online · Un Online` (or similar)
  - `Outbox: ...` decreasing after push
- Print a test receipt.

## 6) What To Test in the Pilot (order)

1. Barcode scan (exists in both companies): confirm Unofficial item is picked by default.
2. Toggle invoice company to Official and scan again: confirm Official item is used.
3. Force Official invoice with Unofficial items:
   - Add an Unofficial-only item
   - Turn on `Flag to Official`
   - Checkout: confirm it passes and prints, and is marked for review (stock moves skipped)
4. Cash sale, Card sale.
5. Credit sale:
   - With API reachable: should work.
   - With API unreachable: should queue offline and sync later.
6. Returns:
   - With API reachable: should work.
   - With API unreachable: should queue offline and sync later.

## 7) Debug Fast Tomorrow (What We Look At First)

On the POS screen:
- Sync badges: `OK` vs `OFFLINE`
- Queue counters: queued events
- Use `Reconnect` to run pull+push and clear queue.

On Admin:
- Sales: `Adjustment Queue` for flagged invoices.
- System: `Outbox` to see rejected events (if any).

On local node machine:
- `docker compose logs -f api`
- `docker compose logs -f worker`
  - If using the edge compose file: `docker compose --env-file deploy/edge/.env.edge -f deploy/docker-compose.edge.yml logs -f api worker`
