#!/usr/bin/env python3
import argparse
import json
from datetime import datetime
import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = 'postgresql://localhost/ahtrading'


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def run_purchase_agent(db_url: str, company_id: str):
    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT auto_execute, max_amount_usd, max_actions_per_day
                FROM ai_agent_settings
                WHERE company_id = %s AND agent_code = 'AI_PURCHASE'
                """,
                (company_id,),
            )
            settings = cur.fetchone() or {"auto_execute": False, "max_amount_usd": 0, "max_actions_per_day": 0}
            cur.execute(
                """
                SELECT COUNT(*) AS count
                FROM ai_actions
                WHERE company_id = %s AND agent_code = 'AI_PURCHASE'
                  AND created_at::date = CURRENT_DATE
                """,
                (company_id,),
            )
            today_count = cur.fetchone()["count"]
            cur.execute(
                """
                SELECT i.id AS item_id, i.sku, i.name, i.reorder_point, i.reorder_qty,
                       COALESCE(SUM(sm.qty_in) - SUM(sm.qty_out), 0) AS qty_on_hand,
                       s.supplier_id, s.lead_time_days, s.min_order_qty, s.last_cost_usd
                FROM items i
                LEFT JOIN stock_moves sm
                  ON sm.item_id = i.id AND sm.company_id = i.company_id
                LEFT JOIN item_suppliers s
                  ON s.item_id = i.id AND s.company_id = i.company_id AND s.is_primary = true
                WHERE i.company_id = %s
                GROUP BY i.id, i.sku, i.name, i.reorder_point, i.reorder_qty,
                         s.supplier_id, s.lead_time_days, s.min_order_qty, s.last_cost_usd
                """,
                (company_id,),
            )
            rows = cur.fetchall()

        for r in rows:
            if r["reorder_point"] is None or r["reorder_point"] <= 0:
                continue
            if r["qty_on_hand"] >= r["reorder_point"]:
                continue
            if not r["supplier_id"]:
                continue

            qty = r["reorder_qty"] if r["reorder_qty"] > 0 else r["reorder_point"]
            if r["min_order_qty"] and qty < r["min_order_qty"]:
                qty = r["min_order_qty"]

            amount_usd = qty * (r["last_cost_usd"] or 0)
            auto_execute = settings.get("auto_execute", False)
            max_amount = settings.get("max_amount_usd", 0) or 0
            max_actions = settings.get("max_actions_per_day", 0) or 0

            rec_payload = {
                "item_id": str(r["item_id"]),
                "sku": r["sku"],
                "name": r["name"],
                "qty_on_hand": str(r["qty_on_hand"]),
                "reorder_point": str(r["reorder_point"]),
                "reorder_qty": str(qty),
                "supplier_id": str(r["supplier_id"]),
                "lead_time_days": r["lead_time_days"],
                "amount_usd": str(amount_usd),
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1 FROM ai_recommendations
                        WHERE company_id = %s AND agent_code = 'AI_PURCHASE'
                          AND status = 'pending'
                          AND recommendation_json->>'item_id' = %s
                        """,
                        (company_id, str(r["item_id"])),
                    )
                    if cur.fetchone():
                        continue
                    execute = False
                    if auto_execute:
                        if (max_amount == 0 or amount_usd <= max_amount) and (max_actions == 0 or today_count < max_actions):
                            execute = True
                            today_count += 1

                    status = "approved" if execute else "pending"
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_PURCHASE', %s::jsonb, %s)
                        RETURNING id
                        """,
                        (company_id, json.dumps(rec_payload), status),
                    )
                    rec_id = cur.fetchone()["id"]

                    if execute:
                        cur.execute(
                            """
                            INSERT INTO ai_actions
                              (id, company_id, agent_code, recommendation_id, action_json, status)
                            VALUES
                              (gen_random_uuid(), %s, 'AI_PURCHASE', %s, %s::jsonb, 'queued')
                            """,
                            (company_id, rec_id, json.dumps(rec_payload)),
                        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    args = parser.parse_args()
    run_purchase_agent(args.db, args.company_id)


if __name__ == "__main__":
    main()
