#!/usr/bin/env python3
"""
Cloud -> Edge master data replication (phase 1).

This is the missing half of Hybrid mode: ensure the edge node can run offline by
pulling master data (catalog/config) from the cloud periodically.

Current scope (initial):
- companies, branches, warehouses, tax_codes
- item_categories, items, item_prices
- price_lists, price_list_items
- customers
- promotions, promotion_items

Notes:
- Cloud is authoritative for these entities.
- Deletions are not yet propagated (prefer soft-delete flags like is_active).
"""

import json
import os
import socket
import urllib.error
import urllib.request
from typing import Any

import psycopg
from psycopg.rows import dict_row

try:
    from .pos_processor import set_company_context
except ImportError:  # pragma: no cover
    from pos_processor import set_company_context


ENTITIES: list[str] = [
    "companies",
    "branches",
    # Device tokens must exist on edge so POS Desktop can authenticate to edge while offline.
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
    "promotions",
    "promotion_items",
    # Customers reference price lists, so pull after price list entities.
    "customers",
]


def _cloud_base_url() -> str:
    raw = (os.getenv("EDGE_SYNC_TARGET_URL") or "").strip()
    if not raw:
        return ""
    raw = raw.rstrip("/")
    # Allow EDGE_SYNC_TARGET_URL to be either full edge-sync path or base API host.
    if "/edge-sync/" in raw:
        return raw.split("/edge-sync/", 1)[0].rstrip("/")
    return raw


def _export_url() -> str:
    base = _cloud_base_url()
    if not base:
        return ""
    return base.rstrip("/") + "/edge-sync/masterdata/export"


def _edge_key() -> str:
    return (os.getenv("EDGE_SYNC_KEY") or "").strip()


def _source_node_id() -> str:
    return (os.getenv("EDGE_SYNC_NODE_ID") or "").strip() or socket.gethostname()


def _http_post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload, default=str).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Edge-Sync-Key": _edge_key(),
            "X-Edge-Node-Id": _source_node_id(),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read().decode("utf-8") if resp else ""
        if not body:
            return {}
        try:
            return json.loads(body)
        except Exception:
            return {"raw": body}


def _load_columns(cur, table: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name=%s
        ORDER BY ordinal_position ASC
        """,
        (table,),
    )
    return [dict(r) for r in (cur.fetchall() or [])]


def _prep_value(col: dict[str, Any], v: Any) -> Any:
    if v is None:
        return None
    data_type = (col.get("data_type") or "").strip().lower()
    if data_type in {"json", "jsonb"} and not isinstance(v, str):
        return json.dumps(v)
    # Arrays arrive from JSON as lists; psycopg can adapt those.
    return v


def _upsert_rows(cur, table: str, rows: list[dict[str, Any]], *, pk: str = "id", columns_cache: dict[str, Any]):
    if not rows:
        return 0
    cols = columns_cache.get(table)
    if cols is None:
        cols = _load_columns(cur, table)
        columns_cache[table] = cols

    # Prevent accidental NULL overwrites on version skew: only upsert columns present in the payload.
    payload_keys = set()
    try:
        payload_keys = set((rows[0] or {}).keys())
    except Exception:
        payload_keys = set()

    col_names = [str(c["column_name"]) for c in cols if str(c["column_name"]) in payload_keys]
    if pk not in col_names:
        # Must always include pk even if not present in payload_keys for some reason.
        col_names = [pk] + [c for c in col_names if c != pk]

    update_cols = [c for c in col_names if c != pk]
    insert_cols_sql = ", ".join(col_names)
    values_sql = ", ".join(["%s"] * len(col_names))
    update_sql = ", ".join([f"{c}=EXCLUDED.{c}" for c in update_cols])

    sql = f"INSERT INTO {table} ({insert_cols_sql}) VALUES ({values_sql}) ON CONFLICT ({pk}) DO UPDATE SET {update_sql}"

    values = []
    col_by_name = {str(c["column_name"]): c for c in cols}
    for r in rows:
        tup = []
        for name in col_names:
            tup.append(_prep_value(col_by_name[name], r.get(name)))
        values.append(tuple(tup))

    cur.executemany(sql, values)
    return len(values)


def _get_cursor(cur, company_id: str, entity: str) -> str:
    cur.execute(
        """
        SELECT cursor_ts, cursor_id, cursor_at
        FROM edge_masterdata_sync_state
        WHERE company_id=%s::uuid AND entity=%s
        """,
        (company_id, entity),
    )
    row = cur.fetchone()
    if not row:
        return "1970-01-01T00:00:00+00:00|00000000-0000-0000-0000-000000000000"

    ts = row.get("cursor_ts") or row.get("cursor_at")
    cid = row.get("cursor_id")
    if not ts:
        ts = "1970-01-01T00:00:00+00:00"
    if not cid:
        cid = "00000000-0000-0000-0000-000000000000"
    return f"{ts}|{cid}"


def _set_cursor(cur, company_id: str, entity: str, cursor_at: Any, cursor_id: Any) -> None:
    cur.execute(
        """
        INSERT INTO edge_masterdata_sync_state (company_id, entity, cursor_at, cursor_ts, cursor_id)
        VALUES (%s::uuid, %s, %s::timestamptz, %s::timestamptz, %s::uuid)
        ON CONFLICT (company_id, entity)
        DO UPDATE SET
          cursor_at = EXCLUDED.cursor_at,
          cursor_ts = EXCLUDED.cursor_ts,
          cursor_id = EXCLUDED.cursor_id,
          updated_at = now()
        """,
        (company_id, entity, cursor_at, cursor_at, cursor_id),
    )


def run_edge_cloud_masterdata_pull(db_url: str, company_id: str, *, limit: int = 500, max_loops: int = 200) -> dict[str, Any]:
    # Allow binding an edge node to a specific cloud company id (useful during provisioning).
    # If set, we will sync that company id regardless of the local company id passed in.
    sync_company_id = (os.getenv("EDGE_SYNC_COMPANY_ID") or "").strip() or company_id

    url = _export_url()
    key = _edge_key()
    if not url or not key:
        return {"ok": True, "skipped": True, "reason": "missing EDGE_SYNC_TARGET_URL or EDGE_SYNC_KEY", "company_id": sync_company_id}

    limit = max(1, min(int(limit or 500), 2000))
    columns_cache: dict[str, Any] = {}
    summary: dict[str, Any] = {"ok": True, "company_id": sync_company_id, "entities": {}}

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        # If we were invoked once per local company (worker_service behavior), avoid doing the same
        # sync multiple times once the sync company exists locally.
        if sync_company_id and company_id != sync_company_id:
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 FROM companies WHERE id=%s::uuid", (sync_company_id,))
                    exists = bool(cur.fetchone())
                if exists:
                    return {"ok": True, "skipped": True, "reason": "not sync company", "company_id": sync_company_id}
            except Exception:
                # If we can't check, proceed (best-effort).
                pass

        for entity in ENTITIES:
            pulled = 0
            loops = 0
            while loops < max_loops:
                loops += 1
                with conn.transaction():
                    with conn.cursor() as cur:
                        set_company_context(cur, sync_company_id)
                        since = _get_cursor(cur, sync_company_id, entity)

                try:
                    since_ts, since_id = (since.split("|", 1) + [""])[:2]
                    since_ts = (since_ts or "").strip() or "1970-01-01T00:00:00+00:00"
                    since_id = (since_id or "").strip() or "00000000-0000-0000-0000-000000000000"
                except Exception:
                    since_ts = "1970-01-01T00:00:00+00:00"
                    since_id = "00000000-0000-0000-0000-000000000000"

                try:
                    resp = _http_post_json(
                        url,
                        {"company_id": sync_company_id, "entity": entity, "since_ts": since_ts, "since_id": since_id, "limit": limit},
                    )
                except urllib.error.HTTPError as ex:
                    body = ""
                    try:
                        body = ex.read().decode("utf-8")  # type: ignore[attr-defined]
                    except Exception:
                        pass
                    return {"ok": False, "company_id": sync_company_id, "entity": entity, "error": f"http {ex.code}", "body": body}
                except Exception as ex:
                    return {"ok": False, "company_id": sync_company_id, "entity": entity, "error": str(ex)}

                rows = resp.get("rows") or []
                next_ts = resp.get("next_ts") or since_ts
                next_id = resp.get("next_id") or since_id

                if not rows:
                    break

                # Apply locally.
                with conn.transaction():
                    with conn.cursor() as cur:
                        set_company_context(cur, sync_company_id)
                        table = entity  # table names match entity codes
                        n = _upsert_rows(cur, table, rows, pk="id", columns_cache=columns_cache)
                        _set_cursor(cur, sync_company_id, entity, next_ts, next_id)
                        pulled += int(n or 0)

                # Continue looping until the cloud returns no rows for this entity.
            summary["entities"][entity] = {"pulled": pulled, "loops": loops}

    return summary
