# Account Defaults (Mapping)

Account roles are mapped per company to local COA accounts.

## Role Codes
- AR, AP, CASH, BANK
- SALES, SALES_RETURNS
- VAT_PAYABLE, VAT_RECOVERABLE
- INVENTORY, COGS, INV_ADJ
- ROUNDING
- INTERCO_AR, INTERCO_AP
- GRNI

## Usage
- GL posting rules look up the company defaults by role.
- Missing roles block posting and must be configured.
- Template: `docs/coa/account_defaults_template.csv`
