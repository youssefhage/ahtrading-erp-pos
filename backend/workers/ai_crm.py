#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timedelta
import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = 'postgresql://localhost/ahtrading'


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SET app.current_company_id = %s", (company_id,))


def run_crm_agent(db_url: str, company_id: str, inactive_days: int):
    cutoff = datetime.utcnow().date() - timedelta(days=inactive_days)
    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT c.id, c.name, c.phone, c.email,
                       MAX(si.created_at)::date AS last_purchase
                FROM customers c
                LEFT JOIN sales_invoices si
                  ON si.customer_id = c.id AND si.company_id = c.company_id
                WHERE c.company_id = %s
                GROUP BY c.id, c.name, c.phone, c.email
                """,
                (company_id,),
            )
            rows = cur.fetchall()

        for r in rows:
            last_purchase = r["last_purchase"]
            if last_purchase is None:
                eligible = True
            else:
                eligible = last_purchase <= cutoff
            if not eligible:
                continue

            rec_payload = {
                "customer_id": str(r["id"]),
                "name": r["name"],
                "phone": r["phone"],
                "email": r["email"],
                "last_purchase": str(last_purchase) if last_purchase else None,
                "inactive_days": inactive_days,
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1 FROM ai_recommendations
                        WHERE company_id = %s AND agent_code = 'AI_CRM'
                          AND status = 'pending'
                          AND recommendation_json->>'customer_id' = %s
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
                          (gen_random_uuid(), %s, 'AI_CRM', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--inactive-days", type=int, default=60)
    args = parser.parse_args()
    run_crm_agent(args.db, args.company_id, args.inactive_days)


if __name__ == "__main__":
    main()
