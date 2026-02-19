# POS Agent (Python) + POS UI (Svelte)

This folder contains the **local POS agent** (Python + SQLite) and the **POS UI** (Svelte + Vite) that it serves.

In production we typically run this via **Melqard POS Desktop** (Tauri), which:
- starts one or two local agents (Official + Unofficial),
- hosts a single unified cashier UI,
- and auto-updates remotely via the updater URL configured in the desktop app.

## Run (Dev / Manual)
```bash
python3 pos-desktop/agent.py
```
Open:
- http://localhost:7070
- Unified cashier UI: http://localhost:7070

### Svelte + Vite UI development
```bash
cd pos-desktop/ui
npm install
npm run dev
```

Build and serve the packaged UI with the Python agent:
```bash
cd pos-desktop/ui
npm run build
python3 pos-desktop/agent.py
```

### Multi-Company Pilot (Run Two Agents)
Local caches are per-agent (SQLite). For a pilot where the cashier needs both companies, run two agents on different ports, each with its own `--config` and `--db`:

```bash
# Official
cp pos-desktop/config.official.sample.json pos-desktop/config.official.json
python3 pos-desktop/agent.py --port 7070 --config pos-desktop/config.official.json --db pos-desktop/pos.official.sqlite

# Unofficial
cp pos-desktop/config.unofficial.sample.json pos-desktop/config.unofficial.json
python3 pos-desktop/agent.py --port 7072 --config pos-desktop/config.unofficial.json --db pos-desktop/pos.unofficial.sqlite
```

## Config
Edit `pos-desktop/config.json` or call POST /api/config

Config keys:
- api_base_url
- company_id
- device_id
- device_token
- warehouse_id
- shift_id
- exchange_rate
- rate_type
- pricing_currency
- vat_rate
- tax_code_id
- loyalty_rate (points per USD)
- receipt_printer / receipt_print_copies / auto_print_receipt
- receipt_template (`classic` | `compact` | `detailed`)
- receipt_company_name / receipt_footer_text
- print_base_url
- invoice_printer / invoice_print_copies / auto_print_invoice
- invoice_template (`official_classic` | `official_compact` | `standard`)

Device auth:
- Register the device on the backend to obtain `device_id` and `device_token`.
- Set both in `config.json` before syncing.

## Sync
- Pull catalog: POST /api/sync/pull
- Push sales: POST /api/sync/push

During pull, the agent also fetches `/pos/config` from the backend to populate:
- `warehouse_id`
- `tax_code_id`
- `vat_rate`
- `invoice_template` (from company `print_policy` when configured)

## Unified Mode (Two Companies)
Run two agents (one per company) and point the UI to the second agent using **Other Agent** in the header.

Unified behaviors:
- Mixed cart automatically splits into **two invoices** (Official + Unofficial) from one interface.
- **Flag to Official** forces a single Official invoice even if items belong to Unofficial, and marks it for **manual review** (stock moves skipped).

## Local API
- GET /api/health
- GET /api/config
- POST /api/config
- GET /api/receipts/templates
- GET /api/invoices/templates
- GET /api/items
- POST /api/sale
- POST /api/return
- GET /api/outbox
- POST /api/sync/pull
- POST /api/sync/push

## POS UI Features
- Barcode scan support (type/scan then Enter)
- Tabbed navigation (POS + Item Lookup)
- Settings screen to configure agent connectivity (Edge vs Cloud), device credentials, and per-agent sync
- Customer ID input for credit sales
- Payment method selection (cash/card/transfer/credit)
- Loyalty points calculated from config loyalty_rate
- Credit sales require customer ID and respect credit limits on backend
- Shift open/close with cash reconciliation (requires device auth)
