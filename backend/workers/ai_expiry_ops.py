#!/usr/bin/env python3
import argparse
import json
from datetime import datetime

import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = "postgresql://localhost/ahtrading"


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def run_expiry_ops_agent(db_url: str, company_id: str, days: int = 30, limit: int = 200):
    """
    Operational expiry recommendations (no actions):
    - Batches expiring within N days with qty on hand.
    """
    days = max(1, min(int(days or 30), 3650))
    if limit <= 0:
        return
    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT sm.item_id, i.sku, i.name AS item_name,
                       sm.warehouse_id, w.name AS warehouse_name,
                       sm.batch_id, b.batch_no, b.expiry_date, b.status AS batch_status,
                       SUM(sm.qty_in) - SUM(sm.qty_out) AS qty_on_hand
                FROM stock_moves sm
                JOIN batches b ON b.id = sm.batch_id
                JOIN items i ON i.id = sm.item_id
                LEFT JOIN warehouses w ON w.id = sm.warehouse_id
                WHERE sm.company_id = %s
                  AND b.expiry_date IS NOT NULL
                  AND b.expiry_date <= (CURRENT_DATE + (%s || ' days')::interval)
                GROUP BY sm.item_id, i.sku, i.name, sm.warehouse_id, w.name, sm.batch_id, b.batch_no, b.expiry_date, b.status
                HAVING (SUM(sm.qty_in) - SUM(sm.qty_out)) > 0
                ORDER BY b.expiry_date ASC, qty_on_hand DESC
                LIMIT %s
                """,
                (company_id, days, min(limit, 500)),
            )
            rows = cur.fetchall()

        for r in rows:
            key = f"expiry:{r['batch_id']}:{r['warehouse_id']}"
            rec_payload = {
                "kind": "expiry_ops",
                "key": key,
                "item_id": str(r["item_id"]),
                "sku": r.get("sku"),
                "item_name": r.get("item_name"),
                "warehouse_id": str(r["warehouse_id"]),
                "warehouse_name": r.get("warehouse_name"),
                "batch_id": str(r["batch_id"]),
                "batch_no": r.get("batch_no"),
                "expiry_date": (r.get("expiry_date").isoformat() if r.get("expiry_date") else None),
                "batch_status": r.get("batch_status"),
                "qty_on_hand": str(r.get("qty_on_hand") or 0),
                "days_window": days,
                "timestamp": datetime.utcnow().isoformat(),
                "suggestions": [
                    {"code": "review_promo", "message": "Consider discounting/promoting to sell before expiry."},
                    {"code": "review_writeoff", "message": "Plan an expiry write-off if stock cannot be sold in time."},
                ],
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1
                        FROM ai_recommendations
                        WHERE company_id=%s
                          AND agent_code='AI_EXPIRY_OPS'
                          AND status='pending'
                          AND recommendation_json->>'key'=%s
                        """,
                        (company_id, key),
                    )
                    if cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_EXPIRY_OPS', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()
    run_expiry_ops_agent(args.db, args.company_id, days=args.days, limit=args.limit)


if __name__ == "__main__":
    main()

