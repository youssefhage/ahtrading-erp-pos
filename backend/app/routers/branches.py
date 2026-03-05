from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Any, Dict
from psycopg import sql as psycopg_sql
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/branches", tags=["branches"])


class BranchIn(BaseModel):
    name: str
    address: Optional[str] = None
    default_warehouse_id: Optional[str] = None
    invoice_prefix: Optional[str] = None
    operating_hours: Optional[Dict[str, Any]] = None


class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    default_warehouse_id: Optional[str] = None
    invoice_prefix: Optional[str] = None
    operating_hours: Optional[Dict[str, Any]] = None


@router.get("", dependencies=[Depends(require_permission("config:read"))])
def list_branches(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, address, default_warehouse_id, invoice_prefix, operating_hours, created_at, updated_at
                FROM branches
                WHERE company_id = %s
                ORDER BY name
                """,
                (company_id,),
            )
            return {"branches": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("config:write"))])
def create_branch(data: BranchIn, company_id: str = Depends(get_company_id)):
    import json
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO branches (id, company_id, name, address, default_warehouse_id, invoice_prefix, operating_hours)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s::jsonb)
                RETURNING id
                """,
                (company_id, data.name, data.address, data.default_warehouse_id, (data.invoice_prefix or "").strip() or None, json.dumps(data.operating_hours) if data.operating_hours is not None else None),
            )
            return {"id": cur.fetchone()["id"]}


_BRANCH_UPDATABLE_COLUMNS = frozenset({"name", "address", "default_warehouse_id", "invoice_prefix", "operating_hours"})

@router.patch("/{branch_id}", dependencies=[Depends(require_permission("config:write"))])
def update_branch(branch_id: str, data: BranchUpdate, company_id: str = Depends(get_company_id)):
    import json
    fields = []
    params = []
    payload = data.model_dump(exclude_unset=True)
    if "invoice_prefix" in payload:
        payload["invoice_prefix"] = (payload.get("invoice_prefix") or "").strip() or None
    for k, v in payload.items():
        if k not in _BRANCH_UPDATABLE_COLUMNS:
            continue
        if k == "operating_hours":
            fields.append(psycopg_sql.SQL("{} = %s::jsonb").format(psycopg_sql.Identifier(k)))
            params.append(json.dumps(v) if v is not None else None)
        else:
            fields.append(psycopg_sql.SQL("{} = %s").format(psycopg_sql.Identifier(k)))
            params.append(v)
    if not fields:
        return {"ok": True}
    params.extend([company_id, branch_id])
    set_clause = psycopg_sql.SQL(", ").join(fields)
    query = psycopg_sql.SQL(
        "UPDATE branches SET {}, updated_at = now() WHERE company_id = %s AND id = %s"
    ).format(set_clause)
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(query, params)
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="branch not found")
            return {"ok": True}
