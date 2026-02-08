from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional

import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..validation import CurrencyCode

router = APIRouter(prefix="/pricing", tags=["pricing"])

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
                SELECT i.id, i.sku, i.barcode, i.name, i.unit_of_measure,
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
                          'label', b.label,
                          'is_primary', b.is_primary
                        )
                        ORDER BY b.is_primary DESC, b.created_at ASC
                    ) AS barcodes
                    FROM item_barcodes b
                    WHERE b.company_id = i.company_id AND b.item_id = i.id
                ) bc ON true
                WHERE i.is_active = true
                ORDER BY i.sku
                """,
                (default_pl_id, default_pl_id),
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
