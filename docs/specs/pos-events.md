# POS Events Specification

## sale.completed
Required fields:
- invoice_no (string, optional)
- exchange_rate (number)
- pricing_currency (USD|LBP)
- settlement_currency (USD|LBP)
- customer_id (uuid, optional)
- warehouse_id (uuid)
- lines[]
  - item_id (uuid)
  - qty (number)
  - unit_price_usd
  - unit_price_lbp
  - line_total_usd
  - line_total_lbp
  - unit_cost_usd (optional)
  - unit_cost_lbp (optional)
- tax (optional)
  - tax_code_id (uuid)
  - base_usd
  - base_lbp
  - tax_usd
  - tax_lbp
  - tax_date (date)
- payments[] (optional)
  - method (cash|card|transfer|credit|other)
  - amount_usd
  - amount_lbp
- loyalty_points (optional)

## sale.returned
Required fields:
- invoice_id (uuid, optional)
- exchange_rate (number)
- warehouse_id (uuid)
- lines[]
  - item_id (uuid)
  - qty (number)
  - unit_cost_usd (optional)
  - unit_cost_lbp (optional)
  - line_total_usd
  - line_total_lbp
- tax (optional)
  - tax_code_id (uuid)
  - base_usd
  - base_lbp
  - tax_usd
  - tax_lbp
  - tax_date (date)
