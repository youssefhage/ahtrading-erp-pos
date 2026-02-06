from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/warehouses", tags=["warehouses"])


class WarehouseIn(BaseModel):
    name: str
    location: Optional[str] = None


class WarehouseUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None


@router.get("", dependencies=[Depends(require_permission("config:read"))])
def list_warehouses(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, location
                FROM warehouses
                WHERE company_id = %s
                ORDER BY name
                """,
                (company_id,),
            )
            return {"warehouses": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("config:write"))])
def create_warehouse(data: WarehouseIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO warehouses (id, company_id, name, location)
                VALUES (gen_random_uuid(), %s, %s, %s)
                RETURNING id
                """,
                (company_id, data.name, data.location),
            )
            return {"id": cur.fetchone()["id"]}


@router.patch("/{warehouse_id}", dependencies=[Depends(require_permission("config:write"))])
def update_warehouse(warehouse_id: str, data: WarehouseUpdate, company_id: str = Depends(get_company_id)):
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
            return {"ok": True}

