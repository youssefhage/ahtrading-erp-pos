# Purchase Events Specification

## purchase.received
Required fields:
- supplier_id (uuid)
- exchange_rate (number)
- warehouse_id (uuid)
- lines[]
  - item_id (uuid)
  - qty (number)
  - unit_cost_usd
  - unit_cost_lbp
  - line_total_usd
  - line_total_lbp

## purchase.invoice
Required fields:
- supplier_id (uuid)
- invoice_no (string, optional)
- exchange_rate (number)
- lines[]
  - item_id (uuid)
  - qty (number)
  - unit_price_usd
  - unit_price_lbp
  - line_total_usd
  - line_total_lbp
- tax (optional)
  - tax_code_id (uuid)
  - base_usd
  - base_lbp
  - tax_usd
  - tax_lbp
  - tax_date (date)
- payments[] (optional)
  - method (cash|bank|transfer|other)
  - amount_usd
  - amount_lbp
