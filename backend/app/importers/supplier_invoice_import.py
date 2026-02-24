from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import unicodedata
import uuid
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from ..ai.policy import is_external_ai_allowed
from ..ai.providers import get_ai_provider_config
from ..ai.purchase_invoice_import import (
    openai_extract_purchase_invoice_from_image,
    openai_extract_purchase_invoice_from_images,
    openai_pick_purchase_item_candidate,
    openai_extract_purchase_invoice_from_text,
)

SUPPLIER_NAME_STOPWORDS = {
    "s",
    "sa",
    "sal",
    "sarl",
    "ltd",
    "co",
    "company",
    "group",
    "for",
    "the",
    "and",
    "est",
    "ets",
    "trading",
}

UOM_FALLBACK_PRIORITY = [
    "UNIT",
    "PCS",
    "PIECE",
    "BOX",
    "PACK",
    "CTN",
    "BTL",
    "CAN",
    "BAG",
    "KG",
    "L",
    "EA",
]

UOM_TEXT_HINTS: list[tuple[str, str]] = [
    (r"\b(case|carton|ctn|crate)\b", "BOX"),
    (r"\b(pack|pk|pkg)\b", "PACK"),
    (r"\b(bottle|btl)\b", "BTL"),
    (r"\b(can|tin)\b", "CAN"),
    (r"\b(bag|sack)\b", "BAG"),
    (r"\b(piece|pcs|pc|unit)\b", "UNIT"),
    (r"\b(kg|kilo|kilogram)\b", "KG"),
    (r"\b(l|lt|ltr|liter|litre)\b", "L"),
]


def _norm_code(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = (s or "").strip().upper()
    t = re.sub(r"\s+", "", t)
    t = re.sub(r"[^A-Z0-9._/\-]", "", t)
    return t or None


def _norm_name(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = unicodedata.normalize("NFKD", (s or "").strip())
    # Handle common OCR confusables (e.g., Cyrillic letters in Latin words).
    t = t.translate(
        str.maketrans(
            {
                "\u0430": "a",
                "\u0435": "e",
                "\u043e": "o",
                "\u0440": "p",
                "\u0441": "c",
                "\u0443": "y",
                "\u0445": "x",
                "\u043a": "k",
                "\u043c": "m",
                "\u0442": "t",
                "\u043d": "h",
                "\u0456": "i",
            }
        )
    )
    t = "".join(ch for ch in t if not unicodedata.combining(ch)).lower()
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def _find_supplier_id_by_name(cur, company_id: str, supplier_name: Optional[str]) -> Optional[str]:
    name = (supplier_name or "").strip()
    if not name:
        return None

    # Fast path: exact case-insensitive name.
    cur.execute(
        "SELECT id FROM suppliers WHERE company_id=%s AND lower(name)=lower(%s) ORDER BY created_at ASC LIMIT 1",
        (company_id, name),
    )
    r = cur.fetchone()
    if r:
        return r["id"]

    # OCR-safe path: normalized name match.
    nname = _norm_name(name)
    if not nname:
        return None
    cur.execute("SELECT id, name FROM suppliers WHERE company_id=%s ORDER BY created_at ASC", (company_id,))
    rows = cur.fetchall() or []
    for row in rows:
        if _norm_name(row.get("name")) == nname:
            return row["id"]

    # Containment fallback handles names with added suffixes like "(NEPCO)".
    for row in rows:
        rname = _norm_name(row.get("name")) or ""
        if not rname:
            continue
        if (nname in rname or rname in nname) and min(len(nname), len(rname)) >= 8:
            return row["id"]

    # Token overlap fallback handles punctuation/spacing/abbreviation variations.
    def _tokens(v: str) -> set[str]:
        out = set()
        for t in (v or "").split():
            t = t.strip()
            if not t or t in SUPPLIER_NAME_STOPWORDS or len(t) <= 1:
                continue
            out.add(t)
        return out

    qtok = _tokens(nname)
    best_id = None
    best_score = 0.0
    for row in rows:
        rtok = _tokens(_norm_name(row.get("name")) or "")
        if not qtok or not rtok:
            continue
        inter = len(qtok & rtok)
        if inter < 2:
            continue
        score = inter / max(len(qtok), len(rtok))
        if score > best_score:
            best_score = score
            best_id = row["id"]
    if best_id and best_score >= 0.6:
        return best_id
    return None


def _name_tokens(v: Optional[str]) -> set[str]:
    n = _norm_name(v)
    if not n:
        return set()
    out: set[str] = set()
    for tok in n.split():
        if not tok or len(tok) <= 1 or tok in SUPPLIER_NAME_STOPWORDS:
            continue
        out.add(tok)
    return out


def _name_similarity_score(left: Optional[str], right: Optional[str]) -> Decimal:
    ln = _norm_name(left)
    rn = _norm_name(right)
    if not ln or not rn:
        return Decimal("0")
    if ln == rn:
        return Decimal("0.93")
    if ln in rn or rn in ln:
        short = min(len(ln), len(rn))
        long = max(len(ln), len(rn))
        if short >= 8:
            ratio = Decimal(str(short)) / Decimal(str(long))
            return Decimal("0.88") if ratio >= Decimal("0.55") else Decimal("0.80")
    lt = _name_tokens(ln)
    rt = _name_tokens(rn)
    if not lt or not rt:
        return Decimal("0")
    inter = len(lt & rt)
    if inter == 0:
        return Decimal("0")
    j = Decimal(str(inter)) / Decimal(str(max(len(lt), len(rt))))
    score = Decimal("0.45") + (j * Decimal("0.45"))
    first_left = next(iter(lt), None)
    if first_left and first_left in rt:
        score += Decimal("0.03")
    return min(score, Decimal("0.89"))


def _extract_code_candidates(*texts: Optional[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for txt in texts:
        up = (txt or "").upper()
        if not up:
            continue
        for m in re.finditer(r"\b[A-Z]{1,8}-\d{1,8}\b", up):
            code = _norm_code(m.group(0))
            if code and code not in seen:
                seen.add(code)
                out.append(code)
    return out


def _load_company_uom_codes(cur, company_id: str) -> set[str]:
    cur.execute(
        """
        SELECT code
        FROM unit_of_measures
        WHERE company_id=%s
        """,
        (company_id,),
    )
    return {str(r.get("code") or "").strip().upper() for r in (cur.fetchall() or []) if str(r.get("code") or "").strip()}


def _pick_company_fallback_uom(company_uoms: set[str]) -> str:
    if not company_uoms:
        return "UNIT"
    for c in UOM_FALLBACK_PRIORITY:
        if c in company_uoms:
            return c
    for c in sorted(company_uoms):
        if c != "EA":
            return c
    return "UNIT" if "EA" in company_uoms else sorted(company_uoms)[0]


def _guess_uom_from_text(*texts: Optional[str]) -> Optional[str]:
    merged = " ".join([(t or "") for t in texts]).lower()
    if not merged.strip():
        return None
    for pat, code in UOM_TEXT_HINTS:
        if re.search(pat, merged):
            return code
    return None


def _infer_uom_without_item(
    *,
    supplier_item_name: Optional[str],
    description: Optional[str],
    company_uoms: set[str],
    company_fallback_uom: str,
) -> tuple[str, Decimal, str]:
    guessed = _guess_uom_from_text(supplier_item_name, description)
    if guessed and guessed in company_uoms:
        return (guessed, Decimal("1"), "text_uom_hint")
    return (company_fallback_uom, Decimal("1"), "company_uom_fallback")


def _ensure_uom_exists(cur, company_id: str, uom_code: str):
    code = (uom_code or "").strip().upper() or "EA"
    cur.execute(
        """
        INSERT INTO unit_of_measures (id, company_id, code, name, is_active)
        VALUES (gen_random_uuid(), %s, %s, %s, true)
        ON CONFLICT (company_id, code) DO UPDATE
        SET is_active = true,
            updated_at = now()
        """,
        (company_id, code, code),
    )


def _extract_supplier_fields(sup: dict[str, Any]) -> dict[str, Optional[str]]:
    supplier_name = (sup.get("name") or "").strip() or None
    supplier_vat = (sup.get("vat_no") or "").strip() or None
    supplier_phone = (sup.get("phone") or "").strip() or None
    supplier_email = (sup.get("email") or "").strip() or None
    supplier_address = (sup.get("address") or "").strip() or None
    return {
        "name": supplier_name,
        "vat_no": supplier_vat,
        "phone": supplier_phone,
        "email": supplier_email,
        "address": supplier_address,
    }


def _enrich_supplier_from_extract(
    *,
    cur,
    company_id: str,
    supplier_id: Optional[str],
    sup: dict[str, Any],
):
    if not supplier_id:
        return
    fields = _extract_supplier_fields(sup)
    cur.execute(
        """
        SELECT name, legal_name, vat_no, tax_id, phone, email, notes
        FROM suppliers
        WHERE company_id=%s AND id=%s
        """,
        (company_id, supplier_id),
    )
    row = cur.fetchone() or {}
    updates: dict[str, Optional[str]] = {}
    if fields["name"] and not str(row.get("name") or "").strip():
        updates["name"] = fields["name"]
    if fields["name"] and not str(row.get("legal_name") or "").strip():
        updates["legal_name"] = fields["name"]
    if fields["vat_no"] and not str(row.get("vat_no") or "").strip():
        updates["vat_no"] = fields["vat_no"]
    if fields["vat_no"] and not str(row.get("tax_id") or "").strip():
        updates["tax_id"] = fields["vat_no"]
    if fields["phone"] and not str(row.get("phone") or "").strip():
        updates["phone"] = fields["phone"]
    if fields["email"] and not str(row.get("email") or "").strip():
        updates["email"] = fields["email"]
    if fields["address"]:
        old_notes = str(row.get("notes") or "").strip()
        if not old_notes:
            updates["notes"] = f"Imported address: {fields['address']}"
    if updates:
        set_sql = ", ".join([f"{k}=%s" for k in updates.keys()])
        cur.execute(
            f"""
            UPDATE suppliers
            SET {set_sql}
            WHERE company_id=%s AND id=%s
            """,
            [*updates.values(), company_id, supplier_id],
        )
    if fields["address"]:
        try:
            # Keep a simple default address record so the purchasing team can re-use it.
            cur.execute(
                """
                SELECT id, line1
                FROM party_addresses
                WHERE company_id=%s AND party_kind='supplier' AND party_id=%s
                ORDER BY is_default DESC, created_at ASC
                LIMIT 1
                """,
                (company_id, supplier_id),
            )
            adr = cur.fetchone()
            if not adr:
                cur.execute(
                    """
                    INSERT INTO party_addresses
                      (id, company_id, party_kind, party_id, label, line1, is_default)
                    VALUES
                      (gen_random_uuid(), %s, 'supplier', %s, 'Main', %s, true)
                    """,
                    (company_id, supplier_id, fields["address"]),
                )
            elif not str(adr.get("line1") or "").strip():
                cur.execute(
                    """
                    UPDATE party_addresses
                    SET line1=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (fields["address"], company_id, adr["id"]),
                )
        except Exception:
            # Address enrichment is best-effort and must not block invoice imports.
            pass


def _resolve_or_create_supplier_from_extract(
    *,
    cur,
    company_id: str,
    sup: dict[str, Any],
    auto_create_supplier: bool,
    user_id: Optional[str],
) -> tuple[Optional[str], bool]:
    fields = _extract_supplier_fields(sup)
    supplier_name = fields["name"]
    supplier_vat = fields["vat_no"]

    supplier_id = None
    supplier_created = False
    if supplier_vat:
        cur.execute(
            "SELECT id FROM suppliers WHERE company_id=%s AND vat_no=%s ORDER BY created_at ASC LIMIT 1",
            (company_id, supplier_vat),
        )
        r = cur.fetchone()
        supplier_id = r["id"] if r else None
    if not supplier_id and supplier_name:
        supplier_id = _find_supplier_id_by_name(cur, company_id, supplier_name)

    if not supplier_id and auto_create_supplier and supplier_name:
        cur.execute(
            """
            INSERT INTO suppliers
              (id, company_id, name, legal_name, phone, email, vat_no, tax_id, notes, payment_terms_days, is_active)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, 0, true)
            RETURNING id
            """,
            (
                company_id,
                supplier_name,
                supplier_name,
                fields["phone"],
                fields["email"],
                supplier_vat,
                supplier_vat,
                (f"Imported address: {fields['address']}" if fields["address"] else None),
            ),
        )
        supplier_id = cur.fetchone()["id"]
        supplier_created = True
        cur.execute(
            """
            INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
            VALUES (gen_random_uuid(), %s, %s, 'supplier_create_ai', 'supplier', %s, %s::jsonb)
            """,
            (
                company_id,
                user_id,
                supplier_id,
                json.dumps(
                    {
                        "name": supplier_name,
                        "vat_no": supplier_vat,
                        "phone": fields["phone"],
                        "email": fields["email"],
                        "source": "purchase_invoice_import",
                    }
                ),
            ),
        )

    _enrich_supplier_from_extract(cur=cur, company_id=company_id, supplier_id=supplier_id, sup=sup)
    return supplier_id, supplier_created


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
    return Decimal("89500")


def _normalize_dual_amounts(usd: Decimal, lbp: Decimal, exchange_rate: Decimal) -> tuple[Decimal, Decimal]:
    # Backward compatibility for clients sending only one currency.
    if exchange_rate and exchange_rate != 0:
        if usd == 0 and lbp != 0:
            usd = lbp / exchange_rate
        elif lbp == 0 and usd != 0:
            lbp = usd * exchange_rate
    return usd, lbp


def _to_decimal_optional(v: Any) -> Optional[Decimal]:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    try:
        return Decimal(s)
    except Exception:
        return None


def _doc_amount_to_dual(value: Optional[Decimal], currency: str, exchange_rate: Decimal) -> tuple[Optional[Decimal], Optional[Decimal]]:
    if value is None:
        return (None, None)
    cur = (currency or "").strip().upper()
    if cur == "LBP":
        lbp = value
        usd = (lbp / exchange_rate) if exchange_rate else Decimal("0")
        usd, lbp = _normalize_dual_amounts(usd, lbp, exchange_rate)
        return (usd, lbp)
    # Default to USD if unknown.
    usd = value
    lbp = usd * exchange_rate
    usd, lbp = _normalize_dual_amounts(usd, lbp, exchange_rate)
    return (usd, lbp)


def _resolve_default_vat_tax_code_id_for_import(cur, company_id: str) -> Optional[str]:
    """
    Resolve a sensible default VAT code without creating new tax codes.
    """
    cur.execute(
        """
        SELECT id, rate
        FROM tax_codes
        WHERE company_id = %s AND tax_type = 'vat'
        ORDER BY name
        """,
        (company_id,),
    )
    vat_rows = cur.fetchall() or []
    if not vat_rows:
        return None

    vat_ids = {str(r.get("id")) for r in vat_rows if r.get("id")}
    cur.execute(
        """
        SELECT value_json
        FROM company_settings
        WHERE company_id = %s
          AND key = 'default_vat_tax_code_id'
        LIMIT 1
        """,
        (company_id,),
    )
    conf = cur.fetchone()
    configured = None
    if conf and conf.get("value_json") is not None:
        raw = conf.get("value_json")
        if isinstance(raw, dict):
            configured = str(raw.get("id") or raw.get("tax_code_id") or "").strip() or None
        else:
            configured = str(raw or "").strip() or None
    if configured and configured in vat_ids:
        return configured

    if len(vat_rows) == 1:
        return str(vat_rows[0]["id"])
    return None


def _resolve_tax_code_by_rate(cur, company_id: str, target_rate: Decimal) -> Optional[str]:
    tr = Decimal(str(target_rate or 0))
    if tr <= 0:
        return None
    cur.execute(
        """
        SELECT id, rate, tax_type, name
        FROM tax_codes
        WHERE company_id = %s
        ORDER BY
          CASE WHEN tax_type='vat' THEN 0 ELSE 1 END,
          abs(rate - %s),
          name ASC
        LIMIT 1
        """,
        (company_id, tr),
    )
    row = cur.fetchone()
    if not row:
        return None
    try:
        delta = abs(Decimal(str(row.get("rate") or 0)) - tr)
    except Exception:
        delta = Decimal("1")
    if delta <= Decimal("0.02"):
        return str(row["id"])
    return None


def _resolve_import_tax_code_id(
    *,
    cur,
    company_id: str,
    extracted: dict[str, Any],
    tax_code_id_hint: Optional[str],
    warnings: list[str],
) -> Optional[str]:
    """
    Resolve tax code from extraction signals (totals/lines) using existing codes only.
    """
    hinted = (str(tax_code_id_hint).strip() if tax_code_id_hint is not None else None) or None
    if hinted:
        cur.execute("SELECT id FROM tax_codes WHERE company_id=%s AND id=%s LIMIT 1", (company_id, hinted))
        if cur.fetchone():
            return hinted
        warnings.append("Provided tax_code_id_hint not found; trying automatic tax-code resolution.")

    inv = (extracted.get("invoice") or {}) if isinstance(extracted, dict) else {}
    totals = (extracted.get("totals") or {}) if isinstance(extracted, dict) else {}
    lines = extracted.get("lines") or [] if isinstance(extracted, dict) else []

    tax_doc = _to_decimal_optional((totals or {}).get("tax"))
    subtotal_doc = _to_decimal_optional((totals or {}).get("subtotal"))
    total_doc = _to_decimal_optional((totals or {}).get("total"))
    if subtotal_doc is None and total_doc is not None and tax_doc is not None:
        subtotal_doc = total_doc - tax_doc

    has_tax_signal = bool(tax_doc is not None and abs(tax_doc) > Decimal("0.0001"))
    if not has_tax_signal:
        for ln in lines:
            try:
                qty = Decimal(str((ln or {}).get("qty") or 0))
                unit_price = Decimal(str((ln or {}).get("unit_price") or 0))
            except Exception:
                continue
            line_type = _classify_import_line_type(
                supplier_item_code=((ln or {}).get("supplier_item_code") or "").strip() or None,
                supplier_item_name=((ln or {}).get("supplier_item_name") or "").strip() or None,
                description=((ln or {}).get("description") or "").strip() or None,
                qty=qty,
                unit_price=unit_price,
            )
            if line_type == "tax" and abs(qty * unit_price) > Decimal("0.0001"):
                has_tax_signal = True
                break

    if not has_tax_signal:
        return None

    target_rate: Optional[Decimal] = None
    if subtotal_doc is not None and subtotal_doc != 0 and tax_doc is not None:
        try:
            target_rate = abs(tax_doc / subtotal_doc)
        except Exception:
            target_rate = None

    if target_rate and target_rate > 0:
        match = _resolve_tax_code_by_rate(cur, company_id, target_rate)
        if match:
            return match

    # Lebanon default fallback: if tax exists but we couldn't infer a reliable rate, prefer 11%.
    eleven = _resolve_tax_code_by_rate(cur, company_id, Decimal("0.11"))
    if eleven:
        return eleven

    fallback_vat = _resolve_default_vat_tax_code_id_for_import(cur, company_id)
    if fallback_vat:
        return fallback_vat

    warnings.append("Tax appears present on invoice, but no matching existing tax code was found.")
    return None


def _is_material_import_delta(*, usd: Decimal, lbp: Decimal, currency: str) -> bool:
    """
    Guardrail to avoid adding synthetic adjustment lines for tiny rounding noise.
    """
    cur = (currency or "").strip().upper()
    if cur == "LBP":
        return abs(lbp) >= Decimal("500")
    return abs(usd) >= Decimal("0.03")


def _append_derived_totals_adjustments(
    *,
    out: list[dict[str, Any]],
    extracted: dict[str, Any],
    exchange_rate: Decimal,
    warnings: list[str],
):
    """
    If OCR/vision misses explicit non-item lines (discount/tax), reconcile by totals.
    This keeps invoice math consistent while still exposing a traceable review line.
    """
    if not isinstance(extracted, dict):
        return
    inv = extracted.get("invoice") or {}
    totals = extracted.get("totals") or {}
    if not isinstance(totals, dict):
        return

    totals_currency = str(totals.get("currency") or inv.get("currency") or "USD").strip().upper()
    if totals_currency not in {"USD", "LBP"}:
        totals_currency = "USD"

    subtotal_doc = _to_decimal_optional(totals.get("subtotal"))
    tax_doc = _to_decimal_optional(totals.get("tax"))
    total_doc = _to_decimal_optional(totals.get("total"))
    if subtotal_doc is None and total_doc is not None and tax_doc is not None:
        subtotal_doc = total_doc - tax_doc

    subtotal_doc_usd, subtotal_doc_lbp = _doc_amount_to_dual(subtotal_doc, totals_currency, exchange_rate)
    tax_doc_usd, tax_doc_lbp = _doc_amount_to_dual(tax_doc, totals_currency, exchange_rate)

    if subtotal_doc_usd is None and tax_doc_usd is None:
        return

    current_subtotal_usd = Decimal("0")
    current_subtotal_lbp = Decimal("0")
    current_tax_usd = Decimal("0")
    current_tax_lbp = Decimal("0")
    for ln in out:
        line_type = str(ln.get("line_type") or "item").strip().lower() or "item"
        qty = Decimal(str(ln.get("qty") or 0))
        unit_usd = Decimal(str(ln.get("unit_cost_usd") or 0))
        unit_lbp = Decimal(str(ln.get("unit_cost_lbp") or 0))
        line_total_usd = qty * unit_usd
        line_total_lbp = qty * unit_lbp
        if line_type == "discount":
            line_total_usd = -abs(line_total_usd)
            line_total_lbp = -abs(line_total_lbp)
        if line_type == "tax":
            current_tax_usd += line_total_usd
            current_tax_lbp += line_total_lbp
        else:
            current_subtotal_usd += line_total_usd
            current_subtotal_lbp += line_total_lbp

    next_line_no = (max([int(ln.get("line_no") or 0) for ln in out], default=0) + 1) or 1

    def _append_non_item(line_type: str, amount_usd: Decimal, amount_lbp: Decimal, reason: str, label: str):
        nonlocal next_line_no
        if totals_currency == "LBP":
            entered_lbp = amount_lbp
            entered_usd = (entered_lbp / exchange_rate) if exchange_rate else Decimal("0")
        else:
            entered_usd = amount_usd
            entered_lbp = entered_usd * exchange_rate
        entered_usd, entered_lbp = _normalize_dual_amounts(entered_usd, entered_lbp, exchange_rate)

        if line_type == "discount":
            entered_usd = abs(entered_usd)
            entered_lbp = abs(entered_lbp)

        out.append(
            {
                "line_no": next_line_no,
                "line_type": line_type,
                "qty": Decimal("1"),
                "qty_entered": Decimal("1"),
                "entered_uom_code": None,
                "entered_qty_factor": Decimal("1"),
                "unit_cost_usd": entered_usd,
                "unit_cost_lbp": entered_lbp,
                "unit_cost_entered_usd": entered_usd,
                "unit_cost_entered_lbp": entered_lbp,
                "supplier_item_code": None,
                "supplier_item_name": label,
                "description": label,
                "suggested_item_id": None,
                "suggested_confidence": Decimal("0.97"),
                "suggested_match_reason": f"not_applicable_non_item:{reason}",
                "auto_resolve": False,
                "status": "resolved",
                "raw_json": {
                    "source": "totals_reconciliation",
                    "reason": reason,
                    "totals_currency": totals_currency,
                    "derived_amount_usd": str(amount_usd),
                    "derived_amount_lbp": str(amount_lbp),
                },
            }
        )
        next_line_no += 1

    if subtotal_doc_usd is not None and subtotal_doc_lbp is not None:
        subtotal_diff_usd = subtotal_doc_usd - current_subtotal_usd
        subtotal_diff_lbp = subtotal_doc_lbp - current_subtotal_lbp
        if _is_material_import_delta(usd=subtotal_diff_usd, lbp=subtotal_diff_lbp, currency=totals_currency):
            if subtotal_diff_usd < 0:
                _append_non_item(
                    "discount",
                    abs(subtotal_diff_usd),
                    abs(subtotal_diff_lbp),
                    "derived_totals_subtotal_discount",
                    "Auto-derived discount (from totals)",
                )
            else:
                _append_non_item(
                    "other",
                    subtotal_diff_usd,
                    subtotal_diff_lbp,
                    "derived_totals_subtotal_adjustment",
                    "Auto-derived adjustment (from totals)",
                )
            warnings.append("Totals reconciliation: auto-added subtotal adjustment line.")

    if tax_doc_usd is not None and tax_doc_lbp is not None:
        tax_diff_usd = tax_doc_usd - current_tax_usd
        tax_diff_lbp = tax_doc_lbp - current_tax_lbp
        if _is_material_import_delta(usd=tax_diff_usd, lbp=tax_diff_lbp, currency=totals_currency):
            _append_non_item(
                "tax",
                tax_diff_usd,
                tax_diff_lbp,
                "derived_totals_tax",
                "Auto-derived tax (from totals)",
            )
            warnings.append("Totals reconciliation: auto-added tax line.")


def _fetch_item_uom(cur, company_id: str, item_id: str) -> Optional[str]:
    """
    Best-effort: return the item's base UOM code for persistence on purchasing lines.
    """
    if not item_id:
        return None
    cur.execute(
        """
        SELECT unit_of_measure
        FROM items
        WHERE company_id=%s AND id=%s
        """,
        (company_id, item_id),
    )
    row = cur.fetchone()
    u = (row or {}).get("unit_of_measure")
    return (u.strip().upper() if isinstance(u, str) and u.strip() else None)


NON_ITEM_LINE_PATTERNS: list[tuple[str, str]] = [
    (r"\b(discount|rebate|promo|promotion|allowance)\b", "discount"),
    (r"\b(vat|tax|tva|tvq)\b", "tax"),
    (r"\b(freight|delivery|shipping|transport)\b", "freight"),
    (r"\b(cash|balance|rounding|round off|subtotal|total)\b", "other"),
]


def _classify_import_line_type(
    *,
    supplier_item_code: Optional[str],
    supplier_item_name: Optional[str],
    description: Optional[str],
    qty: Decimal,
    unit_price: Decimal,
) -> str:
    text = " ".join(
        [
            (supplier_item_code or "").strip().lower(),
            (supplier_item_name or "").strip().lower(),
            (description or "").strip().lower(),
        ]
    ).strip()
    if text:
        if re.search(r"\b(free|bonus|foc|gratis|complimentary)\b", text):
            return "free_item"
        for pat, typ in NON_ITEM_LINE_PATTERNS:
            if re.search(pat, text):
                return typ
    if qty > 0 and unit_price == 0:
        return "free_item"
    return "item"


def _extract_pack_count_hint(*texts: str) -> Optional[Decimal]:
    """
    Infer package count from common naming patterns, e.g.:
    - 24x330ml
    - x12
    - *6
    """
    merged = " ".join([(t or "") for t in texts]).lower()
    # Strong forms first.
    patterns = [
        r"(?<!\d)(\d{1,3})\s*[xX\*]\s*\d",   # 24x330ml
        r"\b[xX\*]\s*(\d{1,3})\b",           # x12
        r"\bpack\s*of\s*(\d{1,3})\b",        # pack of 6
    ]
    for pat in patterns:
        m = re.search(pat, merged)
        if not m:
            continue
        try:
            n = Decimal(str(m.group(1)))
            if Decimal("1") < n <= Decimal("240"):
                return n
        except Exception:
            continue
    return None


def _match_item_for_import_line(
    *,
    cur,
    company_id: str,
    supplier_id: Optional[str],
    supplier_item_code: Optional[str],
    supplier_item_name: Optional[str],
) -> tuple[Optional[str], Decimal, str]:
    ncode = _norm_code(supplier_item_code)
    nname = _norm_name(supplier_item_name)

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
            return (r["item_id"], Decimal("0.99"), "alias_code_exact")

    if supplier_id and nname:
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
            return (r["item_id"], Decimal("0.94"), "alias_name_exact")

    codes_to_try: list[str] = []
    if ncode:
        codes_to_try.append(ncode)
    for c in _extract_code_candidates(supplier_item_name):
        if c not in codes_to_try:
            codes_to_try.append(c)
    for code in codes_to_try:
        cur.execute("SELECT id FROM items WHERE company_id=%s AND upper(sku)=upper(%s) LIMIT 1", (company_id, code))
        r = cur.fetchone()
        if r:
            reason = "sku_exact" if code == ncode else "sku_code_from_name"
            return (r["id"], Decimal("0.92"), reason)
        cur.execute(
            "SELECT item_id FROM item_barcodes WHERE company_id=%s AND barcode=%s ORDER BY is_primary DESC LIMIT 1",
            (company_id, code),
        )
        r = cur.fetchone()
        if r:
            reason = "barcode_exact" if code == ncode else "barcode_code_from_name"
            return (r["item_id"], Decimal("0.90"), reason)

    if nname:
        # First pass: if the item is already linked to this supplier, prefer that candidate pool.
        if supplier_id:
            cur.execute(
                """
                SELECT i.id, i.sku, i.name
                FROM item_suppliers sp
                JOIN items i
                  ON i.company_id = sp.company_id AND i.id = sp.item_id
                WHERE sp.company_id=%s
                  AND sp.supplier_id=%s
                ORDER BY sp.last_seen_at DESC NULLS LAST, i.updated_at DESC, i.created_at DESC
                LIMIT 400
                """,
                (company_id, supplier_id),
            )
            linked_rows = cur.fetchall() or []
            best: Optional[tuple[str, Decimal]] = None
            for row in linked_rows:
                score = _name_similarity_score(nname, row.get("name"))
                if best is None or score > best[1]:
                    best = (str(row["id"]), score)
            if best and best[1] >= Decimal("0.64"):
                conf = min(Decimal("0.89"), max(Decimal("0.68"), best[1] + Decimal("0.06")))
                return (best[0], conf, "supplier_linked_name_fuzzy")

        # Second pass: global fuzzy by name.
        cur.execute(
            """
            SELECT id, sku, name
            FROM items
            WHERE company_id=%s
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1200
            """,
            (company_id,),
        )
        all_rows = cur.fetchall() or []
        best_global: Optional[tuple[str, Decimal, str]] = None
        for row in all_rows:
            score = _name_similarity_score(nname, row.get("name"))
            if best_global is None or score > best_global[1]:
                best_global = (str(row["id"]), score, str(row.get("name") or ""))
        if best_global and best_global[1] >= Decimal("0.72"):
            conf = min(Decimal("0.84"), max(Decimal("0.70"), best_global[1]))
            return (best_global[0], conf, "name_fuzzy")
        # Secondary lane: keep suggestions visible for review when OCR noise lowers scores.
        # This does NOT auto-resolve lines; it only proposes a candidate.
        if best_global and best_global[1] >= Decimal("0.58"):
            qtok = _name_tokens(nname)
            ctok = _name_tokens(best_global[2])
            if len(qtok & ctok) >= 2:
                conf = min(Decimal("0.74"), max(Decimal("0.60"), best_global[1] + Decimal("0.04")))
                return (best_global[0], conf, "name_fuzzy_loose")

        cur.execute(
            "SELECT id FROM items WHERE company_id=%s AND lower(name) LIKE %s ORDER BY updated_at DESC, created_at DESC LIMIT 1",
            (company_id, f"%{nname}%"),
        )
        r = cur.fetchone()
        if r:
            return (r["id"], Decimal("0.65"), "name_like")

    return (None, Decimal("0"), "no_match")


def _list_item_match_candidates_for_ai(
    *,
    cur,
    company_id: str,
    supplier_id: Optional[str],
    supplier_item_code: Optional[str],
    supplier_item_name: Optional[str],
    limit: int = 20,
) -> list[dict[str, Any]]:
    """
    Build a conservative shortlist for semantic AI reranking.
    """
    limit = max(5, min(int(limit or 20), 40))
    ncode = _norm_code(supplier_item_code)
    nname = _norm_name(supplier_item_name)
    out: dict[str, dict[str, Any]] = {}
    if supplier_id:
        sp_join = """
            LEFT JOIN item_suppliers sp
              ON sp.company_id = i.company_id AND sp.item_id = i.id AND sp.supplier_id = %s
        """
    else:
        sp_join = """
            LEFT JOIN item_suppliers sp
              ON 1 = 0
        """

    def _upsert(row: dict[str, Any], base_score: Decimal, source: str):
        item_id = str(row.get("id") or "").strip()
        if not item_id:
            return
        prev = out.get(item_id)
        if prev and Decimal(str(prev.get("_score") or 0)) >= base_score:
            return
        out[item_id] = {
            "id": item_id,
            "sku": row.get("sku"),
            "name": row.get("name"),
            "base_uom": row.get("unit_of_measure"),
            "purchase_uom": row.get("purchase_uom_code"),
            "last_cost_usd": row.get("last_cost_usd"),
            "last_cost_lbp": row.get("last_cost_lbp"),
            "source": source,
            "_score": base_score,
        }

    if supplier_id and ncode:
        cur.execute(
            """
            SELECT i.id, i.sku, i.name, i.unit_of_measure, i.purchase_uom_code,
                   sp.last_cost_usd, sp.last_cost_lbp
            FROM supplier_item_aliases a
            JOIN items i
              ON i.company_id = a.company_id AND i.id = a.item_id
            LEFT JOIN item_suppliers sp
              ON sp.company_id = i.company_id AND sp.item_id = i.id AND sp.supplier_id = %s
            WHERE a.company_id=%s
              AND a.supplier_id=%s
              AND a.normalized_code=%s
            ORDER BY a.last_seen_at DESC
            LIMIT 25
            """,
            (supplier_id, company_id, supplier_id, ncode),
        )
        for r in (cur.fetchall() or []):
            _upsert(r, Decimal("0.99"), "alias_code_exact")

    if ncode:
        sql = f"""
            SELECT i.id, i.sku, i.name, i.unit_of_measure, i.purchase_uom_code,
                   sp.last_cost_usd, sp.last_cost_lbp
            FROM items i
            {sp_join}
            WHERE i.company_id=%s
              AND upper(i.sku)=upper(%s)
            LIMIT 10
        """
        params: list[Any] = [supplier_id] if supplier_id else []
        params.extend([company_id, ncode])
        cur.execute(sql, params)
        for r in (cur.fetchall() or []):
            _upsert(r, Decimal("0.95"), "sku_exact")
        sql = f"""
            SELECT i.id, i.sku, i.name, i.unit_of_measure, i.purchase_uom_code,
                   sp.last_cost_usd, sp.last_cost_lbp
            FROM item_barcodes b
            JOIN items i
              ON i.company_id = b.company_id AND i.id = b.item_id
            {sp_join}
            WHERE b.company_id=%s
              AND b.barcode=%s
            LIMIT 10
        """
        params = [supplier_id] if supplier_id else []
        params.extend([company_id, ncode])
        cur.execute(sql, params)
        for r in (cur.fetchall() or []):
            _upsert(r, Decimal("0.93"), "barcode_exact")

    if supplier_id:
        cur.execute(
            """
            SELECT i.id, i.sku, i.name, i.unit_of_measure, i.purchase_uom_code,
                   sp.last_cost_usd, sp.last_cost_lbp
            FROM item_suppliers sp
            JOIN items i
              ON i.company_id = sp.company_id AND i.id = sp.item_id
            WHERE sp.company_id=%s
              AND sp.supplier_id=%s
            ORDER BY sp.last_seen_at DESC NULLS LAST, i.updated_at DESC
            LIMIT 250
            """,
            (company_id, supplier_id),
        )
        rows = cur.fetchall() or []
        for r in rows:
            if not nname:
                _upsert(r, Decimal("0.62"), "supplier_recent")
                continue
            score = _name_similarity_score(nname, r.get("name"))
            if score >= Decimal("0.40"):
                _upsert(r, min(Decimal("0.92"), Decimal("0.50") + score), "supplier_name_fuzzy")

    if nname:
        first_token = next((t for t in nname.split() if len(t) >= 3), None)
        if first_token:
            sql = f"""
                SELECT i.id, i.sku, i.name, i.unit_of_measure, i.purchase_uom_code,
                       sp.last_cost_usd, sp.last_cost_lbp
                FROM items i
                {sp_join}
                WHERE i.company_id=%s
                  AND lower(i.name) LIKE %s
                ORDER BY i.updated_at DESC, i.created_at DESC
                LIMIT 350
            """
            params = [supplier_id] if supplier_id else []
            params.extend([company_id, f"%{first_token}%"])
            cur.execute(sql, params)
            for r in (cur.fetchall() or []):
                score = _name_similarity_score(nname, r.get("name"))
                if score >= Decimal("0.52"):
                    _upsert(r, min(Decimal("0.88"), Decimal("0.45") + score), "global_name_fuzzy")

    ranked = sorted(out.values(), key=lambda x: (Decimal(str(x.get("_score") or 0)), str(x.get("name") or "")), reverse=True)
    trimmed = []
    for c in ranked[:limit]:
        c = dict(c)
        c.pop("_score", None)
        trimmed.append(c)
    return trimmed


def _ai_pick_item_for_import_line(
    *,
    cur,
    company_id: str,
    supplier_id: Optional[str],
    supplier_item_code: Optional[str],
    supplier_item_name: Optional[str],
    description: Optional[str],
    qty: Decimal,
    unit_price_entered_usd: Decimal,
    unit_price_entered_lbp: Decimal,
    exchange_rate: Decimal,
    ai_cfg: Optional[dict[str, Any]],
) -> tuple[Optional[str], Decimal, str, Optional[str]]:
    """
    Semantic rerank against a strict candidate shortlist.
    Returns: (item_id, confidence, reason, preferred_entered_uom_code)
    """
    if not ai_cfg or not ai_cfg.get("api_key"):
        return (None, Decimal("0"), "ai_not_configured", None)
    cands = _list_item_match_candidates_for_ai(
        cur=cur,
        company_id=company_id,
        supplier_id=supplier_id,
        supplier_item_code=supplier_item_code,
        supplier_item_name=supplier_item_name,
    )
    if not cands:
        return (None, Decimal("0"), "ai_no_candidates", None)
    payload_line = {
        "supplier_item_code": supplier_item_code,
        "supplier_item_name": supplier_item_name,
        "description": description,
        "qty": float(qty),
        "unit_price_entered_usd": float(unit_price_entered_usd),
        "unit_price_entered_lbp": float(unit_price_entered_lbp),
        "exchange_rate": float(exchange_rate or 0),
    }
    pick = openai_pick_purchase_item_candidate(
        line=payload_line,
        candidates=cands,
        model=(ai_cfg.get("invoice_match_model") or ai_cfg.get("invoice_text_model") or ai_cfg.get("default_model")),
        base_url=ai_cfg.get("base_url"),
        api_key=ai_cfg.get("api_key"),
    )
    picked = str(pick.get("candidate_item_id") or "").strip() or None
    if not picked:
        return (None, Decimal(str(pick.get("confidence") or 0)), "ai_no_safe_pick", None)
    conf = Decimal(str(pick.get("confidence") or 0))
    if conf < 0:
        conf = Decimal("0")
    if conf > 1:
        conf = Decimal("1")
    reason = str(pick.get("reason") or "").strip() or "ai_candidate_pick"
    reason = re.sub(r"\s+", " ", reason)[:140]
    entered_uom = str(pick.get("entered_uom_code") or "").strip().upper() or None
    return (picked, conf, f"ai_candidate:{reason}", entered_uom)


def _infer_item_purchase_uom_hint(
    *,
    cur,
    company_id: str,
    item_id: Optional[str],
    supplier_item_name: Optional[str],
    description: Optional[str],
) -> tuple[Optional[str], Decimal, str]:
    if not item_id:
        return (None, Decimal("1"), "no_item")

    cur.execute(
        """
        SELECT unit_of_measure, purchase_uom_code
        FROM items
        WHERE company_id=%s AND id=%s
        """,
        (company_id, item_id),
    )
    it = cur.fetchone() or {}
    base_uom = str(it.get("unit_of_measure") or "").strip().upper() or None
    purchase_uom = str(it.get("purchase_uom_code") or "").strip().upper() or None

    cur.execute(
        """
        SELECT uom_code, to_base_factor
        FROM item_uom_conversions
        WHERE company_id=%s AND item_id=%s AND is_active=true
        """,
        (company_id, item_id),
    )
    conv_rows = cur.fetchall() or []
    factor_by_uom: dict[str, Decimal] = {}
    for r in conv_rows:
        u = str(r.get("uom_code") or "").strip().upper()
        if not u:
            continue
        try:
            f = Decimal(str(r.get("to_base_factor") or 0))
        except Exception:
            f = Decimal("0")
        if f > 0:
            factor_by_uom[u] = f
    if base_uom and base_uom not in factor_by_uom:
        factor_by_uom[base_uom] = Decimal("1")

    pack = _extract_pack_count_hint(supplier_item_name or "", description or "")
    if pack and factor_by_uom:
        for u, f in factor_by_uom.items():
            if abs(f - pack) <= Decimal("0.000001"):
                return (u, f, "pack_count_match")

    if purchase_uom and purchase_uom in factor_by_uom:
        return (purchase_uom, factor_by_uom[purchase_uom], "item_purchase_uom_default")

    if base_uom:
        return (base_uom, factor_by_uom.get(base_uom, Decimal("1")), "item_base_uom_default")

    # Last fallback: any known active conversion.
    if factor_by_uom:
        preferred = _pick_company_fallback_uom(set(factor_by_uom.keys()))
        if preferred in factor_by_uom:
            return (preferred, factor_by_uom[preferred], "item_uom_hierarchy_default")
        u, f = next(iter(factor_by_uom.items()))
        return (u, f, "first_active_conversion")

    return (None, Decimal("1"), "no_conversion")


def _upsert_supplier_alias(
    *,
    cur,
    company_id: str,
    supplier_id: str,
    item_id: str,
    supplier_item_code: Optional[str],
    supplier_item_name: Optional[str],
):
    ncode = _norm_code(supplier_item_code)
    nname = _norm_name(supplier_item_name)
    if ncode:
        cur.execute(
            """
            INSERT INTO supplier_item_aliases
              (id, company_id, supplier_id, item_id, supplier_item_code, supplier_item_name, normalized_code, normalized_name, last_seen_at)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (company_id, supplier_id, normalized_code)
              WHERE normalized_code IS NOT NULL AND normalized_code <> ''
            DO UPDATE SET item_id = EXCLUDED.item_id,
                          supplier_item_code = EXCLUDED.supplier_item_code,
                          supplier_item_name = EXCLUDED.supplier_item_name,
                          normalized_name = COALESCE(EXCLUDED.normalized_name, supplier_item_aliases.normalized_name),
                          last_seen_at = now()
            """,
            (company_id, supplier_id, item_id, supplier_item_code, supplier_item_name, ncode, nname),
        )
        return
    if not nname:
        return
    cur.execute(
        """
        UPDATE supplier_item_aliases
        SET item_id=%s,
            supplier_item_name=%s,
            last_seen_at=now()
        WHERE company_id=%s
          AND supplier_id=%s
          AND item_id=%s
          AND normalized_name=%s
        """,
        (item_id, supplier_item_name, company_id, supplier_id, item_id, nname),
    )
    if cur.rowcount == 0:
        cur.execute(
            """
            INSERT INTO supplier_item_aliases
              (id, company_id, supplier_id, item_id, supplier_item_code, supplier_item_name, normalized_code, normalized_name, last_seen_at)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, NULL, %s, now())
            """,
            (company_id, supplier_id, item_id, supplier_item_code, supplier_item_name, nname),
        )


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
    return extract_purchase_invoice_best_effort_from_files(
        files=[{"raw": raw, "content_type": content_type, "filename": filename}],
        company_id=company_id,
        cur=cur,
        warnings=warnings,
        force_mock=force_mock,
    )


def extract_purchase_invoice_best_effort_from_files(
    *,
    files: list[dict[str, Any]],
    company_id: str,
    cur,
    warnings: list[str],
    force_mock: bool = False,
) -> dict[str, Any] | None:
    """
    Best-effort extraction from one or more files in the same invoice packet.
    File entries should contain: raw (bytes), content_type (str), filename (str).
    """
    file_list = [f for f in (files or []) if (f.get("raw") or b"")]
    first_name = str((file_list[0].get("filename") if file_list else "") or "purchase-invoice")
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
                    "supplier_item_name": _clean_item_name(f"Imported ({first_name})"),
                    "description": f"Mock import line from {first_name}",
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

    def _postprocess_extracted(extracted: dict[str, Any] | None) -> dict[str, Any] | None:
        if not isinstance(extracted, dict):
            return extracted
        doc_type = str(extracted.get("document_type") or "").strip().lower()
        conf = _to_decimal_optional(extracted.get("document_confidence"))
        if doc_type and doc_type not in {"purchase_invoice", "supplier_invoice", "invoice"}:
            if conf is not None and conf >= Decimal("0.75"):
                warnings.append(f"AI doc-type flag: '{doc_type}' (confidence {conf}); review carefully before apply.")
            else:
                warnings.append(f"AI doc-type hint: '{doc_type}' (low confidence).")
        return extracted

    image_inputs: list[dict[str, Any]] = []
    text_parts: list[str] = []
    max_pdf_pages = max(1, min(int(os.environ.get("AI_IMPORT_MAX_PDF_PAGES", "4") or 4), 12))
    pdf_render_dpi = max(120, min(int(os.environ.get("AI_IMPORT_PDF_RENDER_DPI", "180") or 180), 320))
    pdf_jpeg_quality = max(65, min(int(os.environ.get("AI_IMPORT_PDF_JPEG_QUALITY", "90") or 90), 98))

    for fobj in file_list:
        raw = fobj.get("raw") or b""
        content_type = str(fobj.get("content_type") or "application/octet-stream")
        filename = str(fobj.get("filename") or "purchase-invoice")
        ct = content_type.strip().lower()
        if ct.startswith("image/"):
            image_inputs.append({"raw": raw, "content_type": content_type, "filename": filename})
            continue
        if ct != "application/pdf":
            warnings.append(f"Unsupported content type for import: {content_type}")
            continue

        # Best-effort PDF text extraction (works for text-based PDFs).
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tf:
            tf.write(raw)
            tf.flush()
            try:
                proc = subprocess.run(
                    ["pdftotext", "-layout", tf.name, "-"],
                    capture_output=True,
                    timeout=18,
                    check=False,
                )
                pdf_text = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
                if proc.returncode != 0:
                    warnings.append(f"pdftotext failed for {filename} (PDF may be image-only).")
                elif pdf_text:
                    text_parts.append(pdf_text)
            except FileNotFoundError:
                warnings.append("pdftotext is not installed; PDF text import needs poppler-utils.")
            except Exception as ex:
                warnings.append(f"pdftotext failed for {filename}: {ex}")

            # For image PDFs, render a bounded number of pages and feed them as images.
            try:
                with tempfile.TemporaryDirectory() as td:
                    out_prefix = os.path.join(td, "page")
                    proc2 = subprocess.run(
                        [
                            "pdftoppm",
                            "-r",
                            str(pdf_render_dpi),
                            "-f",
                            "1",
                            "-l",
                            str(max_pdf_pages),
                            "-jpeg",
                            "-jpegopt",
                            f"quality={pdf_jpeg_quality}",
                            tf.name,
                            out_prefix,
                        ],
                        capture_output=True,
                        timeout=max(20, 8 * max_pdf_pages),
                        check=False,
                    )
                    if proc2.returncode == 0:
                        for i in range(1, max_pdf_pages + 1):
                            p = os.path.join(td, f"page-{i}.jpg")
                            if not os.path.exists(p):
                                break
                            with open(p, "rb") as pf:
                                pr = pf.read() or b""
                            if pr:
                                image_inputs.append(
                                    {
                                        "raw": pr,
                                        "content_type": "image/jpeg",
                                        "filename": f"{filename}#p{i}",
                                    }
                                )
                    else:
                        warnings.append(f"pdftoppm failed for {filename} (cannot render PDF pages).")
            except FileNotFoundError:
                warnings.append("pdftoppm is not installed; image-based PDF import needs poppler-utils.")
            except Exception as ex2:
                warnings.append(f"PDF page render failed for {filename}: {ex2}")

    if image_inputs:
        try:
            if len(image_inputs) == 1:
                one = image_inputs[0]
                extracted = openai_extract_purchase_invoice_from_image(
                    raw=one["raw"],
                    content_type=one["content_type"],
                    filename=str(one.get("filename") or first_name),
                    model=cfg.get("invoice_vision_model"),
                    base_url=cfg.get("base_url"),
                    api_key=cfg.get("api_key"),
                )
                return _postprocess_extracted(extracted)
            extracted = openai_extract_purchase_invoice_from_images(
                images=image_inputs,
                filename_hint=first_name,
                model=cfg.get("invoice_vision_model"),
                base_url=cfg.get("base_url"),
                api_key=cfg.get("api_key"),
            )
            return _postprocess_extracted(extracted)
        except Exception as ex:
            warnings.append(f"Vision extraction failed: {ex}")

    if text_parts:
        try:
            extracted = openai_extract_purchase_invoice_from_text(
                text="\n\n".join(text_parts),
                filename=first_name,
                model=cfg.get("invoice_text_model"),
                base_url=cfg.get("base_url"),
                api_key=cfg.get("api_key"),
            )
            return _postprocess_extracted(extracted)
        except Exception as ex:
            warnings.append(f"Text extraction parse failed: {ex}")

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

    tax_code_id = _resolve_import_tax_code_id(
        cur=cur,
        company_id=company_id,
        extracted=extracted,
        tax_code_id_hint=tax_code_id_hint,
        warnings=warnings,
    )

    sup = (extracted.get("supplier") or {}) if isinstance(extracted, dict) else {}
    supplier_id, supplier_created = _resolve_or_create_supplier_from_extract(
        cur=cur,
        company_id=company_id,
        sup=sup if isinstance(sup, dict) else {},
        auto_create_supplier=auto_create_supplier,
        user_id=user_id,
    )

    supplier_ref = (inv.get("supplier_ref") or inv.get("invoice_no") or "").strip() or None
    cur.execute(
        """
        SELECT supplier_id, supplier_ref
        FROM supplier_invoices
        WHERE company_id=%s AND id=%s
        LIMIT 1
        """,
        (company_id, invoice_id),
    )
    prev = cur.fetchone() or {}
    existing_supplier_id = str(prev.get("supplier_id") or "").strip() or None
    existing_supplier_ref = str(prev.get("supplier_ref") or "").strip() or None
    if not supplier_id and existing_supplier_id:
        supplier_id = existing_supplier_id
        warnings.append("supplier kept from existing draft (extract supplier unresolved).")
    if existing_supplier_ref:
        if supplier_ref and supplier_ref != existing_supplier_ref:
            warnings.append("supplier_ref kept from existing draft (extracted ref differed).")
        supplier_ref = existing_supplier_ref
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
    company_uoms = _load_company_uom_codes(cur, company_id)
    company_fallback_uom = _pick_company_fallback_uom(company_uoms)
    ai_cfg: Optional[dict[str, Any]] = None
    ai_match_budget = 0
    try:
        if is_external_ai_allowed(cur, company_id):
            ai_cfg = get_ai_provider_config(cur, company_id)
            if ai_cfg.get("api_key"):
                ai_match_budget = max(0, min(int(os.environ.get("AI_IMPORT_SEMANTIC_MATCH_BUDGET", "20") or 20), 50))
    except Exception:
        ai_cfg = None
        ai_match_budget = 0

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

        supplier_item_code = (ln.get("supplier_item_code") or "").strip() or None
        supplier_item_name = (ln.get("supplier_item_name") or "").strip() or None
        ncode = _norm_code(supplier_item_code)
        item_id, _, _ = _match_item_for_import_line(
            cur=cur,
            company_id=company_id,
            supplier_id=str(supplier_id) if supplier_id else None,
            supplier_item_code=supplier_item_code,
            supplier_item_name=supplier_item_name,
        )

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
            base_uom = _pick_company_fallback_uom(company_uoms)
            _ensure_uom_exists(cur, company_id, base_uom)
            company_uoms.add(base_uom)
            cur.execute(
                """
                INSERT INTO items (id, company_id, sku, barcode, name, item_type, tags, unit_of_measure, tax_code_id, reorder_point, reorder_qty, is_active)
                VALUES (gen_random_uuid(), %s, %s, NULL, %s, 'stocked', NULL, %s, NULL, 0, 0, true)
                RETURNING id
                """,
                (company_id, sku, name, base_uom),
            )
            item_id = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
                VALUES (gen_random_uuid(), %s, %s, %s, 1, true)
                ON CONFLICT (company_id, item_id, uom_code) DO UPDATE
                SET is_active=true,
                    to_base_factor=1,
                    updated_at=now()
                """,
                (company_id, item_id, base_uom),
            )
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

        entered_uom_code, entered_qty_factor, _ = _infer_item_purchase_uom_hint(
            cur=cur,
            company_id=company_id,
            item_id=str(item_id),
            supplier_item_name=supplier_item_name,
            description=(ln.get("description") or "").strip() or None,
        )
        if not entered_uom_code:
            entered_uom_code, entered_qty_factor, _ = _infer_uom_without_item(
                supplier_item_name=supplier_item_name,
                description=(ln.get("description") or "").strip() or None,
                company_uoms=company_uoms,
                company_fallback_uom=company_fallback_uom,
            )
        if entered_qty_factor <= 0:
            entered_qty_factor = Decimal("1")
        qty_base = qty * entered_qty_factor
        unit_entered_usd = unit_usd
        unit_entered_lbp = unit_lbp
        unit_usd = unit_entered_usd / entered_qty_factor
        unit_lbp = unit_entered_lbp / entered_qty_factor
        unit_usd, unit_lbp = _normalize_dual_amounts(unit_usd, unit_lbp, ex)
        line_total_usd = qty_base * unit_usd
        line_total_lbp = qty_base * unit_lbp

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

            _upsert_supplier_alias(
                cur=cur,
                company_id=company_id,
                supplier_id=str(supplier_id),
                item_id=str(item_id),
                supplier_item_code=supplier_item_code,
                supplier_item_name=supplier_item_name,
            )

        cur.execute(
            """
            INSERT INTO supplier_invoice_lines
              (id, company_id, supplier_invoice_id, item_id, qty,
               uom, qty_factor, qty_entered,
               unit_cost_usd, unit_cost_lbp, unit_cost_entered_usd, unit_cost_entered_lbp,
               line_total_usd, line_total_lbp,
               supplier_item_code, supplier_item_name)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s,
               %s, %s, %s,
               %s, %s, %s, %s,
               %s, %s,
               %s, %s)
            """,
            (
                # Store a concrete UOM for future UX/auditability.
                company_id,
                invoice_id,
                item_id,
                qty_base,
                entered_uom_code or _fetch_item_uom(cur, company_id, item_id),
                entered_qty_factor,
                qty,
                unit_usd,
                unit_lbp,
                unit_entered_usd,
                unit_entered_lbp,
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

    tax_code_id = _resolve_import_tax_code_id(
        cur=cur,
        company_id=company_id,
        extracted=extracted,
        tax_code_id_hint=tax_code_id_hint,
        warnings=warnings,
    )

    sup = (extracted.get("supplier") or {}) if isinstance(extracted, dict) else {}
    supplier_id, supplier_created = _resolve_or_create_supplier_from_extract(
        cur=cur,
        company_id=company_id,
        sup=sup if isinstance(sup, dict) else {},
        auto_create_supplier=auto_create_supplier,
        user_id=user_id,
    )

    supplier_ref = (inv.get("supplier_ref") or inv.get("invoice_no") or "").strip() or None
    cur.execute(
        """
        SELECT supplier_id, supplier_ref
        FROM supplier_invoices
        WHERE company_id=%s AND id=%s
        LIMIT 1
        """,
        (company_id, invoice_id),
    )
    prev = cur.fetchone() or {}
    existing_supplier_id = str(prev.get("supplier_id") or "").strip() or None
    existing_supplier_ref = str(prev.get("supplier_ref") or "").strip() or None
    if not supplier_id and existing_supplier_id:
        supplier_id = existing_supplier_id
        warnings.append("supplier kept from existing draft (extract supplier unresolved).")
    if existing_supplier_ref:
        if supplier_ref and supplier_ref != existing_supplier_ref:
            warnings.append("supplier_ref kept from existing draft (extracted ref differed).")
        supplier_ref = existing_supplier_ref
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

    company_uoms = _load_company_uom_codes(cur, company_id)
    company_fallback_uom = _pick_company_fallback_uom(company_uoms)
    ai_cfg: Optional[dict[str, Any]] = None
    ai_match_budget = 0
    try:
        if is_external_ai_allowed(cur, company_id):
            ai_cfg = get_ai_provider_config(cur, company_id)
            if ai_cfg.get("api_key"):
                ai_match_budget = max(0, min(int(os.environ.get("AI_IMPORT_SEMANTIC_MATCH_BUDGET", "20") or 20), 50))
    except Exception:
        ai_cfg = None
        ai_match_budget = 0

    out: list[dict[str, Any]] = []
    for idx, ln in enumerate(extracted.get("lines") or []):
        try:
            qty_entered = Decimal(str(ln.get("qty") or 0))
        except Exception:
            warnings.append(f"line {idx+1}: invalid qty")
            continue
        try:
            unit_price_entered = Decimal(str(ln.get("unit_price") or 0))
        except Exception:
            warnings.append(f"line {idx+1}: invalid unit_price")
            continue

        supplier_item_code = (ln.get("supplier_item_code") or "").strip() or None
        supplier_item_name = (ln.get("supplier_item_name") or "").strip() or None
        desc = (ln.get("description") or "").strip() or None

        line_type = _classify_import_line_type(
            supplier_item_code=supplier_item_code,
            supplier_item_name=supplier_item_name,
            description=desc,
            qty=qty_entered,
            unit_price=unit_price_entered,
        )

        # Keep non-item lines visible for accounting review, even with qty=0.
        if qty_entered <= 0:
            if line_type in {"discount", "tax", "freight", "other"} and unit_price_entered != 0:
                qty_entered = Decimal("1")
            else:
                continue

        # For item lines, negative costs usually indicate malformed extraction.
        if line_type in {"item", "free_item"} and unit_price_entered < 0:
            warnings.append(f"line {idx+1}: negative unit price ignored")
            continue

        line_currency = (ln.get("currency") or inv.get("currency") or (extracted.get("totals", {}) or {}).get("currency") or "").strip().upper()
        if line_currency not in {"USD", "LBP"}:
            line_currency = "USD"

        unit_entered_usd = unit_price_entered if line_currency == "USD" else (unit_price_entered / ex if ex else Decimal("0"))
        unit_entered_lbp = unit_price_entered if line_currency == "LBP" else (unit_price_entered * ex)
        unit_entered_usd, unit_entered_lbp = _normalize_dual_amounts(unit_entered_usd, unit_entered_lbp, ex)

        suggested_item_id: Optional[str] = None
        confidence = Decimal("0")
        match_reason = "not_applicable_non_item"
        auto_resolve = False
        ai_preferred_entered_uom: Optional[str] = None
        ocr_hint_suffix = ""
        if line_type in {"item", "free_item"}:
            suggested_item_id, confidence, match_reason = _match_item_for_import_line(
                cur=cur,
                company_id=company_id,
                supplier_id=supplier_id,
                supplier_item_code=supplier_item_code,
                supplier_item_name=supplier_item_name,
            )
            if ai_match_budget > 0 and (not suggested_item_id or confidence < Decimal("0.78")):
                try:
                    ai_item_id, ai_confidence, ai_reason, ai_uom = _ai_pick_item_for_import_line(
                        cur=cur,
                        company_id=company_id,
                        supplier_id=supplier_id,
                        supplier_item_code=supplier_item_code,
                        supplier_item_name=supplier_item_name,
                        description=desc,
                        qty=qty_entered,
                        unit_price_entered_usd=unit_entered_usd,
                        unit_price_entered_lbp=unit_entered_lbp,
                        exchange_rate=ex,
                        ai_cfg=ai_cfg,
                    )
                    ai_match_budget -= 1
                    if ai_item_id and ai_confidence >= (confidence + Decimal("0.04")):
                        suggested_item_id = ai_item_id
                        confidence = ai_confidence
                        match_reason = ai_reason
                        ai_preferred_entered_uom = ai_uom
                except Exception as ai_ex:
                    warnings.append(f"line {idx+1}: semantic match fallback skipped ({ai_ex})")
            auto_resolve = bool(suggested_item_id) and match_reason in {
                "alias_code_exact",
                "alias_name_exact",
                "sku_exact",
                "barcode_exact",
            }

        # Blend extraction certainty into the mapping confidence (downward only).
        ocr_conf = _to_decimal_optional(ln.get("confidence"))
        if ocr_conf is not None and ocr_conf >= 0:
            if ocr_conf > 1:
                ocr_conf = Decimal("1")
            if suggested_item_id:
                confidence = min(confidence, ocr_conf)
            ocr_hint_suffix = f"|ocr_conf_{ocr_conf}"

        entered_uom_code, entered_qty_factor, uom_hint_reason = _infer_item_purchase_uom_hint(
            cur=cur,
            company_id=company_id,
            item_id=suggested_item_id,
            supplier_item_name=supplier_item_name,
            description=desc,
        )
        if not entered_uom_code:
            entered_uom_code, entered_qty_factor, uom_hint_reason = _infer_uom_without_item(
                supplier_item_name=supplier_item_name,
                description=desc,
                company_uoms=company_uoms,
                company_fallback_uom=company_fallback_uom,
            )
        if ai_preferred_entered_uom and suggested_item_id:
            try:
                cur.execute(
                    """
                    SELECT to_base_factor
                    FROM item_uom_conversions
                    WHERE company_id=%s AND item_id=%s AND is_active=true AND upper(uom_code)=upper(%s)
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    (company_id, suggested_item_id, ai_preferred_entered_uom),
                )
                rr = cur.fetchone()
                if rr and Decimal(str(rr.get("to_base_factor") or 0)) > 0:
                    entered_uom_code = ai_preferred_entered_uom
                    entered_qty_factor = Decimal(str(rr.get("to_base_factor") or 1))
                    uom_hint_reason = "ai_entered_uom"
            except Exception:
                pass
        if entered_qty_factor <= 0:
            entered_qty_factor = Decimal("1")

        # Base-cost representation for inventory costing.
        unit_base_usd = unit_entered_usd / entered_qty_factor if entered_qty_factor else unit_entered_usd
        unit_base_lbp = unit_entered_lbp / entered_qty_factor if entered_qty_factor else unit_entered_lbp
        unit_base_usd, unit_base_lbp = _normalize_dual_amounts(unit_base_usd, unit_base_lbp, ex)
        qty_base = qty_entered * entered_qty_factor

        out.append(
            {
                "line_no": idx + 1,
                "line_type": line_type,
                "qty": qty_base,
                "qty_entered": qty_entered,
                "entered_uom_code": entered_uom_code,
                "entered_qty_factor": entered_qty_factor,
                "unit_cost_usd": unit_base_usd,
                "unit_cost_lbp": unit_base_lbp,
                "unit_cost_entered_usd": unit_entered_usd,
                "unit_cost_entered_lbp": unit_entered_lbp,
                "supplier_item_code": supplier_item_code,
                "supplier_item_name": supplier_item_name,
                "description": desc,
                "suggested_item_id": suggested_item_id,
                "suggested_confidence": confidence,
                "suggested_match_reason": f"{match_reason}:{uom_hint_reason}{ocr_hint_suffix}",
                "auto_resolve": auto_resolve,
                "raw_json": ln,
            }
        )

    _append_derived_totals_adjustments(
        out=out,
        extracted=extracted,
        exchange_rate=ex,
        warnings=warnings,
    )

    return out


def rematch_supplier_invoice_import_line(
    *,
    cur,
    company_id: str,
    supplier_id: Optional[str],
    line_type: Optional[str],
    supplier_item_code: Optional[str],
    supplier_item_name: Optional[str],
    description: Optional[str],
    qty_entered: Decimal,
    unit_cost_entered_usd: Decimal,
    unit_cost_entered_lbp: Decimal,
    exchange_rate: Decimal,
    resolved_item_id: Optional[str] = None,
    entered_uom_code: Optional[str] = None,
    entered_qty_factor: Optional[Decimal] = None,
) -> dict[str, Any]:
    lt = str(line_type or "item").strip().lower() or "item"
    qty_entered = Decimal(str(qty_entered or 0))
    if qty_entered <= 0 and lt in {"discount", "tax", "freight", "other"}:
        qty_entered = Decimal("1")
    if qty_entered <= 0:
        qty_entered = Decimal("0")

    unit_entered_usd = Decimal(str(unit_cost_entered_usd or 0))
    unit_entered_lbp = Decimal(str(unit_cost_entered_lbp or 0))
    unit_entered_usd, unit_entered_lbp = _normalize_dual_amounts(unit_entered_usd, unit_entered_lbp, exchange_rate)

    suggested_item_id: Optional[str] = None
    suggested_confidence = Decimal("0")
    match_reason = "not_applicable_non_item"
    auto_resolve = False
    ai_preferred_entered_uom: Optional[str] = None
    if lt in {"item", "free_item"}:
        suggested_item_id, suggested_confidence, match_reason = _match_item_for_import_line(
            cur=cur,
            company_id=company_id,
            supplier_id=supplier_id,
            supplier_item_code=supplier_item_code,
            supplier_item_name=supplier_item_name,
        )
        if (not suggested_item_id or suggested_confidence < Decimal("0.78")) and is_external_ai_allowed(cur, company_id):
            try:
                ai_cfg = get_ai_provider_config(cur, company_id)
                ai_item_id, ai_conf, ai_reason, ai_uom = _ai_pick_item_for_import_line(
                    cur=cur,
                    company_id=company_id,
                    supplier_id=supplier_id,
                    supplier_item_code=supplier_item_code,
                    supplier_item_name=supplier_item_name,
                    description=description,
                    qty=qty_entered,
                    unit_price_entered_usd=unit_entered_usd,
                    unit_price_entered_lbp=unit_entered_lbp,
                    exchange_rate=exchange_rate,
                    ai_cfg=ai_cfg,
                )
                if ai_item_id and ai_conf >= (suggested_confidence + Decimal("0.04")):
                    suggested_item_id = ai_item_id
                    suggested_confidence = ai_conf
                    match_reason = ai_reason
                    ai_preferred_entered_uom = ai_uom
            except Exception:
                pass
        auto_resolve = bool(suggested_item_id) and match_reason in {
            "alias_code_exact",
            "alias_name_exact",
            "sku_exact",
            "barcode_exact",
        }

    target_item_id = str(resolved_item_id or suggested_item_id or "").strip() or None
    preferred_uom = (entered_uom_code or "").strip().upper() or None
    entered_uom, qty_factor, uom_reason = _infer_item_purchase_uom_hint(
        cur=cur,
        company_id=company_id,
        item_id=target_item_id,
        supplier_item_name=supplier_item_name,
        description=description,
    )
    if not entered_uom:
        company_uoms = _load_company_uom_codes(cur, company_id)
        company_fallback_uom = _pick_company_fallback_uom(company_uoms)
        entered_uom, qty_factor, uom_reason = _infer_uom_without_item(
            supplier_item_name=supplier_item_name,
            description=description,
            company_uoms=company_uoms,
            company_fallback_uom=company_fallback_uom,
        )

    if preferred_uom and target_item_id:
        try:
            cur.execute(
                """
                SELECT to_base_factor
                FROM item_uom_conversions
                WHERE company_id=%s AND item_id=%s AND is_active=true AND upper(uom_code)=upper(%s)
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (company_id, target_item_id, preferred_uom),
            )
            r = cur.fetchone()
            if r and Decimal(str(r.get("to_base_factor") or 0)) > 0:
                entered_uom = preferred_uom
                qty_factor = Decimal(str(r["to_base_factor"]))
                uom_reason = "preferred_uom_kept"
        except Exception:
            pass
    elif ai_preferred_entered_uom and target_item_id:
        try:
            cur.execute(
                """
                SELECT to_base_factor
                FROM item_uom_conversions
                WHERE company_id=%s AND item_id=%s AND is_active=true AND upper(uom_code)=upper(%s)
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (company_id, target_item_id, ai_preferred_entered_uom),
            )
            rr = cur.fetchone()
            if rr and Decimal(str(rr.get("to_base_factor") or 0)) > 0:
                entered_uom = ai_preferred_entered_uom
                qty_factor = Decimal(str(rr["to_base_factor"]))
                uom_reason = "ai_entered_uom"
        except Exception:
            pass

    if entered_qty_factor is not None and Decimal(str(entered_qty_factor or 0)) > 0 and not target_item_id:
        qty_factor = Decimal(str(entered_qty_factor))
    if qty_factor <= 0:
        qty_factor = Decimal("1")
    if not entered_uom:
        entered_uom = preferred_uom or "UNIT"

    qty_base = qty_entered * qty_factor
    unit_base_usd = unit_entered_usd / qty_factor if qty_factor else unit_entered_usd
    unit_base_lbp = unit_entered_lbp / qty_factor if qty_factor else unit_entered_lbp
    unit_base_usd, unit_base_lbp = _normalize_dual_amounts(unit_base_usd, unit_base_lbp, exchange_rate)

    return {
        "line_type": lt,
        "qty": qty_base,
        "qty_entered": qty_entered,
        "entered_uom_code": entered_uom,
        "entered_qty_factor": qty_factor,
        "unit_cost_usd": unit_base_usd,
        "unit_cost_lbp": unit_base_lbp,
        "unit_cost_entered_usd": unit_entered_usd,
        "unit_cost_entered_lbp": unit_entered_lbp,
        "suggested_item_id": suggested_item_id,
        "suggested_confidence": suggested_confidence,
        "suggested_match_reason": f"{match_reason}:{uom_reason}",
        "auto_resolve": auto_resolve,
    }


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
    if sha:
        cur.execute(
            """
            SELECT id
            FROM document_attachments
            WHERE company_id=%s
              AND entity_type='supplier_invoice'
              AND entity_id=%s
              AND sha256=%s
              AND size_bytes=%s
            ORDER BY uploaded_at DESC
            LIMIT 1
            """,
            (company_id, invoice_id, sha, len(raw)),
        )
        hit = cur.fetchone()
        if hit:
            return str(hit["id"])
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
