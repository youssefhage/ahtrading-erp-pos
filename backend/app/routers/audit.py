from fastapi import APIRouter, Depends, HTTPException
from typing import Optional

from ..db import get_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission

router = APIRouter(prefix="/audit", tags=["audit"])


def _permission_for_entity(entity_type: str) -> str:
    """
    Map entity types to module permissions so per-document timelines don't require `reports:*`.
    Keep this conservative: default to config:read if unknown.
    """
    t = (entity_type or "").strip().lower()
    if not t:
        return "config:read"
    if t.startswith("sales") or t in {"customer_payment", "tax_line"}:
        return "sales:read"
    if t.startswith("purchase") or t.startswith("supplier") or t.startswith("goods_receipt"):
        return "purchases:read"
    if t.startswith("inventory") or t.startswith("stock") or t.startswith("batch"):
        return "inventory:read"
    if t.startswith("gl") or t.startswith("accounting"):
        return "accounting:read"
    if t.startswith("item") or t.startswith("catalog"):
        return "items:read"
    if t.startswith("customer") or t.startswith("party_address") or t.startswith("party_contact"):
        return "customers:read"
    if t.startswith("supplier"):
        return "suppliers:read"
    if t.startswith("user") or t.startswith("role") or t.startswith("permission"):
        return "users:read"
    return "config:read"


@router.get("/logs")
def list_audit_logs(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    action_prefix: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Per-document audit trail feed.
    Uses module permissions derived from `entity_type` instead of `reports:read`.
    """
    if limit <= 0 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 500")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")

    # Require at least a type filter so this endpoint can't be used as a general audit feed
    # without explicit reporting permission.
    if not entity_type:
        raise HTTPException(status_code=400, detail="entity_type is required")

    require_permission(_permission_for_entity(entity_type))(company_id=company_id, user=user)

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT l.id, l.user_id, u.email AS user_email,
                       l.action, l.entity_type, l.entity_id,
                       l.details, l.created_at
                FROM audit_logs l
                LEFT JOIN users u ON u.id = l.user_id
                WHERE l.company_id = %s
                  AND l.entity_type = %s
            """
            params: list = [company_id, entity_type]

            if entity_id:
                sql += " AND l.entity_id = %s::uuid"
                params.append(entity_id)
            if user_id:
                sql += " AND l.user_id = %s::uuid"
                params.append(user_id)
            if action_prefix:
                sql += " AND l.action LIKE %s"
                params.append(action_prefix.strip() + "%")

            sql += " ORDER BY l.created_at DESC, l.id DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])
            cur.execute(sql, params)
            return {"audit_logs": cur.fetchall()}

