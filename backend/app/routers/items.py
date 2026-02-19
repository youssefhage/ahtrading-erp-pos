from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional, List, Literal, Any, Dict
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission
from ..deps import get_current_user
import json
import os
import uuid
from psycopg import errors as pg_errors
from ..ai.item_naming import heuristic_item_name_suggestions, openai_item_name_suggestions
from ..ai.providers import get_ai_provider_config
from ..ai.policy import is_external_ai_allowed

router = APIRouter(prefix="/items", tags=["items"])

ItemType = Literal["stocked", "service", "bundle"]
CostingMethod = Literal["avg", "fifo", "standard"]
TaxCategory = Literal["standard", "zero", "exempt"]

def _norm_uom(code: Optional[str]) -> str:
    c = (code or "").strip()
    if not c:
        raise HTTPException(status_code=400, detail="unit_of_measure is required")
    c = c.upper()
    if len(c) > 32:
        raise HTTPException(status_code=400, detail="unit_of_measure code is too long (max 32 chars)")
    return c


def _ensure_uom_exists(cur, company_id: str, code: str) -> None:
    # Keep the existing name if present; only create if missing and re-activate if disabled.
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


class ItemIn(BaseModel):
    sku: str
    name: str
    item_type: ItemType = "stocked"
    tags: Optional[List[str]] = None
    unit_of_measure: str
    purchase_uom_code: Optional[str] = None
    sales_uom_code: Optional[str] = None
    barcode: Optional[str] = None
    tax_code_id: Optional[str] = None
    tax_category: Optional[TaxCategory] = None
    is_excise: bool = False
    reorder_point: Optional[Decimal] = None
    reorder_qty: Optional[Decimal] = None
    is_active: bool = True
    category_id: Optional[str] = None
    brand: Optional[str] = None
    short_name: Optional[str] = None
    description: Optional[str] = None
    track_batches: bool = False
    track_expiry: bool = False
    default_shelf_life_days: Optional[int] = None
    min_shelf_life_days_for_sale: Optional[int] = None
    expiry_warning_days: Optional[int] = None
    allow_negative_stock: Optional[bool] = None
    case_pack_qty: Optional[Decimal] = None
    inner_pack_qty: Optional[Decimal] = None
    standard_cost_usd: Optional[Decimal] = None
    standard_cost_lbp: Optional[Decimal] = None
    min_margin_pct: Optional[Decimal] = None
    costing_method: Optional[CostingMethod] = None
    preferred_supplier_id: Optional[str] = None
    weight: Optional[Decimal] = None
    volume: Optional[Decimal] = None
    external_ids: Optional[Dict[str, Any]] = None
    image_attachment_id: Optional[str] = None
    image_alt: Optional[str] = None


class BulkItemIn(BaseModel):
    sku: str
    name: str
    unit_of_measure: str = "EA"
    barcode: Optional[str] = None
    tax_code_name: Optional[str] = None
    # Optional costing fields for imports. If omitted, we preserve any existing cost on upsert.
    standard_cost_usd: Optional[Decimal] = None
    standard_cost_lbp: Optional[Decimal] = None
    reorder_point: Optional[Decimal] = Decimal("0")
    reorder_qty: Optional[Decimal] = Decimal("0")


class BulkItemsIn(BaseModel):
    items: List[BulkItemIn]


class ItemPriceIn(BaseModel):
    price_usd: Decimal
    price_lbp: Decimal
    effective_from: date
    effective_to: Optional[date] = None


class BulkItemPriceIn(BaseModel):
    sku: str
    price_usd: Decimal = Decimal("0")
    price_lbp: Decimal = Decimal("0")


class BulkItemPricesIn(BaseModel):
    effective_from: Optional[date] = None
    lines: List[BulkItemPriceIn]

class BulkBarcodeIn(BaseModel):
    sku: str
    barcode: str
    qty_factor: Decimal = Decimal("1")
    uom_code: Optional[str] = None
    label: Optional[str] = None
    is_primary: bool = False


class BulkBarcodesIn(BaseModel):
    lines: List[BulkBarcodeIn]


class BulkUomConversionIn(BaseModel):
    sku: str
    uom_code: str
    to_base_factor: Decimal
    is_active: bool = True


class BulkUomConversionsIn(BaseModel):
    lines: List[BulkUomConversionIn]


class BulkCategoryAssignIn(BaseModel):
    sku: str
    category_name: str


class BulkCategoryAssignRequest(BaseModel):
    lines: List[BulkCategoryAssignIn]


@router.get("", dependencies=[Depends(require_permission("items:read"))])
def list_items(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.barcode, i.name, i.item_type, i.tags,
                       i.unit_of_measure, i.tax_code_id, i.reorder_point, i.reorder_qty,
                       i.purchase_uom_code, i.sales_uom_code,
                       i.tax_category, i.is_excise,
                       i.is_active, i.category_id, i.brand, i.short_name, i.description,
                       i.track_batches, i.track_expiry,
                       i.default_shelf_life_days, i.min_shelf_life_days_for_sale, i.expiry_warning_days,
                       i.allow_negative_stock,
                       i.case_pack_qty, i.inner_pack_qty,
                       i.standard_cost_usd, i.standard_cost_lbp, i.min_margin_pct, i.costing_method,
                       i.preferred_supplier_id,
                       i.weight, i.volume,
                       i.external_ids,
                       i.image_attachment_id, i.image_alt,
                       COALESCE(bc.cnt, 0) AS barcode_count
                FROM items i
                LEFT JOIN LATERAL (
                  SELECT COUNT(*)::int AS cnt
                  FROM item_barcodes b
                  WHERE b.company_id = i.company_id AND b.item_id = i.id
                ) bc ON true
                ORDER BY i.sku
                """
            )
            return {"items": cur.fetchall()}

@router.get("/min", dependencies=[Depends(require_permission("items:read"))])
def list_items_min(
    include_inactive: bool = False,
    company_id: str = Depends(get_company_id),
):
    """
    Lightweight "load all items" endpoint for admin pages that only need to populate
    dropdowns (id/sku/name). This avoids fetching the full item payload.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.name
                FROM items i
                WHERE i.company_id = %s
                  AND (%s = true OR i.is_active = true)
                ORDER BY i.sku
                """,
                (company_id, bool(include_inactive)),
            )
            return {"items": cur.fetchall()}


@router.get("/list", dependencies=[Depends(require_permission("items:read"))])
def list_items_list(
    q: str = "",
    limit: int = 0,
    offset: int = 0,
    include_inactive: bool = False,
    company_id: str = Depends(get_company_id),
):
    """
    Medium-weight catalog listing endpoint for the Items list page.
    Returns the fields needed for listing/searching without pulling long descriptions,
    external ids, costing, etc.
    """
    if limit < 0 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 0 and 500")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")
    qq = (q or "").strip()
    like = f"%{qq}%"
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)::int AS n
                FROM items i
                WHERE i.company_id = %s
                  AND (%s = true OR i.is_active = true)
                  AND (
                    %s = ''
                    OR i.sku ILIKE %s
                    OR i.name ILIKE %s
                    OR (i.barcode IS NOT NULL AND i.barcode ILIKE %s)
                    OR EXISTS (
                      SELECT 1
                      FROM item_barcodes b
                      WHERE b.company_id = i.company_id
                        AND b.item_id = i.id
                        AND b.barcode ILIKE %s
                    )
                  )
                """,
                (company_id, bool(include_inactive), qq, like, like, like, like),
            )
            total = int((cur.fetchone() or {}).get("n") or 0)

            sql = """
                SELECT i.id, i.sku, i.name, i.barcode,
                       i.unit_of_measure, i.category_id,
                       i.is_active, i.updated_at,
                       COALESCE(bc.cnt, 0) AS barcode_count
                FROM items i
                LEFT JOIN LATERAL (
                  SELECT COUNT(*)::int AS cnt
                  FROM item_barcodes b
                  WHERE b.company_id = i.company_id AND b.item_id = i.id
                ) bc ON true
                WHERE i.company_id = %s
                  AND (%s = true OR i.is_active = true)
                  AND (
                    %s = ''
                    OR i.sku ILIKE %s
                    OR i.name ILIKE %s
                    OR (i.barcode IS NOT NULL AND i.barcode ILIKE %s)
                    OR EXISTS (
                      SELECT 1
                      FROM item_barcodes b
                      WHERE b.company_id = i.company_id
                        AND b.item_id = i.id
                        AND b.barcode ILIKE %s
                    )
                  )
                ORDER BY i.sku
            """
            params = [company_id, bool(include_inactive), qq, like, like, like, like]
            if limit > 0:
                sql += " LIMIT %s OFFSET %s"
                params.extend([int(limit), int(offset)])
            cur.execute(
                sql,
                tuple(params),
            )
            return {"items": cur.fetchall(), "total": total}


class ItemsLookupIn(BaseModel):
    ids: List[str]


@router.post("/lookup", dependencies=[Depends(require_permission("items:read"))])
def lookup_items(data: ItemsLookupIn, company_id: str = Depends(get_company_id)):
    ids = data.ids or []
    if not ids:
        return {"items": []}
    if len(ids) > 1000:
        raise HTTPException(status_code=400, detail="too many ids (max 1000)")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.name, i.barcode, i.unit_of_measure, i.is_active,
                       i.tax_code_id,
                       i.standard_cost_usd, i.standard_cost_lbp,
                       COALESCE(
                         (
                           SELECT json_agg(json_build_object('barcode', b.barcode) ORDER BY b.barcode)
                           FROM item_barcodes b
                           WHERE b.company_id = i.company_id AND b.item_id = i.id
                         ),
                         '[]'::json
                       ) AS barcodes
                FROM items i
                WHERE i.company_id = %s
                  AND i.id = ANY(%s)
                ORDER BY i.sku
                """,
                (company_id, ids),
            )
            return {"items": cur.fetchall()}

@router.get("/typeahead", dependencies=[Depends(require_permission("items:read"))])
def typeahead_items(
    q: str = "",
    limit: int = 50,
    include_inactive: bool = False,
    company_id: str = Depends(get_company_id),
):
    """
    Lightweight search endpoint for large catalogs (typeahead/combobox).

    Returns minimal item fields plus barcodes for fast picking by SKU/name/barcode.
    """
    qq = (q or "").strip()
    if limit <= 0 or limit > 200:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 200")
    like = f"%{qq}%"
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.name, i.barcode, i.unit_of_measure,
                       COALESCE(
                         (
                           SELECT json_agg(json_build_object('barcode', b.barcode) ORDER BY b.barcode)
                           FROM item_barcodes b
                           WHERE b.company_id = i.company_id AND b.item_id = i.id
                         ),
                         '[]'::json
                       ) AS barcodes
                FROM items i
                WHERE i.company_id = %s
                  AND (%s = true OR i.is_active = true)
                  AND (
                    %s = ''
                    OR i.sku ILIKE %s
                    OR i.name ILIKE %s
                    OR (i.barcode IS NOT NULL AND i.barcode ILIKE %s)
                    OR EXISTS (
                      SELECT 1
                      FROM item_barcodes b
                      WHERE b.company_id = i.company_id
                        AND b.item_id = i.id
                        AND b.barcode ILIKE %s
                    )
                  )
                ORDER BY i.sku
                LIMIT %s
                """,
                (company_id, include_inactive, qq, like, like, like, like, limit),
            )
            return {"items": cur.fetchall()}


@router.get("/uoms", dependencies=[Depends(require_permission("items:read"))])
def list_item_uoms(
    q: str = "",
    limit: int = 50,
    company_id: str = Depends(get_company_id),
):
    """
    List UOM codes (master data).

    Returns active UOM codes, ordered by usage frequency (and then alphabetically).
    """
    qq = (q or "").strip()
    if limit <= 0 or limit > 200:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 200")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            like = f"%{qq}%" if qq else None
            cur.execute(
                """
                WITH usage AS (
                  SELECT unit_of_measure AS code, COUNT(*)::int AS n
                  FROM items
                  WHERE company_id = %s AND COALESCE(unit_of_measure, '') <> ''
                  GROUP BY unit_of_measure
                )
                SELECT u.code AS uom, COALESCE(us.n, 0)::int AS n
                FROM unit_of_measures u
                LEFT JOIN usage us ON us.code = u.code
                WHERE u.company_id = %s
                  AND u.is_active = true
                  AND (%s::text IS NULL OR u.code ILIKE %s OR u.name ILIKE %s)
                ORDER BY COALESCE(us.n, 0) DESC, u.code ASC
                LIMIT %s
                """,
                (company_id, company_id, like, like, like, limit),
            )
            rows = cur.fetchall()
            return {"uoms": [r["uom"] for r in rows]}


class UomRow(BaseModel):
    code: str
    name: str
    is_active: bool
    usage_count: int = 0


@router.get("/uoms/manage", dependencies=[Depends(require_permission("config:write"))])
def list_uoms_manage(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH usage AS (
                  SELECT unit_of_measure AS code, COUNT(*)::int AS n
                  FROM items
                  WHERE company_id = %s AND COALESCE(unit_of_measure, '') <> ''
                  GROUP BY unit_of_measure
                )
                SELECT u.code, u.name, u.is_active, COALESCE(us.n, 0)::int AS usage_count
                FROM unit_of_measures u
                LEFT JOIN usage us ON us.code = u.code
                WHERE u.company_id = %s
                ORDER BY u.is_active DESC, COALESCE(us.n, 0) DESC, u.code ASC
                """,
                (company_id, company_id),
            )
            return {"uoms": cur.fetchall()}


class UomCreateIn(BaseModel):
    code: str
    name: Optional[str] = None
    is_active: bool = True


@router.post("/uoms", dependencies=[Depends(require_permission("config:write"))])
def create_uom(data: UomCreateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    code = _norm_uom(data.code)
    name = (data.name or "").strip() or code
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO unit_of_measures (id, company_id, code, name, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    ON CONFLICT (company_id, code) DO UPDATE
                    SET name = EXCLUDED.name,
                        is_active = EXCLUDED.is_active,
                        updated_at = now()
                    RETURNING id
                    """,
                    (company_id, code, name, bool(data.is_active)),
                )
                uom_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'uom_upsert', 'uom', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], uom_id, json.dumps({"code": code, "name": name, "is_active": bool(data.is_active)})),
                )
                return {"ok": True, "code": code}


class UomUpdateIn(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


@router.patch("/uoms/{code}", dependencies=[Depends(require_permission("config:write"))])
def update_uom(code: str, data: UomUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    ucode = _norm_uom(code)
    patch = data.model_dump(exclude_unset=True)
    if not patch:
        return {"ok": True}
    fields = []
    params = []
    if "name" in patch:
        fields.append("name = %s")
        params.append((patch.get("name") or "").strip() or ucode)
    if "is_active" in patch:
        fields.append("is_active = %s")
        params.append(bool(patch.get("is_active")))
    params.extend([company_id, ucode])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE unit_of_measures
                    SET {', '.join(fields)}, updated_at = now()
                    WHERE company_id = %s AND code = %s
                    RETURNING id
                    """,
                    params,
                )
                updated = cur.fetchone()
                if not updated:
                    raise HTTPException(status_code=404, detail="uom not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'uom_update', 'uom', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], updated["id"], json.dumps(patch)),
                )
                return {"ok": True}

@router.get("/barcodes", dependencies=[Depends(require_permission("items:read"))])
def list_all_barcodes(company_id: str = Depends(get_company_id)):
    """
    Convenience endpoint for UIs that need barcode/factor mappings for many items.

    Important: this must be defined before `/{item_id}` to avoid Starlette routing
    treating "barcodes" as an item_id.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, item_id, barcode, qty_factor, uom_code, label, is_primary, created_at, updated_at
                FROM item_barcodes
                WHERE company_id = %s
                ORDER BY item_id, is_primary DESC, created_at ASC
                """,
                (company_id,),
            )
            return {"barcodes": cur.fetchall()}


@router.post("/barcodes/bulk", dependencies=[Depends(require_permission("items:write"))])
def bulk_upsert_barcodes(data: BulkBarcodesIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Go-live utility: upsert item barcodes by (company_id, barcode), linking them to items by SKU.

    Why:
    - ERPNext exports include barcode UOM and conversion factors.
    - Our POS relies on barcode.qty_factor and barcode.uom_code to compute base quantities.
    - The normal `/{item_id}/barcodes` endpoint is intentionally append-only (audit trail),
      but imports need idempotent upserts.
    """
    lines = data.lines or []
    if not lines:
        raise HTTPException(status_code=400, detail="lines is required")
    if len(lines) > 20000:
        raise HTTPException(status_code=400, detail="too many lines (max 20000)")

    # Preload item ids + base UOMs by SKU for speed.
    skus = sorted({(ln.sku or "").strip() for ln in lines if (ln.sku or "").strip()})
    if not skus:
        raise HTTPException(status_code=400, detail="each line requires sku")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT sku, id, unit_of_measure
                    FROM items
                    WHERE company_id=%s AND sku = ANY(%s::text[])
                    """,
                    (company_id, skus),
                )
                item_by_sku = {(r["sku"] or "").strip(): {"id": r["id"], "uom": _norm_uom(r["unit_of_measure"])} for r in cur.fetchall()}

                missing = [s for s in skus if s not in item_by_sku]
                if missing:
                    raise HTTPException(status_code=400, detail=f"unknown sku(s): {missing[:25]}")

                upserted = 0
                for ln in lines:
                    sku = (ln.sku or "").strip()
                    barcode = (ln.barcode or "").strip()
                    if not sku or not barcode:
                        raise HTTPException(status_code=400, detail="each line requires sku and barcode")
                    if Decimal(str(ln.qty_factor or 0)) <= 0:
                        raise HTTPException(status_code=400, detail="qty_factor must be > 0")

                    it = item_by_sku[sku]
                    item_id = it["id"]
                    base_uom = it["uom"]

                    uom_code = _norm_uom(ln.uom_code) if ln.uom_code is not None and str(ln.uom_code).strip() else base_uom
                    _ensure_uom_exists(cur, company_id, uom_code)

                    qty_factor = Decimal(str(ln.qty_factor))

                    cur.execute(
                        """
                        INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, uom_code, label, is_primary)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (company_id, barcode) DO UPDATE
                        SET item_id = EXCLUDED.item_id,
                            qty_factor = EXCLUDED.qty_factor,
                            uom_code = EXCLUDED.uom_code,
                            label = EXCLUDED.label,
                            is_primary = EXCLUDED.is_primary,
                            updated_at = now()
                        RETURNING id
                        """,
                        (company_id, item_id, barcode, qty_factor, uom_code, (ln.label or None), bool(ln.is_primary)),
                    )
                    barcode_id = cur.fetchone()["id"]
                    upserted += 1

                    # Ensure conversion exists for the declared barcode UOM.
                    cur.execute(
                        """
                        INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, true)
                        ON CONFLICT (company_id, item_id, uom_code) DO UPDATE
                        SET to_base_factor = EXCLUDED.to_base_factor,
                            is_active = true,
                            updated_at = now()
                        """,
                        (company_id, item_id, uom_code, qty_factor),
                    )

                    if bool(ln.is_primary):
                        # Make all other barcodes for this item non-primary.
                        cur.execute(
                            """
                            UPDATE item_barcodes
                            SET is_primary = false, updated_at = now()
                            WHERE company_id = %s AND item_id = %s AND id <> %s
                            """,
                            (company_id, item_id, barcode_id),
                        )
                        cur.execute(
                            "UPDATE items SET barcode = %s, updated_at = now() WHERE company_id = %s AND id = %s",
                            (barcode, company_id, item_id),
                        )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_barcodes_bulk_upsert', 'barcode', gen_random_uuid(), %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"count": upserted})),
                )

                return {"ok": True, "upserted": upserted}

@router.get("/{item_id}", dependencies=[Depends(require_permission("items:read"))])
def get_item(item_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.barcode, i.name, i.item_type, i.tags,
                       i.unit_of_measure, i.tax_code_id, i.reorder_point, i.reorder_qty,
                       i.purchase_uom_code, i.sales_uom_code,
                       i.tax_category, i.is_excise,
                       i.is_active, i.category_id, i.brand, i.short_name, i.description,
                       i.track_batches, i.track_expiry,
                       i.default_shelf_life_days, i.min_shelf_life_days_for_sale, i.expiry_warning_days,
                       i.allow_negative_stock,
                       i.case_pack_qty, i.inner_pack_qty,
                       i.standard_cost_usd, i.standard_cost_lbp, i.min_margin_pct, i.costing_method,
                       i.preferred_supplier_id,
                       i.weight, i.volume,
                       i.external_ids,
                       i.image_attachment_id, i.image_alt,
                       i.created_at, i.updated_at,
                       COALESCE(
                         (
                           SELECT json_agg(json_build_object('barcode', b.barcode) ORDER BY b.barcode)
                           FROM item_barcodes b
                           WHERE b.company_id = i.company_id AND b.item_id = i.id
                         ),
                         '[]'::json
                       ) AS barcodes
                FROM items i
                WHERE i.company_id = %s AND i.id = %s
                """,
                (company_id, item_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="item not found")
            return {"item": row}


class ItemWarehousePolicyIn(BaseModel):
    warehouse_id: str
    min_stock: Decimal = Decimal("0")
    max_stock: Decimal = Decimal("0")
    preferred_supplier_id: Optional[str] = None
    replenishment_lead_time_days: Optional[int] = None
    notes: Optional[str] = None


@router.get("/{item_id}/warehouse-policies", dependencies=[Depends(require_permission("items:read"))])
def list_item_warehouse_policies(item_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM items WHERE company_id=%s AND id=%s", (company_id, item_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="item not found")
            cur.execute(
                """
                SELECT p.id, p.item_id, p.warehouse_id, w.name AS warehouse_name,
                       p.min_stock, p.max_stock, p.preferred_supplier_id,
                       s.name AS preferred_supplier_name,
                       p.replenishment_lead_time_days, p.notes, p.updated_at
                FROM item_warehouse_policies p
                JOIN warehouses w ON w.id = p.warehouse_id
                LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
                WHERE p.company_id=%s AND p.item_id=%s
                ORDER BY w.name ASC
                """,
                (company_id, item_id),
            )
            return {"policies": cur.fetchall()}


@router.post("/{item_id}/warehouse-policies", dependencies=[Depends(require_permission("items:write"))])
def upsert_item_warehouse_policy(
    item_id: str,
    data: ItemWarehousePolicyIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    if data.replenishment_lead_time_days is not None and data.replenishment_lead_time_days < 0:
        raise HTTPException(status_code=400, detail="replenishment_lead_time_days must be >= 0")
    if data.min_stock < 0 or data.max_stock < 0:
        raise HTTPException(status_code=400, detail="min/max stock must be >= 0")
    notes = (data.notes or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM items WHERE company_id=%s AND id=%s", (company_id, item_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="item not found")
                cur.execute("SELECT 1 FROM warehouses WHERE company_id=%s AND id=%s", (company_id, data.warehouse_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail="invalid warehouse_id")

                cur.execute(
                    """
                    INSERT INTO item_warehouse_policies
                      (id, company_id, item_id, warehouse_id, min_stock, max_stock, preferred_supplier_id, replenishment_lead_time_days, notes)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (company_id, item_id, warehouse_id) DO UPDATE
                      SET min_stock = EXCLUDED.min_stock,
                          max_stock = EXCLUDED.max_stock,
                          preferred_supplier_id = EXCLUDED.preferred_supplier_id,
                          replenishment_lead_time_days = EXCLUDED.replenishment_lead_time_days,
                          notes = EXCLUDED.notes,
                          updated_at = now()
                    RETURNING id
                    """,
                    (
                        company_id,
                        item_id,
                        data.warehouse_id,
                        data.min_stock or 0,
                        data.max_stock or 0,
                        data.preferred_supplier_id,
                        data.replenishment_lead_time_days,
                        notes,
                    ),
                )
                pid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_warehouse_policy_upsert', 'item_warehouse_policy', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], pid, json.dumps({"item_id": item_id, **data.model_dump()}, default=str)),
                )
                return {"id": pid}


@router.delete("/warehouse-policies/{policy_id}", dependencies=[Depends(require_permission("items:write"))])
def delete_item_warehouse_policy(
    policy_id: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM item_warehouse_policies
                    WHERE company_id=%s AND id=%s
                    RETURNING id
                    """,
                    (company_id, policy_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="policy not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_warehouse_policy_delete', 'item_warehouse_policy', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], policy_id, json.dumps({})),
                )
                return {"ok": True}


@router.post("", dependencies=[Depends(require_permission("items:write"))])
def create_item(data: ItemIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                barcode = data.barcode.strip() if data.barcode else None
                tags = [t.strip() for t in (data.tags or []) if (t or "").strip()] or None
                uom = _norm_uom(data.unit_of_measure)
                _ensure_uom_exists(cur, company_id, uom)
                purchase_uom = _norm_uom(data.purchase_uom_code) if data.purchase_uom_code else None
                sales_uom = _norm_uom(data.sales_uom_code) if data.sales_uom_code else None
                if purchase_uom:
                    _ensure_uom_exists(cur, company_id, purchase_uom)
                if sales_uom:
                    _ensure_uom_exists(cur, company_id, sales_uom)
                ext_ids = json.dumps(data.external_ids) if data.external_ids is not None else None
                cur.execute(
                    """
                    INSERT INTO items
                      (id, company_id, sku, barcode, name, item_type, tags, unit_of_measure, purchase_uom_code, sales_uom_code,
                       tax_code_id, tax_category, is_excise,
                       reorder_point, reorder_qty,
                       is_active, category_id, brand, short_name, description,
                       track_batches, track_expiry, default_shelf_life_days, min_shelf_life_days_for_sale, expiry_warning_days,
                       allow_negative_stock,
                       case_pack_qty, inner_pack_qty,
                       standard_cost_usd, standard_cost_lbp, min_margin_pct, costing_method,
                       preferred_supplier_id,
                       weight, volume,
                       external_ids,
                       image_attachment_id, image_alt)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s,
                       %s, %s, %s,
                       %s, %s,
                       %s, %s, %s, %s, %s,
                       %s, %s, %s, %s, %s,
                       %s,
                       %s, %s,
                       %s, %s, %s, %s,
                       %s,
                       %s, %s,
                       %s::jsonb,
                       %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        data.sku,
                        barcode,
                        data.name,
                        data.item_type,
                        tags,
                        uom,
                        purchase_uom,
                        sales_uom,
                        data.tax_code_id,
                        data.tax_category,
                        bool(data.is_excise),
                        data.reorder_point or 0,
                        data.reorder_qty or 0,
                        bool(data.is_active),
                        data.category_id,
                        (data.brand or "").strip() or None,
                        (data.short_name or "").strip() or None,
                        (data.description or "").strip() or None,
                        bool(data.track_batches),
                        bool(data.track_expiry),
                        data.default_shelf_life_days,
                        data.min_shelf_life_days_for_sale,
                        data.expiry_warning_days,
                        data.allow_negative_stock,
                        data.case_pack_qty,
                        data.inner_pack_qty,
                        data.standard_cost_usd,
                        data.standard_cost_lbp,
                        data.min_margin_pct,
                        data.costing_method,
                        data.preferred_supplier_id,
                        data.weight,
                        data.volume,
                        ext_ids,
                        data.image_attachment_id,
                        (data.image_alt or "").strip() or None,
                    ),
                )
                item_id = cur.fetchone()["id"]

                if barcode:
                    cur.execute(
                        """
                        INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, uom_code, is_primary)
                        VALUES (gen_random_uuid(), %s, %s, %s, 1, %s, true)
                        ON CONFLICT (company_id, barcode) DO NOTHING
                        """,
                        (company_id, item_id, barcode, uom),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_create', 'item', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], item_id, json.dumps(data.model_dump(), default=str)),
                )
                return {"id": item_id}


@router.post("/bulk", dependencies=[Depends(require_permission("items:write"))])
def bulk_upsert_items(data: BulkItemsIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Upsert items by (company_id, sku). This is used for go-live imports.
    """
    items = data.items or []
    if not items:
        raise HTTPException(status_code=400, detail="items is required")
    if len(items) > 5000:
        raise HTTPException(status_code=400, detail="too many items (max 5000)")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Preload tax codes by name for this company (optional mapping).
                cur.execute("SELECT id, name FROM tax_codes WHERE company_id = %s", (company_id,))
                tax_by_name = {(r["name"] or "").strip().lower(): r["id"] for r in cur.fetchall()}

                upserted = 0
                for it in items:
                    sku = (it.sku or "").strip()
                    name = (it.name or "").strip()
                    uom = _norm_uom((it.unit_of_measure or "").strip() or "EA")
                    if not sku or not name:
                        raise HTTPException(status_code=400, detail="each item requires sku and name")

                    _ensure_uom_exists(cur, company_id, uom)

                    barcode = (it.barcode or "").strip() or None
                    tax_code_id = None
                    if it.tax_code_name:
                        key = (it.tax_code_name or "").strip().lower()
                        if key:
                            tax_code_id = tax_by_name.get(key)
                            if not tax_code_id:
                                raise HTTPException(status_code=400, detail=f"unknown tax_code_name: {it.tax_code_name}")

                    reorder_point = it.reorder_point if it.reorder_point is not None else Decimal("0")
                    reorder_qty = it.reorder_qty if it.reorder_qty is not None else Decimal("0")
                    standard_cost_usd = it.standard_cost_usd
                    standard_cost_lbp = it.standard_cost_lbp

                    cur.execute(
                        """
                        INSERT INTO items (
                          id, company_id, sku, barcode, name, unit_of_measure,
                          tax_code_id, reorder_point, reorder_qty,
                          standard_cost_usd, standard_cost_lbp
                        )
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (company_id, sku) DO UPDATE
                        SET barcode = EXCLUDED.barcode,
                            name = EXCLUDED.name,
                            unit_of_measure = EXCLUDED.unit_of_measure,
                            tax_code_id = EXCLUDED.tax_code_id,
                            reorder_point = EXCLUDED.reorder_point,
                            reorder_qty = EXCLUDED.reorder_qty,
                            standard_cost_usd = COALESCE(EXCLUDED.standard_cost_usd, items.standard_cost_usd),
                            standard_cost_lbp = COALESCE(EXCLUDED.standard_cost_lbp, items.standard_cost_lbp),
                            updated_at = now()
                        RETURNING id
                        """,
                        (
                            company_id,
                            sku,
                            barcode,
                            name,
                            uom,
                            tax_code_id,
                            reorder_point,
                            reorder_qty,
                            standard_cost_usd,
                            standard_cost_lbp,
                        ),
                    )
                    item_id = cur.fetchone()["id"]
                    upserted += 1

                    if barcode:
                        # Ensure scanning works and primary barcode is kept in sync.
                        cur.execute(
                            """
                            INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, uom_code, is_primary)
                            VALUES (gen_random_uuid(), %s, %s, %s, 1, %s, true)
                            ON CONFLICT (company_id, barcode) DO UPDATE
                            SET item_id = EXCLUDED.item_id,
                                is_primary = true,
                                uom_code = EXCLUDED.uom_code,
                                updated_at = now()
                            """,
                            (company_id, item_id, barcode, uom),
                        )
                        cur.execute(
                            """
                            UPDATE item_barcodes
                            SET is_primary = false, updated_at = now()
                            WHERE company_id = %s AND item_id = %s AND barcode <> %s
                            """,
                            (company_id, item_id, barcode),
                        )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'items_bulk_upsert', 'items', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"count": upserted})),
                )

                return {"ok": True, "upserted": upserted}


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    item_type: Optional[ItemType] = None
    tags: Optional[List[str]] = None
    unit_of_measure: Optional[str] = None
    purchase_uom_code: Optional[str] = None
    sales_uom_code: Optional[str] = None
    barcode: Optional[str] = None
    tax_code_id: Optional[str] = None
    tax_category: Optional[TaxCategory] = None
    is_excise: Optional[bool] = None
    reorder_point: Optional[Decimal] = None
    reorder_qty: Optional[Decimal] = None
    is_active: Optional[bool] = None
    category_id: Optional[str] = None
    brand: Optional[str] = None
    short_name: Optional[str] = None
    description: Optional[str] = None
    track_batches: Optional[bool] = None
    track_expiry: Optional[bool] = None
    default_shelf_life_days: Optional[int] = None
    min_shelf_life_days_for_sale: Optional[int] = None
    expiry_warning_days: Optional[int] = None
    allow_negative_stock: Optional[bool] = None
    case_pack_qty: Optional[Decimal] = None
    inner_pack_qty: Optional[Decimal] = None
    standard_cost_usd: Optional[Decimal] = None
    standard_cost_lbp: Optional[Decimal] = None
    min_margin_pct: Optional[Decimal] = None
    costing_method: Optional[CostingMethod] = None
    preferred_supplier_id: Optional[str] = None
    weight: Optional[Decimal] = None
    volume: Optional[Decimal] = None
    external_ids: Optional[Dict[str, Any]] = None
    image_attachment_id: Optional[str] = None
    image_alt: Optional[str] = None


@router.patch("/{item_id}", dependencies=[Depends(require_permission("items:write"))])
def update_item(item_id: str, data: ItemUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_unset=True)
    uom_to_ensure: Optional[str] = None
    if "unit_of_measure" in patch:
        uom_to_ensure = _norm_uom(patch.get("unit_of_measure"))
        patch["unit_of_measure"] = uom_to_ensure
    if "purchase_uom_code" in patch and patch.get("purchase_uom_code") is not None:
        patch["purchase_uom_code"] = _norm_uom(patch.get("purchase_uom_code"))
    if "sales_uom_code" in patch and patch.get("sales_uom_code") is not None:
        patch["sales_uom_code"] = _norm_uom(patch.get("sales_uom_code"))

    fields = []
    params = []
    # Use exclude_unset so clients can explicitly clear nullable fields (e.g. tax_code_id).
    for k, v in patch.items():
        if k == "barcode" and isinstance(v, str):
            fields.append("barcode = %s")
            params.append(v.strip() or None)
        elif k == "tags" and isinstance(v, list):
            fields.append("tags = %s")
            norm = [str(t).strip() for t in v if str(t or "").strip()]
            params.append(norm or None)
        elif k in {"brand", "short_name", "description", "image_alt"} and isinstance(v, str):
            fields.append(f"{k} = %s")
            params.append(v.strip() or None)
        elif k in {"purchase_uom_code", "sales_uom_code"} and isinstance(v, str):
            fields.append(f"{k} = %s")
            params.append(v.strip() or None)
        elif k == "external_ids":
            fields.append("external_ids = %s::jsonb")
            params.append(json.dumps(v) if v is not None else None)
        else:
            fields.append(f"{k} = %s")
            params.append(v)
    if not fields:
        return {"ok": True}
    params.extend([company_id, item_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Lock the item row so base-UOM changes can be validated safely.
                cur.execute(
                    "SELECT unit_of_measure FROM items WHERE company_id=%s AND id=%s FOR UPDATE",
                    (company_id, item_id),
                )
                existing = cur.fetchone()
                if not existing:
                    raise HTTPException(status_code=404, detail="item not found")
                existing_base_uom = _norm_uom(existing.get("unit_of_measure"))

                if uom_to_ensure:
                    # Base UOM is effectively the "stock UOM". Changing it after any document/stock history
                    # changes the meaning of stored quantities, so we forbid it once the item has activity.
                    if uom_to_ensure != existing_base_uom:
                        cur.execute(
                            "SELECT 1 FROM stock_moves WHERE company_id=%s AND item_id=%s LIMIT 1",
                            (company_id, item_id),
                        )
                        if cur.fetchone():
                            raise HTTPException(status_code=409, detail="cannot change base UOM after stock moves exist")
                        cur.execute(
                            "SELECT 1 FROM goods_receipt_lines WHERE company_id=%s AND item_id=%s LIMIT 1",
                            (company_id, item_id),
                        )
                        if cur.fetchone():
                            raise HTTPException(status_code=409, detail="cannot change base UOM after goods receipts exist")
                        cur.execute(
                            "SELECT 1 FROM supplier_invoice_lines WHERE company_id=%s AND item_id=%s LIMIT 1",
                            (company_id, item_id),
                        )
                        if cur.fetchone():
                            raise HTTPException(status_code=409, detail="cannot change base UOM after supplier invoices exist")
                        cur.execute(
                            "SELECT 1 FROM purchase_order_lines WHERE company_id=%s AND item_id=%s LIMIT 1",
                            (company_id, item_id),
                        )
                        if cur.fetchone():
                            raise HTTPException(status_code=409, detail="cannot change base UOM after purchase orders exist")
                        cur.execute(
                            """
                            SELECT 1
                            FROM sales_invoice_lines l
                            JOIN sales_invoices i ON i.id = l.invoice_id
                            WHERE i.company_id=%s AND l.item_id=%s
                            LIMIT 1
                            """,
                            (company_id, item_id),
                        )
                        if cur.fetchone():
                            raise HTTPException(status_code=409, detail="cannot change base UOM after sales invoices exist")
                        cur.execute(
                            "SELECT 1 FROM sales_return_lines WHERE company_id=%s AND item_id=%s LIMIT 1",
                            (company_id, item_id),
                        )
                        if cur.fetchone():
                            raise HTTPException(status_code=409, detail="cannot change base UOM after sales returns exist")
                        cur.execute(
                            "SELECT 1 FROM stock_transfer_lines WHERE company_id=%s AND item_id=%s LIMIT 1",
                            (company_id, item_id),
                        )
                        if cur.fetchone():
                            raise HTTPException(status_code=409, detail="cannot change base UOM after stock transfers exist")

                    _ensure_uom_exists(cur, company_id, uom_to_ensure)

                # Secondary/default UOMs are optional; ensure the master codes exist if set.
                pu = patch.get("purchase_uom_code")
                su = patch.get("sales_uom_code")
                if isinstance(pu, str) and pu.strip():
                    _ensure_uom_exists(cur, company_id, pu.strip())
                if isinstance(su, str) and su.strip():
                    _ensure_uom_exists(cur, company_id, su.strip())
                cur.execute(
                    f"""
                    UPDATE items
                    SET {', '.join(fields)}
                    WHERE company_id = %s AND id = %s
                    """,
                    params,
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="item not found")

                # Ensure base conversion row exists (uom_code=items.unit_of_measure, factor=1).
                if uom_to_ensure:
                    cur.execute(
                        """
                        INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
                        VALUES (gen_random_uuid(), %s, %s, %s, 1, true)
                        ON CONFLICT (company_id, item_id, uom_code) DO UPDATE
                        SET to_base_factor = 1,
                            is_active = true,
                            updated_at = now()
                        """,
                        (company_id, item_id, uom_to_ensure),
                    )

                # Mirror legacy primary barcode into item_barcodes for POS scanning.
                patch = data.model_dump(exclude_none=True)
                if "barcode" in patch:
                    new_barcode = (data.barcode.strip() if isinstance(data.barcode, str) else None) or None
                    if new_barcode:
                        cur.execute(
                            """
                            INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, uom_code, is_primary)
                            VALUES (gen_random_uuid(), %s, %s, %s, 1, %s, true)
                            ON CONFLICT (company_id, barcode) DO UPDATE
                            SET item_id = EXCLUDED.item_id,
                                is_primary = true,
                                uom_code = EXCLUDED.uom_code,
                                updated_at = now()
                            """,
                            (company_id, item_id, new_barcode, uom_to_ensure or existing_base_uom),
                        )
                        cur.execute(
                            """
                            UPDATE item_barcodes
                            SET is_primary = false, updated_at = now()
                            WHERE company_id = %s AND item_id = %s AND barcode <> %s
                            """,
                            (company_id, item_id, new_barcode),
                        )
                    else:
                        cur.execute(
                            """
                            UPDATE item_barcodes
                            SET is_primary = false, updated_at = now()
                            WHERE company_id = %s AND item_id = %s
                            """,
                            (company_id, item_id),
                        )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_update', 'item', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], item_id, json.dumps(patch, default=str)),
                )
                return {"ok": True}


@router.post("/{item_id}/prices", dependencies=[Depends(require_permission("items:write"))])
def add_item_price(item_id: str, data: ItemPriceIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM items WHERE company_id=%s AND id=%s",
                    (company_id, item_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="item not found")

                cur.execute(
                    """
                    INSERT INTO item_prices (id, item_id, price_usd, price_lbp, effective_from, effective_to, source_type, source_id)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, 'manual', gen_random_uuid())
                    RETURNING id
                    """,
                    (item_id, data.price_usd, data.price_lbp, data.effective_from, data.effective_to),
                )
                price_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_price_added', 'item', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], item_id, json.dumps({"item_price_id": str(price_id), **data.model_dump()}, default=str)),
                )
                return {"id": price_id}


@router.get("/{item_id}/prices", dependencies=[Depends(require_permission("items:read"))])
def list_item_prices(item_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, price_usd, price_lbp, effective_from, effective_to
                FROM item_prices
                WHERE item_id = %s
                ORDER BY effective_from DESC
                """,
                (item_id,),
            )
            return {"prices": cur.fetchall()}


@router.post("/prices/bulk", dependencies=[Depends(require_permission("items:write"))])
def bulk_upsert_item_prices(data: BulkItemPricesIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Go-live utility: bulk upsert item_prices by SKU.

    Idempotency:
    - We derive a deterministic (source_type, source_id) per line so repeated imports
      don't create duplicate price rows.
    """
    lines = data.lines or []
    if not lines:
        raise HTTPException(status_code=400, detail="lines is required")
    if len(lines) > 5000:
        raise HTTPException(status_code=400, detail="too many lines (max 5000)")

    eff = data.effective_from or date.today()
    # Keep consistent with ERPNext importer UUID namespace to allow stable re-runs.
    namespace = uuid.UUID("8d5fe1a9-64b2-4dd4-9f45-4d2045b0fd4a")
    source_type = "erpnext_price_import"

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                skus = sorted({(ln.sku or "").strip() for ln in lines if (ln.sku or "").strip()})
                if not skus:
                    raise HTTPException(status_code=400, detail="each line requires sku")

                cur.execute(
                    """
                    SELECT sku, id
                    FROM items
                    WHERE company_id=%s AND sku = ANY(%s::text[])
                    """,
                    (company_id, skus),
                )
                sku_to_id = {str(r["sku"]): str(r["id"]) for r in cur.fetchall()}

                upserted = 0
                for ln in lines:
                    sku = (ln.sku or "").strip()
                    if not sku:
                        raise HTTPException(status_code=400, detail="each line requires sku")
                    item_id = sku_to_id.get(sku)
                    if not item_id:
                        raise HTTPException(status_code=400, detail=f"unknown sku: {sku}")

                    price_usd = Decimal(str(ln.price_usd or 0))
                    price_lbp = Decimal(str(ln.price_lbp or 0))
                    if price_usd < 0 or price_lbp < 0:
                        raise HTTPException(status_code=400, detail=f"negative price not allowed: {sku}")

                    # Deterministic id per (company, sku, effective_from).
                    src = str(uuid.uuid5(namespace, f"price:{company_id}:{sku}:{eff.isoformat()}"))
                    try:
                        cur.execute(
                            """
                            INSERT INTO item_prices (id, item_id, price_usd, price_lbp, effective_from, effective_to, source_type, source_id)
                            VALUES (gen_random_uuid(), %s, %s, %s, %s, NULL, %s, %s::uuid)
                            ON CONFLICT (source_type, source_id) DO UPDATE
                            SET item_id = EXCLUDED.item_id,
                                price_usd = EXCLUDED.price_usd,
                                price_lbp = EXCLUDED.price_lbp,
                                effective_from = EXCLUDED.effective_from,
                                effective_to = EXCLUDED.effective_to
                            """,
                            (item_id, price_usd, price_lbp, eff, source_type, src),
                        )
                    except (pg_errors.UndefinedColumn, pg_errors.UndefinedTable, pg_errors.InvalidColumnReference) as e:
                        raise HTTPException(status_code=500, detail=f"db schema mismatch: {e}") from None
                    upserted += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_prices_bulk_upsert', 'item_prices', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"count": upserted, "effective_from": eff.isoformat()})),
                )
                return {"ok": True, "upserted": upserted, "effective_from": eff}


@router.post("/uom-conversions/bulk", dependencies=[Depends(require_permission("items:write"))])
def bulk_upsert_item_uom_conversions(
    data: BulkUomConversionsIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Go-live utility: bulk upsert item_uom_conversions by SKU.
    """
    lines = data.lines or []
    if not lines:
        raise HTTPException(status_code=400, detail="lines is required")
    if len(lines) > 20000:
        raise HTTPException(status_code=400, detail="too many lines (max 20000)")

    skus = sorted({(ln.sku or "").strip() for ln in lines if (ln.sku or "").strip()})
    if not skus:
        raise HTTPException(status_code=400, detail="each line requires sku")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT sku, id, unit_of_measure
                    FROM items
                    WHERE company_id=%s AND sku = ANY(%s::text[])
                    """,
                    (company_id, skus),
                )
                item_by_sku = {
                    (str(r["sku"]) or "").strip(): {"id": str(r["id"]), "base_uom": _norm_uom(r.get("unit_of_measure"))}
                    for r in (cur.fetchall() or [])
                }

                missing = [s for s in skus if s not in item_by_sku]
                if missing:
                    raise HTTPException(status_code=400, detail=f"unknown sku(s): {missing[:25]}")

                upserted = 0
                for ln in lines:
                    sku = (ln.sku or "").strip()
                    if not sku:
                        raise HTTPException(status_code=400, detail="each line requires sku")
                    it = item_by_sku[sku]
                    item_id = it["id"]
                    base_uom = it["base_uom"]

                    uom_code = _norm_uom(ln.uom_code)
                    f = Decimal(str(ln.to_base_factor or 0))
                    if f <= 0:
                        raise HTTPException(status_code=400, detail=f"to_base_factor must be > 0: {sku}/{uom_code}")
                    if uom_code == base_uom and f != 1:
                        raise HTTPException(status_code=400, detail=f"base UOM conversion factor must be 1: {sku}/{uom_code}")
                    if uom_code != base_uom and f == 1:
                        # Allowed, but usually indicates missing data; keep permissive.
                        pass

                    _ensure_uom_exists(cur, company_id, uom_code)

                    cur.execute(
                        """
                        INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                        ON CONFLICT (company_id, item_id, uom_code) DO UPDATE
                        SET to_base_factor = EXCLUDED.to_base_factor,
                            is_active = EXCLUDED.is_active,
                            updated_at = now()
                        """,
                        (company_id, item_id, uom_code, f, bool(ln.is_active)),
                    )
                    upserted += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_uom_conversions_bulk_upsert', 'item_uom_conversions', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"count": upserted})),
                )
                return {"ok": True, "upserted": upserted}


@router.post("/category-assign/bulk", dependencies=[Depends(require_permission("items:write"))])
def bulk_assign_item_categories(
    data: BulkCategoryAssignRequest,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Go-live utility: assign item_categories by SKU.
    Category names must already exist (use /item-categories to create them).
    """
    lines = data.lines or []
    if not lines:
        raise HTTPException(status_code=400, detail="lines is required")
    if len(lines) > 20000:
        raise HTTPException(status_code=400, detail="too many lines (max 20000)")

    skus = sorted({(ln.sku or "").strip() for ln in lines if (ln.sku or "").strip()})
    if not skus:
        raise HTTPException(status_code=400, detail="each line requires sku")

    cat_names = sorted({(ln.category_name or "").strip() for ln in lines if (ln.category_name or "").strip()})
    if not cat_names:
        raise HTTPException(status_code=400, detail="each line requires category_name")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT sku, id
                    FROM items
                    WHERE company_id=%s AND sku = ANY(%s::text[])
                    """,
                    (company_id, skus),
                )
                item_by_sku = {(str(r["sku"]) or "").strip(): str(r["id"]) for r in (cur.fetchall() or [])}
                missing_items = [s for s in skus if s not in item_by_sku]
                if missing_items:
                    raise HTTPException(status_code=400, detail=f"unknown sku(s): {missing_items[:25]}")

                cur.execute(
                    """
                    SELECT id, name
                    FROM item_categories
                    WHERE company_id=%s AND name = ANY(%s::text[])
                    """,
                    (company_id, cat_names),
                )
                cat_by_name = {(str(r["name"]) or "").strip(): str(r["id"]) for r in (cur.fetchall() or [])}
                missing_cats = [n for n in cat_names if n not in cat_by_name]
                if missing_cats:
                    raise HTTPException(status_code=400, detail=f"unknown category_name(s): {missing_cats[:25]}")

                updated = 0
                for ln in lines:
                    sku = (ln.sku or "").strip()
                    cname = (ln.category_name or "").strip()
                    if not sku or not cname:
                        continue
                    cur.execute(
                        """
                        UPDATE items
                        SET category_id=%s::uuid, updated_at=now()
                        WHERE company_id=%s AND id=%s
                        """,
                        (cat_by_name[cname], company_id, item_by_sku[sku]),
                    )
                    updated += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'items_bulk_category_assign', 'items', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"count": updated})),
                )
                return {"ok": True, "updated": updated}


class ItemBarcodeIn(BaseModel):
    barcode: str
    qty_factor: Decimal = Decimal("1")
    uom_code: Optional[str] = None
    label: Optional[str] = None
    is_primary: bool = False


class ItemBarcodeUpdate(BaseModel):
    qty_factor: Optional[Decimal] = None
    uom_code: Optional[str] = None
    label: Optional[str] = None
    is_primary: Optional[bool] = None


class ItemNameSuggestIn(BaseModel):
    raw_name: str
    count: int = 3


@router.post("/name-suggestions", dependencies=[Depends(require_permission("items:write"))])
def suggest_item_names(data: ItemNameSuggestIn, company_id: str = Depends(get_company_id)):
    raw = (data.raw_name or "").strip()
    n = max(1, min(int(data.count or 3), 6))
    if not raw:
        raise HTTPException(status_code=400, detail="raw_name is required")

    # Prefer an LLM if configured; otherwise fall back to deterministic normalization.
    try:
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                if is_external_ai_allowed(cur, company_id):
                    cfg = get_ai_provider_config(cur, company_id)
                    if cfg.get("api_key"):
                        return {
                            "suggestions": openai_item_name_suggestions(
                                raw,
                                count=n,
                                model=cfg.get("item_naming_model"),
                                base_url=cfg.get("base_url"),
                                api_key=cfg.get("api_key"),
                            )
                        }
    except Exception:
        # Never fail the UI due to naming suggestions.
        pass
    return {"suggestions": heuristic_item_name_suggestions(raw)[:n]}

@router.get("/{item_id}/barcodes", dependencies=[Depends(require_permission("items:read"))])
def list_item_barcodes(item_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, barcode, qty_factor, uom_code, label, is_primary, created_at, updated_at
                    FROM item_barcodes
                    WHERE company_id = %s AND item_id = %s
                    ORDER BY is_primary DESC, created_at ASC
                    """,
                    (company_id, item_id),
                )
                return {"barcodes": cur.fetchall()}


@router.post("/{item_id}/barcodes", dependencies=[Depends(require_permission("items:write"))])
def add_item_barcode(item_id: str, data: ItemBarcodeIn, company_id: str = Depends(get_company_id)):
    barcode = data.barcode.strip()
    if not barcode:
        raise HTTPException(status_code=400, detail="barcode is required")
    if data.qty_factor <= 0:
        raise HTTPException(status_code=400, detail="qty_factor must be > 0")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT unit_of_measure FROM items WHERE company_id = %s AND id = %s", (company_id, item_id))
                it = cur.fetchone()
                if not it:
                    raise HTTPException(status_code=404, detail="item not found")
                base_uom = _norm_uom(it.get("unit_of_measure"))

                uom_code = _norm_uom(data.uom_code) if data.uom_code is not None else None
                if data.qty_factor != 1 and not uom_code:
                    raise HTTPException(status_code=400, detail="uom_code is required when qty_factor != 1")
                if uom_code and uom_code == base_uom and data.qty_factor != 1:
                    raise HTTPException(status_code=400, detail="qty_factor must be 1 when uom_code is the item base UOM")
                if uom_code:
                    _ensure_uom_exists(cur, company_id, uom_code)

                cur.execute(
                    """
                    INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, uom_code, label, is_primary)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, item_id, barcode, data.qty_factor, uom_code or base_uom, data.label, data.is_primary),
                )
                barcode_id = cur.fetchone()["id"]

                # Ensure conversion exists for the declared barcode UOM.
                # We store the factor used at scan time in docs, so future edits won't rewrite history.
                bc_uom = uom_code or base_uom
                cur.execute(
                    """
                    INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, true)
                    ON CONFLICT (company_id, item_id, uom_code) DO UPDATE
                    SET to_base_factor = EXCLUDED.to_base_factor,
                        is_active = true,
                        updated_at = now()
                    """,
                    (company_id, item_id, bc_uom, Decimal(str(data.qty_factor))),
                )

                if data.is_primary:
                    cur.execute(
                        """
                        UPDATE item_barcodes
                        SET is_primary = false, updated_at = now()
                        WHERE company_id = %s AND item_id = %s AND id <> %s
                        """,
                        (company_id, item_id, barcode_id),
                    )
                    cur.execute(
                        "UPDATE items SET barcode = %s WHERE company_id = %s AND id = %s",
                        (barcode, company_id, item_id),
                    )

                cur.execute(
                    """
                    SELECT COUNT(*)::int AS cnt, BOOL_OR(is_primary) AS has_primary
                    FROM item_barcodes
                    WHERE company_id = %s AND item_id = %s
                    """,
                    (company_id, item_id),
                )
                stats = cur.fetchone()
                if stats and int(stats["cnt"] or 0) == 1 and not stats["has_primary"]:
                    cur.execute("UPDATE item_barcodes SET is_primary = true, updated_at = now() WHERE id = %s", (barcode_id,))
                    cur.execute("UPDATE items SET barcode = %s WHERE company_id = %s AND id = %s", (barcode, company_id, item_id))

                return {"id": barcode_id}


@router.patch("/barcodes/{barcode_id}", dependencies=[Depends(require_permission("items:write"))])
def update_item_barcode(barcode_id: str, data: ItemBarcodeUpdate, company_id: str = Depends(get_company_id)):
    patch = data.model_dump(exclude_none=True)
    if "qty_factor" in patch and patch["qty_factor"] is not None and patch["qty_factor"] <= 0:
        raise HTTPException(status_code=400, detail="qty_factor must be > 0")
    if "uom_code" in patch and patch["uom_code"] is not None:
        patch["uom_code"] = _norm_uom(patch["uom_code"])
    if not patch:
        return {"ok": True}

    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
    params.extend([company_id, barcode_id])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE item_barcodes
                    SET {', '.join(fields)}, updated_at = now()
                    WHERE company_id = %s AND id = %s
                    RETURNING id, item_id, barcode, qty_factor, uom_code
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="barcode not found")

                # Validate vs item base UOM.
                cur.execute("SELECT unit_of_measure FROM items WHERE company_id=%s AND id=%s", (company_id, row["item_id"]))
                it = cur.fetchone()
                if not it:
                    raise HTTPException(status_code=404, detail="item not found")
                base_uom = _norm_uom(it.get("unit_of_measure"))
                bc_uom = _norm_uom(row.get("uom_code") or base_uom)
                bc_factor = Decimal(str(row.get("qty_factor") or 1))
                if bc_uom == base_uom and bc_factor != 1:
                    raise HTTPException(status_code=400, detail="qty_factor must be 1 when uom_code is the item base UOM")
                _ensure_uom_exists(cur, company_id, bc_uom)

                # Keep conversions in sync (best-effort upsert).
                cur.execute(
                    """
                    INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, true)
                    ON CONFLICT (company_id, item_id, uom_code) DO UPDATE
                    SET to_base_factor = EXCLUDED.to_base_factor,
                        is_active = true,
                        updated_at = now()
                    """,
                    (company_id, row["item_id"], bc_uom, bc_factor),
                )

                if patch.get("is_primary") is True:
                    cur.execute(
                        """
                        UPDATE item_barcodes
                        SET is_primary = false, updated_at = now()
                        WHERE company_id = %s AND item_id = %s AND id <> %s
                        """,
                        (company_id, row["item_id"], barcode_id),
                    )
                    cur.execute(
                        "UPDATE items SET barcode = %s WHERE company_id = %s AND id = %s",
                        (row["barcode"], company_id, row["item_id"]),
                    )

                return {"ok": True}


@router.delete("/barcodes/{barcode_id}", dependencies=[Depends(require_permission("items:write"))])
def delete_item_barcode(barcode_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, item_id, barcode, is_primary
                    FROM item_barcodes
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, barcode_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="barcode not found")

                cur.execute("DELETE FROM item_barcodes WHERE company_id = %s AND id = %s", (company_id, barcode_id))

                if row["is_primary"]:
                    cur.execute(
                        """
                        SELECT id, barcode
                        FROM item_barcodes
                        WHERE company_id = %s AND item_id = %s
                        ORDER BY created_at ASC
                        LIMIT 1
                        """,
                        (company_id, row["item_id"]),
                    )
                    next_row = cur.fetchone()
                    if next_row:
                        cur.execute("UPDATE item_barcodes SET is_primary = true, updated_at = now() WHERE id = %s", (next_row["id"],))
                        cur.execute(
                            "UPDATE items SET barcode = %s WHERE company_id = %s AND id = %s",
                            (next_row["barcode"], company_id, row["item_id"]),
                        )
                    else:
                        cur.execute("UPDATE items SET barcode = NULL WHERE company_id = %s AND id = %s", (company_id, row["item_id"]))

                return {"ok": True}


class ItemUomConversionIn(BaseModel):
    uom_code: str
    to_base_factor: Decimal = Decimal("1")
    is_active: bool = True


@router.get("/{item_id}/uom-conversions", dependencies=[Depends(require_permission("items:read"))])
def list_item_uom_conversions(item_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute("SELECT unit_of_measure FROM items WHERE company_id=%s AND id=%s", (company_id, item_id))
            it = cur.fetchone()
            if not it:
                raise HTTPException(status_code=404, detail="item not found")
            base_uom = _norm_uom(it.get("unit_of_measure"))
            cur.execute(
                """
                SELECT c.uom_code, u.name AS uom_name, u.precision AS uom_precision,
                       c.to_base_factor, c.is_active, c.created_at, c.updated_at
                FROM item_uom_conversions c
                JOIN unit_of_measures u
                  ON u.company_id = c.company_id AND u.code = c.uom_code
                WHERE c.company_id=%s AND c.item_id=%s
                ORDER BY (c.uom_code = %s) DESC, c.uom_code ASC
                """,
                (company_id, item_id, base_uom),
            )
            rows = [dict(r) for r in (cur.fetchall() or [])]
            has_base = any(str(r.get("uom_code") or "").strip().upper() == base_uom for r in rows)
            if not has_base:
                cur.execute(
                    """
                    SELECT name, precision
                    FROM unit_of_measures
                    WHERE company_id=%s AND code=%s
                    """,
                    (company_id, base_uom),
                )
                u = cur.fetchone() or {}
                rows.insert(
                    0,
                    {
                        "uom_code": base_uom,
                        "uom_name": u.get("name") or base_uom,
                        "uom_precision": u.get("precision"),
                        "to_base_factor": Decimal("1"),
                        "is_active": True,
                        "created_at": None,
                        "updated_at": None,
                    },
                )
            rows.sort(key=lambda r: (0 if str(r.get("uom_code") or "").strip().upper() == base_uom else 1, str(r.get("uom_code") or "")))
            return {"base_uom": base_uom, "conversions": rows}


@router.post("/{item_id}/uom-conversions", dependencies=[Depends(require_permission("items:write"))])
def upsert_item_uom_conversion(item_id: str, data: ItemUomConversionIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    uom_code = _norm_uom(data.uom_code)
    f = Decimal(str(data.to_base_factor or 0))
    if f <= 0:
        raise HTTPException(status_code=400, detail="to_base_factor must be > 0")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT unit_of_measure FROM items WHERE company_id=%s AND id=%s FOR UPDATE", (company_id, item_id))
                it = cur.fetchone()
                if not it:
                    raise HTTPException(status_code=404, detail="item not found")
                base_uom = _norm_uom(it.get("unit_of_measure"))
                if uom_code == base_uom and f != 1:
                    raise HTTPException(status_code=400, detail="base UOM conversion factor must be 1")
                _ensure_uom_exists(cur, company_id, uom_code)
                cur.execute(
                    """
                    INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                    ON CONFLICT (company_id, item_id, uom_code) DO UPDATE
                    SET to_base_factor = EXCLUDED.to_base_factor,
                        is_active = EXCLUDED.is_active,
                        updated_at = now()
                    """,
                    (company_id, item_id, uom_code, f, bool(data.is_active)),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_uom_conversion_upsert', 'item', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], item_id, json.dumps({"uom_code": uom_code, "to_base_factor": str(f), "is_active": bool(data.is_active)})),
                )
                return {"ok": True}


class ItemUomConversionUpdateIn(BaseModel):
    to_base_factor: Optional[Decimal] = None
    is_active: Optional[bool] = None


@router.patch("/{item_id}/uom-conversions/{uom_code}", dependencies=[Depends(require_permission("items:write"))])
def update_item_uom_conversion(item_id: str, uom_code: str, data: ItemUomConversionUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    u = _norm_uom(uom_code)
    patch = data.model_dump(exclude_unset=True)
    if not patch:
        return {"ok": True}
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT unit_of_measure FROM items WHERE company_id=%s AND id=%s FOR UPDATE", (company_id, item_id))
                it = cur.fetchone()
                if not it:
                    raise HTTPException(status_code=404, detail="item not found")
                base_uom = _norm_uom(it.get("unit_of_measure"))

                if "to_base_factor" in patch and patch["to_base_factor"] is not None:
                    f = Decimal(str(patch["to_base_factor"] or 0))
                    if f <= 0:
                        raise HTTPException(status_code=400, detail="to_base_factor must be > 0")
                    if u == base_uom and f != 1:
                        raise HTTPException(status_code=400, detail="base UOM conversion factor must be 1")
                if u == base_uom and patch.get("is_active") is False:
                    raise HTTPException(status_code=400, detail="cannot deactivate the base UOM conversion")

                fields = []
                params = []
                if "to_base_factor" in patch and patch["to_base_factor"] is not None:
                    fields.append("to_base_factor = %s")
                    params.append(Decimal(str(patch["to_base_factor"])))
                if "is_active" in patch and patch["is_active"] is not None:
                    fields.append("is_active = %s")
                    params.append(bool(patch["is_active"]))
                if not fields:
                    return {"ok": True}
                params.extend([company_id, item_id, u])
                cur.execute(
                    f"""
                    UPDATE item_uom_conversions
                    SET {', '.join(fields)}, updated_at = now()
                    WHERE company_id=%s AND item_id=%s AND uom_code=%s
                    """,
                    params,
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="conversion not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_uom_conversion_update', 'item', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], item_id, json.dumps({"uom_code": u, **patch}, default=str)),
                )
                return {"ok": True}


class UomConversionLookupIn(BaseModel):
    item_ids: List[str]


@router.post("/uom-conversions/lookup", dependencies=[Depends(require_permission("items:read"))])
def lookup_item_uom_conversions(data: UomConversionLookupIn, company_id: str = Depends(get_company_id)):
    ids = sorted({str(i).strip() for i in (data.item_ids or []) if str(i).strip()})
    if not ids:
        return {"conversions": {}}
    if len(ids) > 500:
        raise HTTPException(status_code=400, detail="too many item_ids (max 500)")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.item_id, c.uom_code, u.name AS uom_name, u.precision AS uom_precision,
                       c.to_base_factor, c.is_active
                FROM item_uom_conversions c
                JOIN unit_of_measures u
                  ON u.company_id = c.company_id AND u.code = c.uom_code
                WHERE c.company_id=%s AND c.item_id = ANY(%s::uuid[])
                ORDER BY c.item_id, (c.to_base_factor = 1) DESC, c.uom_code ASC
                """,
                (company_id, ids),
            )
            out: dict[str, list[dict]] = {}
            for r in cur.fetchall():
                out.setdefault(str(r["item_id"]), []).append(dict(r))
            return {"conversions": out}
