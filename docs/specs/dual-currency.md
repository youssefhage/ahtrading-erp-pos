# Dual Currency Rules (USD + LBP)

## Rules
- USD is primary pricing/settlement currency.
- LBP is mandatory for VAT and statutory reporting.
- Each document stores USD total, LBP total, and exchange rate at creation time.

## Exchange Rate Table
- Rates stored per company, per date, per rate_type.
- Once used in a document, that rate is locked.

## VAT
- VAT is computed from LBP base amount.
- VAT payable and VAT recoverable are tracked in LBP.

## Rounding
- USD precision: 4 decimals
- LBP precision: 0 or 2 decimals, depending on policy (default 2)
- Rounding differences recorded to a dedicated account.
