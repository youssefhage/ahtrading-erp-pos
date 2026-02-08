#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, date, timedelta

import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = "postgresql://localhost/ahtrading"


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def run_ap_guard_agent(db_url: str, company_id: str, due_soon_days: int = 7, limit: int = 200):
    """
    AP guardrails:
    - Supplier invoices on hold (draft + is_on_hold=true)
    - Supplier invoices due soon with outstanding balance (posted, unpaid)
    Creates ai_recommendations with agent_code=AI_AP_GUARD (no actions).
    """
    due_soon_days = max(0, int(due_soon_days or 0))
    if limit <= 0:
        return

    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)

            cur.execute(
                """
                SELECT i.id, i.invoice_no, i.supplier_ref, i.supplier_id, s.name AS supplier_name,
                       i.invoice_date, i.due_date, i.total_usd, i.total_lbp,
                       i.is_on_hold, i.hold_reason, i.held_at
                FROM supplier_invoices i
                LEFT JOIN suppliers s ON s.id = i.supplier_id
                WHERE i.company_id = %s
                  AND i.status = 'draft'
                  AND COALESCE(i.is_on_hold, false) = true
                ORDER BY i.held_at DESC NULLS LAST, i.created_at DESC
                LIMIT %s
                """,
                (company_id, min(limit, 200)),
            )
            on_hold = cur.fetchall()

            due_to = date.today() + timedelta(days=due_soon_days)
            cur.execute(
                """
                SELECT i.id, i.invoice_no, i.supplier_ref, i.supplier_id, s.name AS supplier_name,
                       i.invoice_date, i.due_date, i.total_usd, i.total_lbp,
                       COALESCE(SUM(p.amount_usd), 0) AS paid_usd,
                       COALESCE(SUM(p.amount_lbp), 0) AS paid_lbp
                FROM supplier_invoices i
                LEFT JOIN suppliers s ON s.id = i.supplier_id
                LEFT JOIN supplier_payments p ON p.supplier_invoice_id = i.id
                WHERE i.company_id = %s
                  AND i.status = 'posted'
                  AND i.due_date IS NOT NULL
                  AND i.due_date <= %s
                GROUP BY i.id, i.invoice_no, i.supplier_ref, i.supplier_id, s.name, i.invoice_date, i.due_date, i.total_usd, i.total_lbp
                HAVING (COALESCE(i.total_usd,0) - COALESCE(SUM(p.amount_usd),0)) > 0.0001
                    OR (COALESCE(i.total_lbp,0) - COALESCE(SUM(p.amount_lbp),0)) > 0.5
                ORDER BY i.due_date ASC, i.created_at DESC
                LIMIT %s
                """,
                (company_id, due_to, min(limit, 200)),
            )
            due_soon = cur.fetchall()

        def _insert(rec_payload: dict, unique_key: str):
            with conn.transaction():
                with conn.cursor() as cur2:
                    set_company_context(cur2, company_id)
                    cur2.execute(
                        """
                        SELECT 1
                        FROM ai_recommendations
                        WHERE company_id = %s
                          AND agent_code = 'AI_AP_GUARD'
                          AND status = 'pending'
                          AND recommendation_json->>'key' = %s
                        """,
                        (company_id, unique_key),
                    )
                    if cur2.fetchone():
                        return
                    cur2.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_AP_GUARD', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )

        for r in on_hold:
            rec = {
                "kind": "supplier_invoice_hold",
                "key": f"hold:{r['id']}",
                "invoice_id": str(r["id"]),
                "invoice_no": r.get("invoice_no"),
                "supplier_ref": r.get("supplier_ref"),
                "supplier_id": str(r.get("supplier_id")) if r.get("supplier_id") else None,
                "supplier_name": r.get("supplier_name"),
                "hold_reason": r.get("hold_reason"),
                "held_at": (r.get("held_at").isoformat() if r.get("held_at") else None),
                "timestamp": datetime.utcnow().isoformat(),
            }
            _insert(rec, rec["key"])

        for r in due_soon:
            outstanding_usd = (r.get("total_usd") or 0) - (r.get("paid_usd") or 0)
            outstanding_lbp = (r.get("total_lbp") or 0) - (r.get("paid_lbp") or 0)
            rec = {
                "kind": "supplier_invoice_due_soon",
                "key": f"due:{r['id']}",
                "invoice_id": str(r["id"]),
                "invoice_no": r.get("invoice_no"),
                "supplier_ref": r.get("supplier_ref"),
                "supplier_id": str(r.get("supplier_id")) if r.get("supplier_id") else None,
                "supplier_name": r.get("supplier_name"),
                "due_date": (r.get("due_date").isoformat() if r.get("due_date") else None),
                "outstanding_usd": str(outstanding_usd),
                "outstanding_lbp": str(outstanding_lbp),
                "timestamp": datetime.utcnow().isoformat(),
            }
            _insert(rec, rec["key"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--due-soon-days", type=int, default=7)
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()
    run_ap_guard_agent(args.db, args.company_id, due_soon_days=args.due_soon_days, limit=args.limit)


if __name__ == "__main__":
    main()

