# POS Desktop (Lightweight)

## Why this approach
- Pure Python + SQLite + static HTML.
- No heavy frameworks; runs on low-spec hardware.
- Offline-first with local outbox queue.

## Run
```bash
python3 pos-desktop/agent.py
```
Open:
- http://localhost:7070

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

Device auth:
- Register the device on the backend to obtain `device_id` and `device_token`.
- Set both in `config.json` before syncing.

## Sync
- Pull catalog: POST /api/sync/pull
- Push sales: POST /api/sync/push

## Local API
- GET /api/health
- GET /api/config
- POST /api/config
- GET /api/items
- POST /api/sale
- GET /api/outbox
- POST /api/sync/pull
- POST /api/sync/push

## POS UI Features
- Barcode scan support (type/scan then Enter)
- Customer ID input for credit sales
- Payment method selection (cash/card/transfer/credit)
- Loyalty points calculated from config loyalty_rate
- Credit sales require customer ID and respect credit limits on backend
- Shift open/close with cash reconciliation (requires device auth)
