# Lebanese COA Import

## Source
- Original file: `docs/Chart of Accounts.xls`
- Normalized file: `docs/coa/coa_lebanon_normalized.csv`

## Normalized Columns
- account_code (integer)
- name_fr
- name_en
- name_ar
- normal_balance_raw

## JSON Template
- File: `docs/coa/coa_lebanon_template.json`
- Contains template metadata + full account list

## Normal Balance Mapping (Default)
- C  -> credit
- D  -> debit
- C/D -> both
- C=D -> none (requires manual review)
- HD  -> none (requires manual review)
- N.A -> none (requires manual review)

## Import Rules
- account_code stored as string to preserve formatting and allow non-numeric codes.
- is_postable default = true
- If normal_balance_raw in {C=D, HD, N.A} set is_postable=false and flag for review.
- Parent relationships are not assumed from the code; can be configured after import.

## COA Templates
- Lebanese COA template (imported)
- IFRS COA template (optional)
- Custom COA templates (created per company)

## Multilingual Labels
- Store name_ar, name_en, name_fr on template and company accounts.
- UI should allow editing and default language per company.

## Account Defaults Mapping
- Template file: `docs/coa/account_defaults_template.csv`
- Map role_code to your company account_code.
