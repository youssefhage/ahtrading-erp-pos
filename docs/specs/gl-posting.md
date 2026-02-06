# GL Posting Rules (Core)

## Principles
- Every operational document posts a journal in both USD and LBP.
- VAT is posted in LBP (USD optional for analytics only).
- Exchange rate is locked at document creation time.
- Journals are immutable once posted; corrections use reversing entries.
- Posting uses account role mappings; see `docs/specs/account-defaults.md`.

## Sales Invoice
### Accounts (example mapping)
- Debit: Accounts Receivable / Cash (USD + LBP)
- Credit: Sales Revenue (USD + LBP)
- Credit: VAT Payable (LBP)

### Posting Logic
1) Calculate line totals in USD and LBP.
2) Compute VAT base and VAT amount in LBP.
3) Post receivable in both currencies.
4) Post sales revenue in both currencies.
5) Post VAT payable in LBP (USD optional = 0).

## Sales Return
- Reverse sales invoice entries
- Post to Sales Returns account

## Purchase Invoice
- Debit: Inventory/COGS or Expense (USD + LBP)
- Debit: VAT Recoverable (LBP)
- Credit: Accounts Payable (USD + LBP)

## Goods Receipt
- Debit: Inventory
- Credit: GRNI (goods received not invoiced)

## Payment
- Debit: Cash/Bank
- Credit: Receivable/Payable

## Inventory Adjustment
- Debit/Credit: Inventory
- Counter: Inventory Adjustments (gain/loss)

## Intercompany Issuing
- Company A: sale and AR
- Company B: issue inventory and intercompany receivable
- Settlement: intercompany payable/receivable
