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


def upsert_sales_daily(cur, company_id: str, start_date: date, end_date: date):
    """
    Build a compact feature store from invoices + returns so demand forecasting doesn't
    have to scan transactional tables every time.
    """
    set_company_context(cur, company_id)
    cur.execute(
        """
        WITH sold AS (
          SELECT si.company_id, l.item_id, si.invoice_date AS d,
                 SUM(l.qty) AS sold_qty,
                 SUM(l.line_total_usd) AS sold_usd,
                 SUM(l.line_total_lbp) AS sold_lbp
          FROM sales_invoices si
          JOIN sales_invoice_lines l ON l.invoice_id = si.id
          WHERE si.company_id = %s
            AND si.status = 'posted'
            AND si.invoice_date BETWEEN %s AND %s
          GROUP BY si.company_id, l.item_id, si.invoice_date
        ),
        ret AS (
          SELECT r.company_id, l.item_id, r.created_at::date AS d,
                 SUM(l.qty) AS returned_qty,
                 SUM(l.line_total_usd) AS returned_usd,
                 SUM(l.line_total_lbp) AS returned_lbp
          FROM sales_returns r
          JOIN sales_return_lines l ON l.sales_return_id = r.id
          WHERE r.company_id = %s
            AND r.status = 'posted'
            AND r.created_at::date BETWEEN %s AND %s
          GROUP BY r.company_id, l.item_id, r.created_at::date
        ),
        merged AS (
          SELECT s.company_id, s.item_id, s.d AS sale_date,
                 s.sold_qty, s.sold_usd, s.sold_lbp,
                 COALESCE(rt.returned_qty, 0) AS returned_qty,
                 COALESCE(rt.returned_usd, 0) AS returned_usd,
                 COALESCE(rt.returned_lbp, 0) AS returned_lbp
          FROM sold s
          LEFT JOIN ret rt
            ON rt.company_id = s.company_id AND rt.item_id = s.item_id AND rt.d = s.d
          UNION ALL
          SELECT rt.company_id, rt.item_id, rt.d AS sale_date,
                 0, 0, 0,
                 rt.returned_qty, rt.returned_usd, rt.returned_lbp
          FROM ret rt
          LEFT JOIN sold s
            ON s.company_id = rt.company_id AND s.item_id = rt.item_id AND s.d = rt.d
          WHERE s.company_id IS NULL
        )
        INSERT INTO ai_item_sales_daily
          (company_id, item_id, sale_date,
           sold_qty, sold_revenue_usd, sold_revenue_lbp,
           returned_qty, returned_revenue_usd, returned_revenue_lbp,
           updated_at)
        SELECT company_id, item_id, sale_date,
               sold_qty, sold_usd, sold_lbp,
               returned_qty, returned_usd, returned_lbp,
               now()
        FROM merged
        ON CONFLICT (company_id, item_id, sale_date) DO UPDATE
        SET sold_qty = EXCLUDED.sold_qty,
            sold_revenue_usd = EXCLUDED.sold_revenue_usd,
            sold_revenue_lbp = EXCLUDED.sold_revenue_lbp,
            returned_qty = EXCLUDED.returned_qty,
            returned_revenue_usd = EXCLUDED.returned_revenue_usd,
            returned_revenue_lbp = EXCLUDED.returned_revenue_lbp,
            updated_at = now()
        """,
        (company_id, start_date, end_date, company_id, start_date, end_date),
    )


def ensure_agent_setting(cur, company_id: str):
    set_company_context(cur, company_id)
    cur.execute(
        """
        INSERT INTO ai_agent_settings (company_id, agent_code, auto_execute, max_amount_usd, max_actions_per_day)
        VALUES (%s, 'AI_DEMAND', false, 0, 0)
        ON CONFLICT (company_id, agent_code) DO NOTHING
        """,
        (company_id,),
    )


def run_demand_agent(
    db_url: str,
    company_id: str,
    window_days: int = 28,
    review_days: int = 7,
    safety_days: int = 3,
):
    """
    Demand planning agent (v1):
    - Computes net avg daily demand from sales minus returns over `window_days`.
    - Uses supplier lead time + a review period to suggest reorder qty.
    - Creates AI_DEMAND recommendations that can be approved and optionally executed into POs.
    """
    window_days = max(7, int(window_days))
    review_days = max(1, int(review_days))
    safety_days = max(0, int(safety_days))
    end = date.today()
    start = end - timedelta(days=window_days - 1)

    with get_conn(db_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                ensure_agent_setting(cur, company_id)
                upsert_sales_daily(cur, company_id, start, end)

        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT i.id AS item_id, i.sku, i.name,
                       s.supplier_id, s.lead_time_days, s.min_order_qty, s.last_cost_usd
                FROM items i
                JOIN item_suppliers s
                  ON s.company_id = i.company_id AND s.item_id = i.id AND s.is_primary = true
                WHERE i.company_id = %s
                ORDER BY i.sku
                """,
                (company_id,),
            )
            items = cur.fetchall()

        for it in items:
            item_id = str(it["item_id"])
            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)

                    # Avoid spam: keep one pending demand rec per item.
                    cur.execute(
                        """
                        SELECT 1
                        FROM ai_recommendations
                        WHERE company_id = %s
                          AND agent_code = 'AI_DEMAND'
                          AND status IN ('pending', 'approved')
                          AND recommendation_json->>'item_id' = %s
                        """,
                        (company_id, item_id),
                    )
                    if cur.fetchone():
                        continue

                    cur.execute(
                        """
                        SELECT
                          COALESCE(SUM(sold_qty - returned_qty), 0) AS net_qty,
                          COALESCE(SUM(sold_revenue_usd - returned_revenue_usd), 0) AS net_usd
                        FROM ai_item_sales_daily
                        WHERE company_id = %s AND item_id = %s
                          AND sale_date BETWEEN %s AND %s
                        """,
                        (company_id, item_id, start, end),
                    )
                    hist = cur.fetchone()
                    net_qty = Decimal(str(hist["net_qty"] or 0))
                    if net_qty <= 0:
                        continue

                    avg_daily = (net_qty / Decimal(str(window_days))).quantize(Decimal("0.000001"))
                    lead = int(it.get("lead_time_days") or 0)
                    horizon = max(1, lead + review_days)
                    safety_qty = avg_daily * Decimal(str(safety_days))
                    forecast_qty = avg_daily * Decimal(str(horizon))

                    cur.execute(
                        """
                        SELECT COALESCE(SUM(on_hand_qty), 0) AS on_hand_qty
                        FROM item_warehouse_costs
                        WHERE company_id = %s AND item_id = %s
                        """,
                        (company_id, item_id),
                    )
                    on_hand = Decimal(str((cur.fetchone() or {}).get("on_hand_qty") or 0))

                    needed = (forecast_qty + safety_qty) - on_hand
                    if needed <= 0:
                        # Still store forecast for the copilot UI.
                        cur.execute(
                            """
                            INSERT INTO ai_demand_forecasts
                              (company_id, item_id, method, window_days, horizon_days,
                               avg_daily_qty, forecast_qty, details, computed_at)
                            VALUES
                              (%s, %s, 'ema', %s, %s, %s, %s, %s::jsonb, now())
                            ON CONFLICT (company_id, item_id, method) DO UPDATE
                            SET window_days = EXCLUDED.window_days,
                                horizon_days = EXCLUDED.horizon_days,
                                avg_daily_qty = EXCLUDED.avg_daily_qty,
                                forecast_qty = EXCLUDED.forecast_qty,
                                details = EXCLUDED.details,
                                computed_at = now()
                            """,
                            (
                                company_id,
                                item_id,
                                window_days,
                                horizon,
                                avg_daily,
                                forecast_qty,
                                json.dumps(
                                    {
                                        "on_hand_qty": str(on_hand),
                                        "needed_qty": str(needed),
                                        "lead_time_days": lead,
                                        "review_days": review_days,
                                        "safety_days": safety_days,
                                        "window_start": start.isoformat(),
                                        "window_end": end.isoformat(),
                                    }
                                ),
                            ),
                        )
                        continue

                    min_order = Decimal(str(it.get("min_order_qty") or 0))
                    reorder_qty = needed
                    if min_order and reorder_qty < min_order:
                        reorder_qty = min_order

                    last_cost = Decimal(str(it.get("last_cost_usd") or 0))
                    amount_usd = (reorder_qty * last_cost).quantize(Decimal("0.0001")) if last_cost else Decimal("0")

                    # Persist forecast snapshot.
                    cur.execute(
                        """
                        INSERT INTO ai_demand_forecasts
                          (company_id, item_id, method, window_days, horizon_days,
                           avg_daily_qty, forecast_qty, details, computed_at)
                        VALUES
                          (%s, %s, 'ema', %s, %s, %s, %s, %s::jsonb, now())
                        ON CONFLICT (company_id, item_id, method) DO UPDATE
                        SET window_days = EXCLUDED.window_days,
                            horizon_days = EXCLUDED.horizon_days,
                            avg_daily_qty = EXCLUDED.avg_daily_qty,
                            forecast_qty = EXCLUDED.forecast_qty,
                            details = EXCLUDED.details,
                            computed_at = now()
                        """,
                        (
                            company_id,
                            item_id,
                            window_days,
                            horizon,
                            avg_daily,
                            forecast_qty,
                            json.dumps(
                                {
                                    "on_hand_qty": str(on_hand),
                                    "needed_qty": str(needed),
                                    "lead_time_days": lead,
                                    "review_days": review_days,
                                    "safety_days": safety_days,
                                    "last_cost_usd": str(last_cost),
                                    "window_start": start.isoformat(),
                                    "window_end": end.isoformat(),
                                }
                            ),
                        ),
                    )

                    rec_payload = {
                        "item_id": item_id,
                        "sku": it["sku"],
                        "name": it["name"],
                        "supplier_id": str(it["supplier_id"]),
                        "window_days": window_days,
                        "lead_time_days": lead,
                        "review_days": review_days,
                        "safety_days": safety_days,
                        "avg_daily_qty": str(avg_daily),
                        "forecast_qty": str(forecast_qty),
                        "on_hand_qty": str(on_hand),
                        "reorder_qty": str(reorder_qty),
                        "amount_usd": str(amount_usd),
                        "timestamp": datetime.utcnow().isoformat(),
                    }

                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_DEMAND', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--window-days", type=int, default=28)
    parser.add_argument("--review-days", type=int, default=7)
    parser.add_argument("--safety-days", type=int, default=3)
    args = parser.parse_args()
    run_demand_agent(args.db, args.company_id, window_days=args.window_days, review_days=args.review_days, safety_days=args.safety_days)


if __name__ == "__main__":
    main()

