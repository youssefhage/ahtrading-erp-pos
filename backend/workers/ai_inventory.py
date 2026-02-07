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


def run_inventory_agent(db_url: str, company_id: str):
    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT i.id, i.sku, i.name, i.reorder_point, i.reorder_qty,
                       COALESCE(SUM(sm.qty_in) - SUM(sm.qty_out), 0) AS qty_on_hand
                FROM items i
                LEFT JOIN stock_moves sm
                  ON sm.item_id = i.id AND sm.company_id = i.company_id
                WHERE i.company_id = %s
                GROUP BY i.id, i.sku, i.name, i.reorder_point, i.reorder_qty
                """,
                (company_id,),
            )
            rows = cur.fetchall()

        for r in rows:
            if r["reorder_point"] is None or r["reorder_point"] <= 0:
                continue
            if r["qty_on_hand"] >= r["reorder_point"]:
                continue

            rec_payload = {
                "item_id": str(r["id"]),
                "sku": r["sku"],
                "name": r["name"],
                "qty_on_hand": str(r["qty_on_hand"]),
                "reorder_point": str(r["reorder_point"]),
                "reorder_qty": str(r["reorder_qty"]),
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1 FROM ai_recommendations
                        WHERE company_id = %s AND agent_code = 'AI_INVENTORY'
                          AND status = 'pending'
                          AND recommendation_json->>'item_id' = %s
                        """,
                        (company_id, str(r["id"])),
                    )
                    if cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_INVENTORY', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    args = parser.parse_args()
    run_inventory_agent(args.db, args.company_id)


if __name__ == "__main__":
    main()
