# Sales API

All sales endpoints require header:
- `X-Company-Id: <company_uuid>`

## Create Sales Invoice
- POST /sales/invoices
- Uses POS event pipeline (event_type: sale.completed)

## Create Sales Return
- POST /sales/returns
- Uses POS event pipeline (event_type: sale.returned)

## List
- GET /sales/invoices
- GET /sales/returns

## Payments
- POST /sales/payments
