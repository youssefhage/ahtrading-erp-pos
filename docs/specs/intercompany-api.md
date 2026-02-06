# Intercompany API

## Issue From Another Company
- POST /intercompany/issue

Payload:
- source_company_id
- issue_company_id
- sell_company_id
- source_invoice_id
- warehouse_id
- lines[]
  - item_id
  - qty
  - unit_cost_usd
  - unit_cost_lbp

Behavior:
- Creates intercompany document
- Issues stock from issue company
- Posts GL entries:
  - Issue company: Dr Intercompany AR, Cr Inventory
  - Sell company: Dr COGS, Cr Intercompany AP
- Records settlement row

## Settle Intercompany Balance
- POST /intercompany/settle

Payload:
- from_company_id
- to_company_id
- amount_usd
- amount_lbp
- exchange_rate
- method (cash|bank)
