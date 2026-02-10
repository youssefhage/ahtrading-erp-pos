#!/usr/bin/env python3
"""
Edge -> Cloud sync worker (phase 1).

Goal: keep store operations fast and resilient during outages by treating the on-prem "edge"
node as the source of truth, and asynchronously replicating fully-posted documents to the cloud.

Current scope:
- sales invoices (header + lines + payments + tax + optional stock moves + optional GL)
"""

import json
import os
import socket
import urllib.request
import urllib.error
from datetime import datetime

import psycopg
from psycopg.rows import dict_row

try:
    from .pos_processor import set_company_context
except ImportError:  # pragma: no cover
    from pos_processor import set_company_context


def _target_url() -> str:
    """
    Accept either:
    - EDGE_SYNC_TARGET_URL="https://cloud.example.com/edge-sync/sales-invoices/import"
    - EDGE_SYNC_TARGET_URL="https://cloud.example.com"  (we'll append the path)
    """
    raw = (os.getenv("EDGE_SYNC_TARGET_URL") or "").strip()
    if not raw:
        return ""
    if "/edge-sync/" in raw:
        return raw.rstrip("/")
    return raw.rstrip("/") + "/edge-sync/sales-invoices/import"


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
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode("utf-8") if resp else ""
        if not body:
            return {}
        try:
            return json.loads(body)
        except Exception:
            return {"raw": body}


def _fetch_one(cur, sql: str, params: tuple):
    cur.execute(sql, params)
    row = cur.fetchone()
    return dict(row) if row else None


def _fetch_all(cur, sql: str, params: tuple):
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def _build_sales_invoice_bundle(cur, company_id: str, invoice_id: str) -> dict:
    inv = _fetch_one(
        cur,
        "SELECT * FROM sales_invoices WHERE company_id=%s AND id=%s",
        (company_id, invoice_id),
    )
    if not inv:
        raise ValueError("invoice not found on edge")

    lines = _fetch_all(cur, "SELECT * FROM sales_invoice_lines WHERE invoice_id=%s ORDER BY created_at ASC", (invoice_id,))
    payments = _fetch_all(cur, "SELECT * FROM sales_payments WHERE invoice_id=%s ORDER BY created_at ASC", (invoice_id,))
    tax_lines = _fetch_all(
        cur,
        """
        SELECT * FROM tax_lines
        WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
        ORDER BY created_at ASC
        """,
        (company_id, invoice_id),
    )
    stock_moves = _fetch_all(
        cur,
        """
        SELECT * FROM stock_moves
        WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
        ORDER BY created_at ASC
        """,
        (company_id, invoice_id),
    )
    gl_journals = _fetch_all(
        cur,
        """
        SELECT * FROM gl_journals
        WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
        ORDER BY created_at ASC
        """,
        (company_id, invoice_id),
    )
    journal_ids = [str(j.get("id")) for j in gl_journals if j.get("id")]
    gl_entries = []
    if journal_ids:
        gl_entries = _fetch_all(cur, "SELECT * FROM gl_entries WHERE journal_id = ANY(%s::uuid[]) ORDER BY created_at ASC", (journal_ids,))

    customer_update = None
    if inv.get("customer_id"):
        cu = _fetch_one(
            cur,
            """
            SELECT id, credit_balance_usd, credit_balance_lbp, loyalty_points
            FROM customers
            WHERE company_id=%s AND id=%s
            """,
            (company_id, inv.get("customer_id")),
        )
        if cu:
            customer_update = cu

    return {
        "company_id": str(company_id),
        "invoice": inv,
        "lines": lines,
        "payments": payments,
        "tax_lines": tax_lines,
        "stock_moves": stock_moves,
        "gl_journals": gl_journals,
        "gl_entries": gl_entries,
        "customer_update": customer_update,
        "source_node_id": _source_node_id(),
    }


def _claim_one(cur, company_id: str, max_attempts: int = 100):
    # Avoid hammering the same row during long outages.
    # Pending: always eligible.
    # Failed: eligible only if last_attempt_at is older than 60s.
    cur.execute(
        """
        WITH c AS (
          SELECT id, entity_type, entity_id
          FROM edge_sync_outbox
          WHERE company_id = %s
            AND status IN ('pending', 'failed')
            AND attempt_count < %s
            AND (
              status = 'pending'
              OR last_attempt_at IS NULL
              OR last_attempt_at < now() - interval '60 seconds'
            )
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE edge_sync_outbox o
        SET attempt_count = o.attempt_count + 1,
            last_attempt_at = now(),
            last_error = NULL,
            status = 'pending'
        FROM c
        WHERE o.id = c.id
        RETURNING o.id, o.entity_type, o.entity_id, o.attempt_count
        """,
        (company_id, max_attempts),
    )
    row = cur.fetchone()
    return dict(row) if row else None


def run_edge_cloud_sync(db_url: str, company_id: str, limit: int = 10) -> int:
    url = _target_url()
    key = _edge_key()
    if not url or not key:
        return 0

    processed = 0
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        for _ in range(max(1, int(limit or 10))):
            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    claimed = _claim_one(cur, company_id)
            if not claimed:
                break

            outbox_id = str(claimed["id"])
            entity_type = claimed["entity_type"]
            entity_id = str(claimed["entity_id"])

            try:
                with conn.transaction():
                    with conn.cursor() as cur:
                        set_company_context(cur, company_id)
                        if entity_type == "sales_invoice":
                            bundle = _build_sales_invoice_bundle(cur, company_id, entity_id)
                        else:
                            raise ValueError(f"unknown entity_type: {entity_type}")

                _http_post_json(url, bundle)

                with conn.transaction():
                    with conn.cursor() as cur:
                        set_company_context(cur, company_id)
                        cur.execute(
                            """
                            UPDATE edge_sync_outbox
                            SET status='sent', sent_at=now(), last_error=NULL, updated_at=now()
                            WHERE company_id=%s AND id=%s::uuid
                            """,
                            (company_id, outbox_id),
                        )
                processed += 1
            except urllib.error.HTTPError as ex:
                # Cloud responded with a non-2xx status. Capture response body if possible.
                try:
                    body = ex.read().decode("utf-8")  # type: ignore[attr-defined]
                except Exception:
                    body = ""
                msg = f"http {getattr(ex, 'code', None)} {getattr(ex, 'reason', '')}".strip()
                if body:
                    msg = f"{msg}: {body[:1000]}"
                with conn.transaction():
                    with conn.cursor() as cur:
                        set_company_context(cur, company_id)
                        cur.execute(
                            """
                            UPDATE edge_sync_outbox
                            SET status='failed', last_error=%s, updated_at=now()
                            WHERE company_id=%s AND id=%s::uuid
                            """,
                            (msg, company_id, outbox_id),
                        )
            except Exception as ex:
                with conn.transaction():
                    with conn.cursor() as cur:
                        set_company_context(cur, company_id)
                        cur.execute(
                            """
                            UPDATE edge_sync_outbox
                            SET status='failed', last_error=%s, updated_at=now()
                            WHERE company_id=%s AND id=%s::uuid
                            """,
                            (str(ex)[:1000], company_id, outbox_id),
                        )

    return processed

