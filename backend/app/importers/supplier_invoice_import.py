from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import uuid
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from ..ai.policy import is_external_ai_allowed
from ..ai.providers import get_ai_provider_config
from ..ai.purchase_invoice_import import (
    openai_extract_purchase_invoice_from_image,
    openai_extract_purchase_invoice_from_text,
)


def _norm_code(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = (s or "").strip().upper()
    t = re.sub(r"\s+", "", t)
    t = re.sub(r"[^A-Z0-9._\\-/]", "", t)
    return t or None


def _norm_name(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = (s or "").strip().lower()
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def _clean_item_name(raw: str) -> str:
    t = (raw or "").strip()
    t = re.sub(r"\s+", " ", t)
    # Basic cleanup: don't aggressively title-case (brands/codes can be uppercase).
    return t[:200] if t else "New Item"


def _default_exchange_rate(cur, company_id: str) -> Decimal:
    cur.execute(
        """
        SELECT usd_to_lbp
        FROM exchange_rates
        WHERE company_id = %s
        ORDER BY rate_date DESC, created_at DESC
        LIMIT 1
        """,
        (company_id,),
    )
    r = cur.fetchone()
    if r and r.get("usd_to_lbp") is not None:
        try:
            ex = Decimal(str(r["usd_to_lbp"] or 0))
            if ex > 0:
                return ex
        except Exception:
            pass
    # Safe fallback (matches Admin UI default).
    return Decimal("90000")


def _normalize_dual_amounts(usd: Decimal, lbp: Decimal, exchange_rate: Decimal) -> tuple[Decimal, Decimal]:
    # Backward compatibility for clients sending only one currency.
    if exchange_rate and exchange_rate != 0:
        if usd == 0 and lbp != 0:
            usd = lbp / exchange_rate
        elif lbp == 0 and usd != 0:
            lbp = usd * exchange_rate
    return usd, lbp


def extract_purchase_invoice_best_effort(
    *,
    raw: bytes,
    content_type: str,
    filename: str,
    company_id: str,
    cur,
    warnings: list[str],
    force_mock: bool = False,
) -> dict[str, Any] | None:
    """
    Best-effort invoice extraction.
    Returns extracted dict or None if extraction was not possible.
    """
    if force_mock:
        # Safe-by-default: only used when explicitly requested by the caller (local/dev testing).
        warnings.append("Mock extraction enabled: configure AI for real invoice parsing.")
        return {
            "supplier": {"name": "Mock Supplier"},
            "invoice": {
                "invoice_no": None,
                "invoice_date": date.today().isoformat(),
                "due_date": date.today().isoformat(),
                "currency": "USD",
            },
            "totals": {"currency": "USD"},
            "lines": [
                {
                    "qty": 1,
                    "unit_price": 1,
                    "currency": "USD",
                    "supplier_item_code": "MOCK-001",
                    "supplier_item_name": _clean_item_name(f"Imported ({filename})"),
                    "description": f"Mock import line from {filename}",
                }
            ],
        }

    external_ai_allowed = is_external_ai_allowed(cur, company_id)
    if not external_ai_allowed:
        warnings.append("External AI processing is disabled for this company; created draft + attached file only.")
        return None

    cfg = get_ai_provider_config(cur, company_id)
    if not cfg.get("api_key"):
        warnings.append("AI provider API key is not configured; created draft + attached file only.")
        return None

    ct = (content_type or "application/octet-stream").strip().lower()
    if ct.startswith("image/"):
        return openai_extract_purchase_invoice_from_image(
            raw=raw,
            content_type=content_type,
            filename=filename,
            model=cfg.get("invoice_vision_model"),
            base_url=cfg.get("base_url"),
            api_key=cfg.get("api_key"),
        )

    if ct == "application/pdf":
        # Best-effort PDF text extraction (works for text-based PDFs).
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as f:
            f.write(raw)
            f.flush()
            pdf_text = ""
            try:
                proc = subprocess.run(
                    ["pdftotext", "-layout", f.name, "-"],
                    capture_output=True,
                    timeout=12,
                    check=False,
                )
                pdf_text = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
                if proc.returncode != 0:
                    warnings.append("pdftotext failed (PDF may be image-only).")
                elif not pdf_text:
                    warnings.append("PDF text extraction returned empty text (PDF may be image-only).")
            except FileNotFoundError:
                warnings.append("pdftotext is not installed; PDF import needs poppler-utils.")
            except Exception as ex:
                warnings.append(f"pdftotext failed: {ex}")

            if pdf_text:
                try:
                    return openai_extract_purchase_invoice_from_text(
                        text=pdf_text,
                        filename=filename,
                        model=cfg.get("invoice_text_model"),
                        base_url=cfg.get("base_url"),
                        api_key=cfg.get("api_key"),
                    )
                except Exception as ex:
                    warnings.append(f"Text extraction parse failed: {ex}")

            # Fallback for image-based PDFs: render first page to PNG and run vision extraction.
            try:
                with tempfile.TemporaryDirectory() as td:
                    out_prefix = os.path.join(td, "page1")
                    proc2 = subprocess.run(
                        ["pdftoppm", "-f", "1", "-l", "1", "-png", "-singlefile", f.name, out_prefix],
                        capture_output=True,
                        timeout=15,
                        check=False,
                    )
                    png_path = out_prefix + ".png"
                    if proc2.returncode != 0:
                        warnings.append("pdftoppm failed (cannot render PDF to image).")
                        return None
                    if not os.path.exists(png_path):
                        warnings.append("pdftoppm did not produce an image (unexpected).")
                        return None
                    with open(png_path, "rb") as pf:
                        img_raw = pf.read() or b""
                    if not img_raw:
                        warnings.append("Rendered PDF page image was empty (unexpected).")
                        return None
                    return openai_extract_purchase_invoice_from_image(
                        raw=img_raw,
                        content_type="image/png",
                        filename=filename,
                        model=cfg.get("invoice_vision_model"),
                        base_url=cfg.get("base_url"),
                        api_key=cfg.get("api_key"),
                    )
            except FileNotFoundError:
                warnings.append("pdftoppm is not installed; image-based PDF import needs poppler-utils.")
                return None
            except Exception as ex2:
                warnings.append(f"PDF image fallback failed: {ex2}")
                return None

    warnings.append(f"Unsupported content type for import: {content_type}")
    return None


def apply_extracted_purchase_invoice_to_draft(
    *,
    company_id: str,
    invoice_id: str,
    extracted: dict[str, Any],
    exchange_rate_hint: Optional[Decimal],
    tax_code_id_hint: Optional[str],
    auto_create_supplier: bool,
    auto_create_items: bool,
    cur,
    warnings: list[str],
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    """
    Apply extraction output to an existing draft supplier invoice.
    Mutates the DB via the provided cursor.
    """
    inv = (extracted.get("invoice") or {}) if isinstance(extracted, dict) else {}
    ex = Decimal(str(exchange_rate_hint or 0)) if exchange_rate_hint is not None else Decimal("0")
    if ex <= 0:
        ex = _default_exchange_rate(cur, company_id)
    try:
        ex_ai = Decimal(str(inv.get("exchange_rate") or 0))
        if ex_ai and ex_ai > 0:
            ex = ex_ai
    except Exception:
        pass

    tax_code_id = (tax_code_id_hint or "").strip() or None

    supplier_id = None
    supplier_created = False
    supplier_name = None

    sup = (extracted.get("supplier") or {}) if isinstance(extracted, dict) else {}
    supplier_name = (sup.get("name") or "").strip() or None
    supplier_vat = (sup.get("vat_no") or "").strip() or None

    # Try to match existing supplier by VAT number, then by name.
    if supplier_vat:
        cur.execute(
            "SELECT id FROM suppliers WHERE company_id=%s AND vat_no=%s ORDER BY created_at ASC LIMIT 1",
            (company_id, supplier_vat),
        )
        r = cur.fetchone()
        supplier_id = r["id"] if r else None
    if not supplier_id and supplier_name:
        cur.execute(
            "SELECT id FROM suppliers WHERE company_id=%s AND lower(name)=lower(%s) ORDER BY created_at ASC LIMIT 1",
            (company_id, supplier_name),
        )
        r = cur.fetchone()
        supplier_id = r["id"] if r else None

    if not supplier_id and auto_create_supplier and supplier_name:
        cur.execute(
            """
            INSERT INTO suppliers (id, company_id, name, phone, email, vat_no, payment_terms_days)
            VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, 0)
            RETURNING id
            """,
            (company_id, supplier_name, (sup.get("phone") or "").strip() or None, (sup.get("email") or "").strip() or None, supplier_vat),
        )
        supplier_id = cur.fetchone()["id"]
        supplier_created = True
        cur.execute(
            """
            INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
            VALUES (gen_random_uuid(), %s, %s, 'supplier_create_ai', 'supplier', %s, %s::jsonb)
            """,
            (company_id, user_id, supplier_id, json.dumps({"name": supplier_name, "source": "purchase_invoice_import"})),
        )

    supplier_ref = (inv.get("supplier_ref") or inv.get("invoice_no") or "").strip() or None
    inv_date = None
    due_date = None
    try:
        if inv.get("invoice_date"):
            inv_date = date.fromisoformat(str(inv.get("invoice_date"))[:10])
    except Exception:
        inv_date = None
    try:
        if inv.get("due_date"):
            due_date = date.fromisoformat(str(inv.get("due_date"))[:10])
    except Exception:
        due_date = None
    if not inv_date:
        inv_date = date.today()
    if not due_date:
        due_date = inv_date

    cur.execute(
        """
        UPDATE supplier_invoices
        SET supplier_id = %s,
            supplier_ref = %s,
            exchange_rate = %s,
            invoice_date = %s,
            due_date = %s,
            tax_code_id = COALESCE(%s, tax_code_id)
        WHERE company_id = %s AND id = %s
        """,
        (supplier_id, supplier_ref, ex, inv_date, due_date, tax_code_id, company_id, invoice_id),
    )

    # Insert lines (delete any existing just in case).
    cur.execute("DELETE FROM supplier_invoice_lines WHERE company_id=%s AND supplier_invoice_id=%s", (company_id, invoice_id))

    created_items = 0
    price_changes: list[dict[str, Any]] = []

    for idx, ln in enumerate(extracted.get("lines") or []):
        try:
            qty = Decimal(str(ln.get("qty") or 0))
            unit_price = Decimal(str(ln.get("unit_price") or 0))
        except Exception:
            warnings.append(f"line {idx+1}: invalid qty/unit_price")
            continue
        if qty <= 0 or unit_price <= 0:
            continue

        line_currency = (ln.get("currency") or inv.get("currency") or (extracted.get("totals", {}) or {}).get("currency") or "").strip().upper()
        if line_currency not in {"USD", "LBP"}:
            line_currency = "USD"  # safe default (we keep the raw supplier name/code anyway)

        unit_usd = unit_price if line_currency == "USD" else (unit_price / ex if ex else Decimal("0"))
        unit_lbp = unit_price if line_currency == "LBP" else (unit_price * ex)
        unit_usd, unit_lbp = _normalize_dual_amounts(unit_usd, unit_lbp, ex)
        line_total_usd = qty * unit_usd
        line_total_lbp = qty * unit_lbp

        supplier_item_code = (ln.get("supplier_item_code") or "").strip() or None
        supplier_item_name = (ln.get("supplier_item_name") or "").strip() or None
        ncode = _norm_code(supplier_item_code)
        nname = _norm_name(supplier_item_name)

        item_id = None
        if supplier_id and ncode:
            cur.execute(
                """
                SELECT item_id
                FROM supplier_item_aliases
                WHERE company_id=%s AND supplier_id=%s AND normalized_code=%s
                ORDER BY last_seen_at DESC
                LIMIT 1
                """,
                (company_id, supplier_id, ncode),
            )
            r = cur.fetchone()
            item_id = r["item_id"] if r else None

        if not item_id and supplier_id and nname:
            cur.execute(
                """
                SELECT item_id
                FROM supplier_item_aliases
                WHERE company_id=%s AND supplier_id=%s AND normalized_name=%s
                ORDER BY last_seen_at DESC
                LIMIT 1
                """,
                (company_id, supplier_id, nname),
            )
            r = cur.fetchone()
            item_id = r["item_id"] if r else None

        if not item_id and ncode:
            cur.execute("SELECT id FROM items WHERE company_id=%s AND upper(sku)=upper(%s) LIMIT 1", (company_id, ncode))
            r = cur.fetchone()
            item_id = r["id"] if r else None
            if not item_id:
                cur.execute(
                    "SELECT item_id FROM item_barcodes WHERE company_id=%s AND barcode=%s ORDER BY is_primary DESC LIMIT 1",
                    (company_id, ncode),
                )
                r = cur.fetchone()
                item_id = r["item_id"] if r else None

        if not item_id and nname:
            cur.execute(
                "SELECT id FROM items WHERE company_id=%s AND lower(name) LIKE %s ORDER BY updated_at DESC, created_at DESC LIMIT 1",
                (company_id, f"%{nname}%"),
            )
            r = cur.fetchone()
            item_id = r["id"] if r else None

        if not item_id and auto_create_items:
            sku = None
            if ncode:
                sku = ncode[:64]
                cur.execute("SELECT 1 FROM items WHERE company_id=%s AND upper(sku)=upper(%s) LIMIT 1", (company_id, sku))
                if cur.fetchone():
                    sku = None
            if not sku:
                sku = f"AUTO-{uuid.uuid4().hex[:8].upper()}"
            name = _clean_item_name(supplier_item_name or supplier_item_code or "New Item")
            # Ensure base UOM exists (FK on items.unit_of_measure).
            cur.execute(
                """
                INSERT INTO unit_of_measures (id, company_id, code, name, is_active)
                VALUES (gen_random_uuid(), %s, 'EA', 'EA', true)
                ON CONFLICT (company_id, code) DO UPDATE
                SET is_active = true,
                    updated_at = now()
                """,
                (company_id,),
            )
            cur.execute(
                """
                INSERT INTO items (id, company_id, sku, barcode, name, item_type, tags, unit_of_measure, tax_code_id, reorder_point, reorder_qty, is_active)
                VALUES (gen_random_uuid(), %s, %s, NULL, %s, 'stocked', NULL, 'EA', NULL, 0, 0, true)
                RETURNING id
                """,
                (company_id, sku, name),
            )
            item_id = cur.fetchone()["id"]
            created_items += 1
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'item_create_ai', 'item', %s, %s::jsonb)
                """,
                (company_id, user_id, item_id, json.dumps({"sku": sku, "name": name, "source": "purchase_invoice_import"})),
            )

        if not item_id:
            warnings.append(f"line {idx+1}: could not match/create item")
            continue

        if supplier_id:
            cur.execute(
                """
                SELECT last_cost_usd, last_cost_lbp
                FROM item_suppliers
                WHERE company_id=%s AND supplier_id=%s AND item_id=%s
                LIMIT 1
                """,
                (company_id, supplier_id, item_id),
            )
            prev = cur.fetchone() or {}
            prev_usd = Decimal(str(prev.get("last_cost_usd") or 0))
            prev_lbp = Decimal(str(prev.get("last_cost_lbp") or 0))

            if (prev_usd and prev_usd > 0 and unit_usd and unit_usd > 0 and unit_usd != prev_usd) or (
                prev_lbp and prev_lbp > 0 and unit_lbp and unit_lbp > 0 and unit_lbp != prev_lbp
            ):
                pct = 0
                try:
                    base = prev_usd if prev_usd > 0 else prev_lbp
                    nxt = unit_usd if prev_usd > 0 else unit_lbp
                    if base and base != 0:
                        pct = float((nxt - base) / base)
                except Exception:
                    pct = 0
                price_changes.append(
                    {
                        "item_id": str(item_id),
                        "supplier_id": str(supplier_id),
                        "prev_usd": float(prev_usd),
                        "prev_lbp": float(prev_lbp),
                        "new_usd": float(unit_usd),
                        "new_lbp": float(unit_lbp),
                        "pct": pct,
                    }
                )

            cur.execute(
                """
                INSERT INTO item_suppliers (id, company_id, item_id, supplier_id, is_primary, lead_time_days, min_order_qty, last_cost_usd, last_cost_lbp, last_seen_at)
                VALUES (gen_random_uuid(), %s, %s, %s, false, 0, 0, %s, %s, now())
                ON CONFLICT (company_id, item_id, supplier_id)
                DO UPDATE SET last_cost_usd = EXCLUDED.last_cost_usd,
                              last_cost_lbp = EXCLUDED.last_cost_lbp,
                              last_seen_at = now()
                """,
                (company_id, item_id, supplier_id, unit_usd, unit_lbp),
            )

            # Learned alias table for supplier-side identifiers.
            cur.execute(
                """
                INSERT INTO supplier_item_aliases
                  (id, company_id, supplier_id, item_id, raw_code, raw_name, normalized_code, normalized_name, last_seen_at)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (company_id, supplier_id, item_id, normalized_code, normalized_name)
                DO UPDATE SET raw_code = EXCLUDED.raw_code,
                              raw_name = EXCLUDED.raw_name,
                              last_seen_at = now()
                """,
                (company_id, supplier_id, item_id, supplier_item_code, supplier_item_name, ncode, nname),
            )

        cur.execute(
            """
            INSERT INTO supplier_invoice_lines
              (id, company_id, supplier_invoice_id, item_id, qty,
               unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp,
               supplier_item_code, supplier_item_name)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s,
               %s, %s, %s, %s,
               %s, %s)
            """,
            (
                company_id,
                invoice_id,
                item_id,
                qty,
                unit_usd,
                unit_lbp,
                line_total_usd,
                line_total_lbp,
                supplier_item_code,
                supplier_item_name,
            ),
        )

    # Recompute totals + tax.
    cur.execute(
        """
        SELECT COALESCE(SUM(line_total_usd),0) AS base_usd, COALESCE(SUM(line_total_lbp),0) AS base_lbp
        FROM supplier_invoice_lines
        WHERE company_id = %s AND supplier_invoice_id = %s
        """,
        (company_id, invoice_id),
    )
    sums = cur.fetchone() or {}
    base_usd = Decimal(str(sums.get("base_usd") or 0))
    base_lbp = Decimal(str(sums.get("base_lbp") or 0))

    tax_rate = Decimal("0")
    if tax_code_id:
        cur.execute("SELECT rate FROM tax_codes WHERE company_id=%s AND id=%s", (company_id, tax_code_id))
        r = cur.fetchone()
        if r:
            tax_rate = Decimal(str(r["rate"] or 0))
    tax_lbp = base_lbp * tax_rate
    tax_usd = (tax_lbp / ex) if ex else Decimal("0")
    total_usd = base_usd + tax_usd
    total_lbp = base_lbp + tax_lbp

    cur.execute(
        """
        UPDATE supplier_invoices
        SET total_usd=%s, total_lbp=%s, exchange_rate=%s
        WHERE company_id=%s AND id=%s
        """,
        (total_usd, total_lbp, ex, company_id, invoice_id),
    )

    # Surface price-impact insights as an AI recommendation (optional).
    if price_changes:
        rec_payload = {
            "invoice_id": str(invoice_id),
            "type": "price_impact",
            "changes": price_changes[:50],
        }
        cur.execute(
            """
            INSERT INTO ai_recommendations (id, company_id, agent_code, status, recommendation_json)
            VALUES (gen_random_uuid(), %s, 'AI_PURCHASE_INVOICE_INSIGHTS', 'pending', %s::jsonb)
            """,
            (company_id, json.dumps(rec_payload)),
        )

    cur.execute(
        """
        INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
        VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_import_ai_filled', 'supplier_invoice', %s, %s::jsonb)
        """,
        (
            company_id,
            user_id,
            invoice_id,
            json.dumps(
                {
                    "supplier_id": (str(supplier_id) if supplier_id else None),
                    "supplier_created": supplier_created,
                    "created_items": created_items,
                    "warnings": warnings,
                }
            ),
        ),
    )

    return {
        "supplier_id": supplier_id,
        "supplier_created": supplier_created,
        "created_items": created_items,
        "exchange_rate": str(ex),
    }


def apply_extracted_purchase_invoice_header_to_draft(
    *,
    company_id: str,
    invoice_id: str,
    extracted: dict[str, Any],
    exchange_rate_hint: Optional[Decimal],
    tax_code_id_hint: Optional[str],
    auto_create_supplier: bool,
    cur,
    warnings: list[str],
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    """
    Apply only supplier + header fields from extraction to an existing draft supplier invoice.
    Used by the async import pipeline when we require human review before creating invoice lines.
    """
    inv = (extracted.get("invoice") or {}) if isinstance(extracted, dict) else {}
    ex = Decimal(str(exchange_rate_hint or 0)) if exchange_rate_hint is not None else Decimal("0")
    if ex <= 0:
        ex = _default_exchange_rate(cur, company_id)
    try:
        ex_ai = Decimal(str(inv.get("exchange_rate") or 0))
        if ex_ai and ex_ai > 0:
            ex = ex_ai
    except Exception:
        pass

    tax_code_id = (tax_code_id_hint or "").strip() or None

    supplier_id = None
    supplier_created = False

    sup = (extracted.get("supplier") or {}) if isinstance(extracted, dict) else {}
    supplier_name = (sup.get("name") or "").strip() or None
    supplier_vat = (sup.get("vat_no") or "").strip() or None

    # Try to match existing supplier by VAT number, then by name.
    if supplier_vat:
        cur.execute(
            "SELECT id FROM suppliers WHERE company_id=%s AND vat_no=%s ORDER BY created_at ASC LIMIT 1",
            (company_id, supplier_vat),
        )
        r = cur.fetchone()
        supplier_id = r["id"] if r else None
    if not supplier_id and supplier_name:
        cur.execute(
            "SELECT id FROM suppliers WHERE company_id=%s AND lower(name)=lower(%s) ORDER BY created_at ASC LIMIT 1",
            (company_id, supplier_name),
        )
        r = cur.fetchone()
        supplier_id = r["id"] if r else None

    if not supplier_id and auto_create_supplier and supplier_name:
        cur.execute(
            """
            INSERT INTO suppliers (id, company_id, name, vat_no, is_active, payment_terms_days)
            VALUES (gen_random_uuid(), %s, %s, %s, true, 0)
            RETURNING id
            """,
            (company_id, supplier_name, supplier_vat),
        )
        supplier_id = cur.fetchone()["id"]
        supplier_created = True
        cur.execute(
            """
            INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
            VALUES (gen_random_uuid(), %s, %s, 'supplier_create_ai', 'supplier', %s, %s::jsonb)
            """,
            (company_id, user_id, supplier_id, json.dumps({"name": supplier_name, "vat_no": supplier_vat, "source": "purchase_invoice_import"})),
        )

    supplier_ref = (inv.get("supplier_ref") or inv.get("invoice_no") or "").strip() or None
    if supplier_id and supplier_ref:
        cur.execute(
            """
            SELECT 1
            FROM supplier_invoices
            WHERE company_id=%s AND supplier_id=%s
              AND supplier_ref=%s
              AND status <> 'canceled'
              AND id <> %s
            LIMIT 1
            """,
            (company_id, supplier_id, supplier_ref, invoice_id),
        )
        if cur.fetchone():
            warnings.append("supplier_ref already exists for this supplier; left blank to avoid conflicts.")
            supplier_ref = None

    inv_date = inv.get("invoice_date") or inv.get("date") or None
    due_date = inv.get("due_date") or inv.get("due") or None
    try:
        inv_date = date.fromisoformat(str(inv_date)) if inv_date else date.today()
    except Exception:
        inv_date = date.today()
    try:
        due_date = date.fromisoformat(str(due_date)) if due_date else inv_date
    except Exception:
        due_date = inv_date

    cur.execute(
        """
        UPDATE supplier_invoices
        SET supplier_id = %s,
            supplier_ref = %s,
            exchange_rate = %s,
            invoice_date = %s,
            due_date = %s,
            tax_code_id = COALESCE(%s, tax_code_id)
        WHERE company_id = %s AND id = %s
        """,
        (supplier_id, supplier_ref, ex, inv_date, due_date, tax_code_id, company_id, invoice_id),
    )

    if supplier_created:
        warnings.append("Supplier was auto-created by import (review before posting).")

    return {"ok": True, "supplier_id": supplier_id, "supplier_created": supplier_created, "supplier_ref": supplier_ref, "exchange_rate": ex}


def build_supplier_invoice_import_review_lines(
    *,
    company_id: str,
    supplier_id: Optional[str],
    extracted: dict[str, Any],
    exchange_rate_hint: Optional[Decimal],
    cur,
    warnings: list[str],
) -> list[dict[str, Any]]:
    """
    Convert extraction output into "review lines" (without creating invoice lines).
    Each review line includes computed dual-currency costs and an optional suggested item match.
    """
    inv = (extracted.get("invoice") or {}) if isinstance(extracted, dict) else {}
    ex = Decimal(str(exchange_rate_hint or 0)) if exchange_rate_hint is not None else Decimal("0")
    if ex <= 0:
        ex = _default_exchange_rate(cur, company_id)
    try:
        ex_ai = Decimal(str(inv.get("exchange_rate") or 0))
        if ex_ai and ex_ai > 0:
            ex = ex_ai
    except Exception:
        pass

    out: list[dict[str, Any]] = []
    for idx, ln in enumerate(extracted.get("lines") or []):
        try:
            qty = Decimal(str(ln.get("qty") or 0))
            unit_price = Decimal(str(ln.get("unit_price") or 0))
        except Exception:
            warnings.append(f"line {idx+1}: invalid qty/unit_price")
            continue
        if qty <= 0 or unit_price <= 0:
            continue

        line_currency = (ln.get("currency") or inv.get("currency") or (extracted.get("totals", {}) or {}).get("currency") or "").strip().upper()
        if line_currency not in {"USD", "LBP"}:
            line_currency = "USD"

        unit_usd = unit_price if line_currency == "USD" else (unit_price / ex if ex else Decimal("0"))
        unit_lbp = unit_price if line_currency == "LBP" else (unit_price * ex)
        unit_usd, unit_lbp = _normalize_dual_amounts(unit_usd, unit_lbp, ex)

        supplier_item_code = (ln.get("supplier_item_code") or "").strip() or None
        supplier_item_name = (ln.get("supplier_item_name") or "").strip() or None
        desc = (ln.get("description") or "").strip() or None
        ncode = _norm_code(supplier_item_code)
        nname = _norm_name(supplier_item_name)

        suggested_item_id = None
        confidence = Decimal("0")

        if supplier_id and ncode:
            cur.execute(
                """
                SELECT item_id
                FROM supplier_item_aliases
                WHERE company_id=%s AND supplier_id=%s AND normalized_code=%s
                ORDER BY last_seen_at DESC
                LIMIT 1
                """,
                (company_id, supplier_id, ncode),
            )
            r = cur.fetchone()
            if r:
                suggested_item_id = r["item_id"]
                confidence = Decimal("0.98")

        if not suggested_item_id and supplier_id and nname:
            cur.execute(
                """
                SELECT item_id
                FROM supplier_item_aliases
                WHERE company_id=%s AND supplier_id=%s AND normalized_name=%s
                ORDER BY last_seen_at DESC
                LIMIT 1
                """,
                (company_id, supplier_id, nname),
            )
            r = cur.fetchone()
            if r:
                suggested_item_id = r["item_id"]
                confidence = Decimal("0.92")

        if not suggested_item_id and ncode:
            cur.execute("SELECT id FROM items WHERE company_id=%s AND upper(sku)=upper(%s) LIMIT 1", (company_id, ncode))
            r = cur.fetchone()
            if r:
                suggested_item_id = r["id"]
                confidence = Decimal("0.90")
            else:
                cur.execute(
                    "SELECT item_id FROM item_barcodes WHERE company_id=%s AND barcode=%s ORDER BY is_primary DESC LIMIT 1",
                    (company_id, ncode),
                )
                r = cur.fetchone()
                if r:
                    suggested_item_id = r["item_id"]
                    confidence = Decimal("0.88")

        if not suggested_item_id and nname:
            cur.execute(
                "SELECT id FROM items WHERE company_id=%s AND lower(name) LIKE %s ORDER BY updated_at DESC, created_at DESC LIMIT 1",
                (company_id, f"%{nname}%"),
            )
            r = cur.fetchone()
            if r:
                suggested_item_id = r["id"]
                confidence = Decimal("0.65")

        out.append(
            {
                "line_no": idx + 1,
                "qty": qty,
                "unit_cost_usd": unit_usd,
                "unit_cost_lbp": unit_lbp,
                "supplier_item_code": supplier_item_code,
                "supplier_item_name": supplier_item_name,
                "description": desc,
                "suggested_item_id": suggested_item_id,
                "suggested_confidence": confidence,
                "raw_json": ln,
            }
        )

    return out


def store_attachment_for_invoice(
    *,
    cur,
    company_id: str,
    invoice_id: str,
    raw: bytes,
    filename: str,
    content_type: str,
    user_id: Optional[str],
) -> str:
    sha = hashlib.sha256(raw).hexdigest() if raw else None
    cur.execute(
        """
        INSERT INTO document_attachments
          (id, company_id, entity_type, entity_id, filename, content_type, size_bytes, sha256, bytes, uploaded_by_user_id)
        VALUES
          (gen_random_uuid(), %s, 'supplier_invoice', %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (company_id, invoice_id, filename, content_type, len(raw), sha, raw, user_id),
    )
    return cur.fetchone()["id"]
