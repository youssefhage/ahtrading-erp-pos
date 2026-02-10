#!/usr/bin/env python3
"""
Import ERPNext CSV exports into a running Melqard (cloud) API via HTTPS.

Why this exists:
- When you're not at the office, you can still import realistic data into the cloud pilot
  without needing DB access or an on-prem Edge PC.
- Uses existing bulk endpoints for customers/items/suppliers + opening-stock import.

Expected folder structure (default: ./Data AH Trading):
- Customer_cleaned.csv
- Supplier_cleaned.csv
- Item_cleaned.csv
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
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, build_opener, HTTPCookieProcessor
import http.cookiejar


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _norm(v: Any) -> str:
    return str(v or "").strip()


def _to_decimal(v: Any) -> Decimal:
    s = _norm(v)
    if not s:
        return Decimal("0")
    try:
        return Decimal(s)
    except Exception:
        return Decimal("0")


def _to_bool01(v: Any) -> bool:
    s = _norm(v).lower()
    return s in {"1", "true", "yes", "y"}


def _header_index(header: list[str]) -> dict[str, int]:
    # ERPNext export sometimes contains duplicate column names. We only record the
    # first occurrence of each header label.
    idx: dict[str, int] = {}
    for i, h in enumerate(header):
        k = (h or "").strip()
        if not k or k in idx:
            continue
        idx[k] = i
    return idx


def _chunks(seq, n: int):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


@dataclass(frozen=True)
class ImportPaths:
    customers_csv: Path
    suppliers_csv: Path
    items_csv: Path


def _paths(data_dir: Path) -> ImportPaths:
    return ImportPaths(
        customers_csv=data_dir / "Customer_cleaned.csv",
        suppliers_csv=data_dir / "Supplier_cleaned.csv",
        items_csv=data_dir / "Item_cleaned.csv",
    )


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/") + "/"
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))

    def _req(self, method: str, path: str, body: Optional[dict] = None, headers: Optional[dict] = None) -> Any:
        url = urljoin(self.base_url, path.lstrip("/"))
        data = None
        hdrs = {"Content-Type": "application/json"}
        if headers:
            hdrs.update(headers)
        if body is not None:
            data = json.dumps(body, default=str).encode("utf-8")
        req = Request(url=url, method=method.upper(), data=data, headers=hdrs)
        try:
            with self.opener.open(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8") if resp is not None else ""
                return json.loads(raw) if raw else {}
        except HTTPError as e:
            raw = ""
            try:
                raw = e.read().decode("utf-8")
            except Exception:
                raw = ""
            try:
                detail = json.loads(raw).get("detail") if raw else None
            except Exception:
                detail = raw or None
            raise RuntimeError(f"{method} {url} -> HTTP {e.code}: {detail}") from None
        except URLError as e:
            raise RuntimeError(f"{method} {url} -> network error: {e}") from None

    def login(self, email: str, password: str) -> None:
        self._req("POST", "/auth/login", {"email": email, "password": password})

    def get_companies(self) -> list[dict]:
        res = self._req("GET", "/companies")
        return list(res.get("companies") or [])

    def list_warehouses(self, company_id: str) -> list[dict]:
        res = self._req("GET", "/warehouses", headers={"X-Company-Id": company_id})
        return list(res.get("warehouses") or [])

    def post_bulk_customers(self, company_id: str, customers: list[dict]) -> dict:
        return self._req("POST", "/customers/bulk", {"customers": customers}, headers={"X-Company-Id": company_id})

    def post_bulk_suppliers(self, company_id: str, suppliers: list[dict]) -> dict:
        return self._req("POST", "/suppliers/bulk", {"suppliers": suppliers}, headers={"X-Company-Id": company_id})

    def post_bulk_items(self, company_id: str, items: list[dict]) -> dict:
        return self._req("POST", "/items/bulk", {"items": items}, headers={"X-Company-Id": company_id})

    def post_bulk_prices(self, company_id: str, effective_from: date, lines: list[dict]) -> dict:
        return self._req(
            "POST",
            "/items/prices/bulk",
            {"effective_from": effective_from.isoformat(), "lines": lines},
            headers={"X-Company-Id": company_id},
        )

    def import_opening_stock(self, company_id: str, warehouse_id: str, import_id: str, lines: list[dict]) -> dict:
        return self._req(
            "POST",
            "/inventory/opening-stock/import",
            {"import_id": import_id, "warehouse_id": warehouse_id, "posting_date": date.today().isoformat(), "lines": lines},
            headers={"X-Company-Id": company_id},
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", required=True, help="Cloud API base URL (example: https://api.melqard.com)")
    ap.add_argument("--email", default=os.getenv("MELQARD_ADMIN_EMAIL") or "")
    ap.add_argument("--password", default=os.getenv("MELQARD_ADMIN_PASSWORD") or "")
    ap.add_argument("--data-dir", default="Data AH Trading")
    ap.add_argument("--skip-opening-stock", action="store_true", help="Skip opening stock import")
    ap.add_argument("--skip-suppliers", action="store_true")
    ap.add_argument("--chunk", type=int, default=1000)
    args = ap.parse_args()

    if not args.email or not args.password:
        _die("missing admin credentials: pass --email/--password or set MELQARD_ADMIN_EMAIL/MELQARD_ADMIN_PASSWORD")

    data_dir = Path(args.data_dir)
    p = _paths(data_dir)
    for fp in [p.customers_csv, p.suppliers_csv, p.items_csv]:
        if not fp.exists():
            _die(f"missing file: {fp}")

    api = ApiClient(args.api_base)
    print("[1/6] Login...")
    api.login(args.email, args.password)

    print("[2/6] Resolve companies...")
    companies = api.get_companies()
    by_name = {str(c.get("name") or ""): str(c.get("id") or "") for c in companies}
    official_id = by_name.get("AH Trading Official") or ""
    unofficial_id = by_name.get("AH Trading Unofficial") or ""
    if not official_id or not unofficial_id:
        _die("missing required companies in cloud: AH Trading Official / AH Trading Unofficial")

    # Company mapping from ERPNext CSV.
    alias = {
        "Antoine Hage Trading": official_id,
        "UNDISCLOSED COMPANY": unofficial_id,
        "ACOUNTING COMPANY": official_id,
    }

    print("[3/6] Import customers (shared -> both companies)...")
    customers: list[dict] = []
    with p.customers_csv.open(newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r, None)
        if not header:
            _die(f"empty csv: {p.customers_csv}")
        idx = _header_index([str(h) for h in header])
        for k in ["ID", "Customer Name"]:
            if k not in idx:
                _die(f"missing column '{k}' in {p.customers_csv}")
        for row in r:
            code = _norm(row[idx["ID"]])
            name = _norm(row[idx["Customer Name"]])
            if not name:
                continue
            cust_type = _norm(row[idx.get("Customer Type", -1)]) if "Customer Type" in idx else ""
            party_type = "business" if cust_type.lower() == "company" else "individual"
            disabled = _to_bool01(row[idx.get("Disabled", -1)]) if "Disabled" in idx else False
            customers.append(
                {
                    "code": code or None,
                    "name": name,
                    "phone": _norm(row[idx.get("Mobile No", -1)]) if "Mobile No" in idx else None,
                    "email": _norm(row[idx.get("Email Id", -1)]) if "Email Id" in idx else None,
                    "tax_id": _norm(row[idx.get("Tax ID", -1)]) if "Tax ID" in idx else None,
                    "party_type": party_type,
                    "is_active": not disabled,
                }
            )

    for cid, label in [(official_id, "official"), (unofficial_id, "unofficial")]:
        for chunk in _chunks(customers, int(args.chunk or 1000)):
            api.post_bulk_customers(cid, chunk)
        print(f"  - customers imported to {label}: {len(customers)}")

    if not args.skip_suppliers:
        print("[4/6] Import suppliers (-> official)...")
        suppliers: list[dict] = []
        with p.suppliers_csv.open(newline="", encoding="utf-8") as f:
            r = csv.reader(f)
            header = next(r, None)
            if not header:
                _die(f"empty csv: {p.suppliers_csv}")
            idx = _header_index([str(h) for h in header])
            for k in ["ID", "Supplier Name"]:
                if k not in idx:
                    _die(f"missing column '{k}' in {p.suppliers_csv}")
            for row in r:
                code = _norm(row[idx["ID"]])
                name = _norm(row[idx["Supplier Name"]])
                if not name:
                    continue
                disabled = _to_bool01(row[idx.get("Disabled", -1)]) if "Disabled" in idx else False
                suppliers.append(
                    {
                        "code": code or None,
                        "name": name,
                        "party_type": "business",
                        "phone": _norm(row[idx.get("Mobile No", -1)]) if "Mobile No" in idx else None,
                        "email": _norm(row[idx.get("Email Id", -1)]) if "Email Id" in idx else None,
                        "tax_id": _norm(row[idx.get("Tax ID", -1)]) if "Tax ID" in idx else None,
                        "is_active": not disabled,
                    }
                )
        for chunk in _chunks(suppliers, int(args.chunk or 1000)):
            api.post_bulk_suppliers(official_id, chunk)
        print(f"  - suppliers imported: {len(suppliers)}")

    print("[5/6] Import items + prices...")
    items_by_company: dict[str, list[dict]] = {official_id: [], unofficial_id: []}
    prices_by_company: dict[str, list[dict]] = {official_id: [], unofficial_id: []}
    opening_by_company: dict[str, list[dict]] = {official_id: [], unofficial_id: []}

    with p.items_csv.open(newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r, None)
        if not header:
            _die(f"empty csv: {p.items_csv}")
        idx = _header_index([str(h) for h in header])
        for k in ["ID", "Item Name", "Default Unit of Measure"]:
            if k not in idx:
                _die(f"missing column '{k}' in {p.items_csv}")

        c_company = idx.get("Company")
        c_uom = idx.get("Default Unit of Measure")
        c_barcode = idx.get("Barcode")
        c_price = idx.get("Standard Selling Rate")
        c_opening = idx.get("Opening Stock")
        c_val = idx.get("Valuation Rate")

        for row in r:
            sku = _norm(row[idx["ID"]])
            name = _norm(row[idx["Item Name"]])
            if not sku or not name:
                continue

            row_company = _norm(row[c_company]) if c_company is not None else ""
            target_company = alias.get(row_company, official_id)

            uom = _norm(row[c_uom]) if c_uom is not None else "EA"
            uom = (uom or "EA").strip().upper()[:32]
            barcode = _norm(row[c_barcode]) if c_barcode is not None else ""
            barcode = barcode or None

            items_by_company[target_company].append(
                {
                    "sku": sku,
                    "name": name,
                    "unit_of_measure": uom,
                    "barcode": barcode,
                }
            )

            # Price import (USD only for now; LBP can be derived by exchange rate in POS).
            price_usd = _to_decimal(row[c_price]) if c_price is not None else Decimal("0")
            if price_usd > 0:
                prices_by_company[target_company].append({"sku": sku, "price_usd": str(price_usd), "price_lbp": "0"})

            # Opening stock import.
            if not args.skip_opening_stock:
                qty = _to_decimal(row[c_opening]) if c_opening is not None else Decimal("0")
                if qty > 0:
                    unit_cost_usd = _to_decimal(row[c_val]) if c_val is not None else Decimal("0")
                    opening_by_company[target_company].append(
                        {
                            "sku": sku,
                            "qty": str(qty),
                            "unit_cost_usd": str(unit_cost_usd if unit_cost_usd > 0 else Decimal("0")),
                            "unit_cost_lbp": "0",
                        }
                    )

    # Upsert items first (needed before prices/opening stock).
    for cid, label in [(official_id, "official"), (unofficial_id, "unofficial")]:
        items = items_by_company[cid]
        for chunk in _chunks(items, 5000):
            api.post_bulk_items(cid, chunk)
        print(f"  - items upserted ({label}): {len(items)}")

        prices = prices_by_company[cid]
        for chunk in _chunks(prices, 5000):
            api.post_bulk_prices(cid, date.today(), chunk)
        print(f"  - prices upserted ({label}): {len(prices)}")

    if not args.skip_opening_stock:
        print("[6/6] Import opening stock...")
        for cid, label in [(official_id, "official"), (unofficial_id, "unofficial")]:
            whs = api.list_warehouses(cid)
            wh = next((w for w in whs if str(w.get("name") or "") == "Main Warehouse"), None) or (whs[0] if whs else None)
            if not wh:
                _die(f"no warehouse found for {label}")
            warehouse_id = str(wh.get("id") or "")
            lines = opening_by_company[cid]
            if not lines:
                print(f"  - opening stock ({label}): 0 lines (skipped)")
                continue
            # Deterministic UUID-ish tag (backend validates UUID format). We'll use a stable string per day/company.
            import_id = f"00000000-0000-0000-0000-{cid.replace('-', '')[:12]}"
            res = api.import_opening_stock(cid, warehouse_id, import_id, lines)
            print(f"  - opening stock ({label}): {len(lines)} lines (already_applied={bool(res.get('already_applied'))})")

    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

