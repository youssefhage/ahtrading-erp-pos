from fastapi import APIRouter, Depends
from pydantic import BaseModel
from decimal import Decimal
from typing import Optional
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


class SupplierIn(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None


class ItemSupplierIn(BaseModel):
    item_id: str
    is_primary: bool = False
    lead_time_days: int = 0
    min_order_qty: Decimal = Decimal("0")
    last_cost_usd: Decimal = Decimal("0")
    last_cost_lbp: Decimal = Decimal("0")


@router.get("", dependencies=[Depends(require_permission("suppliers:read"))])
def list_suppliers(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, phone, email
                FROM suppliers
                WHERE company_id = %s
                ORDER BY name
                """,
                (company_id,),
            )
            return {"suppliers": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("suppliers:write"))])
def create_supplier(data: SupplierIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO suppliers (id, company_id, name, phone, email)
                VALUES (gen_random_uuid(), %s, %s, %s, %s)
                RETURNING id
                """,
                (company_id, data.name, data.phone, data.email),
            )
            return {"id": cur.fetchone()["id"]}


@router.get("/{supplier_id}/items", dependencies=[Depends(require_permission("suppliers:read"))])
def list_supplier_items(supplier_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.item_id, i.sku, i.name, s.is_primary, s.lead_time_days, s.min_order_qty,
                       s.last_cost_usd, s.last_cost_lbp
                FROM item_suppliers s
                JOIN items i ON i.id = s.item_id
                WHERE s.company_id = %s AND s.supplier_id = %s
                ORDER BY i.sku
                """,
                (company_id, supplier_id),
            )
            return {"items": cur.fetchall()}


@router.post("/{supplier_id}/items", dependencies=[Depends(require_permission("suppliers:write"))])
def add_supplier_item(supplier_id: str, data: ItemSupplierIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO item_suppliers
                  (id, company_id, item_id, supplier_id, is_primary, lead_time_days, min_order_qty, last_cost_usd, last_cost_lbp)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (company_id, item_id, supplier_id) DO UPDATE
                SET is_primary = EXCLUDED.is_primary,
                    lead_time_days = EXCLUDED.lead_time_days,
                    min_order_qty = EXCLUDED.min_order_qty,
                    last_cost_usd = EXCLUDED.last_cost_usd,
                    last_cost_lbp = EXCLUDED.last_cost_lbp
                RETURNING id
                """,
                (
                    company_id,
                    data.item_id,
                    supplier_id,
                    data.is_primary,
                    data.lead_time_days,
                    data.min_order_qty,
                    data.last_cost_usd,
                    data.last_cost_lbp,
                ),
            )
            return {"id": cur.fetchone()["id"]}


@router.get("/items/{item_id}", dependencies=[Depends(require_permission("suppliers:read"))])
def list_item_suppliers(item_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.supplier_id, p.name, s.is_primary, s.lead_time_days, s.min_order_qty,
                       s.last_cost_usd, s.last_cost_lbp
                FROM item_suppliers s
                JOIN suppliers p ON p.id = s.supplier_id
                WHERE s.company_id = %s AND s.item_id = %s
                ORDER BY p.name
                """,
                (company_id, item_id),
            )
            return {"suppliers": cur.fetchall()}
