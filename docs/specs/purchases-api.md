# Purchases API

All purchase endpoints require header:
- `X-Company-Id: <company_uuid>`

## Create Goods Receipt
- POST /purchases/receipts
- Uses POS event pipeline (event_type: purchase.received)

## Create Supplier Invoice
- POST /purchases/invoices
- Uses POS event pipeline (event_type: purchase.invoice)

## List
- GET /purchases/orders
- GET /purchases/receipts
- GET /purchases/invoices

## Create Purchase Order
- POST /purchases/orders
