from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

# Back-compat alias for the operational locations listing endpoint.
# Primary endpoint is `GET /inventory/locations?warehouse_id=...`.
router = APIRouter(prefix="/inventory/warehouses", tags=["inventory"])


@router.get("/{warehouse_id}/locations", dependencies=[Depends(require_permission("inventory:read"))])
def list_locations_for_warehouse(
    warehouse_id: str,
    q: str = Query("", description="Search code/name"),
    include_inactive: bool = Query(False, description="Include inactive locations"),
    limit: int = Query(200, ge=1, le=1000),
    company_id: str = Depends(get_company_id),
):
    qq = (q or "").strip()
    like = f"%{qq}%"

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM warehouses WHERE company_id=%s AND id=%s",
                (company_id, warehouse_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="warehouse not found")

            sql = """
                SELECT id, warehouse_id, code, name, is_active, created_at, updated_at
                FROM warehouse_locations
                WHERE company_id=%s
                  AND warehouse_id=%s
            """
            params: list = [company_id, warehouse_id]
            if not include_inactive:
                sql += " AND is_active=true"
            if qq:
                sql += " AND (code ILIKE %s OR COALESCE(name,'') ILIKE %s)"
                params.extend([like, like])
            sql += " ORDER BY is_active DESC, code ASC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"locations": cur.fetchall()}

