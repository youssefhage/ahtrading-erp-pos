#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timedelta
from decimal import Decimal

import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = "postgresql://localhost/ahtrading"


def get_conn(db_url: str):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def run_price_impact_agent(
    db_url: str,
    company_id: str,
    *,
    lookback_days: int = 30,
    min_pct_increase: Decimal = Decimal("0.05"),
    target_margin_pct: Decimal = Decimal("0.15"),
    limit: int = 200,
):
    """
    Deterministic "price impact" task generator:
    - Watches item_cost_change_log for meaningful cost increases.
    - Creates pending AI recommendations suggesting an updated sell price to preserve margin.
    """
    lookback_days = int(lookback_days or 0) or 30
    limit = min(max(int(limit or 0) or 200, 1), 500)

    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                WITH latest_price AS (
                  SELECT p.item_id, p.price_usd, p.price_lbp,
                         ROW_NUMBER() OVER (PARTITION BY p.item_id ORDER BY p.effective_from DESC, p.created_at DESC, p.id DESC) AS rn
                  FROM item_prices p
                  JOIN items itp ON itp.id = p.item_id
                  WHERE itp.company_id = %s
                    AND p.effective_from <= CURRENT_DATE
                    AND (p.effective_to IS NULL OR p.effective_to >= CURRENT_DATE)
                )
                SELECT c.id AS change_id, c.changed_at, c.item_id, i.sku, i.name,
                       c.warehouse_id, w.name AS warehouse_name,
                       c.on_hand_qty,
                       c.old_avg_cost_usd, c.new_avg_cost_usd, c.pct_change_usd,
                       COALESCE(lp.price_usd, 0) AS price_usd
                FROM item_cost_change_log c
                JOIN items i ON i.company_id = c.company_id AND i.id = c.item_id
                JOIN warehouses w ON w.company_id = c.company_id AND w.id = c.warehouse_id
                LEFT JOIN latest_price lp ON lp.item_id = c.item_id AND lp.rn = 1
                WHERE c.company_id = %s
                  AND c.changed_at >= now() - interval '1 day' * %s
                ORDER BY c.changed_at DESC
                LIMIT %s
                """,
                (company_id, company_id, lookback_days, limit),
            )
            rows = cur.fetchall() or []

        for r in rows:
            pct = r.get("pct_change_usd")
            try:
                pct = Decimal(str(pct)) if pct is not None else None
            except Exception:
                pct = None

            # Only act on meaningful increases (avoid spam when cost decreases).
            if pct is None or pct < min_pct_increase:
                continue

            new_cost = Decimal(str(r.get("new_avg_cost_usd") or 0))
            if new_cost <= 0:
                continue

            current_price = Decimal(str(r.get("price_usd") or 0))
            suggested_price = None
            if target_margin_pct >= Decimal("0.99"):
                target_margin_pct = Decimal("0.50")
            if target_margin_pct < 0:
                target_margin_pct = Decimal("0.15")
            try:
                suggested_price = (new_cost / (Decimal("1") - target_margin_pct)).quantize(Decimal("0.0001"))
            except Exception:
                suggested_price = None

            rec_payload = {
                "change_id": str(r["change_id"]),
                "changed_at": str(r["changed_at"]),
                "item_id": str(r["item_id"]),
                "sku": r.get("sku"),
                "name": r.get("name"),
                "warehouse_id": str(r["warehouse_id"]),
                "warehouse_name": r.get("warehouse_name"),
                "on_hand_qty": str(r.get("on_hand_qty") or 0),
                "old_avg_cost_usd": str(r.get("old_avg_cost_usd") or 0),
                "new_avg_cost_usd": str(r.get("new_avg_cost_usd") or 0),
                "pct_change_usd": str(pct),
                "current_price_usd": str(current_price),
                "target_margin_pct": str(target_margin_pct),
                "suggested_price_usd": str(suggested_price) if suggested_price is not None else None,
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1 FROM ai_recommendations
                        WHERE company_id = %s AND agent_code = 'AI_PRICE_IMPACT'
                          AND status = 'pending'
                          AND recommendation_json->>'change_id' = %s
                        """,
                        (company_id, str(r["change_id"])),
                    )
                    if cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_PRICE_IMPACT', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", default=DB_URL_DEFAULT)
    p.add_argument("--company-id", required=True)
    p.add_argument("--lookback-days", default="30")
    p.add_argument("--min-pct-increase", default="0.05")
    p.add_argument("--target-margin-pct", default="0.15")
    p.add_argument("--limit", default="200")
    args = p.parse_args()
    run_price_impact_agent(
        args.db,
        args.company_id,
        lookback_days=int(args.lookback_days),
        min_pct_increase=Decimal(str(args.min_pct_increase)),
        target_margin_pct=Decimal(str(args.target_margin_pct)),
        limit=int(args.limit),
    )


if __name__ == "__main__":
    main()
