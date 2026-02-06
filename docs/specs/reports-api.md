# Reports API

All report endpoints require header:
- `X-Company-Id: <company_uuid>`

## VAT
- GET /reports/vat
- GET /reports/vat?period=2026-01-01
- GET /reports/vat?format=csv

## Trial Balance
- GET /reports/trial-balance

## General Ledger
- GET /reports/gl
- GET /reports/gl?start_date=2026-01-01&end_date=2026-01-31
- GET /reports/gl?format=csv

## Inventory Valuation
- GET /reports/inventory-valuation
- GET /reports/inventory-valuation?format=csv
