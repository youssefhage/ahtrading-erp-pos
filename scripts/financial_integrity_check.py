#!/usr/bin/env python3
"""
Lightweight financial integrity checks (v1).

Goal: catch "math doesn't add up" issues early by verifying key invariants:
- Posted sales invoice totals == sum(lines) + tax_lines
- Posted supplier invoice totals == sum(lines) + tax_lines
- GL journals are balanced (per currency) within small epsilons

This is intentionally read-only and safe to run against production DBs.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from decimal import Decimal


# Allow running from repo root without installing as a package.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from backend.app.db import get_conn, set_company_context  # noqa: E402


EPS_USD = Decimal("0.01")
EPS_LBP = Decimal("100")


def d(v) -> Decimal:
    return Decimal(str(v or 0))


@dataclass
class Finding:
    kind: str
    id: str
    ref: str
    message: str


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--company-id", default=os.environ.get("COMPANY_ID") or "", help="Company UUID (or env COMPANY_ID)")
    p.add_argument("--limit", type=int, default=200, help="Rows per check (default: 200)")
    return p.parse_args()


def check_sales_invoices(company_id: str, limit: int) -> list[Finding]:
    findings: list[Finding] = []
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id,
                       i.invoice_no,
                       i.invoice_date,
                       i.total_usd,
                       i.total_lbp,
                       COALESCE(SUM(l.line_total_usd), 0) AS base_usd,
                       COALESCE(SUM(l.line_total_lbp), 0) AS base_lbp,
                       COALESCE(t.tax_usd, 0) AS tax_usd,
                       COALESCE(t.tax_lbp, 0) AS tax_lbp
                FROM sales_invoices i
                JOIN sales_invoice_lines l ON l.invoice_id = i.id
                LEFT JOIN LATERAL (
                  SELECT COALESCE(SUM(tl.tax_usd), 0) AS tax_usd,
                         COALESCE(SUM(tl.tax_lbp), 0) AS tax_lbp
                  FROM tax_lines tl
                  WHERE tl.company_id = i.company_id
                    AND tl.source_type = 'sales_invoice'
                    AND tl.source_id = i.id
                ) t ON true
                WHERE i.company_id = %s
                  AND i.status = 'posted'
                GROUP BY i.id, i.invoice_no, i.invoice_date, i.total_usd, i.total_lbp, t.tax_usd, t.tax_lbp
                ORDER BY i.invoice_date DESC, i.invoice_no DESC
                LIMIT %s
                """,
                (company_id, limit),
            )
            for r in cur.fetchall():
                base_usd = d(r["base_usd"])
                base_lbp = d(r["base_lbp"])
                tax_usd = d(r["tax_usd"])
                tax_lbp = d(r["tax_lbp"])
                exp_total_usd = base_usd + tax_usd
                exp_total_lbp = base_lbp + tax_lbp
                got_total_usd = d(r["total_usd"])
                got_total_lbp = d(r["total_lbp"])
                du = got_total_usd - exp_total_usd
                dl = got_total_lbp - exp_total_lbp
                if abs(du) > EPS_USD or abs(dl) > EPS_LBP:
                    findings.append(
                        Finding(
                            kind="sales_invoice_total_mismatch",
                            id=str(r["id"]),
                            ref=str(r["invoice_no"] or r["id"]),
                            message=(
                                f"total mismatch: got usd={got_total_usd} lbp={got_total_lbp} "
                                f"expected usd={exp_total_usd} lbp={exp_total_lbp} "
                                f"delta usd={du} lbp={dl}"
                            ),
                        )
                    )
    return findings


def check_supplier_invoices(company_id: str, limit: int) -> list[Finding]:
    findings: list[Finding] = []
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id,
                       i.invoice_no,
                       i.invoice_date,
                       i.total_usd,
                       i.total_lbp,
                       COALESCE(SUM(l.line_total_usd), 0) AS base_usd,
                       COALESCE(SUM(l.line_total_lbp), 0) AS base_lbp,
                       COALESCE(t.tax_usd, 0) AS tax_usd,
                       COALESCE(t.tax_lbp, 0) AS tax_lbp
                FROM supplier_invoices i
                JOIN supplier_invoice_lines l ON l.supplier_invoice_id = i.id
                LEFT JOIN LATERAL (
                  SELECT COALESCE(SUM(tl.tax_usd), 0) AS tax_usd,
                         COALESCE(SUM(tl.tax_lbp), 0) AS tax_lbp
                  FROM tax_lines tl
                  WHERE tl.company_id = i.company_id
                    AND tl.source_type = 'supplier_invoice'
                    AND tl.source_id = i.id
                ) t ON true
                WHERE i.company_id = %s
                  AND i.status = 'posted'
                GROUP BY i.id, i.invoice_no, i.invoice_date, i.total_usd, i.total_lbp, t.tax_usd, t.tax_lbp
                ORDER BY i.invoice_date DESC, i.invoice_no DESC
                LIMIT %s
                """,
                (company_id, limit),
            )
            for r in cur.fetchall():
                base_usd = d(r["base_usd"])
                base_lbp = d(r["base_lbp"])
                tax_usd = d(r["tax_usd"])
                tax_lbp = d(r["tax_lbp"])
                exp_total_usd = base_usd + tax_usd
                exp_total_lbp = base_lbp + tax_lbp
                got_total_usd = d(r["total_usd"])
                got_total_lbp = d(r["total_lbp"])
                du = got_total_usd - exp_total_usd
                dl = got_total_lbp - exp_total_lbp
                if abs(du) > EPS_USD or abs(dl) > EPS_LBP:
                    findings.append(
                        Finding(
                            kind="supplier_invoice_total_mismatch",
                            id=str(r["id"]),
                            ref=str(r["invoice_no"] or r["id"]),
                            message=(
                                f"total mismatch: got usd={got_total_usd} lbp={got_total_lbp} "
                                f"expected usd={exp_total_usd} lbp={exp_total_lbp} "
                                f"delta usd={du} lbp={dl}"
                            ),
                        )
                    )
    return findings


def check_gl_balance(company_id: str, limit: int) -> list[Finding]:
    findings: list[Finding] = []
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT j.id,
                       j.journal_no,
                       j.journal_date,
                       COALESCE(SUM(e.debit_usd - e.credit_usd), 0) AS delta_usd,
                       COALESCE(SUM(e.debit_lbp - e.credit_lbp), 0) AS delta_lbp
                FROM gl_journals j
                JOIN gl_entries e ON e.journal_id = j.id
                WHERE j.company_id = %s
                GROUP BY j.id, j.journal_no, j.journal_date
                HAVING ABS(COALESCE(SUM(e.debit_usd - e.credit_usd), 0)) > %s
                    OR ABS(COALESCE(SUM(e.debit_lbp - e.credit_lbp), 0)) > %s
                ORDER BY j.journal_date DESC, j.journal_no DESC
                LIMIT %s
                """,
                (company_id, EPS_USD, EPS_LBP, limit),
            )
            for r in cur.fetchall():
                findings.append(
                    Finding(
                        kind="gl_unbalanced",
                        id=str(r["id"]),
                        ref=str(r["journal_no"] or r["id"]),
                        message=f"unbalanced: delta usd={d(r['delta_usd'])} delta lbp={d(r['delta_lbp'])} on {r['journal_date']}",
                    )
                )
    return findings


def main() -> int:
    args = _parse_args()
    company_id = (args.company_id or "").strip()
    if not company_id:
        print("Missing --company-id (or env COMPANY_ID).", file=sys.stderr)
        return 2
    limit = max(1, min(int(args.limit or 200), 5000))

    findings: list[Finding] = []
    findings.extend(check_sales_invoices(company_id, limit))
    findings.extend(check_supplier_invoices(company_id, limit))
    findings.extend(check_gl_balance(company_id, limit))

    if not findings:
        print("OK: no integrity issues found.")
        return 0

    print(f"Found {len(findings)} issue(s):")
    for f in findings[:200]:
        print(f"- {f.kind}: {f.ref} ({f.id}) -> {f.message}")
    if len(findings) > 200:
        print(f"... plus {len(findings) - 200} more")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

