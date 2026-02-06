# Dual Currency Rules (USD + LBP)

## Rules
- USD is primary pricing/settlement currency.
- LBP is mandatory for VAT and statutory reporting.
- Each document stores USD total, LBP total, and exchange rate at creation time.
- For GL and operational documents, USD and LBP amounts represent the *same value* expressed in two currencies using the document's locked exchange rate (subject to rounding).

## Exchange Rate Table
- Rates stored per company, per date, per rate_type.
- Once used in a document, that rate is locked.

## VAT
- VAT is computed from the LBP base amount.
- VAT payable and VAT recoverable are reported in LBP (statutory).
- For v1 posting, VAT is also stored/posted in USD as `vat_usd = vat_lbp / exchange_rate` so journals remain balanced in both currencies.

## Rounding
- USD precision: 4 decimals
- LBP precision: 0 or 2 decimals, depending on policy (default 2)
- Rounding differences recorded to a dedicated account.
