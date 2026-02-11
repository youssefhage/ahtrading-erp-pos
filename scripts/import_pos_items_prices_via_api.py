#!/usr/bin/env python3
"""
Import items + prices into the POS API from a CSV produced by export_erpnext_pos_import_csv.py.

Default flow (local dev):
1) Start the API (docker compose up)
2) Login with BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
3) Upsert items via POST /items/bulk
4) Upsert prices via POST /items/prices/bulk (effective_from=today)

CSV columns expected:
  sku,name,unit_of_measure,tax_code,standard_cost_usd,price_usd

Notes:
- Prices are stored in item_prices (not on the item row).
- Item upsert preserves existing costs when the CSV cost is blank (API uses COALESCE).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _to_decimal_or_none(v: Any) -> Optional[Decimal]:
    try:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        d = Decimal(s)
        return d
    except (InvalidOperation, ValueError):
        return None


def _chunks(xs: list, n: int):
    for i in range(0, len(xs), n):
        yield xs[i : i + n]


@dataclass(frozen=True)
class ApiClient:
    api_base: str
    token: str
    timeout_s: int = 60

    def req_json(self, method: str, path: str, payload: Any | None = None) -> dict:
        url = self.api_base.rstrip("/") + path
        data = None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "User-Agent": "codex-pos-import/1.0",
        }
        if payload is not None:
            data = json.dumps(payload, default=str).encode("utf-8")
        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=self.timeout_s) as resp:
                body = resp.read().decode("utf-8")
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {e.code} {path}: {body[:500]}") from None
        return json.loads(body) if body else {}


def login(api_base: str, email: str, password: str) -> tuple[str, Optional[str]]:
    url = api_base.rstrip("/") + "/auth/login"
    payload = {"email": email, "password": password}
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=data,
        headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "codex-pos-import/1.0"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"login failed HTTP {e.code}: {body[:500]}") from None
    j = json.loads(body) if body else {}
    if j.get("mfa_required"):
        _die("MFA is enabled for this user; use a non-MFA admin or implement /auth/mfa/verify in this script")
    token = str(j.get("token") or "").strip()
    if not token:
        _die("login succeeded but no token returned")
    return token, (str(j.get("active_company_id")) if j.get("active_company_id") else None)


def select_company(cli: ApiClient, company_name: str) -> str:
    res = cli.req_json("GET", "/companies")
    companies = list(res.get("companies") or [])
    if not companies:
        _die("no companies returned by /companies (does this user have any roles?)")
    target = None
    for c in companies:
        if str(c.get("name") or "").strip().lower() == company_name.strip().lower():
            target = c
            break
    if not target:
        names = ", ".join(sorted({str(c.get("name") or "").strip() for c in companies if str(c.get("name") or "").strip()}))
        _die(f"company not found: {company_name}. Available: {names}")
    cid = str(target.get("id") or "").strip()
    if not cid:
        _die("company missing id")
    cli.req_json("POST", "/auth/select-company", {"company_id": cid})
    return cid


def wait_for_health(api_base: str, timeout_s: int = 90) -> None:
    url = api_base.rstrip("/") + "/health"
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            req = Request(url, headers={"Accept": "application/json", "User-Agent": "codex-pos-import/1.0"}, method="GET")
            with urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(1)
    _die(f"API health check timed out: {url}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default=os.getenv("POS_API_BASE_URL") or os.getenv("API_BASE_URL") or "http://localhost:8001")
    ap.add_argument("--email", default=os.getenv("BOOTSTRAP_ADMIN_EMAIL") or "admin@ahtrading.local")
    ap.add_argument("--password", default=os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or "change-me")
    ap.add_argument("--company-name", default=os.getenv("POS_COMPANY_NAME") or "", help="Optional: pick company by name")
    ap.add_argument("--csv", default="Data AH Trading/erpnext_pos_items_prices.csv")
    ap.add_argument("--items-chunk", type=int, default=2000)
    ap.add_argument("--prices-chunk", type=int, default=2000)
    ap.add_argument(
        "--sample-sku",
        default=os.getenv("POS_IMPORT_SAMPLE_SKU") or "",
        help="Optional: SKU to spot-check after import. Defaults to the first imported SKU.",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    csv_path = str(args.csv)
    if not os.path.exists(csv_path):
        _die(f"CSV not found: {csv_path}")

    wait_for_health(str(args.api_base))
    token, active_company_id = login(str(args.api_base), str(args.email), str(args.password))
    cli = ApiClient(api_base=str(args.api_base), token=token)

    if str(args.company_name or "").strip():
        active_company_id = select_company(cli, str(args.company_name))

    if not active_company_id:
        # Not fatal as long as the session has a company; but most endpoints require one.
        # This is a useful hint if the user has no roles.
        print("warn: active_company_id is empty; requests may fail unless you pass X-Company-Id elsewhere", file=sys.stderr)

    # Read CSV.
    items_payload: list[dict] = []
    prices_payload: list[dict] = []
    missing_required = 0

    with open(csv_path, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            sku = (row.get("sku") or "").strip()
            name = (row.get("name") or "").strip()
            uom = (row.get("unit_of_measure") or "").strip()
            if not sku or not name or not uom:
                missing_required += 1
                continue

            cost = _to_decimal_or_none(row.get("standard_cost_usd"))
            price = _to_decimal_or_none(row.get("price_usd"))

            items_payload.append(
                {
                    "sku": sku,
                    "name": name,
                    "unit_of_measure": uom,
                    "barcode": None,
                    "tax_code_name": None,
                    "reorder_point": 0,
                    "reorder_qty": 0,
                    "standard_cost_usd": (str(cost) if cost is not None and cost > 0 else None),
                    "standard_cost_lbp": None,
                }
            )

            if price is not None and price > 0:
                prices_payload.append(
                    {
                        "sku": sku,
                        "price_usd": str(price),
                        "price_lbp": "0",
                    }
                )

    if missing_required:
        print(f"warn: skipped {missing_required} CSV rows missing sku/name/unit_of_measure", file=sys.stderr)

    # If the user didn't specify a SKU to verify, pick the first imported SKU (if any).
    sample_sku_used = (str(args.sample_sku or "").strip() or (str(items_payload[0].get("sku")).strip() if items_payload else ""))
    if not sample_sku_used:
        sample_sku_used = None

    if args.dry_run:
        print(
            json.dumps(
                {
                    "ok": True,
                    "dry_run": True,
                    "api_base": str(args.api_base),
                    "csv": csv_path,
                    "items": len(items_payload),
                    "prices": len(prices_payload),
                    "effective_from": date.today().isoformat(),
                    "sample_sku": sample_sku_used,
                    "sample_sku_used": sample_sku_used,
                },
                indent=2,
            )
        )
        return 0

    # Upsert items.
    upserted_items = 0
    for batch in _chunks(items_payload, int(args.items_chunk)):
        cli.req_json("POST", "/items/bulk", {"items": batch})
        upserted_items += len(batch)

    # Upsert prices (effective today).
    eff = date.today().isoformat()
    upserted_prices = 0
    for batch in _chunks(prices_payload, int(args.prices_chunk)):
        cli.req_json("POST", "/items/prices/bulk", {"effective_from": eff, "lines": batch})
        upserted_prices += len(batch)

    # Basic verification: fetch items count and spot-check one SKU if present.
    inv = cli.req_json("GET", "/items/min?include_inactive=true")
    items_min = list(inv.get("items") or [])
    sample = None
    if sample_sku_used:
        sample = next((x for x in items_min if str(x.get("sku")) == sample_sku_used), None)
    sample_price_rows = None
    if sample and sample.get("id"):
        sample_price_rows = cli.req_json("GET", f"/items/{sample['id']}/prices").get("prices")

    print(
        json.dumps(
            {
                "ok": True,
                "api_base": str(args.api_base),
                "csv": csv_path,
                "effective_from": eff,
                "items_sent": len(items_payload),
                "prices_sent": len(prices_payload),
                "items_upserted": upserted_items,
                "prices_upserted": upserted_prices,
                "items_min_count": len(items_min),
                "sample_sku": sample_sku_used,
                "sample_sku_used": sample_sku_used,
                "sample_item_found": bool(sample),
                "sample_prices_count": (len(sample_price_rows) if isinstance(sample_price_rows, list) else None),
            },
            indent=2,
        )
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
