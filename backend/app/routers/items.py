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
from ..ai.item_naming import heuristic_item_name_suggestions, openai_item_name_suggestions
from ..ai.policy import is_external_ai_allowed

router = APIRouter(prefix="/items", tags=["items"])

ItemType = Literal["stocked", "service", "bundle"]


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
                        data.unit_of_measure,
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
                    uom = (it.unit_of_measure or "").strip() or "EA"
                    if not sku or not name:
                        raise HTTPException(status_code=400, detail="each item requires sku and name")

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
    fields = []
    params = []
    # Use exclude_unset so clients can explicitly clear nullable fields (e.g. tax_code_id).
    for k, v in data.model_dump(exclude_unset=True).items():
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
                    (company_id, user["user_id"], item_id, json.dumps(data.model_dump(exclude_unset=True), default=str)),
                )
                return {"ok": True}


@router.post("/{item_id}/prices", dependencies=[Depends(require_permission("items:write"))])
def add_item_price(item_id: str, data: ItemPriceIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO item_prices (id, item_id, price_usd, price_lbp, effective_from, effective_to)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (item_id, data.price_usd, data.price_lbp, data.effective_from, data.effective_to),
            )
            return {"id": cur.fetchone()["id"]}


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
    if os.environ.get("OPENAI_API_KEY"):
        try:
            with get_conn() as conn:
                set_company_context(conn, company_id)
                with conn.cursor() as cur:
                    if is_external_ai_allowed(cur, company_id):
                        return {"suggestions": openai_item_name_suggestions(raw, count=n)}
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
