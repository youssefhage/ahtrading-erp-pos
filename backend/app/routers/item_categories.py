from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/item-categories", tags=["item-categories"])


class CategoryIn(BaseModel):
    name: str
    parent_id: Optional[str] = None
    is_active: bool = True


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("", dependencies=[Depends(require_permission("items:read"))])
def list_categories(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, parent_id, is_active, updated_at
                FROM item_categories
                WHERE company_id = %s
                ORDER BY name
                """,
                (company_id,),
            )
            return {"categories": cur.fetchall()}


@router.post("", dependencies=[Depends(require_permission("items:write"))])
def create_category(data: CategoryIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if data.parent_id:
                    cur.execute(
                        "SELECT 1 FROM item_categories WHERE company_id=%s AND id=%s",
                        (company_id, data.parent_id),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail="invalid parent_id")

                cur.execute(
                    """
                    INSERT INTO item_categories (id, company_id, name, parent_id, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, name, data.parent_id, bool(data.is_active)),
                )
                cid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_category_create', 'item_category', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], cid, json.dumps({"name": name})),
                )
                return {"id": cid}


@router.patch("/{category_id}", dependencies=[Depends(require_permission("items:write"))])
def update_category(category_id: str, data: CategoryUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_unset=True)
    if not patch:
        return {"ok": True}
    fields = []
    params = []
    if "name" in patch:
        nm = (patch["name"] or "").strip()
        if not nm:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        fields.append("name = %s")
        params.append(nm)
    if "parent_id" in patch:
        pid = patch["parent_id"]
        if pid:
            cur_pid = str(pid)
            if cur_pid == category_id:
                raise HTTPException(status_code=400, detail="parent_id cannot be self")
        fields.append("parent_id = %s")
        params.append(pid)
    if "is_active" in patch:
        fields.append("is_active = %s")
        params.append(bool(patch["is_active"]))

    params.extend([company_id, category_id])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if "parent_id" in patch and patch.get("parent_id"):
                    cur.execute(
                        "SELECT 1 FROM item_categories WHERE company_id=%s AND id=%s",
                        (company_id, patch["parent_id"]),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail="invalid parent_id")

                cur.execute(
                    f"""
                    UPDATE item_categories
                    SET {', '.join(fields)}
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    params,
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="category not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'item_category_update', 'item_category', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], category_id, json.dumps(patch)),
                )
                return {"ok": True}

