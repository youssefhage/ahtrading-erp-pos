# Reports API

All report endpoints require header:
- `X-Company-Id: <company_uuid>`

## VAT
- GET /reports/vat
- GET /reports/vat?period=2026-01-01
- GET /reports/vat?start_date=2026-01-01&end_date=2026-01-31
- GET /reports/vat?start_date=2026-01-01
- GET /reports/vat?end_date=2026-01-31
- GET /reports/vat?format=csv

Response fields:
- `period` (nullable, month start when `period` query is used)
- `start_date` / `end_date` (nullable, applied range)
  - open-ended ranges are supported (`start_date` only or `end_date` only)
- `summary`
  - `output_base_lbp`, `output_tax_lbp`
  - `input_base_lbp`, `input_tax_lbp`
  - `net_tax_lbp` (`output_tax_lbp - input_tax_lbp`)
  - `other_base_lbp`, `other_tax_lbp` (unexpected source buckets)
  - `rows_count`
- `vat[]`
  - `tax_code_id`, `tax_name`, `period`
  - `direction` (`output` | `input` | `other`)
  - `direction_label`
  - `base_lbp`, `tax_lbp`
  - `line_count`
  - `source_types[]`

## Trial Balance
- GET /reports/trial-balance

## General Ledger
- GET /reports/gl
- GET /reports/gl?start_date=2026-01-01&end_date=2026-01-31
- GET /reports/gl?format=csv

## Inventory Valuation
- GET /reports/inventory-valuation
- GET /reports/inventory-valuation?format=csv
