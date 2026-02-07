#!/usr/bin/env python3
import argparse
import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = "postgresql://localhost/ahtrading"


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s, true)", (company_id,))


def list_company_ids(cur):
    cur.execute("SELECT id FROM companies ORDER BY created_at ASC")
    return [str(r["id"]) for r in cur.fetchall()]


def rebuild_for_company(cur, company_id: str):
    set_company_context(cur, company_id)
    cur.execute("DELETE FROM item_warehouse_costs WHERE company_id = %s", (company_id,))
    cur.execute(
        """
        INSERT INTO item_warehouse_costs
          (company_id, item_id, warehouse_id, on_hand_qty, avg_cost_usd, avg_cost_lbp, updated_at)
        SELECT
          company_id,
          item_id,
          warehouse_id,
          COALESCE(SUM(qty_in) - SUM(qty_out), 0) AS on_hand_qty,
          CASE
            WHEN COALESCE(SUM(qty_in), 0) > 0
            THEN COALESCE(SUM(qty_in * unit_cost_usd), 0) / NULLIF(SUM(qty_in), 0)
            ELSE 0
          END AS avg_cost_usd,
          CASE
            WHEN COALESCE(SUM(qty_in), 0) > 0
            THEN COALESCE(SUM(qty_in * unit_cost_lbp), 0) / NULLIF(SUM(qty_in), 0)
            ELSE 0
          END AS avg_cost_lbp,
          now() AS updated_at
        FROM stock_moves
        WHERE company_id = %s
        GROUP BY company_id, item_id, warehouse_id
        """,
        (company_id,),
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", help="Rebuild for a single company")
    parser.add_argument("--all", action="store_true", help="Rebuild for all companies")
    args = parser.parse_args()

    if not args.company_id and not args.all:
        raise SystemExit("Pass --company-id or --all")

    with get_conn(args.db) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                company_ids = [args.company_id] if args.company_id else list_company_ids(cur)
                for cid in company_ids:
                    rebuild_for_company(cur, cid)


if __name__ == "__main__":
    main()
