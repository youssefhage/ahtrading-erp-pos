from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/branches", tags=["branches"])


class BranchIn(BaseModel):
    name: str
    address: Optional[str] = None


class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None


@router.get("", dependencies=[Depends(require_permission("config:read"))])
def list_branches(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, address, created_at, updated_at
                FROM branches
                WHERE company_id = %s
                ORDER BY name
                """,
                (company_id,),
            )
            return {"branches": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("config:write"))])
def create_branch(data: BranchIn, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO branches (id, company_id, name, address)
                VALUES (gen_random_uuid(), %s, %s, %s)
                RETURNING id
                """,
                (company_id, data.name, data.address),
            )
            return {"id": cur.fetchone()["id"]}


@router.patch("/{branch_id}", dependencies=[Depends(require_permission("config:write"))])
def update_branch(branch_id: str, data: BranchUpdate, company_id: str = Depends(get_company_id)):
    fields = []
    params = []
    for k, v in data.model_dump(exclude_none=True).items():
        fields.append(f"{k} = %s")
        params.append(v)
    if not fields:
        return {"ok": True}
    params.extend([company_id, branch_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE branches
                SET {', '.join(fields)}, updated_at = now()
                WHERE company_id = %s AND id = %s
                """,
                params,
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="branch not found")
            return {"ok": True}

