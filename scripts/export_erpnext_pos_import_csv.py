#!/usr/bin/env python3
"""
Export a POS import-ready CSV directly from a live ERPNext instance.

This is intended to solve a common issue:
- Many items can have Item.standard_rate (aka "Standard Selling Rate") = 0,
  while prices exist in Item Price for the "Standard Selling" price list.

Output CSV columns (compatible with the Admin "Import Items (CSV)" dialog):
  sku,name,unit_of_measure,tax_code,standard_cost_usd,price_usd

Price normalization:
- ERPNext Item Price rows can be in a UOM different from Item.stock_uom.
- We normalize to stock_uom using the Item.uoms child table conversion_factor:
    price_per_stock_uom = price_list_rate / conversion_factor(price_uom)

Credentials:
- Provide via env vars (recommended):
    ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET
  or pass via CLI flags.
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


def _uom_factor_from_item_doc(item_doc: dict, uom: str) -> Optional[Decimal]:
    for row in item_doc.get("uoms") or []:
        if str(row.get("uom") or "").strip() == uom:
            f = _to_decimal(row.get("conversion_factor"))
            if f > 0:
                return f
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--erp-base", default=os.getenv("ERPNEXT_BASE_URL") or "https://erp.ahagetrading.com")
    ap.add_argument("--api-key", default=os.getenv("ERPNEXT_API_KEY") or "")
    ap.add_argument("--api-secret", default=os.getenv("ERPNEXT_API_SECRET") or "")
    ap.add_argument("--price-list", default="Standard Selling", help="ERPNext Item Price price_list to export")
    ap.add_argument("--currency", default="USD", help="Only export Item Price rows matching this currency")
    ap.add_argument("--out", default="Data AH Trading/erpnext_pos_items_prices.csv")
    ap.add_argument("--include-disabled", action="store_true", help="Include disabled items (default: skip)")
    args = ap.parse_args()

    if not args.api_key or not args.api_secret:
        _die("missing ERPNext credentials: set ERPNEXT_API_KEY and ERPNEXT_API_SECRET (or pass --api-key/--api-secret)")

    cli = ErpNextClient(base_url=str(args.erp_base), api_key=str(args.api_key), api_secret=str(args.api_secret))
    user = cli.get_logged_user()
    if not user:
        _die("could not authenticate (empty logged user)")

    # Load items map.
    items: dict[str, dict] = {}
    for it in cli.iter_resource_list(
        "Item",
        fields=["item_code", "item_name", "disabled", "stock_uom", "valuation_rate", "last_purchase_rate"],
        page_size=1000,
    ):
        code = str(it.get("item_code") or "").strip()
        if not code:
            continue
        items[code] = it

    # Load item prices for the chosen price list and compute a normalized (stock_uom) rate.
    price_by_item: dict[str, Decimal] = {}
    uom_mismatches: list[tuple[str, str, str, Decimal]] = []
    missing_conv: list[tuple[str, str]] = []
    item_doc_cache: dict[str, dict] = {}

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
        price_uom = str(ip.get("uom") or "").strip()
        norm_rate = rate

        if price_uom and stock_uom and price_uom != stock_uom:
            uom_mismatches.append((code, stock_uom, price_uom, rate))
            doc = item_doc_cache.get(code)
            if doc is None:
                doc = cli.get_doc("Item", code)
                item_doc_cache[code] = doc
            factor = _uom_factor_from_item_doc(doc, price_uom)
            if not factor or factor <= 0:
                missing_conv.append((code, price_uom))
                continue
            norm_rate = rate / factor

        # Prefer the latest valid_from if multiple prices exist for an item.
        prev = price_by_item.get(code)
        if prev is None:
            price_by_item[code] = norm_rate
        else:
            prev_from = str(items.get("_vf_" + code) or "")
            cur_from = str(ip.get("valid_from") or "")
            if cur_from >= prev_from:
                items["_vf_" + code] = cur_from
                price_by_item[code] = norm_rate

    out_path = str(args.out)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["sku", "name", "unit_of_measure", "tax_code", "standard_cost_usd", "price_usd"])

        rows_written = 0
        skipped_disabled = 0
        missing_price = 0
        missing_cost = 0

        for code, it in sorted(items.items(), key=lambda kv: kv[0]):
            if code.startswith("_vf_"):
                continue

            disabled = bool(int(_to_decimal(it.get("disabled") or 0)))
            if disabled and not args.include_disabled:
                skipped_disabled += 1
                continue

            name = str(it.get("item_name") or "").strip() or code
            uom = str(it.get("stock_uom") or "").strip() or "EA"

            cost = _to_decimal(it.get("valuation_rate"))
            if cost <= 0:
                cost = _to_decimal(it.get("last_purchase_rate"))
            if cost <= 0:
                missing_cost += 1

            price = price_by_item.get(code, Decimal("0"))
            if price <= 0:
                missing_price += 1

            # Leave blank unless you want to fetch full Item docs for taxes (slower).
            tax_code = ""

            w.writerow(
                [
                    code,
                    name,
                    uom,
                    tax_code,
                    (str(cost) if cost > 0 else ""),
                    (str(price) if price > 0 else ""),
                ]
            )
            rows_written += 1

    print(
        json.dumps(
            {
                "ok": True,
                "logged_user": user,
                "out": out_path,
                "items_total": len([k for k in items.keys() if not k.startswith("_vf_")]),
                "rows_written": rows_written,
                "skipped_disabled": skipped_disabled,
                "prices_exported": len(price_by_item),
                "missing_price_rows_written": missing_price,
                "missing_cost_rows_written": missing_cost,
                "uom_mismatch_item_price_rows": len(uom_mismatches),
                "uom_mismatch_missing_conversions": len(missing_conv),
                "uom_mismatch_examples": [
                    {
                        "item_code": c,
                        "stock_uom": su,
                        "price_uom": pu,
                        "price_list_rate": str(r),
                    }
                    for (c, su, pu, r) in uom_mismatches[:10]
                ],
            },
            indent=2,
        )
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

