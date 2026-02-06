#!/usr/bin/env python3
"""
Long-running worker service.

Processes POS outbox events for all companies (or a specified subset) using the
same logic as `pos_processor.py`, but runs continuously.
"""

import argparse
import time

import psycopg
from psycopg.rows import dict_row

try:
    from .pos_processor import process_events, DB_URL_DEFAULT, MAX_ATTEMPTS_DEFAULT
except ImportError:  # pragma: no cover
    # Allow running as a script: `python3 backend/workers/worker_service.py`
    from pos_processor import process_events, DB_URL_DEFAULT, MAX_ATTEMPTS_DEFAULT


def list_company_ids(db_url: str):
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM companies ORDER BY created_at ASC")
            return [str(r["id"]) for r in cur.fetchall()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--max-attempts", type=int, default=MAX_ATTEMPTS_DEFAULT)
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("--companies", nargs="*", help="Optional list of company UUIDs to process")
    parser.add_argument("--once", action="store_true", help="Run a single pass and exit")
    args = parser.parse_args()

    while True:
        company_ids = args.companies or list_company_ids(args.db)
        did_work = False
        for cid in company_ids:
            processed = process_events(args.db, cid, args.limit, max_attempts=args.max_attempts)
            if processed:
                did_work = True

        if args.once:
            break

        # If we processed anything, loop again quickly; otherwise back off.
        time.sleep(0 if did_work else args.sleep)


if __name__ == "__main__":
    main()
