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
    cur.execute("SET app.current_company_id = %s", (company_id,))


def run_agents(db_url: str, company_id: str, limit: int):
    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT id, event_type, payload_json
                FROM events
                WHERE company_id = %s
                ORDER BY created_at ASC
                LIMIT %s
                """,
                (company_id, limit),
            )
            events = cur.fetchall()

        for e in events:
            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1 FROM ai_recommendations
                        WHERE company_id = %s AND event_id = %s AND agent_code = 'AI_CORE'
                        """,
                        (company_id, e["id"]),
                    )
                    if cur.fetchone():
                        continue
                    # Placeholder recommendation: echo event
                    rec = {
                        "agent": "AI_CORE",
                        "event_type": e["event_type"],
                        "timestamp": datetime.utcnow().isoformat(),
                        "recommendation": "review"
                    }
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, event_id, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_CORE', %s, %s::jsonb, 'pending')
                        """,
                        (company_id, e["id"], json.dumps(rec)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    run_agents(args.db, args.company_id, args.limit)


if __name__ == "__main__":
    main()
