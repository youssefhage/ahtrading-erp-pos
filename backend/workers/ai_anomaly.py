#!/usr/bin/env python3
import argparse
import json
from datetime import date, datetime, timedelta
from decimal import Decimal

import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = "postgresql://localhost/ahtrading"


def get_conn(db_url: str):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def run_anomaly_agent(
    db_url: str,
    company_id: str,
    lookback_days: int = 7,
    return_rate_threshold: Decimal = Decimal("0.20"),
    min_return_qty: Decimal = Decimal("2"),
    adjustment_value_usd_threshold: Decimal = Decimal("250"),
):
    """
    Anomaly / shrinkage guardrails (recommendation-only):
    - High return rates per item (last N days).
    - Large inventory adjustments by approximate value.
    - POS outbox failures (device sync issues).
    """
    lookback_days = max(1, int(lookback_days))
    start = date.today() - timedelta(days=lookback_days - 1)
    end = date.today()

    with get_conn(db_url) as conn:
        # 1) High return rate per item.
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                WITH sold AS (
                  SELECT l.item_id,
                         SUM(l.qty) AS sold_qty,
                         SUM(l.line_total_usd) AS sold_usd
                  FROM sales_invoices si
                  JOIN sales_invoice_lines l ON l.invoice_id = si.id
                  WHERE si.company_id = %s
                    AND si.status = 'posted'
                    AND si.invoice_date BETWEEN %s AND %s
                  GROUP BY l.item_id
                ),
                ret AS (
                  SELECT l.item_id,
                         SUM(l.qty) AS ret_qty,
                         SUM(l.line_total_usd) AS ret_usd
                  FROM sales_returns r
                  JOIN sales_return_lines l ON l.sales_return_id = r.id
                  WHERE r.company_id = %s
                    AND r.status = 'posted'
                    AND r.created_at::date BETWEEN %s AND %s
                  GROUP BY l.item_id
                )
                SELECT i.id AS item_id, i.sku, i.name,
                       COALESCE(s.sold_qty, 0) AS sold_qty,
                       COALESCE(r.ret_qty, 0) AS ret_qty,
                       COALESCE(s.sold_usd, 0) AS sold_usd,
                       COALESCE(r.ret_usd, 0) AS ret_usd
                FROM items i
                LEFT JOIN sold s ON s.item_id = i.id
                LEFT JOIN ret r ON r.item_id = i.id
                WHERE i.company_id = %s
                """,
                (company_id, start, end, company_id, start, end, company_id),
            )
            rows = cur.fetchall()

        for r in rows:
            sold_qty = Decimal(str(r["sold_qty"] or 0))
            ret_qty = Decimal(str(r["ret_qty"] or 0))
            if sold_qty <= 0 or ret_qty < min_return_qty:
                continue
            rate = (ret_qty / sold_qty) if sold_qty else Decimal("0")
            if rate < return_rate_threshold:
                continue

            rec_payload = {
                "type": "high_return_rate",
                "lookback_days": lookback_days,
                "item_id": str(r["item_id"]),
                "sku": r["sku"],
                "name": r["name"],
                "sold_qty": str(sold_qty),
                "returned_qty": str(ret_qty),
                "return_rate": str(rate),
                "sold_usd": str(r["sold_usd"] or 0),
                "returned_usd": str(r["ret_usd"] or 0),
                "window_start": start.isoformat(),
                "window_end": end.isoformat(),
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1
                        FROM ai_recommendations
                        WHERE company_id = %s AND agent_code = 'AI_ANOMALY'
                          AND status = 'pending'
                          AND recommendation_json->>'type' = 'high_return_rate'
                          AND recommendation_json->>'item_id' = %s
                        """,
                        (company_id, str(r["item_id"])),
                    )
                    if cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_ANOMALY', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )

        # 2) Large inventory adjustments by approximate value (USD).
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT sm.item_id, i.sku, i.name,
                       sm.warehouse_id, w.name AS warehouse_name,
                       sm.qty_in, sm.qty_out, sm.unit_cost_usd,
                       sm.created_at
                FROM stock_moves sm
                JOIN items i ON i.id = sm.item_id
                JOIN warehouses w ON w.id = sm.warehouse_id
                WHERE sm.company_id = %s
                  AND sm.source_type = 'inventory_adjustment'
                  AND sm.created_at::date BETWEEN %s AND %s
                ORDER BY sm.created_at DESC
                LIMIT 500
                """,
                (company_id, start, end),
            )
            moves = cur.fetchall()

        for m in moves:
            qty = Decimal(str(m["qty_in"] or 0)) - Decimal(str(m["qty_out"] or 0))
            unit = Decimal(str(m["unit_cost_usd"] or 0))
            approx = abs(qty) * unit
            if approx < adjustment_value_usd_threshold:
                continue

            rec_payload = {
                "type": "large_adjustment",
                "item_id": str(m["item_id"]),
                "sku": m["sku"],
                "name": m["name"],
                "warehouse_id": str(m["warehouse_id"]),
                "warehouse_name": m["warehouse_name"],
                "qty_delta": str(qty),
                "unit_cost_usd": str(unit),
                "approx_value_usd": str(approx),
                "created_at": (m["created_at"].isoformat() if hasattr(m["created_at"], "isoformat") else str(m["created_at"])),
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1
                        FROM ai_recommendations
                        WHERE company_id = %s AND agent_code = 'AI_ANOMALY'
                          AND status = 'pending'
                          AND recommendation_json->>'type' = 'large_adjustment'
                          AND recommendation_json->>'item_id' = %s
                          AND recommendation_json->>'warehouse_id' = %s
                          AND recommendation_json->>'created_at' = %s
                        """,
                        (company_id, str(m["item_id"]), str(m["warehouse_id"]), rec_payload["created_at"]),
                    )
                    if cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_ANOMALY', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )

        # 3) POS outbox failures (surface operational breakages).
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT o.id, d.device_code, o.event_type, o.created_at, o.error_message, o.attempt_count
                FROM pos_events_outbox o
                JOIN pos_devices d ON d.id = o.device_id
                WHERE d.company_id = %s
                  AND o.error_message IS NOT NULL
                  AND o.created_at > now() - interval '7 days'
                ORDER BY o.created_at DESC
                LIMIT 50
                """,
                (company_id,),
            )
            fails = cur.fetchall()

        for f in fails:
            rec_payload = {
                "type": "pos_outbox_failure",
                "outbox_id": str(f["id"]),
                "device_code": f["device_code"],
                "event_type": f["event_type"],
                "attempt_count": int(f["attempt_count"] or 0),
                "error_message": f["error_message"],
                "created_at": (f["created_at"].isoformat() if hasattr(f["created_at"], "isoformat") else str(f["created_at"])),
                "timestamp": datetime.utcnow().isoformat(),
            }
            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1
                        FROM ai_recommendations
                        WHERE company_id = %s AND agent_code = 'AI_ANOMALY'
                          AND status = 'pending'
                          AND recommendation_json->>'type' = 'pos_outbox_failure'
                          AND recommendation_json->>'outbox_id' = %s
                        """,
                        (company_id, str(f["id"])),
                    )
                    if cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_ANOMALY', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--lookback-days", type=int, default=7)
    parser.add_argument("--return-rate", default="0.20")
    parser.add_argument("--min-return-qty", default="2")
    parser.add_argument("--adjustment-usd", default="250")
    args = parser.parse_args()
    run_anomaly_agent(
        args.db,
        args.company_id,
        lookback_days=args.lookback_days,
        return_rate_threshold=Decimal(str(args.return_rate)),
        min_return_qty=Decimal(str(args.min_return_qty)),
        adjustment_value_usd_threshold=Decimal(str(args.adjustment_usd)),
    )


if __name__ == "__main__":
    main()

