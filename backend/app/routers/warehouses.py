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
    # NULL means "inherit company/item policy" (override is optional).
    allow_negative_stock: Optional[bool] = None


class WarehouseUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    min_shelf_life_days_for_sale_default: Optional[int] = None
    # Explicit NULL clears the override (inherit).
    allow_negative_stock: Optional[bool] = None


class WarehouseLocationIn(BaseModel):
    code: str
    name: Optional[str] = None
    is_active: bool = True


class WarehouseLocationUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("", dependencies=[Depends(require_permission("config:read"))])
def list_warehouses(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, location, min_shelf_life_days_for_sale_default, allow_negative_stock
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
                    INSERT INTO warehouses (id, company_id, name, location, min_shelf_life_days_for_sale_default, allow_negative_stock)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, data.name, data.location, int(data.min_shelf_life_days_for_sale_default or 0), data.allow_negative_stock),
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
    # Build patch using fields explicitly provided so clients can clear nullable fields (set to NULL).
    patch = {k: getattr(data, k) for k in getattr(data, "model_fields_set", set())}
    if "min_shelf_life_days_for_sale_default" in patch and patch["min_shelf_life_days_for_sale_default"] is not None:
        if patch["min_shelf_life_days_for_sale_default"] < 0:
            raise HTTPException(status_code=400, detail="min_shelf_life_days_for_sale_default must be >= 0")
    if not patch:
        return {"ok": True}

    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
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
                    (company_id, user["user_id"], warehouse_id, json.dumps(patch, default=str)),
                )
                return {"ok": True}


@router.get("/{warehouse_id}/locations", dependencies=[Depends(require_permission("config:read"))])
def list_warehouse_locations(warehouse_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, warehouse_id, code, name, is_active, created_at, updated_at
                FROM warehouse_locations
                WHERE company_id=%s AND warehouse_id=%s
                ORDER BY is_active DESC, code ASC
                """,
                (company_id, warehouse_id),
            )
            return {"locations": cur.fetchall()}


@router.post("/{warehouse_id}/locations", dependencies=[Depends(require_permission("config:write"))])
def upsert_warehouse_location(
    warehouse_id: str,
    data: WarehouseLocationIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    code = (data.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    name = (data.name or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO warehouse_locations (id, company_id, warehouse_id, code, name, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                    ON CONFLICT (company_id, warehouse_id, code) DO UPDATE
                      SET name = EXCLUDED.name,
                          is_active = EXCLUDED.is_active,
                          updated_at = now()
                    RETURNING id
                    """,
                    (company_id, warehouse_id, code, name, bool(data.is_active)),
                )
                lid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'warehouse_location_upsert', 'warehouse_location', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], lid, json.dumps({"warehouse_id": warehouse_id, "code": code, "name": name, "is_active": bool(data.is_active)})),
                )
                return {"id": lid}


@router.patch("/locations/{location_id}", dependencies=[Depends(require_permission("config:write"))])
def update_warehouse_location(
    location_id: str,
    data: WarehouseLocationUpdate,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    patch = {k: getattr(data, k) for k in getattr(data, "model_fields_set", set())}
    if "code" in patch:
        patch["code"] = (patch.get("code") or "").strip() or None
        if not patch["code"]:
            raise HTTPException(status_code=400, detail="code cannot be empty")
    if "name" in patch:
        patch["name"] = (patch.get("name") or "").strip() or None
    if not patch:
        return {"ok": True}
    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
    params.extend([company_id, location_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE warehouse_locations
                    SET {', '.join(fields)}
                    WHERE company_id=%s AND id=%s
                    RETURNING id, warehouse_id
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="location not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'warehouse_location_update', 'warehouse_location', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], location_id, json.dumps(patch)),
                )
                return {"ok": True}
