#!/usr/bin/env python3
import argparse
import csv
import os
import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = 'postgresql://localhost/ahtrading'


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--csv", required=True)
    args = parser.parse_args()

    with get_conn(args.db) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, args.company_id)

            with open(args.csv, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                rows = list(reader)

            for r in rows:
                role = (r.get("role_code") or "").strip()
                code = (r.get("account_code") or "").strip()
                if not role or not code:
                    continue
                cur.execute(
                    """
                    SELECT id FROM company_coa_accounts
                    WHERE company_id = %s AND account_code = %s
                    """,
                    (args.company_id, code),
                )
                acc = cur.fetchone()
                if not acc:
                    raise ValueError(f"Account code not found: {code}")

                cur.execute(
                    """
                    INSERT INTO company_account_defaults (company_id, role_code, account_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (company_id, role_code) DO UPDATE SET account_id = EXCLUDED.account_id
                    """,
                    (args.company_id, role, acc["id"]),
                )
        conn.commit()


if __name__ == "__main__":
    main()
