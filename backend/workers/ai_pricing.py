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


def run_pricing_agent(db_url: str, company_id: str, min_margin_pct: Decimal = Decimal("0.05"), target_margin_pct: Decimal = Decimal("0.15")):
    """
    Simple pricing guardrail:
    - Computes current sell price (latest active item_prices row).
    - Estimates avg cost from item_warehouse_costs.
    - Flags items below a minimum margin.
    """
    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                WITH latest_price AS (
                  SELECT p.item_id, p.price_usd, p.price_lbp,
                         ROW_NUMBER() OVER (PARTITION BY p.item_id ORDER BY p.effective_from DESC, p.created_at DESC, p.id DESC) AS rn
                  FROM item_prices p
                  JOIN items i ON i.id = p.item_id
                  WHERE i.company_id = %s
                    AND p.effective_from <= CURRENT_DATE
                    AND (p.effective_to IS NULL OR p.effective_to >= CURRENT_DATE)
                )
                SELECT i.id AS item_id, i.sku, i.name,
                       COALESCE(lp.price_usd, 0) AS price_usd,
                       COALESCE(lp.price_lbp, 0) AS price_lbp,
                       COALESCE(SUM(c.on_hand_qty), 0) AS on_hand_qty,
                       CASE
                         WHEN COALESCE(SUM(c.on_hand_qty), 0) > 0 THEN
                           COALESCE(SUM(c.on_hand_qty * c.avg_cost_usd) / NULLIF(SUM(c.on_hand_qty), 0), 0)
                         ELSE
                           COALESCE(AVG(c.avg_cost_usd), 0)
                       END AS avg_cost_usd,
                       CASE
                         WHEN COALESCE(SUM(c.on_hand_qty), 0) > 0 THEN
                           COALESCE(SUM(c.on_hand_qty * c.avg_cost_lbp) / NULLIF(SUM(c.on_hand_qty), 0), 0)
                         ELSE
                           COALESCE(AVG(c.avg_cost_lbp), 0)
                       END AS avg_cost_lbp
                FROM items i
                LEFT JOIN latest_price lp ON lp.item_id = i.id AND lp.rn = 1
                LEFT JOIN item_warehouse_costs c ON c.company_id = i.company_id AND c.item_id = i.id
                WHERE i.company_id = %s
                GROUP BY i.id, i.sku, i.name, lp.price_usd, lp.price_lbp
                """,
                (company_id, company_id),
            )
            rows = cur.fetchall()

        for r in rows:
            price_usd = Decimal(str(r.get("price_usd") or 0))
            cost_usd = Decimal(str(r.get("avg_cost_usd") or 0))

            if price_usd <= 0 or cost_usd <= 0:
                continue

            margin_pct = (price_usd - cost_usd) / price_usd if price_usd else Decimal("0")
            if margin_pct >= min_margin_pct:
                continue

            # Suggest a price that hits target margin (bounded by at least +1% to avoid divide-by-zero).
            target = max(target_margin_pct, Decimal("0.01"))
            suggested_price_usd = (cost_usd / (Decimal("1") - target)).quantize(Decimal("0.0001"))

            rec_payload = {
                "item_id": str(r["item_id"]),
                "sku": r["sku"],
                "name": r["name"],
                "price_usd": str(price_usd),
                "cost_usd": str(cost_usd),
                "margin_pct": str(margin_pct),
                "min_margin_pct": str(min_margin_pct),
                "target_margin_pct": str(target_margin_pct),
                "suggested_price_usd": str(suggested_price_usd),
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1 FROM ai_recommendations
                        WHERE company_id = %s AND agent_code = 'AI_PRICING'
                          AND status = 'pending'
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
                          (gen_random_uuid(), %s, 'AI_PRICING', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--min-margin-pct", default="0.05")
    parser.add_argument("--target-margin-pct", default="0.15")
    args = parser.parse_args()
    run_pricing_agent(
        args.db,
        args.company_id,
        min_margin_pct=Decimal(str(args.min_margin_pct)),
        target_margin_pct=Decimal(str(args.target_margin_pct)),
    )


if __name__ == "__main__":
    main()
