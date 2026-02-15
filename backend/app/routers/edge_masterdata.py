import os
import hmac
from datetime import datetime, timezone
from typing import Any, Optional, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..db import get_admin_conn, set_company_context
from .edge_sync import _upsert_edge_node_seen


router = APIRouter(prefix="/edge-sync/masterdata", tags=["edge-masterdata"])


def _require_edge_key(x_edge_sync_key: Optional[str]) -> None:
    expected = (os.getenv("EDGE_SYNC_KEY") or "").strip()
    if not expected:
        # Fail closed: do not allow edge export unless explicitly configured.
        raise HTTPException(status_code=403, detail="edge sync not configured")
    if not x_edge_sync_key or not hmac.compare_digest(x_edge_sync_key.strip(), expected):
        raise HTTPException(status_code=403, detail="forbidden")


EntityCode = Literal[
    "companies",
    "branches",
    "pos_devices",
    "pos_cashiers",
    "warehouses",
    "tax_codes",
    "unit_of_measures",
    "item_categories",
    "items",
    "item_barcodes",
    "item_uom_conversions",
    "item_prices",
    "price_lists",
    "price_list_items",
    "customers",
    "promotions",
    "promotion_items",
]


class MasterdataExportIn(BaseModel):
    company_id: str
    entity: EntityCode
    # Cursor is (updated_at, id). This prevents missing rows when many records share the
    # same updated_at timestamp and paging is in effect.
    since_ts: Optional[str] = None  # ISO timestamp
    since_id: Optional[str] = None  # UUID
    limit: int = 500


def _since_ts_or_epoch(since_ts: Optional[str]) -> str:
    s = (since_ts or "").strip()
    return s or "1970-01-01T00:00:00+00:00"


def _since_id_or_zero(since_id: Optional[str]) -> str:
    s = (since_id or "").strip()
    # Use the nil UUID as the "lowest" starting point for tie-breaking.
    return s or "00000000-0000-0000-0000-000000000000"


def _clamp_limit(limit: int) -> int:
    try:
        n = int(limit or 0)
    except Exception:
        n = 500
    if n < 1:
        n = 1
    if n > 2000:
        n = 2000
    return n


@router.post("/export")
def export_masterdata(
    data: MasterdataExportIn,
    x_edge_sync_key: Optional[str] = Header(None, alias="X-Edge-Sync-Key"),
    x_edge_node_id: Optional[str] = Header(None, alias="X-Edge-Node-Id"),
):
    """
    Cloud-side endpoint: edge pulls master data deltas for offline operation.

    Notes:
    - This is "cloud-authoritative" replication (edge should treat these entities as read-only).
    - Idempotency is handled on the edge via upserts by primary key.
    - Deletions are not yet propagated (prefer soft-delete flags like is_active).
    """
    _require_edge_key(x_edge_sync_key)

    company_id = (data.company_id or "").strip()
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id is required")

    since_ts = _since_ts_or_epoch(data.since_ts)
    since_id = _since_id_or_zero(data.since_id)
    limit = _clamp_limit(data.limit)
    entity = data.entity

    # Entity specs: (sql, params...)
    if entity == "companies":
        sql = """
        SELECT *
        FROM companies
        WHERE id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "branches":
        sql = """
        SELECT *
        FROM branches
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "pos_devices":
        sql = """
        SELECT *
        FROM pos_devices
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "pos_cashiers":
        sql = """
        SELECT *
        FROM pos_cashiers
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "warehouses":
        sql = """
        SELECT *
        FROM warehouses
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "tax_codes":
        sql = """
        SELECT *
        FROM tax_codes
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "unit_of_measures":
        sql = """
        SELECT *
        FROM unit_of_measures
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "item_categories":
        sql = """
        SELECT *
        FROM item_categories
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "items":
        sql = """
        SELECT *
        FROM items
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "item_barcodes":
        sql = """
        SELECT *
        FROM item_barcodes
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "item_uom_conversions":
        sql = """
        SELECT *
        FROM item_uom_conversions
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "item_prices":
        # item_prices is linked to items for company scoping.
        sql = """
        SELECT ip.*
        FROM item_prices ip
        JOIN items i ON i.id = ip.item_id
        WHERE i.company_id=%s::uuid
          AND (ip.updated_at, ip.id) > (%s::timestamptz, %s::uuid)
        ORDER BY ip.updated_at ASC, ip.id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "price_lists":
        sql = """
        SELECT *
        FROM price_lists
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "price_list_items":
        sql = """
        SELECT *
        FROM price_list_items
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "customers":
        sql = """
        SELECT *
        FROM customers
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "promotions":
        sql = """
        SELECT *
        FROM promotions
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    elif entity == "promotion_items":
        sql = """
        SELECT *
        FROM promotion_items
        WHERE company_id=%s::uuid
          AND (updated_at, id) > (%s::timestamptz, %s::uuid)
        ORDER BY updated_at ASC, id ASC
        LIMIT %s
        """
        params = (company_id, since_ts, since_id, limit)
        cursor_col = "updated_at"
    else:
        raise HTTPException(status_code=400, detail="unknown entity")

    with get_admin_conn() as conn:
        with conn.transaction():
            # Most tables are RLS-isolated; set context so cloud export can read them.
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                # Optional: treat exports as "edge node seen" for visibility.
                node_id = (x_edge_node_id or "").strip()
                if node_id:
                    _upsert_edge_node_seen(cur, company_id, node_id, ping=True, imported=False)
                cur.execute(sql, params)
                rows = cur.fetchall() or []

    next_ts = since_ts
    next_id = since_id
    if rows:
        # Use the last row by the same ordering we returned.
        last = rows[-1]
        ts = last.get(cursor_col)
        rid = last.get("id")
        if ts is None:
            ts = datetime(1970, 1, 1, tzinfo=timezone.utc)
        if rid is None:
            rid = "00000000-0000-0000-0000-000000000000"
        next_ts = ts
        next_id = str(rid)

    return {
        "entity": entity,
        "cursor_col": cursor_col,
        "since_ts": since_ts,
        "since_id": since_id,
        "next_ts": next_ts,
        "next_id": next_id,
        "rows": rows,
    }
