"""
Read-only tools for the Kai AI agent.

All tools in this module are safe (no mutations) and never require
user confirmation.  They run read-only SQL against the company-scoped
database via RLS.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal, Optional

from ...db import get_conn, set_company_context
from .registry import ToolResult, register_tool

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json_safe(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return str(val)
    if isinstance(val, (int, float, bool, str)):
        return val
    if isinstance(val, dict):
        return {k: _json_safe(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_json_safe(i) for i in val]
    return str(val)


def _rows(rows: list[Any]) -> list[dict[str, Any]]:
    return [{k: _json_safe(v) for k, v in (dict(r) if hasattr(r, "keys") else r).items()} for r in rows]


# ---------------------------------------------------------------------------
# 1. Item / Product Search
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "query": {"description": "Search term – matches item name, SKU, barcode, or brand."},
        "limit": {"description": "Max results to return (1–50, default 20)."},
        "active_only": {"description": "If true, only return active items."},
    },
)
def search_items(
    company_id: str,
    user: dict,
    query: str,
    limit: int = 20,
    active_only: bool = True,
) -> ToolResult:
    """Search the product catalog by name, SKU, barcode, or brand."""
    limit = max(1, min(50, limit))
    pattern = f"%{query.strip()}%"
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            active_clause = "AND i.is_active = true" if active_only else ""
            cur.execute(
                f"""
                SELECT i.id, i.sku, i.barcode, i.name, i.brand,
                       i.unit_of_measure, i.is_active,
                       ic.name AS category_name,
                       COALESCE(SUM(iwc.on_hand_qty), 0) AS total_stock,
                       COALESCE(AVG(iwc.avg_cost_usd), 0) AS avg_cost_usd
                FROM items i
                LEFT JOIN item_categories ic ON ic.id = i.category_id
                LEFT JOIN item_warehouse_costs iwc
                       ON iwc.item_id = i.id AND iwc.company_id = i.company_id
                WHERE i.company_id = %s
                  AND (i.name ILIKE %s OR i.sku ILIKE %s
                       OR i.barcode ILIKE %s OR i.brand ILIKE %s)
                  {active_clause}
                GROUP BY i.id, ic.name
                ORDER BY i.name
                LIMIT %s
                """,
                (company_id, pattern, pattern, pattern, pattern, limit),
            )
            rows = cur.fetchall()
            return ToolResult(
                data={"items": _rows(rows), "count": len(rows)},
                message=f"Found {len(rows)} item(s) matching '{query}'.",
            )


# ---------------------------------------------------------------------------
# 2. Stock Levels
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "item_query": {"description": "Optional – filter by item name, SKU, or barcode."},
        "warehouse_name": {"description": "Optional – filter by warehouse name."},
        "low_stock_only": {"description": "If true, only show items at or below reorder point."},
        "negative_only": {"description": "If true, only show items with negative stock."},
        "limit": {"description": "Max results (1–100, default 50)."},
    },
)
def get_stock_levels(
    company_id: str,
    user: dict,
    item_query: str = "",
    warehouse_name: str = "",
    low_stock_only: bool = False,
    negative_only: bool = False,
    limit: int = 50,
) -> ToolResult:
    """Get current stock levels across warehouses, with optional filters for low or negative stock."""
    limit = max(1, min(100, limit))
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            conditions = ["iwc.company_id = %s"]
            params: list[Any] = [company_id]

            if item_query.strip():
                conditions.append(
                    "(i.name ILIKE %s OR i.sku ILIKE %s OR i.barcode ILIKE %s)"
                )
                p = f"%{item_query.strip()}%"
                params.extend([p, p, p])

            if warehouse_name.strip():
                conditions.append("w.name ILIKE %s")
                params.append(f"%{warehouse_name.strip()}%")

            if low_stock_only:
                conditions.append("iwc.on_hand_qty <= i.reorder_point")

            if negative_only:
                conditions.append("iwc.on_hand_qty < 0")

            where = " AND ".join(conditions)
            params.append(limit)

            cur.execute(
                f"""
                SELECT i.id AS item_id, i.sku, i.name AS item_name,
                       w.name AS warehouse_name,
                       iwc.on_hand_qty, iwc.avg_cost_usd,
                       i.reorder_point, i.reorder_qty,
                       i.unit_of_measure
                FROM item_warehouse_costs iwc
                JOIN items i ON i.id = iwc.item_id AND i.company_id = iwc.company_id
                JOIN warehouses w ON w.id = iwc.warehouse_id
                WHERE {where}
                ORDER BY i.name, w.name
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cur.fetchall()
            return ToolResult(
                data={"stock": _rows(rows), "count": len(rows)},
                message=f"{len(rows)} stock position(s) returned.",
            )


# ---------------------------------------------------------------------------
# 3. Sales Summary
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "period": {"description": "Time period: today, week, month, or a specific date (YYYY-MM-DD)."},
    },
)
def sales_summary(
    company_id: str,
    user: dict,
    period: str = "today",
) -> ToolResult:
    """Get a sales summary (total revenue, invoice count, top items) for a time period."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            start, end, label = _parse_period(period)

            # Totals
            cur.execute(
                """
                SELECT COUNT(*)::int AS invoice_count,
                       COALESCE(SUM(total_usd), 0) AS total_usd,
                       COALESCE(SUM(total_lbp), 0) AS total_lbp
                FROM sales_invoices
                WHERE company_id = %s AND status = 'posted'
                  AND created_at >= %s AND created_at < %s
                """,
                (company_id, start, end),
            )
            totals = dict(cur.fetchone())

            # Top 10 items by revenue
            cur.execute(
                """
                SELECT i.name AS item_name, i.sku,
                       SUM(sil.qty) AS total_qty,
                       SUM(sil.line_total_usd) AS revenue_usd
                FROM sales_invoice_lines sil
                JOIN sales_invoices si ON si.id = sil.invoice_id
                JOIN items i ON i.id = sil.item_id
                WHERE si.company_id = %s AND si.status = 'posted'
                  AND si.created_at >= %s AND si.created_at < %s
                GROUP BY i.name, i.sku
                ORDER BY revenue_usd DESC
                LIMIT 10
                """,
                (company_id, start, end),
            )
            top_items = cur.fetchall()

            return ToolResult(
                data={
                    "period": label,
                    "invoice_count": totals["invoice_count"],
                    "total_usd": str(totals["total_usd"]),
                    "total_lbp": str(totals["total_lbp"]),
                    "top_items": _rows(top_items),
                },
                message=f"Sales for {label}: {totals['invoice_count']} invoices, ${totals['total_usd']} USD.",
            )


# ---------------------------------------------------------------------------
# 4. Purchases Summary
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "period": {"description": "Time period: today, week, month, or a specific date (YYYY-MM-DD)."},
    },
)
def purchases_summary(
    company_id: str,
    user: dict,
    period: str = "today",
) -> ToolResult:
    """Get a purchases summary (total cost, PO and invoice counts) for a time period."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            start, end, label = _parse_period(period)

            cur.execute(
                """
                SELECT
                  (SELECT COUNT(*)::int FROM purchase_orders
                   WHERE company_id=%s AND status='posted'
                     AND created_at >= %s AND created_at < %s) AS po_count,
                  (SELECT COALESCE(SUM(total_usd),0) FROM purchase_orders
                   WHERE company_id=%s AND status='posted'
                     AND created_at >= %s AND created_at < %s) AS po_total_usd,
                  (SELECT COUNT(*)::int FROM supplier_invoices
                   WHERE company_id=%s AND status='posted'
                     AND created_at >= %s AND created_at < %s) AS si_count,
                  (SELECT COALESCE(SUM(total_usd),0) FROM supplier_invoices
                   WHERE company_id=%s AND status='posted'
                     AND created_at >= %s AND created_at < %s) AS si_total_usd
                """,
                (
                    company_id, start, end,
                    company_id, start, end,
                    company_id, start, end,
                    company_id, start, end,
                ),
            )
            row = dict(cur.fetchone())
            return ToolResult(
                data={
                    "period": label,
                    "purchase_orders": {"count": row["po_count"], "total_usd": str(row["po_total_usd"])},
                    "supplier_invoices": {"count": row["si_count"], "total_usd": str(row["si_total_usd"])},
                },
                message=f"Purchases for {label}: {row['po_count']} POs (${row['po_total_usd']}), {row['si_count']} supplier invoices (${row['si_total_usd']}).",
            )


# ---------------------------------------------------------------------------
# 5. Customer Lookup
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "query": {"description": "Search by customer name, phone, or email."},
        "limit": {"description": "Max results (1–50, default 20)."},
    },
)
def customer_lookup(
    company_id: str,
    user: dict,
    query: str,
    limit: int = 20,
) -> ToolResult:
    """Look up customers by name, phone, or email.  Returns recent purchase activity."""
    limit = max(1, min(50, limit))
    pattern = f"%{query.strip()}%"
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.id, c.name, c.phone, c.email, c.is_active,
                       c.party_type, c.vat_no,
                       (SELECT COUNT(*)::int FROM sales_invoices si
                        WHERE si.customer_id = c.id AND si.status = 'posted') AS invoice_count,
                       (SELECT COALESCE(SUM(si.total_usd), 0) FROM sales_invoices si
                        WHERE si.customer_id = c.id AND si.status = 'posted') AS lifetime_revenue_usd,
                       (SELECT MAX(si.created_at) FROM sales_invoices si
                        WHERE si.customer_id = c.id AND si.status = 'posted') AS last_purchase_at
                FROM customers c
                WHERE c.company_id = %s
                  AND (c.name ILIKE %s OR c.phone ILIKE %s OR c.email ILIKE %s)
                ORDER BY c.name
                LIMIT %s
                """,
                (company_id, pattern, pattern, pattern, limit),
            )
            rows = cur.fetchall()
            return ToolResult(
                data={"customers": _rows(rows), "count": len(rows)},
                message=f"Found {len(rows)} customer(s) matching '{query}'.",
            )


# ---------------------------------------------------------------------------
# 6. Supplier Lookup
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "query": {"description": "Search by supplier name, phone, or email."},
        "limit": {"description": "Max results (1–50, default 20)."},
    },
)
def supplier_lookup(
    company_id: str,
    user: dict,
    query: str,
    limit: int = 20,
) -> ToolResult:
    """Look up suppliers by name, phone, or email.  Returns PO and invoice counts."""
    limit = max(1, min(50, limit))
    pattern = f"%{query.strip()}%"
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.name, s.phone, s.email, s.is_active,
                       s.party_type, s.vat_no,
                       (SELECT COUNT(*)::int FROM purchase_orders po
                        WHERE po.supplier_id = s.id AND po.status = 'posted') AS po_count,
                       (SELECT COUNT(*)::int FROM supplier_invoices si
                        WHERE si.supplier_id = s.id AND si.status = 'posted') AS invoice_count,
                       (SELECT COALESCE(SUM(si.total_usd), 0) FROM supplier_invoices si
                        WHERE si.supplier_id = s.id AND si.status = 'posted') AS total_invoiced_usd
                FROM suppliers s
                WHERE s.company_id = %s
                  AND (s.name ILIKE %s OR s.phone ILIKE %s OR s.email ILIKE %s)
                ORDER BY s.name
                LIMIT %s
                """,
                (company_id, pattern, pattern, pattern, limit),
            )
            rows = cur.fetchall()
            return ToolResult(
                data={"suppliers": _rows(rows), "count": len(rows)},
                message=f"Found {len(rows)} supplier(s) matching '{query}'.",
            )


# ---------------------------------------------------------------------------
# 7. AR/AP Aging
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "direction": {"description": "'receivable' for customer aging, 'payable' for supplier aging."},
        "limit": {"description": "Max results (1–100, default 30)."},
    },
)
def aging_report(
    company_id: str,
    user: dict,
    direction: Literal["receivable", "payable"] = "receivable",
    limit: int = 30,
) -> ToolResult:
    """Get accounts receivable or accounts payable aging summary."""
    limit = max(1, min(100, limit))
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            if direction == "receivable":
                cur.execute(
                    """
                    SELECT c.name AS party_name,
                           COUNT(*)::int AS open_invoices,
                           SUM(si.total_usd) AS total_usd,
                           MIN(si.created_at) AS oldest_invoice_date,
                           MAX(si.created_at) AS newest_invoice_date
                    FROM sales_invoices si
                    JOIN customers c ON c.id = si.customer_id
                    WHERE si.company_id = %s AND si.status = 'posted'
                    GROUP BY c.id, c.name
                    HAVING SUM(si.total_usd) > 0
                    ORDER BY total_usd DESC
                    LIMIT %s
                    """,
                    (company_id, limit),
                )
            else:
                cur.execute(
                    """
                    SELECT s.name AS party_name,
                           COUNT(*)::int AS open_invoices,
                           SUM(si.total_usd) AS total_usd,
                           MIN(si.created_at) AS oldest_invoice_date,
                           MAX(si.created_at) AS newest_invoice_date
                    FROM supplier_invoices si
                    JOIN suppliers s ON s.id = si.supplier_id
                    WHERE si.company_id = %s AND si.status = 'posted'
                    GROUP BY s.id, s.name
                    HAVING SUM(si.total_usd) > 0
                    ORDER BY total_usd DESC
                    LIMIT %s
                    """,
                    (company_id, limit),
                )
            rows = cur.fetchall()
            label = "Accounts Receivable" if direction == "receivable" else "Accounts Payable"
            total = sum(float(r.get("total_usd") or 0) for r in rows)
            return ToolResult(
                data={"direction": direction, "aging": _rows(rows), "count": len(rows), "grand_total_usd": str(total)},
                message=f"{label}: {len(rows)} parties, ${total:,.2f} USD total.",
            )


# ---------------------------------------------------------------------------
# 8. Recent Invoices
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "invoice_type": {"description": "'sales' or 'purchase'."},
        "status": {"description": "Filter by status: draft, posted, canceled. Leave empty for all."},
        "limit": {"description": "Max results (1–50, default 20)."},
    },
)
def recent_invoices(
    company_id: str,
    user: dict,
    invoice_type: Literal["sales", "purchase"] = "sales",
    status: str = "",
    limit: int = 20,
) -> ToolResult:
    """Get recent sales or purchase (supplier) invoices."""
    limit = max(1, min(50, limit))
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            if invoice_type == "sales":
                status_clause = ""
                params: list[Any] = [company_id]
                if status.strip():
                    status_clause = "AND si.status = %s"
                    params.append(status.strip().lower())
                params.append(limit)
                cur.execute(
                    f"""
                    SELECT si.id, si.invoice_no, si.status,
                           si.total_usd, si.total_lbp,
                           c.name AS customer_name,
                           si.created_at
                    FROM sales_invoices si
                    LEFT JOIN customers c ON c.id = si.customer_id
                    WHERE si.company_id = %s {status_clause}
                    ORDER BY si.created_at DESC
                    LIMIT %s
                    """,
                    tuple(params),
                )
            else:
                status_clause = ""
                params = [company_id]
                if status.strip():
                    status_clause = "AND si.status = %s"
                    params.append(status.strip().lower())
                params.append(limit)
                cur.execute(
                    f"""
                    SELECT si.id, si.invoice_no, si.status,
                           si.total_usd, si.total_lbp,
                           s.name AS supplier_name,
                           si.created_at
                    FROM supplier_invoices si
                    LEFT JOIN suppliers s ON s.id = si.supplier_id
                    WHERE si.company_id = %s {status_clause}
                    ORDER BY si.created_at DESC
                    LIMIT %s
                    """,
                    tuple(params),
                )
            rows = cur.fetchall()
            return ToolResult(
                data={"invoices": _rows(rows), "count": len(rows), "type": invoice_type},
                message=f"{len(rows)} recent {invoice_type} invoice(s).",
            )


# ---------------------------------------------------------------------------
# 9. Batch / Expiry Check
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "days_ahead": {"description": "Show batches expiring within this many days (default 30)."},
        "limit": {"description": "Max results (1–100, default 50)."},
    },
)
def expiring_batches(
    company_id: str,
    user: dict,
    days_ahead: int = 30,
    limit: int = 50,
) -> ToolResult:
    """Find inventory batches expiring within a given number of days."""
    limit = max(1, min(100, limit))
    cutoff = date.today() + timedelta(days=max(1, days_ahead))
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT b.id AS batch_id, b.batch_no, b.expiry_date,
                       i.name AS item_name, i.sku,
                       w.name AS warehouse_name,
                       b.on_hand_qty, b.uom
                FROM batches b
                JOIN items i ON i.id = b.item_id
                JOIN warehouses w ON w.id = b.warehouse_id
                WHERE b.company_id = %s
                  AND b.expiry_date IS NOT NULL
                  AND b.expiry_date <= %s
                  AND b.on_hand_qty > 0
                ORDER BY b.expiry_date ASC
                LIMIT %s
                """,
                (company_id, cutoff, limit),
            )
            rows = cur.fetchall()
            return ToolResult(
                data={"batches": _rows(rows), "count": len(rows), "cutoff_date": cutoff.isoformat()},
                message=f"{len(rows)} batch(es) expiring within {days_ahead} days.",
            )


# ---------------------------------------------------------------------------
# 10. AI Recommendations Query
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "agent_code": {"description": "Optional agent filter: AI_PURCHASE, AI_DEMAND, AI_PRICING, AI_INVENTORY, AI_ANOMALY, AI_SHRINKAGE, AI_CRM, AI_EXPIRY_OPS, etc."},
        "status": {"description": "Filter by status: pending, approved, rejected, executed.  Default: pending."},
        "limit": {"description": "Max results (1–50, default 25)."},
    },
)
def query_recommendations(
    company_id: str,
    user: dict,
    agent_code: str = "",
    status: str = "pending",
    limit: int = 25,
) -> ToolResult:
    """Query AI recommendations by agent and status."""
    limit = max(1, min(50, limit))
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            conditions = ["r.company_id = %s"]
            params: list[Any] = [company_id]

            if status.strip():
                conditions.append("r.status = %s")
                params.append(status.strip().lower())

            if agent_code.strip():
                conditions.append("r.agent_code = %s")
                params.append(agent_code.strip().upper())

            where = " AND ".join(conditions)
            params.append(limit)

            cur.execute(
                f"""
                SELECT r.id, r.agent_code, r.status, r.created_at,
                       r.recommendation_json,
                       r.decided_at, r.decision_reason
                FROM ai_recommendations r
                WHERE {where}
                ORDER BY r.created_at DESC
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cur.fetchall()
            return ToolResult(
                data={"recommendations": _rows(rows), "count": len(rows)},
                message=f"{len(rows)} recommendation(s) found.",
            )


# ---------------------------------------------------------------------------
# 11. Attention / Dashboard Overview
# ---------------------------------------------------------------------------

@register_tool(category="read")
def operations_overview(
    company_id: str,
    user: dict,
) -> ToolResult:
    """Get a quick operational health overview: pending recommendations, failed outbox events, negative stock, invoices on hold, failed jobs."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*)::int AS c FROM ai_recommendations WHERE company_id=%s AND status='pending'",
                (company_id,),
            )
            pending_recs = int(cur.fetchone()["c"])

            cur.execute(
                "SELECT COUNT(*)::int AS c FROM pos_events_outbox WHERE company_id=%s AND status='failed'",
                (company_id,),
            )
            outbox_failed = int(cur.fetchone()["c"])

            cur.execute(
                "SELECT COUNT(*)::int AS c FROM item_warehouse_costs WHERE company_id=%s AND on_hand_qty < 0",
                (company_id,),
            )
            neg_stock = int(cur.fetchone()["c"])

            cur.execute(
                "SELECT COUNT(*)::int AS c FROM supplier_invoices WHERE company_id=%s AND status='draft' AND is_on_hold=true",
                (company_id,),
            )
            on_hold = int(cur.fetchone()["c"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS c FROM background_job_runs
                WHERE company_id=%s AND status='failed'
                  AND ended_at >= now() - interval '24 hours'
                """,
                (company_id,),
            )
            failed_jobs = int(cur.fetchone()["c"])

            data = {
                "pending_ai_recommendations": pending_recs,
                "pos_outbox_failed": outbox_failed,
                "negative_stock_positions": neg_stock,
                "supplier_invoices_on_hold": on_hold,
                "failed_jobs_24h": failed_jobs,
            }
            # Build a concise summary
            issues = []
            if pending_recs:
                issues.append(f"{pending_recs} pending AI recommendations")
            if outbox_failed:
                issues.append(f"{outbox_failed} failed POS sync events")
            if neg_stock:
                issues.append(f"{neg_stock} negative stock positions")
            if on_hold:
                issues.append(f"{on_hold} invoices on hold")
            if failed_jobs:
                issues.append(f"{failed_jobs} failed background jobs")

            if issues:
                msg = "Attention needed: " + "; ".join(issues) + "."
            else:
                msg = "All systems healthy — no attention items."

            return ToolResult(data=data, message=msg)


# ---------------------------------------------------------------------------
# 12. Navigate (client-side action, echoed back)
# ---------------------------------------------------------------------------

@register_tool(
    category="read",
    parameter_overrides={
        "page": {
            "description": (
                "The app route to navigate to, e.g. "
                "'/automation/ai-hub', '/purchasing/supplier-invoices', "
                "'/inventory/stock', '/system/outbox', "
                "'/system/pos-shifts', '/sales/invoices', "
                "'/purchasing/purchase-orders', '/purchasing/goods-receipts', "
                "'/inventory/alerts', '/inventory/batches', "
                "'/accounting/period-locks', '/catalog/items', "
                "'/partners/customers', '/partners/suppliers', "
                "'/dashboard'."
            ),
        },
        "reason": {"description": "Brief reason for the navigation suggestion."},
    },
)
def navigate(
    company_id: str,
    user: dict,
    page: str,
    reason: str = "",
) -> ToolResult:
    """Navigate the user to a specific page in the application."""
    return ToolResult(
        data={"navigated": True, "page": page, "reason": reason},
        actions=[{"type": "navigate", "href": page, "label": reason}],
    )


# ---------------------------------------------------------------------------
# 13. POS Outbox Status
# ---------------------------------------------------------------------------

@register_tool(category="read")
def pos_outbox_status(
    company_id: str,
    user: dict,
) -> ToolResult:
    """Check POS sync queue — event counts by device and status."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.device_code, o.status, COUNT(*)::int AS count
                FROM pos_events_outbox o
                JOIN pos_devices d ON d.id = o.device_id
                WHERE d.company_id = %s
                GROUP BY d.device_code, o.status
                ORDER BY d.device_code, o.status
                """,
                (company_id,),
            )
            rows = cur.fetchall()
            return ToolResult(
                data={"outbox": _rows(rows)},
                message=f"POS outbox: {len(rows)} device/status combinations.",
            )


# ---------------------------------------------------------------------------
# 14. Exchange Rate
# ---------------------------------------------------------------------------

@register_tool(category="read")
def current_exchange_rate(
    company_id: str,
    user: dict,
) -> ToolResult:
    """Get the latest USD→LBP exchange rate for this company."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT rate_date, rate_type, usd_to_lbp
                FROM exchange_rates
                WHERE company_id = %s
                ORDER BY rate_date DESC, created_at DESC
                LIMIT 3
                """,
                (company_id,),
            )
            rows = cur.fetchall()
            if rows:
                latest = rows[0]
                return ToolResult(
                    data={"rates": _rows(rows)},
                    message=f"Latest rate ({latest['rate_date']}): 1 USD = {latest['usd_to_lbp']} LBP ({latest['rate_type']}).",
                )
            return ToolResult(data={"rates": []}, message="No exchange rates configured.")


# ---------------------------------------------------------------------------
# 15. Period Locks
# ---------------------------------------------------------------------------

@register_tool(category="read")
def accounting_period_locks(
    company_id: str,
    user: dict,
) -> ToolResult:
    """List active accounting period locks."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, start_date, end_date, reason, created_at
                FROM accounting_period_locks
                WHERE company_id = %s AND locked = true
                ORDER BY end_date DESC
                LIMIT 20
                """,
                (company_id,),
            )
            rows = cur.fetchall()
            return ToolResult(
                data={"locks": _rows(rows), "count": len(rows)},
                message=f"{len(rows)} active period lock(s).",
            )


# ---------------------------------------------------------------------------
# Period helper
# ---------------------------------------------------------------------------

def _parse_period(period: str) -> tuple[datetime, datetime, str]:
    """Parse a period string into (start, end, label)."""
    today = date.today()
    p = period.strip().lower()
    if p == "today":
        start = datetime(today.year, today.month, today.day)
        end = start + timedelta(days=1)
        return start, end, f"today ({today.isoformat()})"
    elif p == "yesterday":
        yesterday = today - timedelta(days=1)
        start = datetime(yesterday.year, yesterday.month, yesterday.day)
        end = start + timedelta(days=1)
        return start, end, f"yesterday ({yesterday.isoformat()})"
    elif p == "week":
        start_d = today - timedelta(days=today.weekday())
        start = datetime(start_d.year, start_d.month, start_d.day)
        end = datetime(today.year, today.month, today.day) + timedelta(days=1)
        return start, end, f"this week ({start_d.isoformat()} to {today.isoformat()})"
    elif p == "month":
        start = datetime(today.year, today.month, 1)
        end = datetime(today.year, today.month, today.day) + timedelta(days=1)
        return start, end, f"this month ({start.date().isoformat()} to {today.isoformat()})"
    else:
        # Try parsing as a specific date
        try:
            d = date.fromisoformat(p)
            start = datetime(d.year, d.month, d.day)
            end = start + timedelta(days=1)
            return start, end, d.isoformat()
        except ValueError:
            # Fallback to today
            start = datetime(today.year, today.month, today.day)
            end = start + timedelta(days=1)
            return start, end, f"today ({today.isoformat()})"
