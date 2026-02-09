#!/usr/bin/env python3
"""
Cycle count scheduler (v1).

Creates `cycle_count_tasks` from active `cycle_count_plans` when `next_run_date` is due.
Snapshots expected on-hand quantities from stock_moves at task creation.
"""

from datetime import date, timedelta
from decimal import Decimal
import json

import psycopg
from psycopg.rows import dict_row


def run_cycle_count_scheduler(db_url: str, company_id: str, limit_plans: int = 50):
    today = date.today()
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                # Company context for RLS.
                cur.execute("SELECT set_config('app.current_company_id', %s, true)", (company_id,))

                cur.execute(
                    """
                    SELECT id, name, warehouse_id, location_id, frequency_days, next_run_date
                    FROM cycle_count_plans
                    WHERE company_id=%s AND is_active=true AND next_run_date <= %s
                    ORDER BY next_run_date ASC, id ASC
                    LIMIT %s
                    FOR UPDATE
                    """,
                    (company_id, today, limit_plans),
                )
                plans = cur.fetchall() or []
                if not plans:
                    return

                for p in plans:
                    # Create task
                    cur.execute(
                        """
                        INSERT INTO cycle_count_tasks
                          (id, company_id, plan_id, warehouse_id, location_id, status, scheduled_date)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, 'open', %s)
                        RETURNING id
                        """,
                        (company_id, p["id"], p["warehouse_id"], p.get("location_id"), p["next_run_date"]),
                    )
                    task_id = cur.fetchone()["id"]

                    # Snapshot expected qty
                    if p.get("location_id"):
                        cur.execute(
                            """
                            SELECT item_id, COALESCE(SUM(qty_in),0) - COALESCE(SUM(qty_out),0) AS qty_on_hand
                            FROM stock_moves
                            WHERE company_id=%s AND warehouse_id=%s AND location_id=%s
                            GROUP BY item_id
                            """,
                            (company_id, p["warehouse_id"], p["location_id"]),
                        )
                    else:
                        cur.execute(
                            """
                            SELECT item_id, COALESCE(SUM(qty_in),0) - COALESCE(SUM(qty_out),0) AS qty_on_hand
                            FROM stock_moves
                            WHERE company_id=%s AND warehouse_id=%s
                            GROUP BY item_id
                            """,
                            (company_id, p["warehouse_id"]),
                        )
                    rows = cur.fetchall() or []
                    for r in rows:
                        cur.execute(
                            """
                            INSERT INTO cycle_count_lines (id, company_id, task_id, item_id, expected_qty)
                            VALUES (gen_random_uuid(), %s, %s, %s, %s)
                            """,
                            (company_id, task_id, r["item_id"], r["qty_on_hand"] or 0),
                        )

                    # Advance next_run_date
                    freq = int(p.get("frequency_days") or 7)
                    freq = max(1, min(freq, 365))
                    next_run = p["next_run_date"] + timedelta(days=freq)
                    cur.execute(
                        """
                        UPDATE cycle_count_plans
                        SET next_run_date=%s, updated_at=now()
                        WHERE company_id=%s AND id=%s
                        """,
                        (next_run, company_id, p["id"]),
                    )

                    # Audit
                    cur.execute(
                        """
                        INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                        VALUES (gen_random_uuid(), %s, NULL, 'cycle_count_scheduled', 'cycle_count_task', %s, %s::jsonb)
                        """,
                        (company_id, task_id, json.dumps({"plan_id": str(p["id"]), "scheduled_date": str(p["next_run_date"])})),
                    )

