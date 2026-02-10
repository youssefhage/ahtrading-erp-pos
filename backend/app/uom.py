from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from fastapi import HTTPException


QTY_EPSILON = Decimal("0.000001")
Q6 = Decimal("0.000001")


def norm_uom_code(v: Optional[str]) -> Optional[str]:
    c = (v or "").strip().upper()
    return c or None


def q6(v: Decimal) -> Decimal:
    # Keep factors and entered qty at the same precision as the DB columns (numeric(18,6)).
    return v.quantize(Q6, rounding=ROUND_HALF_UP)


def load_item_uom_context(cur, company_id: str, item_ids: list[str]) -> tuple[dict[str, str], dict[str, dict[str, Decimal]]]:
    """
    Returns:
    - base_uom_by_item: item_id -> items.unit_of_measure (normalized)
    - factors_by_item: item_id -> { uom_code -> to_base_factor } for active conversions
    """
    ids = sorted({str(x) for x in (item_ids or []) if str(x).strip()})
    if not ids:
        return {}, {}

    cur.execute(
        """
        SELECT id, unit_of_measure
        FROM items
        WHERE company_id=%s AND id = ANY(%s::uuid[])
        """,
        (company_id, ids),
    )
    base_uom_by_item: dict[str, str] = {str(r["id"]): (norm_uom_code(r.get("unit_of_measure")) or "EA") for r in (cur.fetchall() or [])}

    cur.execute(
        """
        SELECT item_id, uom_code, to_base_factor
        FROM item_uom_conversions
        WHERE company_id=%s AND item_id = ANY(%s::uuid[]) AND is_active=true
        """,
        (company_id, ids),
    )
    factors_by_item: dict[str, dict[str, Decimal]] = {}
    for r in (cur.fetchall() or []):
        it = str(r["item_id"])
        u = norm_uom_code(r.get("uom_code"))
        if not u:
            continue
        try:
            f = q6(Decimal(str(r.get("to_base_factor") or 0)))
        except Exception:
            continue
        if f <= 0:
            continue
        factors_by_item.setdefault(it, {})[u] = f

    # Ensure base uom always resolves to factor 1 (even if migrations are missing).
    for it, base_uom in base_uom_by_item.items():
        factors_by_item.setdefault(it, {})[base_uom] = Decimal("1")

    return base_uom_by_item, factors_by_item


def resolve_line_uom(
    *,
    line_label: str,
    item_id: str,
    qty_base: Decimal,
    qty_entered: Optional[Decimal],
    uom: Optional[str],
    qty_factor: Optional[Decimal],
    base_uom_by_item: dict[str, str],
    factors_by_item: dict[str, dict[str, Decimal]],
    strict_factor: bool = True,
    epsilon: Decimal = QTY_EPSILON,
) -> dict:
    """
    Canonicalization rules:
    - `qty_base` is always the base quantity (in items.unit_of_measure).
    - `uom/qty_factor/qty_entered` describe what the user entered/scanned.
    - For non-base UOMs, qty_factor must match the active item_uom_conversions.to_base_factor.
    """
    it = str(item_id or "").strip()
    if not it:
        raise HTTPException(status_code=400, detail=f"{line_label}: item_id is required")

    if qty_base <= 0:
        raise HTTPException(status_code=400, detail=f"{line_label}: qty must be > 0")

    base_uom = (base_uom_by_item.get(it) or "").strip().upper()
    if not base_uom:
        raise HTTPException(status_code=400, detail=f"{line_label}: invalid item_id")

    uom_norm = norm_uom_code(uom) or base_uom

    expected = Decimal("1")
    if uom_norm != base_uom:
        expected = factors_by_item.get(it, {}).get(uom_norm) or Decimal("0")
        if expected <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"{line_label}: missing UOM conversion for item_id={it} uom={uom_norm}",
            )
    expected = q6(expected)

    if qty_factor is not None:
        try:
            f_in = q6(Decimal(str(qty_factor or 0)))
        except Exception:
            raise HTTPException(status_code=400, detail=f"{line_label}: qty_factor is invalid")
        if f_in <= 0:
            raise HTTPException(status_code=400, detail=f"{line_label}: qty_factor must be > 0")
        if strict_factor and f_in != expected:
            raise HTTPException(
                status_code=400,
                detail=f"{line_label}: qty_factor mismatch for uom {uom_norm} (expected {expected}, got {f_in})",
            )
    else:
        # If a non-base uom is specified, the factor is derived from conversions.
        pass

    if qty_entered is not None:
        try:
            qe_in = q6(Decimal(str(qty_entered or 0)))
        except Exception:
            raise HTTPException(status_code=400, detail=f"{line_label}: qty_entered is invalid")
        if qe_in <= 0:
            raise HTTPException(status_code=400, detail=f"{line_label}: qty_entered must be > 0")

        # Ensure client didn't send inconsistent base vs entered quantities.
        expect_base = q6(qe_in * expected)
        if (qty_base - expect_base).copy_abs() > epsilon:
            raise HTTPException(
                status_code=400,
                detail=f"{line_label}: qty and qty_entered do not match qty_factor (qty={qty_base}, qty_entered={qe_in}, factor={expected})",
            )

    # Always store a consistent entered qty (even if client omitted it).
    qe = q6(qty_base / expected) if expected else q6(qty_base)

    return {
        "base_uom": base_uom,
        "uom": uom_norm,
        "qty_factor": expected,
        "qty_entered": qe,
        "qty": qty_base,
    }

