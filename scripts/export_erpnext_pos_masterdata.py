#!/usr/bin/env python3
"""
Export ERPNext master data needed to replace ERPNext with Codex POS.

Outputs multiple CSVs (defaults under Data AH Trading/):
- erpnext_pos_items.csv
- erpnext_pos_prices.csv
- erpnext_pos_uom_conversions.csv
- erpnext_pos_barcodes.csv
- erpnext_pos_categories.csv

Credentials via env (recommended):
  ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Iterator, Optional
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _to_decimal(v: Any) -> Decimal:
    try:
        if v is None:
            return Decimal("0")
        s = str(v).strip()
        if not s:
            return Decimal("0")
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return Decimal("0")


@dataclass(frozen=True)
class ErpNextClient:
    base_url: str
    api_key: str
    api_secret: str
    timeout_s: int = 60

    def _auth_header(self) -> str:
        return f"token {self.api_key}:{self.api_secret}"

    def _req_json(self, method: str, path: str, *, params: Optional[dict] = None, payload: Any = None) -> dict:
        url = self.base_url.rstrip("/") + path
        if params:
            url += "?" + urlencode(params, doseq=True)
        data = None
        headers = {
            "Authorization": self._auth_header(),
            "Accept": "application/json",
            "User-Agent": "codex-erpnext-export/1.0",
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=self.timeout_s) as resp:
                body = resp.read().decode("utf-8")
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {e.code} {path}: {body[:500]}") from None
        return json.loads(body) if body else {}

    def get_logged_user(self) -> str:
        return str(self._req_json("GET", "/api/method/frappe.auth.get_logged_user").get("message") or "")

    def iter_resource_list(
        self,
        doctype: str,
        *,
        fields: list[str],
        filters: Optional[list] = None,
        page_size: int = 1000,
        sleep_s: float = 0.05,
    ) -> Iterator[dict]:
        start = 0
        while True:
            params: dict[str, Any] = {
                "fields": json.dumps(fields),
                "limit_page_length": int(page_size),
                "limit_start": int(start),
            }
            if filters is not None:
                params["filters"] = json.dumps(filters)
            data = self._req_json(
                "GET",
                "/api/resource/" + quote(doctype, safe=""),
                params=params,
            ).get("data") or []
            if not data:
                break
            for row in data:
                yield dict(row)
            start += len(data)
            if len(data) < page_size:
                break
            time.sleep(sleep_s)

    def get_doc(self, doctype: str, name: str) -> dict:
        return dict(
            (self._req_json("GET", f"/api/resource/{quote(doctype, safe='')}/{quote(name, safe='')}").get("data") or {})
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--erp-base", default=os.getenv("ERPNEXT_BASE_URL") or "https://erp.ahagetrading.com")
    ap.add_argument("--api-key", default=os.getenv("ERPNEXT_API_KEY") or "")
    ap.add_argument("--api-secret", default=os.getenv("ERPNEXT_API_SECRET") or "")
    ap.add_argument("--price-list", default="Standard Selling")
    ap.add_argument("--currency", default="USD")
    ap.add_argument("--out-dir", default="Data AH Trading")
    ap.add_argument("--include-disabled", action="store_true")
    ap.add_argument("--sleep-per-item", type=float, default=0.01)
    args = ap.parse_args()

    if not args.api_key or not args.api_secret:
        _die("missing ERPNext credentials: set ERPNEXT_API_KEY and ERPNEXT_API_SECRET (or pass --api-key/--api-secret)")

    out_dir = str(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)

    cli = ErpNextClient(base_url=str(args.erp_base), api_key=str(args.api_key), api_secret=str(args.api_secret))
    user = cli.get_logged_user()
    if not user:
        _die("could not authenticate (empty logged user)")

    # Load items (light).
    items: dict[str, dict] = {}
    for it in cli.iter_resource_list(
        "Item",
        fields=["item_code", "item_name", "disabled", "stock_uom", "valuation_rate", "last_purchase_rate", "item_group"],
        page_size=1000,
    ):
        code = str(it.get("item_code") or "").strip()
        if code:
            items[code] = it

    # Load item prices (selling).
    price_by_item: dict[str, Decimal] = {}
    price_uom_by_item: dict[str, str] = {}
    uom_mismatches = 0

    for ip in cli.iter_resource_list(
        "Item Price",
        fields=["item_code", "price_list", "price_list_rate", "currency", "uom", "valid_from"],
        filters=[["price_list", "=", str(args.price_list)]],
        page_size=1000,
    ):
        code = str(ip.get("item_code") or "").strip()
        if not code or code not in items:
            continue
        cur = str(ip.get("currency") or "").strip()
        if cur and cur != str(args.currency):
            continue
        rate = _to_decimal(ip.get("price_list_rate"))
        if rate < 0:
            continue

        stock_uom = str(items[code].get("stock_uom") or "").strip()
        puom = str(ip.get("uom") or "").strip()
        norm_rate = rate

        # Normalize to stock_uom using per-item conversions (requires item doc).
        if puom and stock_uom and puom != stock_uom:
            uom_mismatches += 1
            doc = cli.get_doc("Item", code)
            factor = None
            for row in doc.get("uoms") or []:
                if str(row.get("uom") or "").strip() == puom:
                    f = _to_decimal(row.get("conversion_factor"))
                    factor = f if f > 0 else None
                    break
            if not factor:
                continue
            norm_rate = rate / factor

        prev = price_by_item.get(code)
        if prev is None:
            price_by_item[code] = norm_rate
            price_uom_by_item[code] = stock_uom or puom or ""
        else:
            # Choose latest by valid_from when possible.
            prev_from = str(items.get("_vf_" + code) or "")
            cur_from = str(ip.get("valid_from") or "")
            if cur_from >= prev_from:
                items["_vf_" + code] = cur_from
                price_by_item[code] = norm_rate
                price_uom_by_item[code] = stock_uom or puom or ""

    # Full item docs for barcodes, conversions, taxes.
    barcodes_rows: list[dict[str, str]] = []
    uom_rows: list[dict[str, str]] = []
    items_out: list[dict[str, str]] = []
    categories: set[str] = set()

    missing_barcode_conv = 0
    missing_uoms = 0

    for i, (code, it) in enumerate(sorted(items.items(), key=lambda kv: kv[0])):
        if code.startswith("_vf_"):
            continue
        disabled = bool(int(_to_decimal(it.get("disabled") or 0)))
        if disabled and not bool(args.include_disabled):
            continue

        doc = cli.get_doc("Item", code)
        time.sleep(float(args.sleep_per_item or 0))

        name = str(doc.get("item_name") or it.get("item_name") or "").strip() or code
        stock_uom = str(doc.get("stock_uom") or it.get("stock_uom") or "").strip() or "EA"

        item_group = str(doc.get("item_group") or it.get("item_group") or "").strip()
        if item_group:
            categories.add(item_group)

        # Tax template: prefer first taxes row's item_tax_template if present.
        tax_code = ""
        for tx in doc.get("taxes") or []:
            tmpl = str(tx.get("item_tax_template") or "").strip()
            if tmpl:
                tax_code = tmpl
                break

        # Cost: valuation_rate fallback last_purchase_rate.
        cost = _to_decimal(doc.get("valuation_rate"))
        if cost <= 0:
            cost = _to_decimal(doc.get("last_purchase_rate"))

        items_out.append(
            {
                "sku": code,
                "name": name,
                "unit_of_measure": stock_uom,
                "tax_code": tax_code,
                "standard_cost_usd": (str(cost) if cost > 0 else ""),
                "category_name": item_group,
            }
        )

        # UOM conversions (include base).
        uoms = list(doc.get("uoms") or [])
        if not uoms:
            missing_uoms += 1
            uom_rows.append({"sku": code, "uom_code": stock_uom, "to_base_factor": "1", "is_active": "true"})
        else:
            for row in uoms:
                u = str(row.get("uom") or "").strip()
                f = _to_decimal(row.get("conversion_factor"))
                if not u or f <= 0:
                    continue
                uom_rows.append({"sku": code, "uom_code": u, "to_base_factor": str(f), "is_active": "true"})

        # Barcode mappings.
        # qty_factor must map barcode UOM -> base (stock_uom) factor.
        uom_factor: dict[str, Decimal] = {stock_uom: Decimal("1")}
        for row in doc.get("uoms") or []:
            u = str(row.get("uom") or "").strip()
            f = _to_decimal(row.get("conversion_factor"))
            if u and f > 0:
                uom_factor[u] = f

        for idx, bcrow in enumerate(doc.get("barcodes") or []):
            bc = str(bcrow.get("barcode") or "").strip()
            if not bc:
                continue
            bc_uom = str(bcrow.get("uom") or "").strip() or stock_uom
            f = uom_factor.get(bc_uom)
            if f is None or f <= 0:
                missing_barcode_conv += 1
                continue
            barcodes_rows.append(
                {
                    "sku": code,
                    "barcode": bc,
                    "uom_code": bc_uom,
                    "qty_factor": str(f),
                    "is_primary": "true" if idx == 0 else "false",
                }
            )

    # Prices output.
    prices_out: list[dict[str, str]] = []
    for code in sorted({k for k in items.keys() if not k.startswith("_vf_")}):
        p = price_by_item.get(code, Decimal("0"))
        if p > 0:
            prices_out.append({"sku": code, "price_usd": str(p), "price_lbp": "0"})

    # Write CSVs.
    paths = {
        "items": os.path.join(out_dir, "erpnext_pos_items.csv"),
        "prices": os.path.join(out_dir, "erpnext_pos_prices.csv"),
        "uoms": os.path.join(out_dir, "erpnext_pos_uom_conversions.csv"),
        "barcodes": os.path.join(out_dir, "erpnext_pos_barcodes.csv"),
        "categories": os.path.join(out_dir, "erpnext_pos_categories.csv"),
    }

    def write_csv(path: str, rows: list[dict[str, str]], cols: list[str]) -> None:
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in cols})

    write_csv(paths["items"], items_out, ["sku", "name", "unit_of_measure", "tax_code", "standard_cost_usd", "category_name"])
    write_csv(paths["prices"], prices_out, ["sku", "price_usd", "price_lbp"])
    write_csv(paths["uoms"], uom_rows, ["sku", "uom_code", "to_base_factor", "is_active"])
    write_csv(paths["barcodes"], barcodes_rows, ["sku", "barcode", "uom_code", "qty_factor", "is_primary"])
    write_csv(paths["categories"], [{"name": n, "parent_name": "", "is_active": "true"} for n in sorted(categories)], ["name", "parent_name", "is_active"])

    print(
        json.dumps(
            {
                "ok": True,
                "logged_user": user,
                "out_dir": out_dir,
                "items_exported": len(items_out),
                "prices_exported": len(prices_out),
                "barcodes_exported": len(barcodes_rows),
                "uom_conversions_exported": len(uom_rows),
                "categories_exported": len(categories),
                "price_uom_mismatches_seen": int(uom_mismatches),
                "missing_uoms_items": int(missing_uoms),
                "barcodes_missing_conversion": int(missing_barcode_conv),
                "paths": paths,
            },
            indent=2,
        )
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

