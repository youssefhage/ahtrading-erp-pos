from fastapi import APIRouter, Depends

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/edge-nodes", tags=["edge-nodes"])


@router.get("/status", dependencies=[Depends(require_permission("config:read"))])
def list_edge_node_status(company_id: str = Depends(get_company_id)):
    """
    Admin-facing endpoint: list edge node heartbeat info for the active company.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT node_id, last_seen_at, last_ping_at, last_import_at
                FROM edge_node_status
                WHERE company_id = %s
                ORDER BY last_seen_at DESC
                """,
                (company_id,),
            )
            rows = cur.fetchall() or []
            nodes = [
                {
                    "node_id": str(r["node_id"] or ""),
                    "last_seen_at": r.get("last_seen_at"),
                    "last_ping_at": r.get("last_ping_at"),
                    "last_import_at": r.get("last_import_at"),
                }
                for r in rows
            ]
            return {"nodes": nodes}

