from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
import json

router = APIRouter(prefix="/warehouses", tags=["warehouses"])


class WarehouseIn(BaseModel):
    name: str
    location: Optional[str] = None
    min_shelf_life_days_for_sale_default: int = 0


class WarehouseUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    min_shelf_life_days_for_sale_default: Optional[int] = None


@router.get("", dependencies=[Depends(require_permission("config:read"))])
def list_warehouses(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, location, min_shelf_life_days_for_sale_default
                FROM warehouses
                WHERE company_id = %s
                ORDER BY name
                """,
                (company_id,),
            )
            return {"warehouses": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("config:write"))])
def create_warehouse(data: WarehouseIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if data.min_shelf_life_days_for_sale_default < 0:
        raise HTTPException(status_code=400, detail="min_shelf_life_days_for_sale_default must be >= 0")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO warehouses (id, company_id, name, location, min_shelf_life_days_for_sale_default)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, data.name, data.location, int(data.min_shelf_life_days_for_sale_default or 0)),
                )
                wid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'warehouse_create', 'warehouse', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], wid, json.dumps(data.model_dump(), default=str)),
                )
                return {"id": wid}


@router.patch("/{warehouse_id}", dependencies=[Depends(require_permission("config:write"))])
def update_warehouse(warehouse_id: str, data: WarehouseUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if data.min_shelf_life_days_for_sale_default is not None and data.min_shelf_life_days_for_sale_default < 0:
        raise HTTPException(status_code=400, detail="min_shelf_life_days_for_sale_default must be >= 0")
    fields = []
    params = []
    for k, v in data.model_dump(exclude_none=True).items():
        fields.append(f"{k} = %s")
        params.append(v)
    if not fields:
        return {"ok": True}
    params.extend([company_id, warehouse_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE warehouses
                    SET {', '.join(fields)}
                    WHERE company_id = %s AND id = %s
                    """,
                    params,
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="warehouse not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'warehouse_update', 'warehouse', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], warehouse_id, json.dumps(data.model_dump(exclude_none=True), default=str)),
                )
                return {"ok": True}
