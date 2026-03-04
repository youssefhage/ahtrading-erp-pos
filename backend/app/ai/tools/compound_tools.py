"""
Compound (multi-step) tools for the Kai AI agent.

These tools orchestrate multiple read operations into a single
comprehensive response.  They are read-only but categorized separately
because they represent higher-level "skills" or "workflows".
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from ...db import get_conn, set_company_context
from .registry import ToolResult, register_tool

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. Morning Briefing
# ---------------------------------------------------------------------------

@register_tool(
    category="compound",
    parameter_overrides={
        "include_top_items": {"description": "Include top-selling items in the briefing (default true)."},
    },
)
def morning_briefing(
    company_id: str,
    user: dict,
    include_top_items: bool = True,
) -> ToolResult:
    """Get a comprehensive morning briefing: yesterday's sales, today's open items, stock alerts, pending recommendations, and system health."""
    today = date.today()
    yesterday = today - timedelta(days=1)
    parts: list[str] = []
    data: dict[str, Any] = {}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # 1. Yesterday's sales summary
            cur.execute(
                """
                SELECT COUNT(*)::int AS count,
                       COALESCE(SUM(total_usd), 0) AS total_usd,
                       COALESCE(SUM(total_lbp), 0) AS total_lbp
                FROM sales_invoices
                WHERE company_id = %s AND status = 'posted'
                  AND created_at::date = %s
                """,
                (company_id, yesterday),
            )
            yest = dict(cur.fetchone())
            data["yesterday_sales"] = {k: str(v) for k, v in yest.items()}
            parts.append(
                f"**Yesterday's Sales** ({yesterday})\n"
                f"  {yest['count']} invoices — ${yest['total_usd']} USD"
            )

            # 2. Today's sales so far
            cur.execute(
                """
                SELECT COUNT(*)::int AS count,
                       COALESCE(SUM(total_usd), 0) AS total_usd
                FROM sales_invoices
                WHERE company_id = %s AND status = 'posted'
                  AND created_at::date = %s
                """,
                (company_id, today),
            )
            tod = dict(cur.fetchone())
            data["today_sales"] = {k: str(v) for k, v in tod.items()}
            parts.append(f"**Today So Far**: {tod['count']} invoices — ${tod['total_usd']} USD")

            # 3. Top items yesterday
            if include_top_items:
                cur.execute(
                    """
                    SELECT i.name, i.sku, SUM(sil.qty) AS qty,
                           SUM(sil.line_total_usd) AS revenue
                    FROM sales_invoice_lines sil
                    JOIN sales_invoices si ON si.id = sil.invoice_id
                    JOIN items i ON i.id = sil.item_id
                    WHERE si.company_id = %s AND si.status = 'posted'
                      AND si.created_at::date = %s
                    GROUP BY i.name, i.sku
                    ORDER BY revenue DESC LIMIT 5
                    """,
                    (company_id, yesterday),
                )
                top_items = cur.fetchall()
                if top_items:
                    items_str = "\n".join(
                        f"  • {r['name']} ({r['sku']}): {r['qty']} sold — ${r['revenue']}"
                        for r in top_items
                    )
                    parts.append(f"**Top Sellers Yesterday**\n{items_str}")

            # 4. Stock alerts
            cur.execute(
                "SELECT COUNT(*)::int AS c FROM item_warehouse_costs WHERE company_id=%s AND on_hand_qty < 0",
                (company_id,),
            )
            neg = int(cur.fetchone()["c"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS c FROM item_warehouse_costs iwc
                JOIN items i ON i.id = iwc.item_id AND i.company_id = iwc.company_id
                WHERE iwc.company_id = %s AND iwc.on_hand_qty <= i.reorder_point AND iwc.on_hand_qty > 0
                """,
                (company_id,),
            )
            low = int(cur.fetchone()["c"])

            # Expiring batches in next 7 days
            cur.execute(
                """
                SELECT COUNT(*)::int AS c FROM batches
                WHERE company_id = %s AND expiry_date IS NOT NULL
                  AND expiry_date <= %s AND on_hand_qty > 0
                """,
                (company_id, today + timedelta(days=7)),
            )
            expiring = int(cur.fetchone()["c"])

            stock_alerts = []
            if neg:
                stock_alerts.append(f"🔴 {neg} negative stock positions")
            if low:
                stock_alerts.append(f"🟡 {low} items at/below reorder point")
            if expiring:
                stock_alerts.append(f"🟠 {expiring} batches expiring within 7 days")
            data["stock_alerts"] = {"negative": neg, "low_stock": low, "expiring_7d": expiring}
            if stock_alerts:
                parts.append("**Stock Alerts**\n" + "\n".join(f"  {a}" for a in stock_alerts))
            else:
                parts.append("**Stock**: All clear ✅")

            # 5. Pending AI recommendations
            cur.execute(
                """
                SELECT agent_code, COUNT(*)::int AS c
                FROM ai_recommendations
                WHERE company_id = %s AND status = 'pending'
                GROUP BY agent_code ORDER BY c DESC
                """,
                (company_id,),
            )
            recs = cur.fetchall()
            total_recs = sum(r["c"] for r in recs)
            data["pending_recommendations"] = {r["agent_code"]: r["c"] for r in recs}
            if total_recs:
                rec_str = ", ".join(f"{r['agent_code']}: {r['c']}" for r in recs)
                parts.append(f"**Pending AI Recommendations**: {total_recs} total ({rec_str})")
            else:
                parts.append("**AI Recommendations**: All clear ✅")

            # 6. System health
            cur.execute(
                "SELECT COUNT(*)::int AS c FROM pos_events_outbox WHERE company_id=%s AND status='failed'",
                (company_id,),
            )
            outbox_failed = int(cur.fetchone()["c"])
            cur.execute(
                """
                SELECT COUNT(*)::int AS c FROM background_job_runs
                WHERE company_id=%s AND status='failed' AND ended_at >= now() - interval '24 hours'
                """,
                (company_id,),
            )
            failed_jobs = int(cur.fetchone()["c"])
            cur.execute(
                "SELECT COUNT(*)::int AS c FROM supplier_invoices WHERE company_id=%s AND status='draft' AND is_on_hold=true",
                (company_id,),
            )
            on_hold = int(cur.fetchone()["c"])

            health = []
            if outbox_failed:
                health.append(f"🔴 {outbox_failed} failed POS sync events")
            if failed_jobs:
                health.append(f"🔴 {failed_jobs} failed background jobs (24h)")
            if on_hold:
                health.append(f"🟡 {on_hold} supplier invoices on hold")
            data["system_health"] = {"outbox_failed": outbox_failed, "failed_jobs": failed_jobs, "on_hold": on_hold}

            if health:
                parts.append("**System Health**\n" + "\n".join(f"  {h}" for h in health))
            else:
                parts.append("**System Health**: All systems operational ✅")

    return ToolResult(
        data=data,
        message="\n\n".join(parts),
    )


# ---------------------------------------------------------------------------
# 2. Restock Check
# ---------------------------------------------------------------------------

@register_tool(
    category="compound",
    parameter_overrides={
        "limit": {"description": "Max items to check (1–50, default 20)."},
    },
)
def restock_check(
    company_id: str,
    user: dict,
    limit: int = 20,
) -> ToolResult:
    """Find items that need restocking: below reorder point with preferred supplier info and suggested PO quantities."""
    limit = max(1, min(50, limit))
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id AS item_id, i.name, i.sku,
                       i.reorder_point, i.reorder_qty,
                       i.unit_of_measure,
                       iwc.on_hand_qty,
                       iwc.avg_cost_usd,
                       w.name AS warehouse_name,
                       s.name AS supplier_name,
                       isup.last_cost_usd,
                       isup.lead_time_days,
                       isup.min_order_qty
                FROM item_warehouse_costs iwc
                JOIN items i ON i.id = iwc.item_id AND i.company_id = iwc.company_id
                JOIN warehouses w ON w.id = iwc.warehouse_id
                LEFT JOIN item_suppliers isup
                       ON isup.item_id = i.id AND isup.company_id = i.company_id AND isup.is_primary = true
                LEFT JOIN suppliers s ON s.id = isup.supplier_id
                WHERE iwc.company_id = %s
                  AND iwc.on_hand_qty <= i.reorder_point
                  AND i.is_active = true
                ORDER BY (i.reorder_point - iwc.on_hand_qty) DESC
                LIMIT %s
                """,
                (company_id, limit),
            )
            rows = cur.fetchall()

            if not rows:
                return ToolResult(
                    data={"items": [], "count": 0},
                    message="All items are above their reorder points. No restocking needed.",
                )

            # Group by supplier for PO suggestions
            by_supplier: dict[str, list[dict]] = {}
            lines = []
            for r in rows:
                sup = r["supplier_name"] or "No supplier"
                qty_needed = max(float(r["reorder_qty"] or 0), float(r["reorder_point"] or 0) - float(r["on_hand_qty"] or 0))
                if r.get("min_order_qty") and qty_needed < float(r["min_order_qty"]):
                    qty_needed = float(r["min_order_qty"])
                cost = float(r["last_cost_usd"] or r["avg_cost_usd"] or 0)
                item_info = {
                    "item": r["name"],
                    "sku": r["sku"],
                    "on_hand": str(r["on_hand_qty"]),
                    "reorder_point": str(r["reorder_point"]),
                    "suggested_qty": str(qty_needed),
                    "unit_cost": str(cost),
                    "estimated_total": str(round(qty_needed * cost, 2)),
                    "warehouse": r["warehouse_name"],
                    "supplier": sup,
                    "lead_time_days": r["lead_time_days"],
                }
                lines.append(item_info)
                by_supplier.setdefault(sup, []).append(item_info)

            # Build summary
            parts = [f"**{len(rows)} item(s) need restocking:**\n"]
            for supplier, items in by_supplier.items():
                total = sum(float(i["estimated_total"]) for i in items)
                parts.append(f"**{supplier}** ({len(items)} items, ~${total:,.2f} USD)")
                for it in items[:10]:
                    parts.append(
                        f"  • {it['item']} ({it['sku']}): "
                        f"{it['on_hand']} on hand → order {it['suggested_qty']} "
                        f"@ ${it['unit_cost']}/ea"
                    )

            parts.append("\n💡 *Say \"create a PO for [supplier]\" to generate purchase orders.*")

            return ToolResult(
                data={"items": lines, "count": len(rows), "by_supplier": {k: len(v) for k, v in by_supplier.items()}},
                message="\n".join(parts),
            )


# ---------------------------------------------------------------------------
# 3. Month Close Prep
# ---------------------------------------------------------------------------

@register_tool(category="compound")
def month_close_prep(
    company_id: str,
    user: dict,
) -> ToolResult:
    """Check readiness for month-end close: unposted invoices, open AP, unreconciled items, active period locks."""
    today = date.today()
    # Determine the period we're checking (previous month if < 10th, otherwise current)
    if today.day < 10:
        check_month = (today.replace(day=1) - timedelta(days=1)).month
        check_year = (today.replace(day=1) - timedelta(days=1)).year
    else:
        check_month = today.month
        check_year = today.year

    period_label = f"{check_year}-{check_month:02d}"
    month_start = date(check_year, check_month, 1)
    if check_month == 12:
        month_end = date(check_year + 1, 1, 1)
    else:
        month_end = date(check_year, check_month + 1, 1)

    checklist: list[dict[str, Any]] = []
    data: dict[str, Any] = {"period": period_label}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # 1. Unposted sales invoices
            cur.execute(
                """
                SELECT COUNT(*)::int AS c FROM sales_invoices
                WHERE company_id = %s AND status = 'draft'
                  AND created_at >= %s AND created_at < %s
                """,
                (company_id, month_start, month_end),
            )
            draft_sales = int(cur.fetchone()["c"])
            checklist.append({
                "check": "Draft sales invoices",
                "status": "clear" if draft_sales == 0 else "action_needed",
                "count": draft_sales,
                "detail": f"{draft_sales} unposted" if draft_sales else "All posted ✅",
            })

            # 2. Unposted supplier invoices
            cur.execute(
                """
                SELECT COUNT(*)::int AS c FROM supplier_invoices
                WHERE company_id = %s AND status = 'draft'
                  AND created_at >= %s AND created_at < %s
                """,
                (company_id, month_start, month_end),
            )
            draft_purchases = int(cur.fetchone()["c"])
            checklist.append({
                "check": "Draft supplier invoices",
                "status": "clear" if draft_purchases == 0 else "action_needed",
                "count": draft_purchases,
                "detail": f"{draft_purchases} unposted" if draft_purchases else "All posted ✅",
            })

            # 3. Goods receipts without invoices
            cur.execute(
                """
                SELECT COUNT(*)::int AS c FROM goods_receipts gr
                WHERE gr.company_id = %s AND gr.status = 'posted'
                  AND gr.created_at >= %s AND gr.created_at < %s
                  AND NOT EXISTS (
                    SELECT 1 FROM supplier_invoices si
                    WHERE si.company_id = gr.company_id
                      AND si.id = gr.supplier_invoice_id
                      AND si.status = 'posted'
                  )
                """,
                (company_id, month_start, month_end),
            )
            unmatched_gr = int(cur.fetchone()["c"])
            checklist.append({
                "check": "Unmatched goods receipts",
                "status": "clear" if unmatched_gr == 0 else "warning",
                "count": unmatched_gr,
                "detail": f"{unmatched_gr} GRs without posted invoices" if unmatched_gr else "All matched ✅",
            })

            # 4. Negative stock
            cur.execute(
                "SELECT COUNT(*)::int AS c FROM item_warehouse_costs WHERE company_id=%s AND on_hand_qty < 0",
                (company_id,),
            )
            neg_stock = int(cur.fetchone()["c"])
            checklist.append({
                "check": "Negative stock positions",
                "status": "clear" if neg_stock == 0 else "action_needed",
                "count": neg_stock,
                "detail": f"{neg_stock} positions" if neg_stock else "None ✅",
            })

            # 5. Period lock status
            cur.execute(
                """
                SELECT COUNT(*)::int AS c FROM accounting_period_locks
                WHERE company_id = %s AND locked = true
                  AND start_date <= %s AND end_date >= %s
                """,
                (company_id, month_start, month_start),
            )
            is_locked = int(cur.fetchone()["c"]) > 0
            checklist.append({
                "check": f"Period lock for {period_label}",
                "status": "locked" if is_locked else "unlocked",
                "count": 1 if is_locked else 0,
                "detail": "Period is locked" if is_locked else "Period is open — ready to close",
            })

            # 6. POS outbox
            cur.execute(
                "SELECT COUNT(*)::int AS c FROM pos_events_outbox WHERE company_id=%s AND status='failed'",
                (company_id,),
            )
            failed_sync = int(cur.fetchone()["c"])
            checklist.append({
                "check": "Failed POS sync events",
                "status": "clear" if failed_sync == 0 else "action_needed",
                "count": failed_sync,
                "detail": f"{failed_sync} events need attention" if failed_sync else "All synced ✅",
            })

    data["checklist"] = checklist

    # Build summary
    action_needed = [c for c in checklist if c["status"] in ("action_needed", "warning")]
    clear_items = [c for c in checklist if c["status"] == "clear"]

    parts = [f"**Month-End Close Prep: {period_label}**\n"]

    if action_needed:
        parts.append(f"⚠️ **{len(action_needed)} item(s) need attention:**")
        for c in action_needed:
            icon = "🔴" if c["status"] == "action_needed" else "🟡"
            parts.append(f"  {icon} {c['check']}: {c['detail']}")
    else:
        parts.append("✅ **All checks passed** — ready to close the period!")

    if clear_items:
        parts.append(f"\n✅ {len(clear_items)} check(s) passed: " + ", ".join(c["check"] for c in clear_items))

    lock_item = next((c for c in checklist if "Period lock" in c["check"]), None)
    if lock_item:
        parts.append(f"\n📌 {lock_item['detail']}")

    return ToolResult(data=data, message="\n".join(parts))
