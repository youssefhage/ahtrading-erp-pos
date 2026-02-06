# API Map (High-Level)

## Auth
- POST /auth/login
- GET /auth/me
- POST /auth/logout

## Company
- GET /companies
- POST /companies
- GET /companies/{id}

## COA
- GET /coa/templates
- POST /coa/clone
- GET /coa/accounts
- PATCH /coa/accounts/{account_id}
- GET /coa/mappings
- POST /coa/mappings

## Exchange Rates
- GET /rates
- POST /rates

## Items & Inventory
- GET /items
- POST /items
- GET /inventory/stock
- POST /inventory/adjust

## Config
- GET /config/tax-codes
- POST /config/tax-codes
- GET /config/exchange-rates
- POST /config/exchange-rates
- GET /config/account-defaults
- POST /config/account-defaults

## Sales
- POST /sales/invoices
- GET /sales/invoices
- POST /sales/returns
- POST /sales/payments

## Purchasing
- GET /purchases/orders
- GET /purchases/receipts
- GET /purchases/invoices
- POST /purchases/orders
- POST /purchases/receipts
- POST /purchases/invoices

## POS
- POST /pos/devices/register
- POST /pos/outbox/submit
- GET /pos/inbox/pull
- POST /pos/heartbeat
- GET /pos/catalog

## Reporting
- GET /reports/vat
- GET /reports/trial-balance
- GET /reports/gl
- GET /reports/inventory-valuation
- GET /reports/metrics

## AI
- GET /ai/recommendations
- POST /ai/recommendations/{rec_id}/decide
- GET /ai/settings
- POST /ai/settings

## Suppliers
- GET /suppliers
- POST /suppliers
- GET /suppliers/{id}/items
- POST /suppliers/{id}/items
- GET /suppliers/items/{item_id}

## Customers
- GET /customers
- POST /customers
- PATCH /customers/{id}

## Users
- GET /users
- POST /users
- GET /users/roles
- POST /users/roles
- POST /users/roles/assign

## Intercompany
- POST /intercompany/issue
- POST /intercompany/settle
