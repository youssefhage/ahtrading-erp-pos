# Customers API

All endpoints require header:
- `X-Company-Id: <company_uuid>`

## List Customers
- GET /customers

## Create Customer
- POST /customers

## Update Customer
- PATCH /customers/{customer_id}

Fields include credit limits and loyalty points. Credit sales enforce limits.
