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


def _enforce_https(url: str) -> str:
    """Validate that the URL uses HTTPS scheme. Reject non-HTTPS URLs."""
    if not url:
        return ""
    if not url.lower().startswith("https://"):
        raise ValueError(
            f"Edge sync URL must use HTTPS scheme for security, got: {url[:50]}"
        )
    return url


def _target_url() -> str:
    """
    Accept either:
    - EDGE_SYNC_TARGET_URL="https://cloud.example.com/edge-sync/sales-invoices/import"
    - EDGE_SYNC_TARGET_URL="https://cloud.example.com"  (we'll append the path)
    """
    raw = (os.getenv("EDGE_SYNC_TARGET_URL") or "").strip()
    if not raw:
        return ""
    _enforce_https(raw)
    if "/edge-sync/" in raw:
        return raw.rstrip("/")
    return raw.rstrip("/") + "/edge-sync/sales-invoices/import"


def _customers_url() -> str:
    base = _cloud_base_url()
    if not base:
        return ""
    return base.rstrip("/") + "/edge-sync/customers/import"

def _cloud_base_url() -> str:
    raw = (os.getenv("EDGE_SYNC_TARGET_URL") or "").strip()
    if not raw:
        return ""
    _enforce_https(raw)
    raw = raw.rstrip("/")
    if "/edge-sync/" in raw:
        return raw.split("/edge-sync/", 1)[0].rstrip("/")
    return raw

def _ping_url() -> str:
    base = _cloud_base_url()
    if not base:
        return ""
    return base.rstrip("/") + "/edge-sync/ping"


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
    # NOTE: This replication bundle intentionally selects all columns so that
    # newly-added migration columns are automatically replicated without code changes.
    inv = _fetch_one(
        cur,
        """SELECT id, company_id, invoice_no, customer_id, status,
                  total_usd, total_lbp, exchange_rate,
                  pricing_currency, settlement_currency, created_at
           FROM sales_invoices WHERE company_id=%s AND id=%s""",
        (company_id, invoice_id),
    )
    if not inv:
        raise ValueError("invoice not found on edge")

    lines = _fetch_all(
        cur,
        """SELECT id, invoice_id, item_id, qty,
                  unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp
           FROM sales_invoice_lines WHERE invoice_id=%s ORDER BY id ASC""",
        (invoice_id,),
    )
    payments = _fetch_all(
        cur,
        """SELECT id, invoice_id, method, amount_usd, amount_lbp, created_at
           FROM sales_payments WHERE invoice_id=%s ORDER BY created_at ASC""",
        (invoice_id,),
    )
    tax_lines = _fetch_all(
        cur,
        """
        SELECT id, company_id, source_type, source_id, tax_code_id,
               base_usd, base_lbp, tax_usd, tax_lbp
        FROM tax_lines
        WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
        ORDER BY id ASC
        """,
        (company_id, invoice_id),
    )
    stock_moves = _fetch_all(
        cur,
        """
        SELECT id, company_id, item_id, warehouse_id, batch_id,
               qty_in, qty_out, unit_cost_usd, unit_cost_lbp,
               source_type, source_id, created_at
        FROM stock_moves
        WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
        ORDER BY created_at ASC
        """,
        (company_id, invoice_id),
    )
    gl_journals = _fetch_all(
        cur,
        """
        SELECT id, company_id, journal_no, source_type, source_id,
               journal_date, rate_type, created_at
        FROM gl_journals
        WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
        ORDER BY created_at ASC
        """,
        (company_id, invoice_id),
    )
    journal_ids = [str(j.get("id")) for j in gl_journals if j.get("id")]
    gl_entries = []
    if journal_ids:
        gl_entries = _fetch_all(
            cur,
            """SELECT id, journal_id, account_id,
                      debit_usd, credit_usd, debit_lbp, credit_lbp, memo
               FROM gl_entries WHERE journal_id = ANY(%s::uuid[]) ORDER BY id ASC""",
            (journal_ids,),
        )

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


def _build_customer_bundle(cur, company_id: str, customer_id: str) -> dict:
    cust = _fetch_one(
        cur,
        """SELECT id, company_id, name, email, phone, tax_id,
                  credit_balance_usd, credit_balance_lbp, loyalty_points,
                  created_at
           FROM customers WHERE company_id=%s AND id=%s""",
        (company_id, customer_id),
    )
    if not cust:
        raise ValueError("customer not found on edge")
    return {"company_id": str(company_id), "customer": cust, "source_node_id": _source_node_id()}


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
    sales_url = _target_url()
    customers_url = _customers_url()
    key = _edge_key()
    if not key or (not sales_url and not customers_url):
        return 0

    # Heartbeat to the cloud even if there is nothing to sync right now.
    try:
        ping_url = _ping_url()
        if ping_url:
            _http_post_json(ping_url, {"company_id": str(company_id), "source_node_id": _source_node_id()})
    except Exception:
        # Best-effort: do not block operational sync on heartbeat errors.
        pass

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
                            url = sales_url
                        elif entity_type == "customer":
                            bundle = _build_customer_bundle(cur, company_id, entity_id)
                            url = customers_url
                        else:
                            raise ValueError(f"unknown entity_type: {entity_type}")

                if not url:
                    raise ValueError(f"missing cloud url for entity_type: {entity_type}")
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
