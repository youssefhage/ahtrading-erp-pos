#!/usr/bin/env python3
"""
Import ERPNext CSV exports into a running Melqard (cloud) API via HTTPS.

Why this exists:
- When you're not at the office, you can still import realistic data into the cloud pilot
  without needing DB access or an on-prem local server PC.
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
import socket
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

def _strip_wrapped_quotes(v: Any) -> str:
    s = _norm(v)
    # Some exports include literal quotes inside the field, e.g. `"ALBUZ-001"`.
    # Strip repeated leading/trailing quotes only when they wrap the full value.
    while len(s) >= 2 and s.startswith('"') and s.endswith('"'):
        s = s[1:-1].strip()
    return s


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


def _post_with_isolation(post_fn, records: list[dict], chunk_size: int, label: str) -> int:
    """
    Robust bulk import:
    - Try chunks.
    - If the API returns a 500 (usually a data/DB edge case), bisect until we find
      the offending record(s), print them, and skip.
    """
    ok = 0
    chunk_size = max(1, min(int(chunk_size or 1000), 5000))

    def push_batch(batch: list[dict]) -> None:
        nonlocal ok
        if not batch:
            return
        try:
            post_fn(batch)
            ok += len(batch)
            return
        except RuntimeError as e:
            msg = str(e)
            # Only isolate server errors; for 4xx we want to fail fast.
            if "HTTP 500" not in msg:
                raise
            if len(batch) == 1:
                print(f"[warn] skipping bad record in {label}: {batch[0]}", file=sys.stderr)
                return
            mid = len(batch) // 2
            push_batch(batch[:mid])
            push_batch(batch[mid:])

    for batch in _chunks(records, chunk_size):
        push_batch(batch)

    return ok


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
    def __init__(self, base_url: str, timeout_s: int = 90, max_retries: int = 4):
        self.base_url = base_url.rstrip("/") + "/"
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))
        self.timeout_s = int(timeout_s)
        self.max_retries = int(max_retries)

    def _req(self, method: str, path: str, body: Optional[dict] = None, headers: Optional[dict] = None) -> Any:
        url = urljoin(self.base_url, path.lstrip("/"))
        data = None
        hdrs = {"Content-Type": "application/json"}
        if headers:
            hdrs.update(headers)
        if body is not None:
            data = json.dumps(body, default=str).encode("utf-8")
        attempt = 0
        while True:
            req = Request(url=url, method=method.upper(), data=data, headers=hdrs)
            try:
                with self.opener.open(req, timeout=self.timeout_s) as resp:
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
                if e.code in {429, 500, 502, 503, 504} and attempt < self.max_retries:
                    time.sleep(min(2 ** attempt, 10))
                    attempt += 1
                    continue
                raise RuntimeError(f"{method} {url} -> HTTP {e.code}: {detail}") from None
            except (URLError, socket.timeout, TimeoutError) as e:
                if attempt < self.max_retries:
                    time.sleep(min(2 ** attempt, 10))
                    attempt += 1
                    continue
                raise RuntimeError(f"{method} {url} -> network error: {e}") from None

    def login(self, email: str, password: str) -> None:
        self._req("POST", "/auth/login", {"email": email, "password": password})

    def get_companies(self) -> list[dict]:
        res = self._req("GET", "/companies")
        return list(res.get("companies") or [])

    def list_tax_codes(self, company_id: str) -> list[dict]:
        res = self._req("GET", "/config/tax-codes", headers={"X-Company-Id": company_id})
        return list(res.get("tax_codes") or [])

    def create_tax_code(self, company_id: str, name: str, rate: str, tax_type: str = "vat", reporting_currency: str = "LBP") -> dict:
        return self._req(
            "POST",
            "/config/tax-codes",
            {"name": name, "rate": rate, "tax_type": tax_type, "reporting_currency": reporting_currency},
            headers={"X-Company-Id": company_id},
        )

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

    def post_bulk_barcodes(self, company_id: str, lines: list[dict]) -> dict:
        return self._req(
            "POST",
            "/items/barcodes/bulk",
            {"lines": lines},
            headers={"X-Company-Id": company_id},
        )

    def post_bulk_uom_conversions(self, company_id: str, lines: list[dict]) -> dict:
        return self._req(
            "POST",
            "/items/uom-conversions/bulk",
            {"lines": lines},
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
    ap.add_argument(
        "--prices-effective-from",
        default=os.getenv("POS_IMPORT_PRICES_EFFECTIVE_FROM") or "",
        help="Optional YYYY-MM-DD to force effective_from for imported sell prices.",
    )
    args = ap.parse_args()

    if not args.email or not args.password:
        _die("missing admin credentials: pass --email/--password or set MELQARD_ADMIN_EMAIL/MELQARD_ADMIN_PASSWORD")

    data_dir = Path(args.data_dir)
    p = _paths(data_dir)
    for fp in [p.customers_csv, p.suppliers_csv, p.items_csv]:
        if not fp.exists():
            _die(f"missing file: {fp}")

    api = ApiClient(args.api_base)
    prices_effective_from = date.today()
    if str(args.prices_effective_from or "").strip():
        try:
            prices_effective_from = date.fromisoformat(str(args.prices_effective_from).strip())
        except Exception:
            _die("invalid --prices-effective-from (expected YYYY-MM-DD)")
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

    # Ensure required tax codes exist (official company only).
    # ERPNext mapping:
    # - "Item Tax Template" = "11%" -> VAT 11%
    # - "Item Tax Template" = "0%"  -> VAT exempt 0%
    print("[2.5/6] Ensure tax codes (official)...")
    existing_tax = {str(tc.get("name") or "").strip().lower(): tc for tc in api.list_tax_codes(official_id)}
    for name, rate in [("11%", "0.11"), ("0%", "0")]:
        if name.lower() not in existing_tax:
            api.create_tax_code(official_id, name=name, rate=rate, tax_type="vat", reporting_currency="LBP")
            print(f"  - created tax code: {name} (rate={rate})")

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
            code = _strip_wrapped_quotes(row[idx["ID"]])
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
        imported = _post_with_isolation(lambda b, _cid=cid: api.post_bulk_customers(_cid, b), customers, int(args.chunk or 1000), f"customers/{label}")
        print(f"  - customers imported to {label}: {imported}/{len(customers)}")

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
                code = _strip_wrapped_quotes(row[idx["ID"]])
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
        imported = _post_with_isolation(lambda b: api.post_bulk_suppliers(official_id, b), suppliers, int(args.chunk or 1000), "suppliers/official")
        print(f"  - suppliers imported: {imported}/{len(suppliers)}")

    print("[5/7] Import items + prices + UOM conversions + barcode factors...")
    # Note: ERPNext exports can place company/price/cost in child-table rows where the ID cell is blank.
    # We treat those as continuation rows for the last-seen SKU.
    items_by_company: dict[str, dict[str, dict]] = {official_id: {}, unofficial_id: {}}
    prices_by_company: dict[str, dict[str, dict]] = {official_id: {}, unofficial_id: {}}
    uoms_by_company: dict[str, dict[tuple[str, str], dict]] = {official_id: {}, unofficial_id: {}}
    opening_by_company: dict[str, dict[str, dict]] = {official_id: {}, unofficial_id: {}}
    barcodes_by_company: dict[str, list[dict]] = {official_id: [], unofficial_id: []}

    with p.items_csv.open(newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r, None)
        if not header:
            _die(f"empty csv: {p.items_csv}")
        idx = _header_index([str(h) for h in header])
        for k in ["ID", "Item Name", "Default Unit of Measure"]:
            if k not in idx:
                _die(f"missing column '{k}' in {p.items_csv}")

        # Child-table columns (may appear on separate rows with blank base columns).
        c_company = idx.get("Company")  # item default per company section
        c_uom = idx.get("Default Unit of Measure")
        c_price = idx.get("Standard Selling Rate")
        c_opening = idx.get("Opening Stock")
        c_val = idx.get("Valuation Rate")
        c_tax_tmpl = idx.get("Item Tax Template")

        c_conv_uom = idx.get("UOM")  # item uom conversion section
        c_conv_factor = idx.get("Conversion Factor")
        c_bc = idx.get("Barcode")  # barcode section
        c_bc_uom = idx.get("UOM", None)  # NOTE: duplicate header; we use first occurrence for conversions, barcode UOM is later.
        # Find the barcode UOM column reliably by using the *second* occurrence of "UOM" (barcode section).
        # Header is known to include two "UOM" columns: conversions (near index ~61) and barcode (near index ~68).
        uom_cols = [i for i, h in enumerate(header) if (h or "").strip() == "UOM"]
        c_bc_uom = uom_cols[1] if len(uom_cols) >= 2 else None

        current_sku = ""
        current_company = official_id
        current_base_uom = "EA"
        conv_map_by_sku: dict[str, dict[str, Decimal]] = {}
        barcodes_raw_by_sku: dict[str, list[tuple[str, str]]] = {}

        for row in r:
            sku_cell = _strip_wrapped_quotes(row[idx["ID"]])
            name_cell = _norm(row[idx["Item Name"]])

            # Company mapping can appear on base rows and continuation rows.
            # In this ERPNext export shape, blank Company cells inherit the latest
            # explicit company context.
            row_company = _strip_wrapped_quotes(row[c_company]) if c_company is not None and c_company < len(row) else ""
            if row_company:
                current_company = alias.get(row_company, official_id)

            if sku_cell:
                current_sku = sku_cell
                base_uom = _norm(row[c_uom]) if c_uom is not None and c_uom < len(row) else "EA"
                current_base_uom = (base_uom or "EA").strip().upper()[:32]

                if name_cell:
                    tax_code_name: Optional[str] = None
                    if c_tax_tmpl is not None and c_tax_tmpl < len(row):
                        raw_tmpl = _norm(row[c_tax_tmpl])
                        # In our exports this is typically "11%" or "0%".
                        if raw_tmpl in {"11%", "0%"}:
                            tax_code_name = raw_tmpl
                    # Undisclosed items have no VAT in our rules.
                    if current_company == unofficial_id:
                        tax_code_name = None

                    # Base item upsert payload. Cost may be updated below even if it appears on continuation rows.
                    items_by_company[current_company][current_sku] = {
                        "sku": current_sku,
                        "name": name_cell,
                        "unit_of_measure": current_base_uom,
                        # Do NOT set `barcode` here. We'll upsert barcodes with correct UOM + qty_factor below.
                        "barcode": None,
                        "tax_code_name": tax_code_name,
                        "standard_cost_usd": None,
                        "standard_cost_lbp": None,
                    }
                    # Ensure base conversion exists for all imported items.
                    uoms_by_company[current_company][(current_sku, current_base_uom)] = {
                        "sku": current_sku,
                        "uom_code": current_base_uom,
                        "to_base_factor": "1",
                        "is_active": True,
                    }

            # Continuation rows: import price/cost/opening stock using the last-seen SKU.
            if not current_sku:
                continue

            # Cost import (Valuation Rate -> items.standard_cost_usd). Only set if > 0.
            val_rate = _to_decimal(row[c_val]) if c_val is not None and c_val < len(row) else Decimal("0")
            if val_rate > 0:
                it = items_by_company.get(current_company, {}).get(current_sku)
                if it is not None and not it.get("standard_cost_usd"):
                    it["standard_cost_usd"] = str(val_rate)

            # Price import (USD only for now; LBP can be derived by exchange rate in POS).
            price_usd = _to_decimal(row[c_price]) if c_price is not None and c_price < len(row) else Decimal("0")
            if price_usd > 0:
                prices_by_company[current_company][current_sku] = {"sku": current_sku, "price_usd": str(price_usd), "price_lbp": "0"}

            # Opening stock import.
            if not args.skip_opening_stock:
                qty = _to_decimal(row[c_opening]) if c_opening is not None and c_opening < len(row) else Decimal("0")
                if qty > 0:
                    unit_cost_usd = _to_decimal(row[c_val]) if c_val is not None and c_val < len(row) else Decimal("0")
                    # Deduplicate by SKU in case the export repeats opening stock on child rows.
                    opening_by_company[current_company][current_sku] = {
                        "sku": current_sku,
                        "qty": str(qty),
                        "unit_cost_usd": str(unit_cost_usd if unit_cost_usd > 0 else Decimal("0")),
                        "unit_cost_lbp": "0",
                    }

            # Collect UOM conversions.
            if c_conv_uom is not None and c_conv_factor is not None and c_conv_uom < len(row) and c_conv_factor < len(row):
                u = _norm(row[c_conv_uom]).upper()[:32]
                f = _to_decimal(row[c_conv_factor])
                if u and f > 0:
                    conv_map_by_sku.setdefault(current_sku, {})[u] = f
                    uoms_by_company[current_company][(current_sku, u)] = {
                        "sku": current_sku,
                        "uom_code": u,
                        "to_base_factor": str(f),
                        "is_active": True,
                    }

            # Collect barcodes + their UOM (barcode section).
            if c_bc is not None and c_bc < len(row):
                bc = _norm(row[c_bc])
                if bc:
                    bc_u = _norm(row[c_bc_uom]) if c_bc_uom is not None and c_bc_uom < len(row) else ""
                    bc_u = (bc_u or "").strip().upper()[:32]
                    barcodes_raw_by_sku.setdefault(current_sku, []).append((bc, bc_u))

        # Build bulk upsert payload for barcodes with qty_factor derived from UOM conversions.

        # We need to rebuild per-company lists by re-reading only the base rows to know company per SKU.
        # (This keeps the logic simple and robust for ERPNext exports with blank cells on child rows.)
        sku_company: dict[str, str] = {}
        sku_base_uom: dict[str, str] = {}
        with p.items_csv.open(newline="", encoding="utf-8") as f2:
            r2 = csv.reader(f2)
            header2 = next(r2, None) or []
            idx2 = _header_index([str(h) for h in header2])
            c_company2 = idx.get("Company")
            c_uom2 = idx.get("Default Unit of Measure")
            for row2 in r2:
                sku2 = _strip_wrapped_quotes(row2[idx2["ID"]]) if "ID" in idx2 and idx2["ID"] < len(row2) else ""
                if not sku2:
                    continue
                row_company2 = _strip_wrapped_quotes(row2[c_company2]) if c_company2 is not None and c_company2 < len(row2) else ""
                sku_company[sku2] = alias.get(row_company2, official_id)
                base_uom2 = _norm(row2[c_uom2]) if c_uom2 is not None and c_uom2 < len(row2) else "EA"
                sku_base_uom[sku2] = (base_uom2 or "EA").strip().upper()[:32]

        rerouted_barcodes = 0
        skipped_barcodes = 0
        skipped_skus: set[str] = set()
        for sku, bcs in barcodes_raw_by_sku.items():
            preferred_cid = sku_company.get(sku, official_id)
            if sku in items_by_company.get(preferred_cid, {}):
                cid = preferred_cid
            elif sku in items_by_company.get(official_id, {}):
                cid = official_id
                rerouted_barcodes += len(bcs)
            elif sku in items_by_company.get(unofficial_id, {}):
                cid = unofficial_id
                rerouted_barcodes += len(bcs)
            else:
                skipped_barcodes += len(bcs)
                skipped_skus.add(sku)
                continue
            base_uom = sku_base_uom.get(sku, "EA")
            conv = conv_map_by_sku.get(sku, {})
            conv.setdefault(base_uom, Decimal("1"))
            for i, (bc, bc_uom) in enumerate(bcs):
                uom_code = bc_uom or base_uom
                qty_factor = Decimal("1") if uom_code == base_uom else conv.get(uom_code, Decimal("1"))
                barcodes_by_company[cid].append(
                    {
                        "sku": sku,
                        "barcode": bc,
                        "uom_code": uom_code,
                        "qty_factor": str(qty_factor),
                        "is_primary": i == 0,
                    }
                )
        if rerouted_barcodes:
            print(f"  - [warn] rerouted {rerouted_barcodes} barcode rows to the company where the SKU exists")
        if skipped_barcodes:
            sample = sorted(skipped_skus)[:10]
            print(f"  - [warn] skipped {skipped_barcodes} barcode rows with missing SKU in both companies: {sample}")

        # Normalize UOM conversion ownership to the company where the SKU exists.
        normalized_uoms: dict[str, dict[tuple[str, str], dict]] = {official_id: {}, unofficial_id: {}}
        rerouted_uoms = 0
        skipped_uoms = 0
        for src_cid, rows_by_key in uoms_by_company.items():
            for key, row in rows_by_key.items():
                sku = str(row.get("sku") or "").strip()
                if not sku:
                    continue
                if sku in items_by_company.get(src_cid, {}):
                    cid = src_cid
                elif sku in items_by_company.get(official_id, {}):
                    cid = official_id
                    rerouted_uoms += 1
                elif sku in items_by_company.get(unofficial_id, {}):
                    cid = unofficial_id
                    rerouted_uoms += 1
                else:
                    skipped_uoms += 1
                    continue
                normalized_uoms[cid][key] = row
        uoms_by_company = normalized_uoms
        if rerouted_uoms:
            print(f"  - [warn] rerouted {rerouted_uoms} uom rows to the company where the SKU exists")
        if skipped_uoms:
            print(f"  - [warn] skipped {skipped_uoms} uom rows with missing SKU in both companies")

    # Upsert items first (needed before prices/opening stock).
    for cid, label in [(official_id, "official"), (unofficial_id, "unofficial")]:
        items = list(items_by_company[cid].values())
        imported_items = _post_with_isolation(
            lambda batch, _cid=cid: api.post_bulk_items(_cid, batch),
            items,
            5000,
            f"items/{label}",
        )
        print(f"  - items upserted ({label}): {imported_items}/{len(items)}")

        uoms = list(uoms_by_company[cid].values())
        imported_uoms = _post_with_isolation(
            lambda batch, _cid=cid: api.post_bulk_uom_conversions(_cid, batch),
            uoms,
            5000,
            f"uoms/{label}",
        )
        print(f"  - uom conversions upserted ({label}): {imported_uoms}/{len(uoms)}")

        prices = list(prices_by_company[cid].values())
        imported_prices = _post_with_isolation(
            lambda batch, _cid=cid: api.post_bulk_prices(_cid, prices_effective_from, batch),
            prices,
            5000,
            f"prices/{label}",
        )
        print(f"  - prices upserted ({label}): {imported_prices}/{len(prices)}")

        bcs = barcodes_by_company[cid]
        imported_bcs = _post_with_isolation(
            lambda batch, _cid=cid: api.post_bulk_barcodes(_cid, batch),
            bcs,
            5000,
            f"barcodes/{label}",
        )
        print(f"  - barcodes upserted ({label}): {imported_bcs}/{len(bcs)}")

    if not args.skip_opening_stock:
        print("[6/7] Import opening stock...")
        for cid, label in [(official_id, "official"), (unofficial_id, "unofficial")]:
            whs = api.list_warehouses(cid)
            wh = next((w for w in whs if str(w.get("name") or "") == "Main Warehouse"), None) or (whs[0] if whs else None)
            if not wh:
                _die(f"no warehouse found for {label}")
            warehouse_id = str(wh.get("id") or "")
            lines = opening_by_company[cid]
            lines = list(opening_by_company[cid].values())
            if not lines:
                print(f"  - opening stock ({label}): 0 lines (skipped)")
                continue
            # Deterministic UUID-ish tag (backend validates UUID format). We'll use a stable string per day/company.
            import_id = f"00000000-0000-0000-0000-{cid.replace('-', '')[:12]}"
            res = api.import_opening_stock(cid, warehouse_id, import_id, lines)
            print(f"  - opening stock ({label}): {len(lines)} lines (already_applied={bool(res.get('already_applied'))})")

    print("[7/7] Done.")
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
