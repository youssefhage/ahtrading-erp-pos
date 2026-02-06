# Suppliers API

All endpoints require header:
- `X-Company-Id: <company_uuid>`

## List Suppliers
- GET /suppliers

## Create Supplier
- POST /suppliers

## Supplier Items
- GET /suppliers/{supplier_id}/items
- POST /suppliers/{supplier_id}/items

## Item Suppliers
- GET /suppliers/items/{item_id}
