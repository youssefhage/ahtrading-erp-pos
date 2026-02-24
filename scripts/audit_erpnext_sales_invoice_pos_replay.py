#!/usr/bin/env python3
"""
Exhaustive ERPNext Sales Invoice replay audit for POS compatibility.

What this checks:
- Pulls all posted ERPNext Sales Invoices for target companies.
- Replays POS-style line math (qty_entered * entered_unit_price with UOM factors).
- Verifies invoice totals parity from line net amounts + taxes.
- Detects UOM conversion risks that can cause POS mispricing:
  - invoice line uses non-stock UOM missing on Item.uoms
  - invoice line conversion_factor differs from Item.uoms conversion
  - barcode UOM exists but matching Item.uoms conversion is missing
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, build_opener


TOL_MONEY = Decimal("0.01")
TOL_QTY = Decimal("0.0001")
TOL_FACTOR = Decimal("0.0001")


def _to_dec(v: Any) -> Decimal:
    s = str(v or "").strip()
    if not s:
        return Decimal("0")
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _norm_uom(v: Any) -> str:
    return str(v or "").strip().upper()


def _approx_eq(a: Decimal, b: Decimal, tol: Decimal) -> bool:
    return (a - b).copy_abs() <= tol


def _chunks(xs: list[str], n: int) -> list[list[str]]:
    out: list[list[str]] = []
    for i in range(0, len(xs), n):
        out.append(xs[i : i + n])
    return out


class ErpClient:
    def __init__(self, base_url: str, api_key: str, api_secret: str, timeout_s: int = 60, retries: int = 3):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.api_secret = api_secret
        self.timeout_s = int(timeout_s)
        self.retries = int(retries)

    def _req_json(self, method: str, path: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        url = self.base_url + path
        if params:
            url += "?" + urlencode(params, doseq=True)

        headers = {
            "Authorization": f"token {self.api_key}:{self.api_secret}",
            "Accept": "application/json",
            "User-Agent": "codex-erpnext-invoice-audit/1.0",
        }

        attempt = 0
        while True:
            req = Request(url, method=method, headers=headers)
            try:
                with build_opener().open(req, timeout=self.timeout_s) as resp:
                    body = resp.read().decode("utf-8")
                    return json.loads(body) if body else {}
            except HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                if e.code in {429, 500, 502, 503, 504} and attempt < self.retries:
                    time.sleep(min(2**attempt, 8))
                    attempt += 1
                    continue
                raise RuntimeError(f"ERP {method} {path} -> HTTP {e.code}: {body[:500]}") from None
            except URLError as e:
                if attempt < self.retries:
                    time.sleep(min(2**attempt, 8))
                    attempt += 1
                    continue
                raise RuntimeError(f"ERP {method} {path} -> network error: {e}") from None

    def iter_list(
        self,
        doctype: str,
        *,
        fields: list[str],
        filters: Optional[list[Any]] = None,
        order_by: Optional[str] = None,
        page_size: int = 500,
    ):
        start = 0
        while True:
            params: dict[str, Any] = {
                "fields": json.dumps(fields),
                "limit_start": start,
                "limit_page_length": int(page_size),
            }
            if filters is not None:
                params["filters"] = json.dumps(filters)
            if order_by:
                params["order_by"] = order_by
            rows = self._req_json("GET", f"/api/resource/{quote(doctype, safe='')}", params=params).get("data") or []
            if not rows:
                break
            for r in rows:
                yield dict(r)
            if len(rows) < int(page_size):
                break
            start += len(rows)

    def get_doc(self, doctype: str, name: str) -> dict[str, Any]:
        return dict(self._req_json("GET", f"/api/resource/{quote(doctype, safe='')}/{quote(name, safe='')}").get("data") or {})


def _invoice_issue(kind: str, inv: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
    out = {
        "kind": kind,
        "invoice": str(inv.get("name") or ""),
        "company": str(inv.get("company") or ""),
        "posting_date": str(inv.get("posting_date") or ""),
    }
    out.update(detail)
    return out


def _analyze_invoice(
    inv: dict[str, Any],
    erp: ErpClient,
    item_doc_cache: dict[str, dict[str, Any]],
    item_doc_lock: threading.Lock,
) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    item_risk_hits: Counter[str] = Counter()
    lines_checked = 0

    doc = erp.get_doc("Sales Invoice", str(inv.get("name") or ""))
    items = list(doc.get("items") or [])
    taxes = list(doc.get("taxes") or [])

    sum_net = Decimal("0")
    sum_tax = Decimal("0")

    for tx in taxes:
        tax = _to_dec(tx.get("tax_amount_after_discount_amount"))
        if tax == 0:
            tax = _to_dec(tx.get("tax_amount"))
        sum_tax += tax

    for idx, ln in enumerate(items, start=1):
        lines_checked += 1
        item_code = str(ln.get("item_code") or "").strip()
        uom = _norm_uom(ln.get("uom"))
        stock_uom = _norm_uom(ln.get("stock_uom"))
        qty = _to_dec(ln.get("qty"))
        stock_qty = _to_dec(ln.get("stock_qty"))
        conv = _to_dec(ln.get("conversion_factor"))
        rate = _to_dec(ln.get("rate"))
        amount = _to_dec(ln.get("amount"))
        net_rate = _to_dec(ln.get("net_rate"))
        net_amount = _to_dec(ln.get("net_amount"))
        sum_net += net_amount

        if conv <= 0:
            issues.append(
                _invoice_issue(
                    "line_invalid_conversion_factor",
                    inv,
                    {"line_idx": idx, "item_code": item_code, "uom": uom, "conversion_factor": str(conv)},
                )
            )
        else:
            expect_stock_qty = qty * conv
            if not _approx_eq(stock_qty, expect_stock_qty, TOL_QTY):
                issues.append(
                    _invoice_issue(
                        "line_stock_qty_mismatch",
                        inv,
                        {
                            "line_idx": idx,
                            "item_code": item_code,
                            "uom": uom,
                            "qty": str(qty),
                            "conversion_factor": str(conv),
                            "stock_qty": str(stock_qty),
                            "expected_stock_qty": str(expect_stock_qty),
                        },
                    )
                )

        replay_amount = rate * qty
        if not _approx_eq(amount, replay_amount, TOL_MONEY):
            issues.append(
                _invoice_issue(
                    "line_amount_mismatch",
                    inv,
                    {
                        "line_idx": idx,
                        "item_code": item_code,
                        "qty": str(qty),
                        "rate": str(rate),
                        "amount": str(amount),
                        "expected_amount": str(replay_amount),
                    },
                )
            )

        replay_net = net_rate * qty
        if not _approx_eq(net_amount, replay_net, TOL_MONEY):
            issues.append(
                _invoice_issue(
                    "line_net_amount_mismatch",
                    inv,
                    {
                        "line_idx": idx,
                        "item_code": item_code,
                        "qty": str(qty),
                        "net_rate": str(net_rate),
                        "net_amount": str(net_amount),
                        "expected_net_amount": str(replay_net),
                    },
                )
            )

        if not item_code:
            continue

        with item_doc_lock:
            item_doc = item_doc_cache.get(item_code)
        if item_doc is None:
            item_doc = erp.get_doc("Item", item_code)
            with item_doc_lock:
                item_doc_cache[item_code] = item_doc

        item_stock_uom = _norm_uom(item_doc.get("stock_uom"))
        if item_stock_uom and stock_uom and item_stock_uom != stock_uom:
            issues.append(
                _invoice_issue(
                    "line_stock_uom_vs_item_mismatch",
                    inv,
                    {
                        "line_idx": idx,
                        "item_code": item_code,
                        "line_stock_uom": stock_uom,
                        "item_stock_uom": item_stock_uom,
                    },
                )
            )

        uom_factor: dict[str, Decimal] = {}
        for u in (item_doc.get("uoms") or []):
            uc = _norm_uom(u.get("uom"))
            if not uc:
                continue
            f = _to_dec(u.get("conversion_factor"))
            if f > 0:
                uom_factor[uc] = f

        if item_stock_uom and item_stock_uom not in uom_factor:
            uom_factor[item_stock_uom] = Decimal("1")

        if uom and stock_uom and uom != stock_uom:
            expect_factor = uom_factor.get(uom)
            if expect_factor is None:
                issues.append(
                    _invoice_issue(
                        "missing_item_uom_conversion",
                        inv,
                        {
                            "line_idx": idx,
                            "item_code": item_code,
                            "uom": uom,
                            "stock_uom": stock_uom,
                            "line_conversion_factor": str(conv),
                        },
                    )
                )
                item_risk_hits[item_code] += 1
            elif not _approx_eq(conv, expect_factor, TOL_FACTOR):
                issues.append(
                    _invoice_issue(
                        "line_vs_item_conversion_mismatch",
                        inv,
                        {
                            "line_idx": idx,
                            "item_code": item_code,
                            "uom": uom,
                            "line_conversion_factor": str(conv),
                            "item_conversion_factor": str(expect_factor),
                        },
                    )
                )

            barcode_uoms = {
                _norm_uom(bc.get("uom"))
                for bc in (item_doc.get("barcodes") or [])
                if _norm_uom(bc.get("uom"))
            }
            if uom in barcode_uoms and uom not in uom_factor:
                issues.append(
                    _invoice_issue(
                        "barcode_uom_missing_conversion_risk",
                        inv,
                        {
                            "line_idx": idx,
                            "item_code": item_code,
                            "uom": uom,
                            "stock_uom": stock_uom,
                        },
                    )
                )
                item_risk_hits[item_code] += 1

    inv_net = _to_dec(doc.get("net_total"))
    inv_tax = _to_dec(doc.get("total_taxes_and_charges"))
    inv_grand = _to_dec(doc.get("grand_total"))

    if not _approx_eq(inv_net, sum_net, TOL_MONEY):
        issues.append(
            _invoice_issue(
                "invoice_net_total_mismatch",
                inv,
                {"invoice_net_total": str(inv_net), "sum_line_net_amount": str(sum_net)},
            )
        )

    if not _approx_eq(inv_tax, sum_tax, TOL_MONEY):
        issues.append(
            _invoice_issue(
                "invoice_tax_total_mismatch",
                inv,
                {"invoice_tax_total": str(inv_tax), "sum_tax_rows": str(sum_tax)},
            )
        )

    replay_grand = sum_net + sum_tax
    if not _approx_eq(inv_grand, replay_grand, TOL_MONEY):
        rounded_total = _to_dec(doc.get("rounded_total"))
        if not (rounded_total > 0 and _approx_eq(rounded_total, replay_grand, TOL_MONEY)):
            issues.append(
                _invoice_issue(
                    "invoice_grand_total_mismatch",
                    inv,
                    {"invoice_grand_total": str(inv_grand), "replay_grand_total": str(replay_grand)},
                )
            )

    return {
        "invoice": str(inv.get("name") or ""),
        "company": str(inv.get("company") or ""),
        "posting_date": str(inv.get("posting_date") or ""),
        "currency": str(inv.get("currency") or ""),
        "lines_checked": lines_checked,
        "issues": issues,
        "item_risk_hits": dict(item_risk_hits),
    }


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--erp-base", default=os.getenv("ERPNEXT_BASE_URL") or "https://erp.ahagetrading.com")
    ap.add_argument("--api-key", default=os.getenv("ERPNEXT_API_KEY") or "")
    ap.add_argument("--api-secret", default=os.getenv("ERPNEXT_API_SECRET") or "")
    ap.add_argument(
        "--companies",
        default="Antoine Hage Trading,UNDISCLOSED COMPANY",
        help="Comma-separated ERPNext company names",
    )
    ap.add_argument("--since", default="", help="Optional posting_date >= YYYY-MM-DD")
    ap.add_argument("--until", default="", help="Optional posting_date <= YYYY-MM-DD")
    ap.add_argument("--max-invoices", type=int, default=0, help="Optional cap for debugging; 0 means all")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--max-examples", type=int, default=30)
    ap.add_argument("--out-json", default=".cache/erpnext_sales_invoice_pos_replay_report.json")
    return ap.parse_args()


def main() -> int:
    args = _parse_args()
    companies = [x.strip() for x in str(args.companies or "").split(",") if x.strip()]
    if not companies:
        print("error: --companies is empty", file=sys.stderr)
        return 2
    if not args.api_key or not args.api_secret:
        print("error: missing ERP credentials (ERPNEXT_API_KEY / ERPNEXT_API_SECRET)", file=sys.stderr)
        return 2

    erp = ErpClient(str(args.erp_base), str(args.api_key), str(args.api_secret))

    filters: list[Any] = [["docstatus", "=", 1], ["company", "in", companies]]
    if args.since:
        filters.append(["posting_date", ">=", str(args.since)])
    if args.until:
        filters.append(["posting_date", "<=", str(args.until)])

    headers: list[dict[str, Any]] = list(
        erp.iter_list(
            "Sales Invoice",
            fields=["name", "company", "posting_date", "currency", "docstatus", "status", "grand_total", "net_total", "total_taxes_and_charges"],
            filters=filters,
            order_by="posting_date asc, name asc",
            page_size=500,
        )
    )

    if args.max_invoices and int(args.max_invoices) > 0:
        headers = headers[: int(args.max_invoices)]

    total_invoices = len(headers)
    if total_invoices == 0:
        print("No invoices found for the provided filters.")
        return 0

    item_doc_cache: dict[str, dict[str, Any]] = {}
    item_doc_lock = threading.Lock()

    issue_counts: Counter[str] = Counter()
    issue_examples: dict[str, list[dict[str, Any]]] = defaultdict(list)
    company_counts: Counter[str] = Counter()
    company_with_issues: Counter[str] = Counter()
    risky_item_counts: Counter[str] = Counter()
    total_lines_checked = 0
    invoices_with_issues = 0
    failed_invoices: list[dict[str, str]] = []

    workers = max(1, min(int(args.workers or 8), 32))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        fut_map = {
            ex.submit(_analyze_invoice, inv, erp, item_doc_cache, item_doc_lock): inv
            for inv in headers
        }
        done = 0
        for fut in as_completed(fut_map):
            inv = fut_map[fut]
            done += 1
            company = str(inv.get("company") or "")
            company_counts[company] += 1
            try:
                r = fut.result()
            except Exception as e:
                failed_invoices.append(
                    {
                        "invoice": str(inv.get("name") or ""),
                        "company": company,
                        "error": str(e),
                    }
                )
                continue

            total_lines_checked += int(r.get("lines_checked") or 0)
            issues = list(r.get("issues") or [])
            if issues:
                invoices_with_issues += 1
                company_with_issues[company] += 1
            for isx in issues:
                kind = str(isx.get("kind") or "unknown")
                issue_counts[kind] += 1
                if len(issue_examples[kind]) < int(args.max_examples or 30):
                    issue_examples[kind].append(isx)

            for sku, cnt in dict(r.get("item_risk_hits") or {}).items():
                risky_item_counts[str(sku)] += int(cnt or 0)

            if done % 100 == 0 or done == total_invoices:
                print(f"progress: {done}/{total_invoices} invoices analyzed", file=sys.stderr)

    report = {
        "ok": len(failed_invoices) == 0,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "erp_base": args.erp_base,
        "filters": {
            "companies": companies,
            "since": args.since or None,
            "until": args.until or None,
            "docstatus": 1,
        },
        "totals": {
            "invoices_scanned": total_invoices,
            "invoices_with_issues": invoices_with_issues,
            "lines_scanned": total_lines_checked,
            "failed_invoice_fetches": len(failed_invoices),
            "distinct_issue_types": len(issue_counts),
            "item_docs_cached": len(item_doc_cache),
        },
        "by_company": [
            {
                "company": c,
                "invoices_scanned": int(company_counts[c]),
                "invoices_with_issues": int(company_with_issues[c]),
            }
            for c in sorted(company_counts.keys())
        ],
        "issue_counts": dict(issue_counts),
        "top_risky_items": [
            {"item_code": sku, "hits": int(cnt)}
            for sku, cnt in risky_item_counts.most_common(50)
        ],
        "issue_examples": dict(issue_examples),
        "failed_invoices": failed_invoices[:200],
    }

    out_path = Path(str(args.out_json))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(report["totals"], indent=2))
    print(f"report_json={out_path}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

