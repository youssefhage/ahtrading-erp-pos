# Inventory API

All inventory endpoints require header:
- `X-Company-Id: <company_uuid>`

## Stock Summary
- GET /inventory/stock
- Optional query params: item_id, warehouse_id

## Stock Adjustment
- POST /inventory/adjust
