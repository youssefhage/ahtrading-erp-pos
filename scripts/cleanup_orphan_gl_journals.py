#!/usr/bin/env python3
"""
Safely audit and clean orphan GL journals.

Use cases:
- Previous hard deletes removed source documents but left GL journals behind.
- Those orphans can collide with deterministic journal numbers like GL-<invoice_no>.

Default mode is dry-run (no deletes). Use --apply to execute cleanup.

Example:
  python3 scripts/cleanup_orphan_gl_journals.py \
    --db "$APP_DATABASE_URL" \
    --company-id 00000000-0000-0000-0000-000000000001
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Iterable

import psycopg
from psycopg.rows import dict_row


@dataclass(frozen=True)
class SourceSpec:
    source_type: str
    table_name: str
    has_company_id: bool


SOURCE_SPECS: tuple[SourceSpec, ...] = (
    SourceSpec("sales_invoice", "sales_invoices", True),
    SourceSpec("sales_return", "sales_returns", True),
    SourceSpec("sales_payment", "sales_payments", False),
    SourceSpec("supplier_invoice", "supplier_invoices", True),
    SourceSpec("goods_receipt", "goods_receipts", True),
)


def _q_markers(n: int) -> str:
    return ",".join(["%s"] * max(1, int(n)))


def _fetch_orphans(cur, spec: SourceSpec, company_ids: list[str]) -> list[dict]:
    company_filter = ""
    params: list[object] = [spec.source_type]

    if company_ids:
        company_filter = f" AND j.company_id IN ({_q_markers(len(company_ids))})"
        params.extend(company_ids)

    join_company = "AND s.company_id = j.company_id" if spec.has_company_id else ""

    sql = f"""
        SELECT
            j.id,
            j.company_id,
            j.journal_no,
            j.source_type,
            j.source_id,
            j.created_at,
            COUNT(e.id)::int AS entry_count
        FROM gl_journals j
        LEFT JOIN gl_entries e
          ON e.journal_id = j.id
        LEFT JOIN {spec.table_name} s
          ON s.id = j.source_id
          {join_company}
        WHERE j.source_type = %s
          AND j.source_id IS NOT NULL
          AND s.id IS NULL
          {company_filter}
        GROUP BY j.id, j.company_id, j.journal_no, j.source_type, j.source_id, j.created_at
        ORDER BY j.created_at ASC
    """
    cur.execute(sql, params)
    return list(cur.fetchall() or [])


def _print_summary(rows_by_type: dict[str, list[dict]]) -> None:
    total = 0
    print("Orphan GL journals by source_type:")
    for stype, rows in rows_by_type.items():
        c = len(rows)
        total += c
        print(f"- {stype}: {c}")
    print(f"Total orphan journals: {total}")

    # Show a small preview to validate before apply.
    preview = []
    for stype, rows in rows_by_type.items():
        for r in rows[:3]:
            preview.append((stype, r["company_id"], r["journal_no"], r["id"], r["entry_count"]))
    if preview:
        print("Preview (up to 3 per type):")
        for stype, company_id, journal_no, jid, entry_count in preview:
            print(f"- {stype} | {company_id} | {journal_no} | {jid} | entries={entry_count}")


def _flatten_ids(rows_by_type: dict[str, list[dict]]) -> list[str]:
    out: list[str] = []
    for rows in rows_by_type.values():
        for r in rows:
            out.append(str(r["id"]))
    return out


def _delete_orphans(cur, journal_ids: Iterable[str]) -> tuple[int, int]:
    ids = [str(x) for x in journal_ids if str(x).strip()]
    if not ids:
        return 0, 0

    markers = _q_markers(len(ids))
    cur.execute(f"DELETE FROM gl_entries WHERE journal_id IN ({markers})", ids)
    deleted_entries = cur.rowcount or 0
    cur.execute(f"DELETE FROM gl_journals WHERE id IN ({markers})", ids)
    deleted_journals = cur.rowcount or 0
    return int(deleted_entries), int(deleted_journals)


def main() -> int:
    ap = argparse.ArgumentParser(description="Audit and optionally delete orphan GL journals.")
    ap.add_argument("--db", required=True, help="PostgreSQL URL")
    ap.add_argument("--company-id", action="append", default=[], help="Optional company UUID (repeatable)")
    ap.add_argument("--apply", action="store_true", help="Execute deletion (default is dry-run)")
    args = ap.parse_args()

    company_ids = [str(c).strip() for c in (args.company_id or []) if str(c).strip()]
    rows_by_type: dict[str, list[dict]] = {}

    with psycopg.connect(args.db, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            for spec in SOURCE_SPECS:
                rows_by_type[spec.source_type] = _fetch_orphans(cur, spec, company_ids)

            _print_summary(rows_by_type)
            ids = _flatten_ids(rows_by_type)
            if not ids:
                print("No orphan journals found.")
                return 0

            if not args.apply:
                print("Dry-run only. Re-run with --apply to delete these orphan journals.")
                return 0

            with conn.transaction():
                deleted_entries, deleted_journals = _delete_orphans(cur, ids)
            print(f"Deleted gl_entries: {deleted_entries}")
            print(f"Deleted gl_journals: {deleted_journals}")

            # Post-delete validation.
            post_rows_by_type: dict[str, list[dict]] = {}
            for spec in SOURCE_SPECS:
                post_rows_by_type[spec.source_type] = _fetch_orphans(cur, spec, company_ids)
            post_total = sum(len(v) for v in post_rows_by_type.values())
            print(f"Remaining orphan journals after cleanup: {post_total}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

