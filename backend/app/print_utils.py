from __future__ import annotations

import json
from typing import Optional

SALES_INVOICE_PDF_TEMPLATES = {"official_classic", "official_compact", "standard"}
OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001"


def normalize_sales_invoice_pdf_template(value) -> Optional[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    return raw if raw in SALES_INVOICE_PDF_TEMPLATES else None


def effective_sales_invoice_pdf_template(value, company_id: str) -> Optional[str]:
    tpl = normalize_sales_invoice_pdf_template(value)
    # Temporary compliance window: official company customer invoices should not use
    # the legacy "standard" print layout.
    if str(company_id or "").strip() == OFFICIAL_COMPANY_ID and tpl == "standard":
        return "official_classic"
    return tpl


def load_print_policy(cur, company_id: str) -> dict:
    cur.execute(
        """
        SELECT value_json
        FROM company_settings
        WHERE company_id = %s AND key = 'print_policy'
        LIMIT 1
        """,
        (company_id,),
    )
    row = cur.fetchone()
    if not row:
        return {"sales_invoice_pdf_template": None}

    raw = row.get("value_json")
    obj = {}
    if isinstance(raw, dict):
        obj = raw
    elif isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                obj = parsed
        except Exception:
            obj = {}

    tpl = effective_sales_invoice_pdf_template(obj.get("sales_invoice_pdf_template"), company_id)
    return {"sales_invoice_pdf_template": tpl}
