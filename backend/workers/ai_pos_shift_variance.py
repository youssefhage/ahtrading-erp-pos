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


def _severity(abs_usd: Decimal, abs_lbp: Decimal, min_usd: Decimal, min_lbp: Decimal) -> str:
    usd_ratio = (abs_usd / min_usd) if min_usd > 0 else Decimal("0")
    lbp_ratio = (abs_lbp / min_lbp) if min_lbp > 0 else Decimal("0")
    score = max(usd_ratio, lbp_ratio)
    if score >= Decimal("3"):
        return "high"
    if score >= Decimal("1.5"):
        return "medium"
    return "low"


def run_pos_shift_variance_agent(
    db_url: str,
    company_id: str,
    lookback_days: int = 1,
    min_variance_usd: Decimal = Decimal("20"),
    min_variance_lbp: Decimal = Decimal("2000000"),
    limit: int = 200,
):
    lookback_days = max(1, int(lookback_days))
    limit = max(1, int(limit))
    min_variance_usd = max(Decimal("0"), Decimal(str(min_variance_usd or 0)))
    min_variance_lbp = max(Decimal("0"), Decimal(str(min_variance_lbp or 0)))

    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT s.id AS shift_id,
                       s.device_id,
                       d.device_code,
                       s.opened_at,
                       s.closed_at,
                       s.opening_cash_usd,
                       s.opening_cash_lbp,
                       s.expected_cash_usd,
                       s.expected_cash_lbp,
                       s.closing_cash_usd,
                       s.closing_cash_lbp,
                       s.variance_usd,
                       s.variance_lbp
                FROM pos_shifts s
                LEFT JOIN pos_devices d
                  ON d.company_id = s.company_id
                 AND d.id = s.device_id
                WHERE s.company_id = %s
                  AND s.status = 'closed'
                  AND s.closed_at >= now() - (%s::int * interval '1 day')
                  AND (
                    abs(COALESCE(s.variance_usd, 0)) >= %s
                    OR abs(COALESCE(s.variance_lbp, 0)) >= %s
                  )
                ORDER BY s.closed_at DESC NULLS LAST
                LIMIT %s
                """,
                (company_id, lookback_days, min_variance_usd, min_variance_lbp, limit),
            )
            rows = cur.fetchall() or []

        for row in rows:
            shift_id = str(row["shift_id"])
            abs_usd = abs(Decimal(str(row.get("variance_usd") or 0)))
            abs_lbp = abs(Decimal(str(row.get("variance_lbp") or 0)))
            payload = {
                "type": "pos_shift_cash_variance",
                "key": f"shift:{shift_id}",
                "shift_id": shift_id,
                "device_id": str(row.get("device_id") or ""),
                "device_code": row.get("device_code"),
                "opened_at": (row.get("opened_at").isoformat() if row.get("opened_at") else None),
                "closed_at": (row.get("closed_at").isoformat() if row.get("closed_at") else None),
                "opening_cash_usd": str(row.get("opening_cash_usd") or 0),
                "opening_cash_lbp": str(row.get("opening_cash_lbp") or 0),
                "expected_cash_usd": str(row.get("expected_cash_usd") or 0),
                "expected_cash_lbp": str(row.get("expected_cash_lbp") or 0),
                "closing_cash_usd": str(row.get("closing_cash_usd") or 0),
                "closing_cash_lbp": str(row.get("closing_cash_lbp") or 0),
                "variance_usd": str(row.get("variance_usd") or 0),
                "variance_lbp": str(row.get("variance_lbp") or 0),
                "abs_variance_usd": str(abs_usd),
                "abs_variance_lbp": str(abs_lbp),
                "lookback_days": lookback_days,
                "threshold_usd": str(min_variance_usd),
                "threshold_lbp": str(min_variance_lbp),
                "severity": _severity(abs_usd, abs_lbp, min_variance_usd, min_variance_lbp),
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1
                        FROM ai_recommendations
                        WHERE company_id = %s
                          AND agent_code = 'AI_POS_SHIFT_VARIANCE'
                          AND recommendation_json->>'shift_id' = %s
                        LIMIT 1
                        """,
                        (company_id, shift_id),
                    )
                    if cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_POS_SHIFT_VARIANCE', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(payload)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--lookback-days", type=int, default=1)
    parser.add_argument("--min-variance-usd", type=Decimal, default=Decimal("20"))
    parser.add_argument("--min-variance-lbp", type=Decimal, default=Decimal("2000000"))
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()
    run_pos_shift_variance_agent(
        args.db,
        args.company_id,
        lookback_days=args.lookback_days,
        min_variance_usd=args.min_variance_usd,
        min_variance_lbp=args.min_variance_lbp,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
