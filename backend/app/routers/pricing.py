from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import date
from decimal import Decimal, ROUND_CEILING
from typing import Optional

import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..validation import CurrencyCode

router = APIRouter(prefix="/pricing", tags=["pricing"])

def _get_company_setting_json(cur, company_id: str, key: str) -> dict:
    cur.execute(
        """
        SELECT value_json
        FROM company_settings
        WHERE company_id=%s AND key=%s
        """,
        (company_id, key),
    )
    row = cur.fetchone()
    val = row["value_json"] if row else None
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}

def _round_up(value: Decimal, step: Decimal) -> Decimal:
    if step <= 0:
        return value
    try:
        q = (value / step).to_integral_value(rounding=ROUND_CEILING)
        return q * step
    except Exception:
        return value

@router.get("/cost-changes", dependencies=[Depends(require_permission("items:read"))])
def list_cost_changes(
    q: str = Query("", description="Search SKU/name"),
    item_id: Optional[str] = Query(None),
    warehouse_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    company_id: str = Depends(get_company_id),
):
    """
    Operational "cost change log" (v1): emits recent average-cost changes per item/warehouse.
    Populated by triggers on `item_warehouse_costs`.
    """
    qq = (q or "").strip()
    like = f"%{qq}%"

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT c.id, c.changed_at, c.item_id, i.sku, i.name,
                       c.warehouse_id, w.name AS warehouse_name,
                       c.on_hand_qty,
                       c.old_avg_cost_usd, c.new_avg_cost_usd, c.pct_change_usd,
                       c.old_avg_cost_lbp, c.new_avg_cost_lbp, c.pct_change_lbp,
                       c.source
                FROM item_cost_change_log c
                JOIN items i ON i.company_id = c.company_id AND i.id = c.item_id
                JOIN warehouses w ON w.company_id = c.company_id AND w.id = c.warehouse_id
                WHERE c.company_id = %s
            """
            params: list = [company_id]
            if item_id:
                sql += " AND c.item_id = %s"
                params.append(item_id)
            if warehouse_id:
                sql += " AND c.warehouse_id = %s"
                params.append(warehouse_id)
            if qq:
                sql += " AND (i.sku ILIKE %s OR i.name ILIKE %s)"
                params.extend([like, like])
            sql += " ORDER BY c.changed_at DESC LIMIT %s"
            params.append(limit)

            cur.execute(sql, params)
            return {"changes": cur.fetchall()}

@router.get("/price-changes", dependencies=[Depends(require_permission("items:read"))])
def list_price_changes(
    q: str = Query("", description="Search SKU/name"),
    item_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    company_id: str = Depends(get_company_id),
):
    """
    Operational "sell price change log" (v1): emits recent item sell-price changes over time.
    Populated by triggers on `item_prices`.
    """
    qq = (q or "").strip()
    like = f"%{qq}%"

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT c.id, c.changed_at, c.item_id, i.sku, i.name,
                       c.effective_from, c.effective_to,
                       c.old_price_usd, c.new_price_usd, c.pct_change_usd,
                       c.old_price_lbp, c.new_price_lbp, c.pct_change_lbp,
                       c.source_type, c.source_id
                FROM item_price_change_log c
                JOIN items i ON i.company_id = c.company_id AND i.id = c.item_id
                WHERE c.company_id = %s
            """
            params: list = [company_id]
            if item_id:
                sql += " AND c.item_id = %s"
                params.append(item_id)
            if qq:
                sql += " AND (i.sku ILIKE %s OR i.name ILIKE %s)"
                params.extend([like, like])
            sql += " ORDER BY c.changed_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"changes": cur.fetchall()}

@router.get("/items/{item_id}/suggested-price", dependencies=[Depends(require_permission("items:read"))])
def suggested_price(
    item_id: str,
    target_margin_pct: Optional[Decimal] = Query(None, description="Override target margin (0-0.9). Example: 0.2 for 20%"),
    warehouse_id: Optional[str] = Query(None, description="Optional warehouse for cost calculation"),
    company_id: str = Depends(get_company_id),
):
    """
    Pricing helper (v1):
    - Computes current effective sell price (default price list fallback to item_prices).
    - Computes weighted average cost (by on_hand_qty) from item_warehouse_costs.
    - Suggests a new sell price to hit a target gross margin.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM items WHERE company_id=%s AND id=%s", (company_id, item_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="item not found")

            cfg = _get_company_setting_json(cur, company_id, "pricing_policy")
            cfg_target = cfg.get("target_margin_pct")
            cfg_target = Decimal(str(cfg_target)) if cfg_target is not None else Decimal("0.20")
            tm = target_margin_pct if target_margin_pct is not None else cfg_target
            try:
                tm = Decimal(str(tm))
            except Exception:
                tm = cfg_target
            if tm < 0:
                tm = Decimal("0")
            if tm > Decimal("0.90"):
                tm = Decimal("0.90")

            usd_step = Decimal(str(cfg.get("usd_round_step") or "0.25"))
            lbp_step = Decimal(str(cfg.get("lbp_round_step") or "5000"))

            # Effective price: default price list fallback to item_prices.
            cur.execute(
                """
                SELECT value_json->>'id' AS id
                FROM company_settings
                WHERE company_id = %s AND key = 'default_price_list_id'
                """,
                (company_id,),
            )
            srow = cur.fetchone()
            default_pl_id = srow["id"] if srow else None

            cur.execute(
                """
                SELECT COALESCE(plp.price_usd, p.price_usd) AS price_usd,
                       COALESCE(plp.price_lbp, p.price_lbp) AS price_lbp
                FROM items i
                LEFT JOIN LATERAL (
                    SELECT price_usd, price_lbp
                    FROM price_list_items pli
                    WHERE pli.company_id = i.company_id
                      AND pli.price_list_id = %s::uuid
                      AND pli.item_id = i.id
                      AND pli.effective_from <= CURRENT_DATE
                      AND (pli.effective_to IS NULL OR pli.effective_to >= CURRENT_DATE)
                    ORDER BY pli.effective_from DESC, pli.created_at DESC, pli.id DESC
                    LIMIT 1
                ) plp ON (%s::uuid IS NOT NULL)
                LEFT JOIN LATERAL (
                    SELECT price_usd, price_lbp
                    FROM item_prices ip
                    WHERE ip.item_id = i.id
                      AND ip.effective_from <= CURRENT_DATE
                      AND (ip.effective_to IS NULL OR ip.effective_to >= CURRENT_DATE)
                    ORDER BY ip.effective_from DESC, ip.created_at DESC, ip.id DESC
                    LIMIT 1
                ) p ON true
                WHERE i.company_id=%s AND i.id=%s
                """,
                (default_pl_id, default_pl_id, company_id, item_id),
            )
            prow = cur.fetchone() or {}
            price_usd = Decimal(str(prow.get("price_usd") or 0))
            price_lbp = Decimal(str(prow.get("price_lbp") or 0))

            # Weighted avg cost (prefer on-hand weighted; fall back to simple average if no on-hand).
            if warehouse_id:
                cur.execute(
                    """
                    SELECT avg_cost_usd, avg_cost_lbp, on_hand_qty
                    FROM item_warehouse_costs
                    WHERE company_id=%s AND item_id=%s AND warehouse_id=%s
                    """,
                    (company_id, item_id, warehouse_id),
                )
                crow = cur.fetchone() or {}
                cost_usd = Decimal(str(crow.get("avg_cost_usd") or 0))
                cost_lbp = Decimal(str(crow.get("avg_cost_lbp") or 0))
            else:
                cur.execute(
                    """
                    SELECT
                      SUM(COALESCE(avg_cost_usd,0) * GREATEST(COALESCE(on_hand_qty,0),0)) / NULLIF(SUM(GREATEST(COALESCE(on_hand_qty,0),0)), 0) AS w_cost_usd,
                      SUM(COALESCE(avg_cost_lbp,0) * GREATEST(COALESCE(on_hand_qty,0),0)) / NULLIF(SUM(GREATEST(COALESCE(on_hand_qty,0),0)), 0) AS w_cost_lbp,
                      SUM(GREATEST(COALESCE(on_hand_qty,0),0)) AS w_qty
                    FROM item_warehouse_costs
                    WHERE company_id=%s AND item_id=%s
                    """,
                    (company_id, item_id),
                )
                w = cur.fetchone() or {}
                w_qty = Decimal(str(w.get("w_qty") or 0))
                if w_qty > 0 and w.get("w_cost_usd") is not None:
                    cost_usd = Decimal(str(w.get("w_cost_usd") or 0))
                    cost_lbp = Decimal(str(w.get("w_cost_lbp") or 0))
                else:
                    cur.execute(
                        """
                        SELECT
                          AVG(COALESCE(avg_cost_usd,0)) AS a_cost_usd,
                          AVG(COALESCE(avg_cost_lbp,0)) AS a_cost_lbp
                        FROM item_warehouse_costs
                        WHERE company_id=%s AND item_id=%s
                        """,
                        (company_id, item_id),
                    )
                    a = cur.fetchone() or {}
                    cost_usd = Decimal(str(a.get("a_cost_usd") or 0))
                    cost_lbp = Decimal(str(a.get("a_cost_lbp") or 0))

            def margin(price: Decimal, cost: Decimal) -> Optional[Decimal]:
                if price <= 0:
                    return None
                return (price - cost) / price

            m_usd = margin(price_usd, cost_usd)
            m_lbp = margin(price_lbp, cost_lbp)

            suggested_usd = None
            suggested_lbp = None
            if tm < 1:
                if cost_usd > 0:
                    suggested_usd = _round_up(cost_usd / (Decimal("1") - tm), usd_step)
                if cost_lbp > 0:
                    suggested_lbp = _round_up(cost_lbp / (Decimal("1") - tm), lbp_step)

            # Context: last cost change (helps explain why).
            cur.execute(
                """
                SELECT changed_at, old_avg_cost_usd, new_avg_cost_usd, pct_change_usd,
                       old_avg_cost_lbp, new_avg_cost_lbp, pct_change_lbp
                FROM item_cost_change_log
                WHERE company_id=%s AND item_id=%s
                ORDER BY changed_at DESC
                LIMIT 1
                """,
                (company_id, item_id),
            )
            last_cost = cur.fetchone()

            return {
                "item_id": item_id,
                "target_margin_pct": str(tm),
                "rounding": {"usd_step": str(usd_step), "lbp_step": str(lbp_step)},
                "current": {
                    "price_usd": str(price_usd),
                    "price_lbp": str(price_lbp),
                    "avg_cost_usd": str(cost_usd),
                    "avg_cost_lbp": str(cost_lbp),
                    "margin_usd": (str(m_usd) if m_usd is not None else None),
                    "margin_lbp": (str(m_lbp) if m_lbp is not None else None),
                },
                "suggested": {
                    "price_usd": (str(suggested_usd) if suggested_usd is not None else None),
                    "price_lbp": (str(suggested_lbp) if suggested_lbp is not None else None),
                },
                "last_cost_change": last_cost,
            }

@router.get("/catalog", dependencies=[Depends(require_permission("items:read"))])
def catalog(company_id: str = Depends(get_company_id)):
    """
    Admin-friendly pricing catalog (same "effective price" logic as POS catalog),
    authenticated via session/company access (not device tokens).
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT value_json->>'id' AS id
                FROM company_settings
                WHERE company_id = %s AND key = 'default_price_list_id'
                """,
                (company_id,),
            )
            srow = cur.fetchone()
            default_pl_id = srow["id"] if srow else None

            cur.execute(
                """
                SELECT i.id, i.sku, i.barcode, i.name, i.unit_of_measure, i.is_active,
                       i.tax_code_id,
                       i.category_id, i.brand, i.short_name, i.description,
                       i.track_batches, i.track_expiry,
                       i.default_shelf_life_days, i.min_shelf_life_days_for_sale, i.expiry_warning_days,
                       i.updated_at,
                       COALESCE(plp.price_usd, p.price_usd) AS price_usd,
                       COALESCE(plp.price_lbp, p.price_lbp) AS price_lbp,
                       COALESCE(bc.barcodes, '[]'::jsonb) AS barcodes
                FROM items i
                LEFT JOIN LATERAL (
                    SELECT price_usd, price_lbp
                    FROM price_list_items pli
                    WHERE pli.company_id = i.company_id
                      AND pli.price_list_id = %s::uuid
                      AND pli.item_id = i.id
                      AND pli.effective_from <= CURRENT_DATE
                      AND (pli.effective_to IS NULL OR pli.effective_to >= CURRENT_DATE)
                    ORDER BY pli.effective_from DESC, pli.created_at DESC, pli.id DESC
                    LIMIT 1
                ) plp ON (%s::uuid IS NOT NULL)
                LEFT JOIN LATERAL (
                    SELECT price_usd, price_lbp
                    FROM item_prices ip
                    WHERE ip.item_id = i.id
                      AND ip.effective_from <= CURRENT_DATE
                      AND (ip.effective_to IS NULL OR ip.effective_to >= CURRENT_DATE)
                    ORDER BY ip.effective_from DESC, ip.created_at DESC
                    LIMIT 1
                ) p ON true
                LEFT JOIN LATERAL (
	                    SELECT jsonb_agg(
	                        jsonb_build_object(
	                          'id', b.id,
	                          'barcode', b.barcode,
	                          'qty_factor', b.qty_factor,
	                          'uom_code', b.uom_code,
	                          'label', b.label,
	                          'is_primary', b.is_primary
	                        )
	                        ORDER BY b.is_primary DESC, b.created_at ASC
	                    ) AS barcodes
                    FROM item_barcodes b
                    WHERE b.company_id = i.company_id AND b.item_id = i.id
                ) bc ON true
                ORDER BY i.sku
                """,
                (default_pl_id, default_pl_id),
            )
            return {"items": cur.fetchall()}

@router.get("/catalog/typeahead", dependencies=[Depends(require_permission("items:read"))])
def catalog_typeahead(
    q: str = Query("", description="Search SKU/name/barcode"),
    limit: int = Query(30, ge=1, le=100),
    include_inactive: bool = Query(False, description="Include inactive items"),
    company_id: str = Depends(get_company_id),
):
    """
    Lightweight, scalable typeahead for the pricing catalog.
    Returns the same "effective price" fields as /pricing/catalog, but filtered.
    """
    qq = (q or "").strip()
    if not qq:
        return {"items": []}

    like = f"%{qq}%"

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT value_json->>'id' AS id
                FROM company_settings
                WHERE company_id = %s AND key = 'default_price_list_id'
                """,
                (company_id,),
            )
            srow = cur.fetchone()
            default_pl_id = srow["id"] if srow else None

            cur.execute(
                """
                SELECT i.id, i.sku, i.barcode, i.name, i.unit_of_measure, i.is_active,
                       i.tax_code_id,
                       i.standard_cost_usd, i.standard_cost_lbp,
                       COALESCE(plp.price_usd, p.price_usd) AS price_usd,
                       COALESCE(plp.price_lbp, p.price_lbp) AS price_lbp,
                       COALESCE(bc.barcodes, '[]'::jsonb) AS barcodes
                FROM items i
                LEFT JOIN LATERAL (
                    SELECT price_usd, price_lbp
                    FROM price_list_items pli
                    WHERE pli.company_id = i.company_id
                      AND pli.price_list_id = %s::uuid
                      AND pli.item_id = i.id
                      AND pli.effective_from <= CURRENT_DATE
                      AND (pli.effective_to IS NULL OR pli.effective_to >= CURRENT_DATE)
                    ORDER BY pli.effective_from DESC, pli.created_at DESC, pli.id DESC
                    LIMIT 1
                ) plp ON (%s::uuid IS NOT NULL)
                LEFT JOIN LATERAL (
                    SELECT price_usd, price_lbp
                    FROM item_prices ip
                    WHERE ip.item_id = i.id
                      AND ip.effective_from <= CURRENT_DATE
                      AND (ip.effective_to IS NULL OR ip.effective_to >= CURRENT_DATE)
                    ORDER BY ip.effective_from DESC, ip.created_at DESC
                    LIMIT 1
                ) p ON true
                LEFT JOIN LATERAL (
	                    SELECT jsonb_agg(
	                        jsonb_build_object(
	                          'id', b.id,
	                          'barcode', b.barcode,
	                          'qty_factor', b.qty_factor,
	                          'uom_code', b.uom_code,
	                          'label', b.label,
	                          'is_primary', b.is_primary
	                        )
	                        ORDER BY b.is_primary DESC, b.created_at ASC
	                    ) AS barcodes
                    FROM item_barcodes b
                    WHERE b.company_id = i.company_id AND b.item_id = i.id
                ) bc ON true
                WHERE (%s = true OR i.is_active = true)
                  AND (
                    i.sku ILIKE %s
                   OR i.name ILIKE %s
                   OR i.barcode ILIKE %s
                   OR EXISTS (
                       SELECT 1
                       FROM item_barcodes b2
                       WHERE b2.company_id = i.company_id
                         AND b2.item_id = i.id
                         AND b2.barcode ILIKE %s
                   )
                  )
                ORDER BY
                  CASE
                    WHEN lower(i.sku) = lower(%s) THEN 0
                    WHEN i.barcode IS NOT NULL AND lower(i.barcode) = lower(%s) THEN 0
                    WHEN EXISTS (
                       SELECT 1
                       FROM item_barcodes b3
                       WHERE b3.company_id = i.company_id
                         AND b3.item_id = i.id
                         AND lower(b3.barcode) = lower(%s)
                    ) THEN 0
                    ELSE 1
                  END,
                  i.sku
                LIMIT %s
                """,
                (
                    default_pl_id,
                    default_pl_id,
                    include_inactive,
                    like,
                    like,
                    like,
                    like,
                    qq,
                    qq,
                    qq,
                    limit,
                ),
            )
            return {"items": cur.fetchall()}


class PriceListIn(BaseModel):
    code: str
    name: str
    currency: CurrencyCode = "USD"
    is_default: bool = False


class PriceListUpdate(BaseModel):
    name: Optional[str] = None
    currency: Optional[CurrencyCode] = None
    is_default: Optional[bool] = None


@router.get("/lists", dependencies=[Depends(require_permission("items:read"))])
def list_price_lists(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, currency, is_default, created_at, updated_at
                FROM price_lists
                WHERE company_id = %s
                ORDER BY is_default DESC, code
                """,
                (company_id,),
            )
            return {"lists": cur.fetchall()}


@router.post("/lists", dependencies=[Depends(require_permission("items:write"))])
def create_price_list(data: PriceListIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    code = (data.code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if not (data.name or "").strip():
        raise HTTPException(status_code=400, detail="name is required")
    if data.currency not in {"USD", "LBP"}:
        raise HTTPException(status_code=400, detail="currency must be USD or LBP")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if data.is_default:
                    cur.execute(
                        "UPDATE price_lists SET is_default = false, updated_at = now() WHERE company_id = %s",
                        (company_id,),
                    )
                cur.execute(
                    """
                    INSERT INTO price_lists (id, company_id, code, name, currency, is_default)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, code, data.name.strip(), data.currency, data.is_default),
                )
                list_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'price_list_create', 'price_list', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], list_id, json.dumps(data.model_dump())),
                )
                return {"id": list_id}


@router.patch("/lists/{list_id}", dependencies=[Depends(require_permission("items:write"))])
def update_price_list(list_id: str, data: PriceListUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    if "currency" in patch and patch["currency"] not in {"USD", "LBP"}:
        raise HTTPException(status_code=400, detail="currency must be USD or LBP")

    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
    params.extend([company_id, list_id])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if patch.get("is_default") is True:
                    cur.execute(
                        "UPDATE price_lists SET is_default = false, updated_at = now() WHERE company_id = %s AND id <> %s",
                        (company_id, list_id),
                    )
                cur.execute(
                    f"""
                    UPDATE price_lists
                    SET {', '.join(fields)}, updated_at = now()
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    params,
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="price list not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'price_list_update', 'price_list', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], list_id, json.dumps(patch)),
                )
                return {"ok": True}


class PriceListItemIn(BaseModel):
    item_id: str
    price_usd: Decimal = Decimal("0")
    price_lbp: Decimal = Decimal("0")
    effective_from: date
    effective_to: Optional[date] = None


@router.get("/lists/{list_id}/items", dependencies=[Depends(require_permission("items:read"))])
def list_price_list_items(list_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, item_id, price_usd, price_lbp, effective_from, effective_to, created_at
                FROM price_list_items
                WHERE company_id = %s AND price_list_id = %s
                ORDER BY effective_from DESC, created_at DESC
                LIMIT 500
                """,
                (company_id, list_id),
            )
            return {"items": cur.fetchall()}


@router.post("/lists/{list_id}/items", dependencies=[Depends(require_permission("items:write"))])
def add_price_list_item(list_id: str, data: PriceListItemIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM price_lists WHERE company_id = %s AND id = %s",
                    (company_id, list_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="price list not found")
                cur.execute(
                    "SELECT 1 FROM items WHERE company_id = %s AND id = %s",
                    (company_id, data.item_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail="invalid item_id")
                cur.execute(
                    """
                    INSERT INTO price_list_items
                      (id, company_id, price_list_id, item_id, price_usd, price_lbp, effective_from, effective_to)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        list_id,
                        data.item_id,
                        data.price_usd,
                        data.price_lbp,
                        data.effective_from,
                        data.effective_to,
                    ),
                )
                pli_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'price_list_item_add', 'price_list_item', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], pli_id, json.dumps(data.model_dump(), default=str)),
                )
                return {"id": pli_id}


class CompanySettingIn(BaseModel):
    key: str
    value_json: dict


@router.get("/company-settings", dependencies=[Depends(require_permission("items:read"))])
def list_company_settings(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT key, value_json, updated_at
                FROM company_settings
                WHERE company_id = %s
                ORDER BY key
                """,
                (company_id,),
            )
            return {"settings": cur.fetchall()}


@router.post("/company-settings", dependencies=[Depends(require_permission("items:write"))])
def upsert_company_setting(data: CompanySettingIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not (data.key or "").strip():
        raise HTTPException(status_code=400, detail="key is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO company_settings (company_id, key, value_json)
                    VALUES (%s, %s, %s::jsonb)
                    ON CONFLICT (company_id, key) DO UPDATE
                    SET value_json = EXCLUDED.value_json,
                        updated_at = now()
                    """,
                    (company_id, data.key.strip(), json.dumps(data.value_json)),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'company_setting_upsert', 'company_setting', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps(data.model_dump())),
                )
                return {"ok": True}
