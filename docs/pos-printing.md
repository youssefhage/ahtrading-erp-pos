# POS Printing (Official A4 + Unofficial Receipt)

This project supports two printing styles:

- **Official invoices**: A4 PDF (company header, good for filing).
- **Unofficial invoices**: thermal-style receipt (fast, no A4).

## How It Works

### Unofficial (Receipt)

The POS Agent can print the last receipt directly through the OS print spooler:

- Endpoint: `POST /api/receipts/print-last`
- Config keys (POS Agent):
  - `receipt_printer`
  - `receipt_print_copies`
  - `auto_print_receipt`
  - `receipt_template` (`classic` | `compact` | `detailed`)
  - `receipt_company_name`
  - `receipt_footer_text`

Available template presets:
- `classic`: balanced format with core metadata
- `compact`: minimal metadata, best for speed
- `detailed`: includes SKU + unit price detail rows

Printer discovery:

- Endpoint: `GET /api/printers`
- Uses PowerShell on Windows and CUPS (`lpstat`) on macOS.
- Receipt template list: `GET /api/receipts/templates`

### Official (A4 PDF)

Official invoices are printed as PDFs rendered by the Admin app export route, then spooled to an A4 printer:

- Resolve invoice from a POS outbox event (sync + process):
  - `POST /api/invoices/resolve-by-event`
  - (Agent calls edge `/pos/outbox/submit` then `/pos/outbox/process-one`)
- Print:
  - `POST /api/invoices/print-by-event`

Config keys (POS Agent):

- `print_base_url`: Admin base URL (must serve `/exports/sales-invoices/{id}/pdf`)
- `invoice_printer`
- `invoice_print_copies`
- `auto_print_invoice`
- `invoice_template` (`official_classic` | `official_compact` | `standard`)

Invoice template list:
- Endpoint: `GET /api/invoices/templates`

Company default:
- Admin: `System -> Config -> Policies -> Print Policy`
- Stored in `company_settings.key='print_policy'` and used as fallback when no explicit template is provided.

Notes:

- **Windows**: PDF printing prefers **SumatraPDF** if installed. Otherwise it falls back to the shell `PrintTo` verb (requires selecting a printer).
- **macOS**: uses CUPS `lp` to print PDFs.

## Operator Setup (Per Terminal)

1. Open POS printing settings (in POS UI).
2. Click **Refresh** to detect printers (per agent).
3. Map printers:
   - Official: select your **A4** printer and set **Admin URL**.
   - Unofficial: select your **thermal receipt** printer.
4. (Optional) Enable:
   - **Auto print invoices (A4 PDF)** for Official
   - **Auto print receipts** for Unofficial
5. Use **Test** to validate each printer mapping.

This is intentionally not hardcoded: each terminal can map printers locally.
