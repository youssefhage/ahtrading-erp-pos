#!/usr/bin/env python3
"""
Import master data into the POS API from CSVs produced by export_erpnext_pos_masterdata.py.

Imports (in order):
0) customers (bulk upsert; optional)
0) suppliers (bulk upsert; optional)
1) tax codes (ensures tax_code names exist)
2) item categories (creates by name)
3) items (bulk upsert)
4) category assignment by sku (bulk)
5) UOM conversions (bulk)
6) barcodes (bulk)
7) prices (bulk; effective today)
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
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _to_decimal_or_zero(v: Any) -> Decimal:
    try:
        s = str(v or "").strip()
        if not s:
            return Decimal("0")
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _chunks(xs: list, n: int):
    for i in range(0, len(xs), n):
        yield xs[i : i + n]


@dataclass(frozen=True)
class ApiClient:
    api_base: str
    token: str
    timeout_s: int = 60
    max_retries: int = 5

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
        attempt = 0
        while True:
            req = Request(url, data=data, headers=headers, method=method)
            try:
                with urlopen(req, timeout=self.timeout_s) as resp:
                    body = resp.read().decode("utf-8")
                    return json.loads(body) if body else {}
            except HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                # Retry common transient server/rate-limit failures.
                if e.code in {429, 500, 502, 503, 504} and attempt < self.max_retries:
                    time.sleep(min(2 ** attempt, 10))
                    attempt += 1
                    continue
                raise RuntimeError(f"HTTP {e.code} {path}: {body[:800]}") from None
            except URLError as e:
                if attempt < self.max_retries:
                    time.sleep(min(2 ** attempt, 10))
                    attempt += 1
                    continue
                raise RuntimeError(f"network error {path}: {e}") from None


def wait_for_health(api_base: str, timeout_s: int = 90) -> None:
    url = api_base.rstrip("/") + "/health"
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            req = Request(url, headers={"Accept": "application/json"}, method="GET")
            with urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(1)
    _die(f"API health check timed out: {url}")


def login(api_base: str, email: str, password: str) -> tuple[str, Optional[str]]:
    url = api_base.rstrip("/") + "/auth/login"
    payload = {"email": email, "password": password}
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"login failed HTTP {e.code}: {body[:800]}") from None
    j = json.loads(body) if body else {}
    if j.get("mfa_required"):
        _die("MFA is enabled for this user; use a non-MFA admin")
    token = str(j.get("token") or "").strip()
    if not token:
        _die("login succeeded but no token returned")
    return token, (str(j.get("active_company_id")) if j.get("active_company_id") else None)


def select_company(cli: ApiClient, company_name: str) -> str:
    res = cli.req_json("GET", "/companies")
    companies = list(res.get("companies") or [])
    if not companies:
        _die("no companies returned by /companies")
    target = next((c for c in companies if str(c.get("name") or "").strip().lower() == company_name.strip().lower()), None)
    if not target:
        names = ", ".join(sorted({str(c.get("name") or "").strip() for c in companies if str(c.get("name") or "").strip()}))
        _die(f"company not found: {company_name}. Available: {names}")
    cid = str(target.get("id") or "").strip()
    cli.req_json("POST", "/auth/select-company", {"company_id": cid})
    return cid


def ensure_tax_codes(cli: ApiClient, item_rows: list[dict]) -> int:
    # Map common ERPNext templates to rates (fallback parse "11%" -> 0.11).
    existing = cli.req_json("GET", "/config/tax-codes").get("tax_codes") or []
    existing_by_name = {str(t.get("name") or "").strip(): t for t in existing}

    needed = sorted({str(r.get("tax_code") or "").strip() for r in item_rows if str(r.get("tax_code") or "").strip()})
    created = 0
    for name in needed:
        if name in existing_by_name:
            continue
        rate = None
        if name.endswith("%"):
            try:
                rate = Decimal(name[:-1].strip()) / Decimal("100")
            except Exception:
                rate = None
        if rate is None:
            continue
        cli.req_json(
            "POST",
            "/config/tax-codes",
            {"name": name, "rate": str(rate), "tax_type": "vat", "reporting_currency": "LBP"},
        )
        created += 1
    return created


def ensure_categories(cli: ApiClient, category_rows: list[dict]) -> dict[str, str]:
    res = cli.req_json("GET", "/item-categories")
    existing = list(res.get("categories") or [])
    by_name = {str(c.get("name") or "").strip(): str(c.get("id")) for c in existing if str(c.get("name") or "").strip()}

    # No parent support yet (we export blank parent_name by default).
    for row in category_rows:
        name = str(row.get("name") or "").strip()
        if not name or name in by_name:
            continue
        cid = cli.req_json("POST", "/item-categories", {"name": name, "parent_id": None, "is_active": True}).get("id")
        if cid:
            by_name[name] = str(cid)
    return by_name


def read_csv_dict(path: str) -> list[dict]:
    if not path:
        return []
    if not os.path.exists(path):
        _die(f"CSV not found: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        return [dict(row) for row in r]


def read_csv_dict_if_exists(path: str) -> list[dict]:
    if not path:
        return []
    if not os.path.exists(path):
        return []
    return read_csv_dict(path)


def _to_int_or_none(v: Any) -> Optional[int]:
    s = str(v or "").strip()
    if not s:
        return None
    try:
        return int(s)
    except Exception:
        return None


def _to_bool_or_none(v: Any) -> Optional[bool]:
    s = str(v or "").strip().lower()
    if not s:
        return None
    if s in {"1", "true", "yes", "y"}:
        return True
    if s in {"0", "false", "no", "n"}:
        return False
    return None


def bulk_upsert_customers(cli: ApiClient, rows: list[dict], chunk: int) -> int:
    if not rows:
        return 0
    up = 0
    for batch in _chunks(rows, chunk):
        payload = []
        for r in batch:
            code = str(r.get("code") or "").strip()
            name = str(r.get("name") or "").strip()
            if not code or not name:
                continue
            payload.append(
                {
                    "code": code,
                    "name": name,
                    "party_type": str(r.get("party_type") or "individual").strip() or "individual",
                    "customer_type": str(r.get("customer_type") or "retail").strip() or "retail",
                    "phone": (str(r.get("phone") or "").strip() or None),
                    "email": (str(r.get("email") or "").strip() or None),
                    "tax_id": (str(r.get("tax_id") or "").strip() or None),
                    "vat_no": (str(r.get("vat_no") or "").strip() or None),
                    "payment_terms_days": _to_int_or_none(r.get("payment_terms_days")),
                    "is_active": _to_bool_or_none(r.get("is_active")),
                }
            )
        if not payload:
            continue
        res = cli.req_json("POST", "/customers/bulk", {"customers": payload})
        up += int(res.get("upserted") or len(payload))
    return up


def bulk_upsert_suppliers(cli: ApiClient, rows: list[dict], chunk: int) -> int:
    if not rows:
        return 0
    up = 0
    for batch in _chunks(rows, chunk):
        payload = []
        for r in batch:
            code = str(r.get("code") or "").strip()
            name = str(r.get("name") or "").strip()
            if not code or not name:
                continue
            payload.append(
                {
                    "code": code,
                    "name": name,
                    "party_type": str(r.get("party_type") or "business").strip() or "business",
                    "phone": (str(r.get("phone") or "").strip() or None),
                    "email": (str(r.get("email") or "").strip() or None),
                    "tax_id": (str(r.get("tax_id") or "").strip() or None),
                    "vat_no": (str(r.get("vat_no") or "").strip() or None),
                    "payment_terms_days": _to_int_or_none(r.get("payment_terms_days")),
                    "is_active": _to_bool_or_none(r.get("is_active")),
                }
            )
        if not payload:
            continue
        res = cli.req_json("POST", "/suppliers/bulk", {"suppliers": payload})
        up += int(res.get("upserted") or len(payload))
    return up


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default=os.getenv("POS_API_BASE_URL") or "http://localhost:8001")
    ap.add_argument("--email", default=os.getenv("BOOTSTRAP_ADMIN_EMAIL") or "admin@ahtrading.local")
    ap.add_argument("--password", default=os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or "change-me")
    ap.add_argument("--company-name", default=os.getenv("POS_COMPANY_NAME") or "")
    ap.add_argument("--dir", default="Data AH Trading")
    ap.add_argument("--customers", default="")
    ap.add_argument("--suppliers", default="")
    ap.add_argument("--items", default="")
    ap.add_argument("--prices", default="")
    ap.add_argument("--uoms", default="")
    ap.add_argument("--barcodes", default="")
    ap.add_argument("--categories", default="")
    ap.add_argument("--chunk", type=int, default=2000)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base_dir = str(args.dir)
    customers_csv = str(args.customers or os.path.join(base_dir, "erpnext_pos_customers.csv"))
    suppliers_csv = str(args.suppliers or os.path.join(base_dir, "erpnext_pos_suppliers.csv"))
    items_csv = str(args.items or os.path.join(base_dir, "erpnext_pos_items.csv"))
    prices_csv = str(args.prices or os.path.join(base_dir, "erpnext_pos_prices.csv"))
    uoms_csv = str(args.uoms or os.path.join(base_dir, "erpnext_pos_uom_conversions.csv"))
    barcodes_csv = str(args.barcodes or os.path.join(base_dir, "erpnext_pos_barcodes.csv"))
    categories_csv = str(args.categories or os.path.join(base_dir, "erpnext_pos_categories.csv"))

    wait_for_health(str(args.api_base))
    token, _active_company_id = login(str(args.api_base), str(args.email), str(args.password))
    cli = ApiClient(api_base=str(args.api_base), token=token)
    if str(args.company_name or "").strip():
        select_company(cli, str(args.company_name))

    customers_rows = read_csv_dict_if_exists(customers_csv)
    suppliers_rows = read_csv_dict_if_exists(suppliers_csv)
    items_rows = read_csv_dict(items_csv)
    prices_rows = read_csv_dict(prices_csv)
    uoms_rows = read_csv_dict(uoms_csv)
    barcodes_rows = read_csv_dict(barcodes_csv)
    categories_rows = read_csv_dict(categories_csv)

    if args.dry_run:
        print(
            json.dumps(
                {
                    "ok": True,
                    "dry_run": True,
                    "api_base": str(args.api_base),
                    "customers": len(customers_rows),
                    "suppliers": len(suppliers_rows),
                    "items": len(items_rows),
                    "prices": len(prices_rows),
                    "uoms": len(uoms_rows),
                    "barcodes": len(barcodes_rows),
                    "categories": len(categories_rows),
                },
                indent=2,
            )
        )
        return 0

    up_customers = bulk_upsert_customers(cli, customers_rows, int(args.chunk))
    up_suppliers = bulk_upsert_suppliers(cli, suppliers_rows, int(args.chunk))

    created_tax = ensure_tax_codes(cli, items_rows)
    cats = ensure_categories(cli, categories_rows)

    # Upsert items.
    items_payload = []
    category_assign = []
    for r in items_rows:
        sku = str(r.get("sku") or "").strip()
        name = str(r.get("name") or "").strip()
        uom = str(r.get("unit_of_measure") or "").strip() or "EA"
        tax = str(r.get("tax_code") or "").strip() or None
        cost = str(r.get("standard_cost_usd") or "").strip()
        cat = str(r.get("category_name") or "").strip()
        items_payload.append(
            {
                "sku": sku,
                "name": name,
                "unit_of_measure": uom,
                "barcode": None,
                "tax_code_name": tax,
                "reorder_point": 0,
                "reorder_qty": 0,
                "standard_cost_usd": cost if cost else None,
                "standard_cost_lbp": None,
            }
        )
        if cat:
            category_assign.append({"sku": sku, "category_name": cat})

    up_items = 0
    for batch in _chunks(items_payload, int(args.chunk)):
        cli.req_json("POST", "/items/bulk", {"items": batch})
        up_items += len(batch)

    up_cat = 0
    if category_assign:
        for batch in _chunks(category_assign, int(args.chunk)):
            res = cli.req_json("POST", "/items/category-assign/bulk", {"lines": batch})
            up_cat += int(res.get("updated") or 0)

    # UOM conversions.
    uom_payload = []
    for r in uoms_rows:
        sku = str(r.get("sku") or "").strip()
        u = str(r.get("uom_code") or "").strip()
        f = str(r.get("to_base_factor") or "").strip()
        active = str(r.get("is_active") or "true").strip().lower() != "false"
        if not sku or not u or not f:
            continue
        uom_payload.append({"sku": sku, "uom_code": u, "to_base_factor": f, "is_active": active})

    up_uoms = 0
    for batch in _chunks(uom_payload, int(args.chunk)):
        res = cli.req_json("POST", "/items/uom-conversions/bulk", {"lines": batch})
        up_uoms += int(res.get("upserted") or 0)

    # Barcodes.
    factor_by_sku_uom: dict[tuple[str, str], str] = {}
    for r in uoms_rows:
        sku = str(r.get("sku") or "").strip()
        u = str(r.get("uom_code") or "").strip().upper()
        f = str(r.get("to_base_factor") or "").strip()
        if sku and u and f:
            factor_by_sku_uom[(sku, u)] = f

    corrected_barcode_factors = 0
    bc_payload = []
    for r in barcodes_rows:
        sku = str(r.get("sku") or "").strip()
        bc = str(r.get("barcode") or "").strip()
        u = str(r.get("uom_code") or "").strip()
        qf = str(r.get("qty_factor") or "").strip() or "1"
        mapped = factor_by_sku_uom.get((sku, u.upper())) if u else None
        if mapped and mapped != qf:
            qf = mapped
            corrected_barcode_factors += 1
        primary = str(r.get("is_primary") or "false").strip().lower() == "true"
        if not sku or not bc:
            continue
        bc_payload.append({"sku": sku, "barcode": bc, "uom_code": u or None, "qty_factor": qf, "is_primary": primary})

    up_bcs = 0
    for batch in _chunks(bc_payload, int(args.chunk)):
        res = cli.req_json("POST", "/items/barcodes/bulk", {"lines": batch})
        up_bcs += int(res.get("upserted") or 0)

    # Prices (effective today).
    eff = date.today().isoformat()
    price_payload = []
    for r in prices_rows:
        sku = str(r.get("sku") or "").strip()
        p = str(r.get("price_usd") or "").strip()
        if not sku or not p:
            continue
        price_payload.append({"sku": sku, "price_usd": p, "price_lbp": "0"})

    up_prices = 0
    for batch in _chunks(price_payload, int(args.chunk)):
        res = cli.req_json("POST", "/items/prices/bulk", {"effective_from": eff, "lines": batch})
        up_prices += int(res.get("upserted") or 0)

    print(
        json.dumps(
            {
                "ok": True,
                "api_base": str(args.api_base),
                "effective_from": eff,
                "customers_upserted": up_customers,
                "suppliers_upserted": up_suppliers,
                "tax_codes_created": created_tax,
                "categories_known": len(cats),
                "items_upserted": up_items,
                "categories_assigned": up_cat,
                "uom_conversions_upserted": up_uoms,
                "barcodes_upserted": up_bcs,
                "barcode_factors_corrected_from_uoms": corrected_barcode_factors,
                "prices_upserted": up_prices,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
