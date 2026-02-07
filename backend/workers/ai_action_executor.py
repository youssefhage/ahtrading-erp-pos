#!/usr/bin/env python3
import argparse
import json
from datetime import datetime
from decimal import Decimal
import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = 'postgresql://localhost/ahtrading'


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s, true)", (company_id,))


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


def execute_purchase_action(cur, company_id: str, action_id: str, payload: dict):
    supplier_id = payload.get("supplier_id")
    item_id = payload.get("item_id")
    qty = Decimal(str(payload.get("reorder_qty", 0)))
    amount_usd = Decimal(str(payload.get("amount_usd", 0)))

    if not supplier_id or not item_id or qty <= 0:
        raise ValueError("Invalid purchase action payload")

    rate = latest_rate(cur, company_id)
    unit_cost_usd = amount_usd / qty if qty else Decimal("0")
    unit_cost_lbp = unit_cost_usd * rate

    total_usd = unit_cost_usd * qty
    total_lbp = unit_cost_lbp * qty

    cur.execute(
        """
        INSERT INTO purchase_orders
          (id, company_id, supplier_id, status, total_usd, total_lbp, exchange_rate)
        VALUES
          (gen_random_uuid(), %s, %s, 'posted', %s, %s, %s)
        RETURNING id
        """,
        (company_id, supplier_id, total_usd, total_lbp, rate),
    )
    po_id = cur.fetchone()["id"]

    cur.execute(
        """
        INSERT INTO purchase_order_lines
          (id, company_id, purchase_order_id, item_id, qty, unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
        VALUES
          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (company_id, po_id, item_id, qty, unit_cost_usd, unit_cost_lbp, total_usd, total_lbp),
    )

    cur.execute(
        """
        INSERT INTO audit_logs (id, company_id, action, entity_type, entity_id, details)
        VALUES (gen_random_uuid(), %s, 'ai_execute', 'purchase_order', %s, %s::jsonb)
        """,
        (company_id, po_id, json.dumps(payload)),
    )

    return po_id


def run_executor(db_url: str, company_id: str, limit: int):
    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT id, agent_code, action_json
                FROM ai_actions
                WHERE company_id = %s AND status = 'queued'
                ORDER BY created_at ASC
                LIMIT %s
                """,
                (company_id, limit),
            )
            actions = cur.fetchall()

        for a in actions:
            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    payload = a["action_json"]
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    if a["agent_code"] == "AI_PURCHASE":
                        execute_purchase_action(cur, company_id, a["id"], payload)
                    else:
                        raise ValueError(f"Unsupported agent_code {a['agent_code']}")

                    cur.execute(
                        """
                        UPDATE ai_actions
                        SET status = 'executed', executed_at = now()
                        WHERE id = %s
                        """,
                        (a["id"],),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    run_executor(args.db, args.company_id, args.limit)


if __name__ == "__main__":
    main()
