from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional, List, Literal
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission
from ..deps import get_current_user
import json
import os
import uuid
from ..ai.item_naming import heuristic_item_name_suggestions, openai_item_name_suggestions
from ..ai.providers import get_ai_provider_config
from ..ai.policy import is_external_ai_allowed

router = APIRouter(prefix="/items", tags=["items"])

ItemType = Literal["stocked", "service", "bundle"]

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
    barcode: Optional[str] = None
    tax_code_id: Optional[str] = None
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
    image_attachment_id: Optional[str] = None
    image_alt: Optional[str] = None


class BulkItemIn(BaseModel):
    sku: str
    name: str
    unit_of_measure: str = "EA"
    barcode: Optional[str] = None
    tax_code_name: Optional[str] = None
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


@router.get("", dependencies=[Depends(require_permission("items:read"))])
def list_items(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.barcode, i.name, i.item_type, i.tags,
                       i.unit_of_measure, i.tax_code_id, i.reorder_point, i.reorder_qty,
                       i.is_active, i.category_id, i.brand, i.short_name, i.description,
                       i.track_batches, i.track_expiry,
                       i.default_shelf_life_days, i.min_shelf_life_days_for_sale, i.expiry_warning_days,
                       i.allow_negative_stock,
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
                    """,
                    (company_id, code, name, bool(data.is_active)),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'uom_upsert', 'uom', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], code, json.dumps({"code": code, "name": name, "is_active": bool(data.is_active)})),
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
                    """,
                    params,
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'uom_update', 'uom', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], ucode, json.dumps(patch)),
                )
                return {"ok": True}

@router.get("/{item_id}", dependencies=[Depends(require_permission("items:read"))])
def get_item(item_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.barcode, i.name, i.item_type, i.tags,
                       i.unit_of_measure, i.tax_code_id, i.reorder_point, i.reorder_qty,
                       i.is_active, i.category_id, i.brand, i.short_name, i.description,
                       i.track_batches, i.track_expiry,
                       i.default_shelf_life_days, i.min_shelf_life_days_for_sale, i.expiry_warning_days,
                       i.allow_negative_stock,
                       i.image_attachment_id, i.image_alt,
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
                cur.execute(
                    """
                    INSERT INTO items
                      (id, company_id, sku, barcode, name, item_type, tags, unit_of_measure, tax_code_id, reorder_point, reorder_qty,
                       is_active, category_id, brand, short_name, description,
                       track_batches, track_expiry, default_shelf_life_days, min_shelf_life_days_for_sale, expiry_warning_days,
                       allow_negative_stock,
                       image_attachment_id, image_alt)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                       %s, %s, %s, %s, %s,
                       %s, %s, %s, %s, %s,
                       %s, %s, %s)
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
                        data.tax_code_id,
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
                        data.image_attachment_id,
                        (data.image_alt or "").strip() or None,
                    ),
                )
                item_id = cur.fetchone()["id"]

                if barcode:
                    cur.execute(
                        """
                        INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, is_primary)
                        VALUES (gen_random_uuid(), %s, %s, %s, 1, true)
                        ON CONFLICT (company_id, barcode) DO NOTHING
                        """,
                        (company_id, item_id, barcode),
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

                    cur.execute(
                        """
                        INSERT INTO items (id, company_id, sku, barcode, name, unit_of_measure, tax_code_id, reorder_point, reorder_qty)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (company_id, sku) DO UPDATE
                        SET barcode = EXCLUDED.barcode,
                            name = EXCLUDED.name,
                            unit_of_measure = EXCLUDED.unit_of_measure,
                            tax_code_id = EXCLUDED.tax_code_id,
                            reorder_point = EXCLUDED.reorder_point,
                            reorder_qty = EXCLUDED.reorder_qty,
                            updated_at = now()
                        RETURNING id
                        """,
                        (company_id, sku, barcode, name, uom, tax_code_id, reorder_point, reorder_qty),
                    )
                    item_id = cur.fetchone()["id"]
                    upserted += 1

                    if barcode:
                        # Ensure scanning works and primary barcode is kept in sync.
                        cur.execute(
                            """
                            INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, is_primary)
                            VALUES (gen_random_uuid(), %s, %s, %s, 1, true)
                            ON CONFLICT (company_id, barcode) DO UPDATE
                            SET item_id = EXCLUDED.item_id,
                                is_primary = true,
                                updated_at = now()
                            """,
                            (company_id, item_id, barcode),
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
    barcode: Optional[str] = None
    tax_code_id: Optional[str] = None
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
    image_attachment_id: Optional[str] = None
    image_alt: Optional[str] = None


@router.patch("/{item_id}", dependencies=[Depends(require_permission("items:write"))])
def update_item(item_id: str, data: ItemUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_unset=True)
    uom_to_ensure: Optional[str] = None
    if "unit_of_measure" in patch:
        uom_to_ensure = _norm_uom(patch.get("unit_of_measure"))
        patch["unit_of_measure"] = uom_to_ensure

    fields = []
    params = []
    # Use exclude_unset so clients can explicitly clear nullable fields (e.g. tax_code_id).
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        if k == "barcode" and isinstance(v, str):
            params.append(v.strip() or None)
        elif k == "tags" and isinstance(v, list):
            norm = [str(t).strip() for t in v if str(t or "").strip()]
            params.append(norm or None)
        elif k in {"brand", "short_name", "description", "image_alt"} and isinstance(v, str):
            params.append(v.strip() or None)
        else:
            params.append(v)
    if not fields:
        return {"ok": True}
    params.extend([company_id, item_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if uom_to_ensure:
                    _ensure_uom_exists(cur, company_id, uom_to_ensure)
                cur.execute(
                    f"""
                    UPDATE items
                    SET {', '.join(fields)}
                    WHERE company_id = %s AND id = %s
                    """,
                    params,
                )

                # Mirror legacy primary barcode into item_barcodes for POS scanning.
                patch = data.model_dump(exclude_none=True)
                if "barcode" in patch:
                    new_barcode = (data.barcode.strip() if isinstance(data.barcode, str) else None) or None
                    if new_barcode:
                        cur.execute(
                            """
                            INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, is_primary)
                            VALUES (gen_random_uuid(), %s, %s, %s, 1, true)
                            ON CONFLICT (company_id, barcode) DO UPDATE
                            SET item_id = EXCLUDED.item_id,
                                is_primary = true,
                                updated_at = now()
                            """,
                            (company_id, item_id, new_barcode),
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
                    upserted += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_prices_bulk_upsert', 'item_prices', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"count": upserted, "effective_from": eff.isoformat()})),
                )
                return {"ok": True, "upserted": upserted, "effective_from": eff}


class ItemBarcodeIn(BaseModel):
    barcode: str
    qty_factor: Decimal = Decimal("1")
    label: Optional[str] = None
    is_primary: bool = False


class ItemBarcodeUpdate(BaseModel):
    qty_factor: Optional[Decimal] = None
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
                SELECT id, barcode, qty_factor, label, is_primary, created_at, updated_at
                FROM item_barcodes
                WHERE company_id = %s AND item_id = %s
                ORDER BY is_primary DESC, created_at ASC
                """,
                (company_id, item_id),
            )
            return {"barcodes": cur.fetchall()}


@router.get("/barcodes", dependencies=[Depends(require_permission("items:read"))])
def list_all_barcodes(company_id: str = Depends(get_company_id)):
    """
    Convenience endpoint for UIs that need barcode/factor mappings for many items.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, item_id, barcode, qty_factor, label, is_primary, created_at, updated_at
                FROM item_barcodes
                WHERE company_id = %s
                ORDER BY item_id, is_primary DESC, created_at ASC
                """,
                (company_id,),
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
                cur.execute("SELECT 1 FROM items WHERE company_id = %s AND id = %s", (company_id, item_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="item not found")

                cur.execute(
                    """
                    INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, label, is_primary)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, item_id, barcode, data.qty_factor, data.label, data.is_primary),
                )
                barcode_id = cur.fetchone()["id"]

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
                    RETURNING id, item_id, barcode
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="barcode not found")

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
