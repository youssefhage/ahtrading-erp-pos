#!/usr/bin/env python3
import argparse
import json
from datetime import datetime
from decimal import Decimal

import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = "postgresql://localhost/ahtrading"


def get_conn(db_url: str):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def run_shrinkage_agent(db_url: str, company_id: str):
    """
    Shrinkage / integrity guardrails:
    - Flags negative on-hand quantities per item+warehouse (data integrity / shrinkage symptoms).
    """
    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT c.item_id, i.sku, i.name,
                       c.warehouse_id, w.name AS warehouse_name,
                       c.on_hand_qty, c.avg_cost_usd, c.avg_cost_lbp
                FROM item_warehouse_costs c
                JOIN items i ON i.id = c.item_id
                JOIN warehouses w ON w.id = c.warehouse_id
                WHERE c.company_id = %s
                  AND c.on_hand_qty < 0
                ORDER BY c.on_hand_qty ASC
                """,
                (company_id,),
            )
            rows = cur.fetchall()

        for r in rows:
            qty = Decimal(str(r.get("on_hand_qty") or 0))
            avg_cost_usd = Decimal(str(r.get("avg_cost_usd") or 0))
            avg_cost_lbp = Decimal(str(r.get("avg_cost_lbp") or 0))
            approx_value_usd = abs(qty) * avg_cost_usd
            approx_value_lbp = abs(qty) * avg_cost_lbp

            rec_payload = {
                "item_id": str(r["item_id"]),
                "sku": r["sku"],
                "name": r["name"],
                "warehouse_id": str(r["warehouse_id"]),
                "warehouse_name": r["warehouse_name"],
                "on_hand_qty": str(qty),
                "avg_cost_usd": str(avg_cost_usd),
                "avg_cost_lbp": str(avg_cost_lbp),
                "approx_value_usd": str(approx_value_usd),
                "approx_value_lbp": str(approx_value_lbp),
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1 FROM ai_recommendations
                        WHERE company_id = %s AND agent_code = 'AI_SHRINKAGE'
                          AND status = 'pending'
                          AND recommendation_json->>'item_id' = %s
                          AND recommendation_json->>'warehouse_id' = %s
                        """,
                        (company_id, str(r["item_id"]), str(r["warehouse_id"])),
                    )
                    if cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_SHRINKAGE', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    args = parser.parse_args()
    run_shrinkage_agent(args.db, args.company_id)


if __name__ == "__main__":
    main()

