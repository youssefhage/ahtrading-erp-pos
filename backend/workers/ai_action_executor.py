#!/usr/bin/env python3
import argparse
import json
from decimal import Decimal
import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = 'postgresql://localhost/ahtrading'
MAX_ATTEMPTS_DEFAULT = 5


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def latest_rate(cur, company_id: str):
    set_company_context(cur, company_id)
    cur.execute(
        """
        SELECT usd_to_lbp
        FROM exchange_rates
        WHERE company_id = %s
        ORDER BY rate_date DESC
        LIMIT 1
        """,
        (company_id,),
    )
    row = cur.fetchone()
    return Decimal(str(row["usd_to_lbp"])) if row else Decimal("0")

def get_agent_settings(cur, company_id: str, agent_code: str):
    set_company_context(cur, company_id)
    cur.execute(
        """
        SELECT auto_execute, max_amount_usd, max_actions_per_day
        FROM ai_agent_settings
        WHERE company_id = %s AND agent_code = %s
        """,
        (company_id, agent_code),
    )
    return cur.fetchone() or {"auto_execute": False, "max_amount_usd": 0, "max_actions_per_day": 0}


def executed_today(cur, company_id: str, agent_code: str) -> int:
    set_company_context(cur, company_id)
    cur.execute(
        """
        SELECT COUNT(*) AS count
        FROM ai_actions
        WHERE company_id = %s AND agent_code = %s
          AND status = 'executed'
          AND executed_at::date = CURRENT_DATE
        """,
        (company_id, agent_code),
    )
    return int(cur.fetchone()["count"])


def block_action(cur, action_id: str, reason: str):
    cur.execute(
        """
        UPDATE ai_actions
        SET status = 'blocked',
            error_message = %s,
            updated_at = now()
        WHERE id = %s
        """,
        (reason, action_id),
    )


def amount_usd_for_action(agent_code: str, payload: dict) -> Decimal:
    if agent_code == "AI_PURCHASE":
        return Decimal(str(payload.get("amount_usd", 0) or 0))
    if agent_code == "AI_DEMAND":
        return Decimal(str(payload.get("amount_usd", 0) or 0))
    # Pricing impact depends on quantity/sales; not modeled yet.
    return Decimal("0")


def execute_purchase_action(cur, company_id: str, action_id: str, payload: dict):
    supplier_id = payload.get("supplier_id")
    item_id = payload.get("item_id")
    warehouse_id = payload.get("warehouse_id") or None
    qty = Decimal(str(payload.get("reorder_qty", 0)))
    amount_usd = Decimal(str(payload.get("amount_usd", 0)))

    if not supplier_id or not item_id or qty <= 0:
        raise ValueError("Invalid purchase action payload")

    # Idempotency: re-running the executor should not create duplicate POs.
    set_company_context(cur, company_id)
    cur.execute(
        """
        SELECT id
        FROM purchase_orders
        WHERE company_id=%s AND source_type='ai_action' AND source_id=%s
        LIMIT 1
        """,
        (company_id, action_id),
    )
    existing = cur.fetchone()
    if existing:
        return existing["id"]

    rate = latest_rate(cur, company_id)
    unit_cost_usd = amount_usd / qty if qty else Decimal("0")
    unit_cost_lbp = unit_cost_usd * rate

    total_usd = unit_cost_usd * qty
    total_lbp = unit_cost_lbp * qty

    cur.execute(
        """
        INSERT INTO purchase_orders
          (id, company_id, supplier_id, warehouse_id, status, total_usd, total_lbp, exchange_rate, source_type, source_id)
        VALUES
          (gen_random_uuid(), %s, %s, %s, 'posted', %s, %s, %s, 'ai_action', %s)
        RETURNING id
        """,
        (company_id, supplier_id, warehouse_id, total_usd, total_lbp, rate, action_id),
    )
    po_id = cur.fetchone()["id"]

    cur.execute(
        "SELECT unit_of_measure FROM items WHERE company_id=%s AND id=%s",
        (company_id, item_id),
    )
    urow = cur.fetchone() or {}
    base_uom = (urow.get("unit_of_measure") or None)

    cur.execute(
        """
        INSERT INTO purchase_order_lines
          (id, company_id, purchase_order_id, item_id,
           qty, uom, qty_factor, qty_entered,
           unit_cost_usd, unit_cost_lbp, unit_cost_entered_usd, unit_cost_entered_lbp,
           line_total_usd, line_total_lbp)
        VALUES
          (gen_random_uuid(), %s, %s, %s,
           %s, %s, 1, %s,
           %s, %s, %s, %s,
           %s, %s)
        """,
        (company_id, po_id, item_id, qty, base_uom, qty, unit_cost_usd, unit_cost_lbp, unit_cost_usd, unit_cost_lbp, total_usd, total_lbp),
    )

    cur.execute(
        """
        INSERT INTO audit_logs (id, company_id, action, entity_type, entity_id, details)
        VALUES (gen_random_uuid(), %s, 'ai_execute', 'purchase_order', %s, %s::jsonb)
        """,
        (company_id, po_id, json.dumps(payload)),
    )

    return po_id


def execute_pricing_action(cur, company_id: str, action_id: str, payload: dict):
    item_id = payload.get("item_id")
    suggested_price_usd = payload.get("suggested_price_usd")
    if not item_id or suggested_price_usd is None:
        raise ValueError("Invalid pricing action payload")

    # Idempotency: same action should not create duplicate price rows.
    cur.execute(
        """
        SELECT id
        FROM item_prices
        WHERE source_type='ai_action' AND source_id=%s
        LIMIT 1
        """,
        (action_id,),
    )
    existing = cur.fetchone()
    if existing:
        return existing["id"]

    price_usd = Decimal(str(suggested_price_usd))
    if price_usd <= 0:
        raise ValueError("suggested_price_usd must be > 0")

    # Mirror into LBP using the latest rate (pricing in USD is the primary contract).
    rate = latest_rate(cur, company_id)
    price_lbp = (price_usd * rate) if rate else Decimal("0")

    cur.execute(
        """
        INSERT INTO item_prices (id, item_id, price_usd, price_lbp, effective_from, effective_to, source_type, source_id)
        VALUES (gen_random_uuid(), %s, %s, %s, CURRENT_DATE, NULL, 'ai_action', %s)
        RETURNING id
        """,
        (item_id, price_usd, price_lbp, action_id),
    )
    price_id = cur.fetchone()["id"]

    cur.execute(
        """
        INSERT INTO audit_logs (id, company_id, action, entity_type, entity_id, details)
        VALUES (gen_random_uuid(), %s, 'ai_execute', 'item_price', %s, %s::jsonb)
        """,
        (company_id, price_id, json.dumps(payload)),
    )
    return price_id


def run_executor(db_url: str, company_id: str, limit: int, max_attempts: int = MAX_ATTEMPTS_DEFAULT):
    with get_conn(db_url) as conn:
        for _ in range(limit):
            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT id, agent_code, recommendation_id, action_json, attempt_count, queued_by_user_id
                        FROM ai_actions
                        WHERE company_id = %s AND status = 'queued'
                        ORDER BY created_at ASC
                        FOR UPDATE SKIP LOCKED
                        LIMIT 1
                        """,
                        (company_id,),
                    )
                    a = cur.fetchone()
                    if not a:
                        break

                    try:
                        payload = a["action_json"]
                        if isinstance(payload, str):
                            payload = json.loads(payload)

                        settings = get_agent_settings(cur, company_id, a["agent_code"])
                        auto_execute = bool(settings.get("auto_execute"))
                        max_amount = Decimal(str(settings.get("max_amount_usd") or 0))
                        max_actions = int(settings.get("max_actions_per_day") or 0)

                        # Gating: if auto_execute is disabled, require explicit manual queueing.
                        if not auto_execute and not a.get("queued_by_user_id"):
                            block_action(cur, a["id"], "Awaiting manual queue (auto_execute disabled).")
                            continue

                        if max_actions > 0 and executed_today(cur, company_id, a["agent_code"]) >= max_actions:
                            block_action(cur, a["id"], f"Daily action cap reached ({max_actions}/day).")
                            continue

                        amt = amount_usd_for_action(a["agent_code"], payload)
                        if max_amount > 0 and amt > max_amount:
                            block_action(cur, a["id"], f"Amount exceeds cap (${str(max_amount)}).")
                            continue

                        if a["agent_code"] == "AI_PURCHASE":
                            created_id = execute_purchase_action(cur, company_id, a["id"], payload)
                            created_type = "purchase_order"
                        elif a["agent_code"] == "AI_DEMAND":
                            created_id = execute_purchase_action(cur, company_id, a["id"], payload)
                            created_type = "purchase_order"
                        elif a["agent_code"] == "AI_PRICING":
                            created_id = execute_pricing_action(cur, company_id, a["id"], payload)
                            created_type = "item_price"
                        else:
                            raise ValueError(f"Unsupported agent_code {a['agent_code']}")

                        cur.execute(
                            """
                            UPDATE ai_actions
                            SET status = 'executed',
                                executed_at = now(),
                                executed_by_user_id = queued_by_user_id,
                                error_message = NULL,
                                result_entity_type = %s,
                                result_entity_id = %s,
                                result_json = %s::jsonb,
                                updated_at = now()
                            WHERE id = %s
                            """,
                            (
                                created_type,
                                created_id,
                                json.dumps({"created_entity_type": created_type, "created_entity_id": str(created_id)}, default=str),
                                a["id"],
                            ),
                        )

                        if a.get("recommendation_id"):
                            cur.execute(
                                """
                                UPDATE ai_recommendations
                                SET status = 'executed',
                                    decided_at = COALESCE(decided_at, now())
                                WHERE company_id = %s AND id = %s
                                """,
                                (company_id, a["recommendation_id"]),
                            )
                    except Exception as ex:
                        next_attempt = int(a.get("attempt_count") or 0) + 1
                        # Retry transient errors up to max_attempts; then leave as failed for manual intervention.
                        next_status = "queued" if next_attempt < max_attempts else "failed"
                        cur.execute(
                            """
                            UPDATE ai_actions
                            SET status = %s,
                                attempt_count = %s,
                                error_message = %s,
                                updated_at = now()
                            WHERE id = %s
                            """,
                            (next_status, next_attempt, str(ex), a["id"]),
                        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--max-attempts", type=int, default=MAX_ATTEMPTS_DEFAULT)
    args = parser.parse_args()
    run_executor(args.db, args.company_id, args.limit, max_attempts=args.max_attempts)


if __name__ == "__main__":
    main()
