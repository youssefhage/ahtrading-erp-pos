"""
Write (mutating) tools for the Kai AI agent.

All tools in this module modify data and require user confirmation before
execution.  The LLM is instructed to summarize the pending action and wait
for the user's explicit "yes" before calling these functions.

Each tool follows the pattern:
1. Validate inputs / look up referenced entities.
2. Perform the mutation inside a single transaction.
3. Write an audit log entry.
4. Return a ToolResult with a success message and any relevant IDs.
"""
from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Any, Optional

from ...db import get_conn, set_company_context
from .registry import ToolResult, register_tool

logger = logging.getLogger(__name__)


def _default_exchange_rate(cur, company_id: str) -> Decimal:
    """Fetch the latest exchange rate, with a safe fallback."""
    cur.execute(
        """
        SELECT usd_to_lbp
        FROM exchange_rates
        WHERE company_id = %s
        ORDER BY rate_date DESC, created_at DESC
        LIMIT 1
        """,
        (company_id,),
    )
    r = cur.fetchone()
    if r and r.get("usd_to_lbp"):
        ex = Decimal(str(r["usd_to_lbp"]))
        if ex > 0:
            return ex
    return Decimal("90000")


def _next_doc_no(cur, company_id: str, doc_type: str) -> str:
    cur.execute("SELECT next_document_no(%s, %s) AS doc_no", (company_id, doc_type))
    return cur.fetchone()["doc_no"]


def _q_usd(v: Any) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.0001"))


def _q_lbp(v: Any) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.01"))


# ---------------------------------------------------------------------------
# 1. Create Purchase Order
# ---------------------------------------------------------------------------

@register_tool(
    category="write",
    requires_confirmation=True,
    permission="purchases:write",
    confirm_verb="Create",
    confirm_entity="Purchase Order",
    parameter_overrides={
        "supplier_name": {"description": "The supplier name (will be looked up by name)."},
        "warehouse_name": {"description": "Target warehouse name (default: first warehouse)."},
        "items": {
            "description": (
                "Array of items to order. Each item: "
                '{"item_name_or_sku": "...", "qty": 10, "unit_cost_usd": 12.50}.  '
                "If unit_cost_usd is omitted, uses the item's last cost."
            ),
        },
        "notes": {"description": "Optional notes or reference for the PO."},
    },
)
def create_purchase_order(
    company_id: str,
    user: dict,
    supplier_name: str,
    items: list[dict],
    warehouse_name: str = "",
    notes: str = "",
) -> ToolResult:
    """Create a purchase order for a supplier with the specified items and quantities."""
    if not items:
        return ToolResult(error="No items provided for the purchase order.")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Resolve supplier
                cur.execute(
                    "SELECT id, name FROM suppliers WHERE company_id = %s AND name ILIKE %s AND is_active = true LIMIT 1",
                    (company_id, f"%{supplier_name.strip()}%"),
                )
                sup = cur.fetchone()
                if not sup:
                    return ToolResult(error=f"Supplier '{supplier_name}' not found or inactive.")

                # Resolve warehouse
                if warehouse_name.strip():
                    cur.execute(
                        "SELECT id, name FROM warehouses WHERE company_id = %s AND name ILIKE %s LIMIT 1",
                        (company_id, f"%{warehouse_name.strip()}%"),
                    )
                else:
                    cur.execute(
                        "SELECT id, name FROM warehouses WHERE company_id = %s ORDER BY created_at LIMIT 1",
                        (company_id,),
                    )
                wh = cur.fetchone()
                if not wh:
                    return ToolResult(error="No warehouse found.")

                exchange_rate = _default_exchange_rate(cur, company_id)
                order_no = _next_doc_no(cur, company_id, "PO")

                # Resolve items and build lines
                lines = []
                for item_spec in items:
                    name_or_sku = str(item_spec.get("item_name_or_sku") or item_spec.get("item") or item_spec.get("name") or "").strip()
                    if not name_or_sku:
                        continue
                    qty = Decimal(str(item_spec.get("qty", 1)))
                    if qty <= 0:
                        continue

                    cur.execute(
                        """
                        SELECT id, name, sku FROM items
                        WHERE company_id = %s AND is_active = true
                          AND (name ILIKE %s OR sku ILIKE %s OR barcode = %s)
                        LIMIT 1
                        """,
                        (company_id, f"%{name_or_sku}%", f"%{name_or_sku}%", name_or_sku),
                    )
                    item_row = cur.fetchone()
                    if not item_row:
                        return ToolResult(error=f"Item '{name_or_sku}' not found.")

                    # Cost: use provided, or fall back to last PO cost / avg cost
                    cost_usd = item_spec.get("unit_cost_usd")
                    if cost_usd is not None:
                        cost_usd = _q_usd(cost_usd)
                    else:
                        # Try item_suppliers.last_cost_usd
                        cur.execute(
                            """
                            SELECT last_cost_usd FROM item_suppliers
                            WHERE company_id=%s AND item_id=%s AND supplier_id=%s
                            LIMIT 1
                            """,
                            (company_id, item_row["id"], sup["id"]),
                        )
                        isr = cur.fetchone()
                        if isr and isr.get("last_cost_usd"):
                            cost_usd = _q_usd(isr["last_cost_usd"])
                        else:
                            # Fall back to avg cost
                            cur.execute(
                                "SELECT avg_cost_usd FROM item_warehouse_costs WHERE company_id=%s AND item_id=%s LIMIT 1",
                                (company_id, item_row["id"]),
                            )
                            avc = cur.fetchone()
                            cost_usd = _q_usd(avc["avg_cost_usd"]) if avc and avc.get("avg_cost_usd") else _q_usd(0)

                    cost_lbp = _q_lbp(cost_usd * exchange_rate)
                    line_total_usd = _q_usd(qty * cost_usd)
                    line_total_lbp = _q_lbp(qty * cost_lbp)

                    lines.append({
                        "item_id": item_row["id"],
                        "item_name": item_row["name"],
                        "qty": qty,
                        "unit_cost_usd": cost_usd,
                        "unit_cost_lbp": cost_lbp,
                        "line_total_usd": line_total_usd,
                        "line_total_lbp": line_total_lbp,
                    })

                if not lines:
                    return ToolResult(error="No valid items resolved for the purchase order.")

                total_usd = sum(l["line_total_usd"] for l in lines)
                total_lbp = sum(l["line_total_lbp"] for l in lines)

                # Insert PO
                cur.execute(
                    """
                    INSERT INTO purchase_orders
                      (id, company_id, order_no, supplier_id, warehouse_id, status,
                       total_usd, total_lbp, exchange_rate,
                       supplier_ref,
                       requested_by_user_id, requested_at,
                       approved_by_user_id, approved_at)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, 'posted',
                       %s, %s, %s,
                       %s,
                       %s, now(), %s, now())
                    RETURNING id
                    """,
                    (
                        company_id, order_no, sup["id"], wh["id"],
                        total_usd, total_lbp, exchange_rate,
                        notes.strip() or None,
                        user["user_id"], user["user_id"],
                    ),
                )
                po_id = str(cur.fetchone()["id"])

                # Insert lines
                for l in lines:
                    cur.execute(
                        """
                        INSERT INTO purchase_order_lines
                          (id, company_id, purchase_order_id, item_id,
                           qty, unit_cost_usd, unit_cost_lbp,
                           line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s,
                           %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id, po_id, l["item_id"],
                            l["qty"], l["unit_cost_usd"], l["unit_cost_lbp"],
                            l["line_total_usd"], l["line_total_lbp"],
                        ),
                    )

                # Audit log
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'purchase_order_created', 'purchase_order', %s, %s::jsonb)
                    """,
                    (
                        company_id, user["user_id"], po_id,
                        json.dumps({
                            "order_no": order_no,
                            "supplier": sup["name"],
                            "warehouse": wh["name"],
                            "line_count": len(lines),
                            "total_usd": str(total_usd),
                            "source": "kai_copilot",
                        }, default=str),
                    ),
                )

                line_summaries = [f"  • {l['item_name']} — {l['qty']} × ${l['unit_cost_usd']}" for l in lines]
                return ToolResult(
                    data={
                        "po_id": po_id,
                        "order_no": order_no,
                        "supplier": sup["name"],
                        "warehouse": wh["name"],
                        "total_usd": str(total_usd),
                        "line_count": len(lines),
                    },
                    message=(
                        f"Purchase Order **{order_no}** created for {sup['name']}.\n"
                        f"Warehouse: {wh['name']}\n"
                        + "\n".join(line_summaries) + "\n"
                        f"**Total: ${total_usd} USD**"
                    ),
                    actions=[{"type": "navigate", "href": f"/purchasing/purchase-orders", "label": f"View {order_no}"}],
                )


# ---------------------------------------------------------------------------
# 2. Update Item Price
# ---------------------------------------------------------------------------

@register_tool(
    category="write",
    requires_confirmation=True,
    permission="config:write",
    confirm_verb="Update",
    confirm_entity="Item Price",
    parameter_overrides={
        "item_name_or_sku": {"description": "The item to re-price (by name, SKU, or barcode)."},
        "new_price_usd": {"description": "The new selling price in USD."},
        "price_list_name": {"description": "Price list name (default: the company's default price list)."},
    },
)
def update_item_price(
    company_id: str,
    user: dict,
    item_name_or_sku: str,
    new_price_usd: float,
    price_list_name: str = "",
) -> ToolResult:
    """Update the selling price of an item on a price list."""
    if new_price_usd <= 0:
        return ToolResult(error="Price must be positive.")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Resolve item
                cur.execute(
                    """
                    SELECT id, name, sku FROM items
                    WHERE company_id = %s AND is_active = true
                      AND (name ILIKE %s OR sku ILIKE %s OR barcode = %s)
                    LIMIT 1
                    """,
                    (company_id, f"%{item_name_or_sku.strip()}%", f"%{item_name_or_sku.strip()}%", item_name_or_sku.strip()),
                )
                item = cur.fetchone()
                if not item:
                    return ToolResult(error=f"Item '{item_name_or_sku}' not found.")

                # Resolve price list
                if price_list_name.strip():
                    cur.execute(
                        "SELECT id, name FROM price_lists WHERE company_id = %s AND name ILIKE %s LIMIT 1",
                        (company_id, f"%{price_list_name.strip()}%"),
                    )
                else:
                    cur.execute(
                        "SELECT id, name FROM price_lists WHERE company_id = %s AND is_default = true LIMIT 1",
                        (company_id,),
                    )
                pl = cur.fetchone()
                if not pl:
                    # Fall back to any price list
                    cur.execute("SELECT id, name FROM price_lists WHERE company_id = %s LIMIT 1", (company_id,))
                    pl = cur.fetchone()
                if not pl:
                    return ToolResult(error="No price list found.")

                exchange_rate = _default_exchange_rate(cur, company_id)
                price_usd = _q_usd(new_price_usd)
                price_lbp = _q_lbp(price_usd * exchange_rate)

                # End-date any currently active price
                cur.execute(
                    """
                    UPDATE price_list_items
                    SET effective_to = CURRENT_DATE - 1
                    WHERE company_id = %s AND price_list_id = %s AND item_id = %s
                      AND effective_to IS NULL
                    """,
                    (company_id, pl["id"], item["id"]),
                )

                # Insert new price
                cur.execute(
                    """
                    INSERT INTO price_list_items
                      (id, company_id, price_list_id, item_id,
                       price_usd, price_lbp, effective_from)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, CURRENT_DATE)
                    RETURNING id
                    """,
                    (company_id, pl["id"], item["id"], price_usd, price_lbp),
                )
                new_id = str(cur.fetchone()["id"])

                # Audit
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'price_updated', 'price_list_item', %s, %s::jsonb)
                    """,
                    (
                        company_id, user["user_id"], new_id,
                        json.dumps({
                            "item_name": item["name"],
                            "item_sku": item["sku"],
                            "price_list": pl["name"],
                            "new_price_usd": str(price_usd),
                            "source": "kai_copilot",
                        }, default=str),
                    ),
                )

                return ToolResult(
                    data={
                        "price_list_item_id": new_id,
                        "item_name": item["name"],
                        "item_sku": item["sku"],
                        "price_list": pl["name"],
                        "new_price_usd": str(price_usd),
                        "new_price_lbp": str(price_lbp),
                    },
                    message=(
                        f"Price updated for **{item['name']}** ({item['sku']}) "
                        f"on price list '{pl['name']}': **${price_usd} USD** "
                        f"(LBP {price_lbp}), effective today."
                    ),
                )


# ---------------------------------------------------------------------------
# 3. Approve / Reject AI Recommendation
# ---------------------------------------------------------------------------

@register_tool(
    category="write",
    requires_confirmation=True,
    permission="ai:write",
    confirm_verb="Decide",
    confirm_entity="AI Recommendation",
    parameter_overrides={
        "recommendation_id": {"description": "The UUID of the recommendation to decide on."},
        "decision": {"description": "'approve' or 'reject'."},
        "reason": {"description": "Optional reason for the decision."},
    },
)
def decide_recommendation(
    company_id: str,
    user: dict,
    recommendation_id: str,
    decision: str,
    reason: str = "",
) -> ToolResult:
    """Approve or reject an AI recommendation."""
    decision = decision.strip().lower()
    if decision not in ("approve", "reject"):
        return ToolResult(error="Decision must be 'approve' or 'reject'.")

    new_status = "approved" if decision == "approve" else "rejected"

    EXECUTABLE = {"AI_PURCHASE", "AI_DEMAND", "AI_PRICING"}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Fetch recommendation
                cur.execute(
                    """
                    SELECT id, agent_code, status, recommendation_json
                    FROM ai_recommendations
                    WHERE id = %s AND company_id = %s
                    """,
                    (recommendation_id, company_id),
                )
                rec = cur.fetchone()
                if not rec:
                    return ToolResult(error=f"Recommendation {recommendation_id} not found.")
                if rec["status"] != "pending":
                    return ToolResult(error=f"Recommendation is already '{rec['status']}', cannot change.")

                # Update status
                cur.execute(
                    """
                    UPDATE ai_recommendations
                    SET status = %s, decided_at = now(),
                        decided_by_user_id = %s, decision_reason = %s
                    WHERE id = %s AND company_id = %s
                    """,
                    (new_status, user["user_id"], reason.strip() or None, recommendation_id, company_id),
                )

                # For approved executable recommendations, create an action
                if new_status == "approved" and rec["agent_code"] in EXECUTABLE:
                    # Check auto_execute setting
                    cur.execute(
                        "SELECT auto_execute FROM ai_agent_settings WHERE company_id=%s AND agent_code=%s",
                        (company_id, rec["agent_code"]),
                    )
                    setting = cur.fetchone()
                    auto = setting["auto_execute"] if setting else False
                    action_status = "queued" if auto else "approved"

                    rec_json = rec["recommendation_json"] or {}
                    cur.execute(
                        """
                        INSERT INTO ai_actions
                          (id, company_id, recommendation_id, agent_code,
                           payload_json, status,
                           approved_by_user_id, approved_at,
                           queued_by_user_id, queued_at)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s,
                           %s::jsonb, %s,
                           %s, now(),
                           %s, CASE WHEN %s = 'queued' THEN now() ELSE NULL END)
                        ON CONFLICT (company_id, recommendation_id) DO UPDATE
                        SET status = EXCLUDED.status,
                            approved_by_user_id = EXCLUDED.approved_by_user_id,
                            approved_at = EXCLUDED.approved_at,
                            queued_by_user_id = EXCLUDED.queued_by_user_id,
                            queued_at = EXCLUDED.queued_at
                        """,
                        (
                            company_id, recommendation_id, rec["agent_code"],
                            json.dumps(rec_json, default=str), action_status,
                            user["user_id"],
                            user["user_id"] if auto else None,
                            action_status,
                        ),
                    )

                # If rejected, cancel any pending actions
                if new_status == "rejected":
                    cur.execute(
                        """
                        UPDATE ai_actions
                        SET status = 'canceled'
                        WHERE company_id = %s AND recommendation_id = %s
                          AND status IN ('queued', 'approved', 'blocked', 'failed')
                        """,
                        (company_id, recommendation_id),
                    )

                # Audit
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, %s, 'ai_recommendation', %s, %s::jsonb)
                    """,
                    (
                        company_id, user["user_id"],
                        f"ai_{decision}",
                        recommendation_id,
                        json.dumps({"agent_code": rec["agent_code"], "reason": reason, "source": "kai_copilot"}, default=str),
                    ),
                )

                verb = "Approved" if decision == "approve" else "Rejected"
                return ToolResult(
                    data={
                        "recommendation_id": recommendation_id,
                        "agent_code": rec["agent_code"],
                        "new_status": new_status,
                    },
                    message=f"{verb} recommendation from {rec['agent_code']}.{' Queued for auto-execution.' if new_status == 'approved' and rec['agent_code'] in EXECUTABLE else ''}",
                )


# ---------------------------------------------------------------------------
# 4. Batch Approve/Reject Recommendations
# ---------------------------------------------------------------------------

@register_tool(
    category="write",
    requires_confirmation=True,
    permission="ai:write",
    confirm_verb="Batch Decide",
    confirm_entity="AI Recommendations",
    parameter_overrides={
        "agent_code": {"description": "Approve/reject all pending recommendations from this agent (e.g. AI_PURCHASE, AI_PRICING)."},
        "decision": {"description": "'approve' or 'reject'."},
        "reason": {"description": "Optional reason."},
    },
)
def batch_decide_recommendations(
    company_id: str,
    user: dict,
    agent_code: str,
    decision: str,
    reason: str = "",
) -> ToolResult:
    """Approve or reject all pending recommendations from a specific AI agent."""
    decision = decision.strip().lower()
    if decision not in ("approve", "reject"):
        return ToolResult(error="Decision must be 'approve' or 'reject'.")
    agent_code = agent_code.strip().upper()
    new_status = "approved" if decision == "approve" else "rejected"

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id FROM ai_recommendations
                    WHERE company_id = %s AND agent_code = %s AND status = 'pending'
                    """,
                    (company_id, agent_code),
                )
                rec_ids = [r["id"] for r in cur.fetchall()]
                if not rec_ids:
                    return ToolResult(
                        data={"count": 0},
                        message=f"No pending recommendations from {agent_code}.",
                    )

                cur.execute(
                    """
                    UPDATE ai_recommendations
                    SET status = %s, decided_at = now(),
                        decided_by_user_id = %s, decision_reason = %s
                    WHERE company_id = %s AND agent_code = %s AND status = 'pending'
                    """,
                    (new_status, user["user_id"], reason.strip() or None, company_id, agent_code),
                )

                # Audit
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, %s, 'ai_recommendation', NULL, %s::jsonb)
                    """,
                    (
                        company_id, user["user_id"],
                        f"ai_batch_{decision}",
                        json.dumps({
                            "agent_code": agent_code,
                            "count": len(rec_ids),
                            "reason": reason,
                            "source": "kai_copilot",
                        }, default=str),
                    ),
                )

                verb = "Approved" if decision == "approve" else "Rejected"
                return ToolResult(
                    data={"count": len(rec_ids), "agent_code": agent_code, "new_status": new_status},
                    message=f"{verb} {len(rec_ids)} pending recommendation(s) from {agent_code}.",
                )


# ---------------------------------------------------------------------------
# 5. Create Stock Adjustment
# ---------------------------------------------------------------------------

@register_tool(
    category="write",
    requires_confirmation=True,
    permission="config:write",
    confirm_verb="Create",
    confirm_entity="Stock Adjustment",
    parameter_overrides={
        "item_name_or_sku": {"description": "The item to adjust (by name, SKU, or barcode)."},
        "warehouse_name": {"description": "Warehouse name (default: first warehouse)."},
        "qty_change": {"description": "Quantity change: positive to add stock, negative to remove."},
        "reason": {"description": "Reason for the adjustment (required)."},
    },
)
def create_stock_adjustment(
    company_id: str,
    user: dict,
    item_name_or_sku: str,
    qty_change: float,
    reason: str,
    warehouse_name: str = "",
) -> ToolResult:
    """Create a stock adjustment (add or remove inventory) for an item."""
    if qty_change == 0:
        return ToolResult(error="Quantity change cannot be zero.")
    if not reason.strip():
        return ToolResult(error="A reason is required for stock adjustments.")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Resolve item
                cur.execute(
                    """
                    SELECT id, name, sku, unit_of_measure FROM items
                    WHERE company_id = %s AND is_active = true
                      AND (name ILIKE %s OR sku ILIKE %s OR barcode = %s)
                    LIMIT 1
                    """,
                    (company_id, f"%{item_name_or_sku.strip()}%", f"%{item_name_or_sku.strip()}%", item_name_or_sku.strip()),
                )
                item = cur.fetchone()
                if not item:
                    return ToolResult(error=f"Item '{item_name_or_sku}' not found.")

                # Resolve warehouse
                if warehouse_name.strip():
                    cur.execute(
                        "SELECT id, name FROM warehouses WHERE company_id = %s AND name ILIKE %s LIMIT 1",
                        (company_id, f"%{warehouse_name.strip()}%"),
                    )
                else:
                    cur.execute(
                        "SELECT id, name FROM warehouses WHERE company_id = %s ORDER BY created_at LIMIT 1",
                        (company_id,),
                    )
                wh = cur.fetchone()
                if not wh:
                    return ToolResult(error="No warehouse found.")

                qty = Decimal(str(qty_change))
                qty_in = abs(qty) if qty > 0 else Decimal("0")
                qty_out = abs(qty) if qty < 0 else Decimal("0")

                # Get current cost for the adjustment
                cur.execute(
                    "SELECT avg_cost_usd FROM item_warehouse_costs WHERE company_id=%s AND item_id=%s AND warehouse_id=%s",
                    (company_id, item["id"], wh["id"]),
                )
                cost_row = cur.fetchone()
                unit_cost = Decimal(str(cost_row["avg_cost_usd"])) if cost_row and cost_row.get("avg_cost_usd") else Decimal("0")

                exchange_rate = _default_exchange_rate(cur, company_id)

                # Insert stock move — the trigger handles updating item_warehouse_costs
                cur.execute(
                    """
                    INSERT INTO stock_moves
                      (id, company_id, item_id, warehouse_id,
                       qty_in, qty_out,
                       unit_cost_usd, unit_cost_lbp,
                       source_type, reason,
                       created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s,
                       %s, %s,
                       %s, %s,
                       'kai_adjustment', %s,
                       %s)
                    RETURNING id
                    """,
                    (
                        company_id, item["id"], wh["id"],
                        qty_in, qty_out,
                        unit_cost, _q_lbp(unit_cost * exchange_rate),
                        reason.strip(),
                        user["user_id"],
                    ),
                )
                move_id = str(cur.fetchone()["id"])

                # Audit
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_adjustment_created', 'stock_move', %s, %s::jsonb)
                    """,
                    (
                        company_id, user["user_id"], move_id,
                        json.dumps({
                            "item_name": item["name"],
                            "warehouse": wh["name"],
                            "qty_change": str(qty),
                            "reason": reason,
                            "source": "kai_copilot",
                        }, default=str),
                    ),
                )

                direction = "added" if qty > 0 else "removed"
                return ToolResult(
                    data={
                        "move_id": move_id,
                        "item_name": item["name"],
                        "warehouse": wh["name"],
                        "qty_change": str(qty),
                    },
                    message=(
                        f"Stock adjustment: {direction} {abs(qty)} {item['unit_of_measure']} "
                        f"of **{item['name']}** ({item['sku']}) at {wh['name']}. "
                        f"Reason: {reason}"
                    ),
                )


# ---------------------------------------------------------------------------
# 6. Create Customer
# ---------------------------------------------------------------------------

@register_tool(
    category="write",
    requires_confirmation=True,
    permission="config:write",
    confirm_verb="Create",
    confirm_entity="Customer",
    parameter_overrides={
        "name": {"description": "Customer name (required)."},
        "phone": {"description": "Phone number (optional)."},
        "email": {"description": "Email address (optional)."},
        "party_type": {"description": "'individual' or 'business' (default: individual)."},
        "vat_no": {"description": "VAT registration number (optional)."},
    },
)
def create_customer(
    company_id: str,
    user: dict,
    name: str,
    phone: str = "",
    email: str = "",
    party_type: str = "individual",
    vat_no: str = "",
) -> ToolResult:
    """Create a new customer record."""
    name = name.strip()
    if not name:
        return ToolResult(error="Customer name is required.")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Check for duplicate
                cur.execute(
                    "SELECT id, name FROM customers WHERE company_id = %s AND name ILIKE %s LIMIT 1",
                    (company_id, name),
                )
                existing = cur.fetchone()
                if existing:
                    return ToolResult(
                        error=f"A customer named '{existing['name']}' already exists (ID: {existing['id']}).",
                    )

                cur.execute(
                    """
                    INSERT INTO customers
                      (id, company_id, name, phone, email, party_type, vat_no)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id, name,
                        phone.strip() or None,
                        email.strip().lower() or None,
                        party_type.strip().lower() if party_type.strip().lower() in ("individual", "business") else "individual",
                        vat_no.strip() or None,
                    ),
                )
                cust_id = str(cur.fetchone()["id"])

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'customer_created', 'customer', %s, %s::jsonb)
                    """,
                    (
                        company_id, user["user_id"], cust_id,
                        json.dumps({"name": name, "source": "kai_copilot"}, default=str),
                    ),
                )

                return ToolResult(
                    data={"customer_id": cust_id, "name": name},
                    message=f"Customer **{name}** created successfully.",
                    actions=[{"type": "navigate", "href": "/partners/customers", "label": f"View {name}"}],
                )


# ---------------------------------------------------------------------------
# 7. Set Exchange Rate
# ---------------------------------------------------------------------------

@register_tool(
    category="write",
    requires_confirmation=True,
    permission="config:write",
    confirm_verb="Set",
    confirm_entity="Exchange Rate",
    parameter_overrides={
        "usd_to_lbp": {"description": "The USD→LBP rate (e.g. 89500)."},
        "rate_type": {"description": "Rate type: 'market' (default), 'official', or 'internal'."},
        "rate_date": {"description": "Date for the rate (YYYY-MM-DD, default: today)."},
    },
)
def set_exchange_rate(
    company_id: str,
    user: dict,
    usd_to_lbp: float,
    rate_type: str = "market",
    rate_date: str = "",
) -> ToolResult:
    """Set the USD→LBP exchange rate for a given date."""
    if usd_to_lbp <= 0:
        return ToolResult(error="Exchange rate must be positive.")

    from datetime import date as date_type
    try:
        rd = date_type.fromisoformat(rate_date.strip()) if rate_date.strip() else date_type.today()
    except ValueError:
        rd = date_type.today()

    rt = rate_type.strip().lower()
    if rt not in ("market", "official", "internal"):
        rt = "market"

    rate = _q_usd(usd_to_lbp)  # Use 4-decimal precision

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO exchange_rates (company_id, rate_date, rate_type, usd_to_lbp)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (company_id, rate_date, rate_type)
                    DO UPDATE SET usd_to_lbp = EXCLUDED.usd_to_lbp
                    """,
                    (company_id, rd, rt, rate),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'fx.rate.upsert', 'exchange_rate', NULL, %s::jsonb)
                    """,
                    (
                        company_id, user["user_id"],
                        json.dumps({
                            "rate_date": rd.isoformat(),
                            "rate_type": rt,
                            "usd_to_lbp": str(rate),
                            "source": "kai_copilot",
                        }, default=str),
                    ),
                )

                return ToolResult(
                    data={"rate_date": rd.isoformat(), "rate_type": rt, "usd_to_lbp": str(rate)},
                    message=f"Exchange rate set: **1 USD = {rate} LBP** ({rt}, {rd.isoformat()}).",
                )


# ---------------------------------------------------------------------------
# 8. Retry Failed POS Outbox Events
# ---------------------------------------------------------------------------

@register_tool(
    category="write",
    requires_confirmation=True,
    permission="config:write",
    confirm_verb="Retry",
    confirm_entity="POS Sync Events",
    parameter_overrides={
        "device_code": {"description": "Optional: retry only events from this device."},
    },
)
def retry_failed_outbox(
    company_id: str,
    user: dict,
    device_code: str = "",
) -> ToolResult:
    """Retry all failed POS sync events (re-queue them for processing)."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if device_code.strip():
                    cur.execute(
                        """
                        UPDATE pos_events_outbox o
                        SET status = 'pending', error_message = NULL
                        FROM pos_devices d
                        WHERE o.device_id = d.id
                          AND d.company_id = %s
                          AND d.device_code = %s
                          AND o.status = 'failed'
                        """,
                        (company_id, device_code.strip()),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE pos_events_outbox o
                        SET status = 'pending', error_message = NULL
                        FROM pos_devices d
                        WHERE o.device_id = d.id
                          AND d.company_id = %s
                          AND o.status = 'failed'
                        """,
                        (company_id,),
                    )
                count = cur.rowcount

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'outbox_retry', 'pos_events_outbox', NULL, %s::jsonb)
                    """,
                    (
                        company_id, user["user_id"],
                        json.dumps({"count": count, "device_code": device_code or "all", "source": "kai_copilot"}, default=str),
                    ),
                )

                if count == 0:
                    return ToolResult(data={"count": 0}, message="No failed POS sync events to retry.")

                return ToolResult(
                    data={"count": count},
                    message=f"Re-queued **{count}** failed POS sync event(s) for processing.",
                )
