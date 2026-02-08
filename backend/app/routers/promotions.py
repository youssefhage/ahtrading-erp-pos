import json
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/promotions", tags=["promotions"])


class PromotionIn(BaseModel):
    code: str
    name: str
    starts_on: Optional[date] = None
    ends_on: Optional[date] = None
    is_active: bool = True
    priority: int = 0


class PromotionUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    starts_on: Optional[date] = None
    ends_on: Optional[date] = None
    is_active: Optional[bool] = None
    priority: Optional[int] = None


class PromotionItemIn(BaseModel):
    item_id: str
    min_qty: Decimal = Decimal("1")
    promo_price_usd: Decimal = Decimal("0")
    promo_price_lbp: Decimal = Decimal("0")
    discount_pct: Decimal = Decimal("0")


@router.get("", dependencies=[Depends(require_permission("items:read"))])
def list_promotions(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, starts_on, ends_on, is_active, priority, created_at, updated_at
                FROM promotions
                WHERE company_id = %s
                ORDER BY is_active DESC, priority DESC, code
                """,
                (company_id,),
            )
            return {"promotions": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("items:write"))])
def create_promotion(data: PromotionIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    code = (data.code or "").strip()
    name = (data.name or "").strip()
    if not code or not name:
        raise HTTPException(status_code=400, detail="code and name are required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO promotions (id, company_id, code, name, starts_on, ends_on, is_active, priority)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, code, name, data.starts_on, data.ends_on, data.is_active, data.priority),
                )
                pid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'promotion_create', 'promotion', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], pid, json.dumps(data.model_dump())),
                )
                return {"id": pid}


@router.patch("/{promotion_id}", dependencies=[Depends(require_permission("items:write"))])
def update_promotion(promotion_id: str, data: PromotionUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    fields = []
    params = []
    if "code" in patch:
        patch["code"] = (patch["code"] or "").strip()
        if not patch["code"]:
            raise HTTPException(status_code=400, detail="code cannot be empty")
    if "name" in patch:
        patch["name"] = (patch["name"] or "").strip()
        if not patch["name"]:
            raise HTTPException(status_code=400, detail="name cannot be empty")
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
    params.extend([company_id, promotion_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE promotions
                    SET {', '.join(fields)}
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    params,
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="promotion not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'promotion_update', 'promotion', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], promotion_id, json.dumps(patch)),
                )
                return {"ok": True}


@router.get("/{promotion_id}/items", dependencies=[Depends(require_permission("items:read"))])
def list_promotion_items(promotion_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pi.id, pi.item_id, i.sku, i.name,
                       pi.min_qty, pi.promo_price_usd, pi.promo_price_lbp, pi.discount_pct,
                       pi.created_at, pi.updated_at
                FROM promotion_items pi
                JOIN items i ON i.id = pi.item_id
                WHERE pi.company_id = %s AND pi.promotion_id = %s
                ORDER BY i.sku, pi.min_qty ASC
                """,
                (company_id, promotion_id),
            )
            return {"items": cur.fetchall()}


@router.post("/{promotion_id}/items", dependencies=[Depends(require_permission("items:write"))])
def add_promotion_item(promotion_id: str, data: PromotionItemIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if data.min_qty <= 0:
        raise HTTPException(status_code=400, detail="min_qty must be > 0")
    if data.discount_pct < 0 or data.discount_pct > 1:
        raise HTTPException(status_code=400, detail="discount_pct must be between 0 and 1")
    if data.promo_price_usd < 0 or data.promo_price_lbp < 0:
        raise HTTPException(status_code=400, detail="promo_price must be >= 0")
    if data.promo_price_usd == 0 and data.promo_price_lbp == 0 and data.discount_pct == 0:
        raise HTTPException(status_code=400, detail="set promo_price_* or discount_pct")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM promotions WHERE company_id = %s AND id = %s", (company_id, promotion_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="promotion not found")
                cur.execute("SELECT 1 FROM items WHERE company_id = %s AND id = %s", (company_id, data.item_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="item not found")
                cur.execute(
                    """
                    INSERT INTO promotion_items
                      (id, company_id, promotion_id, item_id, min_qty, promo_price_usd, promo_price_lbp, discount_pct)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (company_id, promotion_id, item_id, min_qty) DO UPDATE
                    SET promo_price_usd = EXCLUDED.promo_price_usd,
                        promo_price_lbp = EXCLUDED.promo_price_lbp,
                        discount_pct = EXCLUDED.discount_pct,
                        updated_at = now()
                    RETURNING id
                    """,
                    (
                        company_id,
                        promotion_id,
                        data.item_id,
                        data.min_qty,
                        data.promo_price_usd,
                        data.promo_price_lbp,
                        data.discount_pct,
                    ),
                )
                row = cur.fetchone()
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'promotion_item_upsert', 'promotion_item', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], row["id"], json.dumps(data.model_dump())),
                )
                return {"id": row["id"]}


@router.delete("/items/{promotion_item_id}", dependencies=[Depends(require_permission("items:write"))])
def delete_promotion_item(promotion_item_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM promotion_items
                WHERE company_id = %s AND id = %s
                RETURNING id
                """,
                (company_id, promotion_item_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="promotion item not found")
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'promotion_item_delete', 'promotion_item', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], promotion_item_id, json.dumps({})),
            )
            return {"ok": True}

