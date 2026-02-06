from fastapi import APIRouter, Depends
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/items", tags=["items"])


class ItemIn(BaseModel):
    sku: str
    name: str
    unit_of_measure: str
    barcode: Optional[str] = None
    tax_code_id: Optional[str] = None
    reorder_point: Optional[Decimal] = None
    reorder_qty: Optional[Decimal] = None


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
                SELECT id, sku, barcode, name, unit_of_measure, tax_code_id, reorder_point, reorder_qty
                FROM items
                ORDER BY sku
                """
            )
            return {"items": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("items:write"))])
def create_item(data: ItemIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO items (id, company_id, sku, barcode, name, unit_of_measure, tax_code_id, reorder_point, reorder_qty)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    company_id,
                    data.sku,
                    data.barcode,
                    data.name,
                    data.unit_of_measure,
                    data.tax_code_id,
                    data.reorder_point or 0,
                    data.reorder_qty or 0,
                ),
            )
            return {"id": cur.fetchone()["id"]}


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    barcode: Optional[str] = None
    tax_code_id: Optional[str] = None
    reorder_point: Optional[Decimal] = None
    reorder_qty: Optional[Decimal] = None


@router.patch("/{item_id}", dependencies=[Depends(require_permission("items:write"))])
def update_item(item_id: str, data: ItemUpdate, company_id: str = Depends(get_company_id)):
    fields = []
    params = []
    for k, v in data.model_dump(exclude_none=True).items():
        fields.append(f"{k} = %s")
        params.append(v)
    if not fields:
        return {"ok": True}
    params.extend([company_id, item_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE items
                SET {', '.join(fields)}
                WHERE company_id = %s AND id = %s
                """,
                params,
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
