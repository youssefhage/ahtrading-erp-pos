import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/dimensions", tags=["dimensions"])


class DimensionIn(BaseModel):
    code: str
    name: str
    is_active: bool = True


class DimensionUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/cost-centers", dependencies=[Depends(require_permission("config:read"))])
def list_cost_centers(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, is_active, created_at, updated_at
                FROM cost_centers
                WHERE company_id=%s
                ORDER BY is_active DESC, code
                """,
                (company_id,),
            )
            return {"cost_centers": cur.fetchall()}


@router.post("/cost-centers", dependencies=[Depends(require_permission("config:write"))])
def create_cost_center(data: DimensionIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
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
                    INSERT INTO cost_centers (id, company_id, code, name, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, code, name, bool(data.is_active)),
                )
                cc_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'dimension_create', 'cost_center', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], cc_id, json.dumps({"code": code, "name": name, "is_active": bool(data.is_active)})),
                )
                return {"id": cc_id}


@router.patch("/cost-centers/{cost_center_id}", dependencies=[Depends(require_permission("config:write"))])
def update_cost_center(
    cost_center_id: str,
    data: DimensionUpdate,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    patch = data.model_dump(exclude_none=True)
    if "code" in patch:
        patch["code"] = (patch["code"] or "").strip()
        if not patch["code"]:
            raise HTTPException(status_code=400, detail="code cannot be empty")
    if "name" in patch:
        patch["name"] = (patch["name"] or "").strip()
        if not patch["name"]:
            raise HTTPException(status_code=400, detail="name cannot be empty")
    if not patch:
        return {"ok": True}

    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k}=%s")
        params.append(v)
    params.extend([company_id, cost_center_id])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE cost_centers
                    SET {', '.join(fields)}
                    WHERE company_id=%s AND id=%s
                    RETURNING id
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="cost center not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'dimension_update', 'cost_center', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], cost_center_id, json.dumps(patch)),
                )
                return {"ok": True}


@router.get("/projects", dependencies=[Depends(require_permission("config:read"))])
def list_projects(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, is_active, created_at, updated_at
                FROM projects
                WHERE company_id=%s
                ORDER BY is_active DESC, code
                """,
                (company_id,),
            )
            return {"projects": cur.fetchall()}


@router.post("/projects", dependencies=[Depends(require_permission("config:write"))])
def create_project(data: DimensionIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
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
                    INSERT INTO projects (id, company_id, code, name, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, code, name, bool(data.is_active)),
                )
                p_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'dimension_create', 'project', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], p_id, json.dumps({"code": code, "name": name, "is_active": bool(data.is_active)})),
                )
                return {"id": p_id}


@router.patch("/projects/{project_id}", dependencies=[Depends(require_permission("config:write"))])
def update_project(
    project_id: str,
    data: DimensionUpdate,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    patch = data.model_dump(exclude_none=True)
    if "code" in patch:
        patch["code"] = (patch["code"] or "").strip()
        if not patch["code"]:
            raise HTTPException(status_code=400, detail="code cannot be empty")
    if "name" in patch:
        patch["name"] = (patch["name"] or "").strip()
        if not patch["name"]:
            raise HTTPException(status_code=400, detail="name cannot be empty")
    if not patch:
        return {"ok": True}

    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k}=%s")
        params.append(v)
    params.extend([company_id, project_id])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE projects
                    SET {', '.join(fields)}
                    WHERE company_id=%s AND id=%s
                    RETURNING id
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="project not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'dimension_update', 'project', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], project_id, json.dumps(patch)),
                )
                return {"ok": True}
