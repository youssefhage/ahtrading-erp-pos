#!/usr/bin/env python3
"""
Sync live ERPNext item pricing into hosted POS API.

What it does:
- Pull ERPNext Item Price rows for:
  - Standard Selling (used as sell price)
  - Standard Buying (used as standard cost)
- Normalize ERP price/cost to stock UOM using Item.uoms conversion_factor.
- Match by SKU against existing POS items per company.
- Upsert sell prices via /items/prices/bulk.
- Patch item standard_cost_usd via /items/{item_id}.

This script is safe to rerun.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener

import http.cookiejar


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _to_dec(v: Any) -> Decimal:
    try:
        s = str(v or "").strip()
        return Decimal(s) if s else Decimal("0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _norm_uom(v: Any) -> str:
    return str(v or "").strip().upper()


def _chunks(xs: list[Any], n: int):
    for i in range(0, len(xs), n):
        yield xs[i : i + n]


@dataclass(frozen=True)
class ErpClient:
    base_url: str
    api_key: str
    api_secret: str
    timeout_s: int = 60

    def _req_json(self, method: str, path: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        url = self.base_url.rstrip("/") + path
        if params:
            url += "?" + urlencode(params, doseq=True)
        req = Request(
            url,
            method=method,
            headers={
                "Authorization": f"token {self.api_key}:{self.api_secret}",
                "Accept": "application/json",
                "User-Agent": "codex-erpnext-sync/1.0",
            },
        )
        try:
            with build_opener().open(req, timeout=self.timeout_s) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else {}
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"ERP {method} {path} -> HTTP {e.code}: {body[:400]}") from None
        except URLError as e:
            raise RuntimeError(f"ERP {method} {path} -> network error: {e}") from None

    def iter_list(self, doctype: str, fields: list[str], filters: Optional[list[Any]] = None, page_size: int = 1000):
        start = 0
        while True:
            params: dict[str, Any] = {
                "fields": json.dumps(fields),
                "limit_start": start,
                "limit_page_length": int(page_size),
            }
            if filters is not None:
                params["filters"] = json.dumps(filters)
            rows = self._req_json("GET", f"/api/resource/{quote(doctype, safe='')}", params=params).get("data") or []
            if not rows:
                break
            for r in rows:
                yield dict(r)
            if len(rows) < page_size:
                break
            start += len(rows)
            time.sleep(0.05)

    def get_item_doc(self, sku: str) -> dict[str, Any]:
        return dict(self._req_json("GET", f"/api/resource/Item/{quote(sku, safe='')}").get("data") or {})


class PosClient:
    def __init__(self, api_base: str):
        self.api_base = api_base.rstrip("/") + "/"
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))

    def _req(self, method: str, path: str, body: Optional[dict] = None, headers: Optional[dict[str, str]] = None) -> Any:
        url = self.api_base + path.lstrip("/")
        data = None
        hdrs = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "codex-erpnext-sync/1.0"}
        if headers:
            hdrs.update(headers)
        if body is not None:
            data = json.dumps(body, default=str).encode("utf-8")
        req = Request(url=url, method=method, headers=hdrs, data=data)
        try:
            with self.opener.open(req, timeout=60) as resp:
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
            raise RuntimeError(f"POS {method} {path} -> HTTP {e.code}: {detail}") from None
        except URLError as e:
            raise RuntimeError(f"POS {method} {path} -> network error: {e}") from None

    def login(self, email: str, password: str) -> None:
        self._req("POST", "/auth/login", {"email": email, "password": password})

    def get_companies(self) -> list[dict[str, Any]]:
        return list(self._req("GET", "/companies").get("companies") or [])

    def list_items(self, company_id: str) -> list[dict[str, Any]]:
        return list(self._req("GET", "/items", headers={"X-Company-Id": company_id}).get("items") or [])

    def pricing_catalog(self, company_id: str) -> list[dict[str, Any]]:
        return list(self._req("GET", "/pricing/catalog", headers={"X-Company-Id": company_id}).get("items") or [])

    def bulk_prices(self, company_id: str, eff_from: str, lines: list[dict[str, str]]) -> None:
        self._req("POST", "/items/prices/bulk", {"effective_from": eff_from, "lines": lines}, headers={"X-Company-Id": company_id})

    def patch_item_cost(self, company_id: str, item_id: str, cost_usd: Decimal) -> None:
        self._req(
            "PATCH",
            f"/items/{quote(item_id, safe='')}",
            {"standard_cost_usd": str(cost_usd)},
            headers={"X-Company-Id": company_id},
        )

    def lookup_uom_conversions(self, company_id: str, item_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        out: dict[str, list[dict[str, Any]]] = {}
        ids = [str(i).strip() for i in (item_ids or []) if str(i).strip()]
        for batch in _chunks(ids, 500):
            res = self._req(
                "POST",
                "/items/uom-conversions/lookup",
                {"item_ids": batch},
                headers={"X-Company-Id": company_id},
            )
            part = dict(res.get("conversions") or {})
            out.update(part)
        return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", required=True, help="POS API base, e.g. https://api.melqard.com")
    ap.add_argument("--email", default=os.getenv("MELQARD_ADMIN_EMAIL") or "")
    ap.add_argument("--password", default=os.getenv("MELQARD_ADMIN_PASSWORD") or "")
    ap.add_argument("--erp-base", default=os.getenv("ERPNEXT_BASE_URL") or "https://erp.ahagetrading.com")
    ap.add_argument("--erp-key", default=os.getenv("ERPNEXT_API_KEY") or "")
    ap.add_argument("--erp-secret", default=os.getenv("ERPNEXT_API_SECRET") or "")
    ap.add_argument("--sell-price-list", default="Standard Selling")
    ap.add_argument("--buy-price-list", default="Standard Buying")
    ap.add_argument("--currency", default="USD")
    ap.add_argument("--effective-from", default=date.today().isoformat())
    ap.add_argument("--only-missing-price", action="store_true")
    ap.add_argument("--only-missing-cost", action="store_true")
    ap.add_argument("--skip-prices", action="store_true")
    ap.add_argument("--skip-costs", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.email or not args.password:
        _die("missing POS credentials: --email/--password (or MELQARD_ADMIN_*)")
    if not args.erp_key or not args.erp_secret:
        _die("missing ERP credentials: --erp-key/--erp-secret (or ERPNEXT_*)")

    try:
        # 1) Pull ERP items (for stock_uom + fallback costs)
        erp = ErpClient(str(args.erp_base), str(args.erp_key), str(args.erp_secret))
        item_meta: dict[str, dict[str, Any]] = {}
        for r in erp.iter_list(
            "Item",
            fields=["item_code", "stock_uom", "valuation_rate", "last_purchase_rate", "disabled"],
            page_size=1000,
        ):
            sku = str(r.get("item_code") or "").strip()
            if sku:
                item_meta[sku] = r

        # 2) Pull ERP selling/buying item prices and normalize to stock_uom
        sell_by_sku: dict[str, Decimal] = {}
        buy_by_sku: dict[str, Decimal] = {}
        doc_cache: dict[str, dict[str, Any]] = {}

        def normalize_to_stock_uom(sku: str, price_uom: str, raw_rate: Decimal) -> Optional[Decimal]:
            stock_uom = str((item_meta.get(sku) or {}).get("stock_uom") or "").strip()
            if not stock_uom or not price_uom or stock_uom == price_uom:
                return raw_rate
            doc = doc_cache.get(sku)
            if doc is None:
                doc = erp.get_item_doc(sku)
                doc_cache[sku] = doc
            factor = None
            for u in doc.get("uoms") or []:
                if str(u.get("uom") or "").strip() == price_uom:
                    f = _to_dec(u.get("conversion_factor"))
                    if f > 0:
                        factor = f
                    break
            if not factor:
                return None
            return raw_rate / factor

        def pull_price_list(price_list_name: str, out: dict[str, Decimal]) -> None:
            latest_vf: dict[str, str] = {}
            for r in erp.iter_list(
                "Item Price",
                fields=["item_code", "price_list", "price_list_rate", "currency", "uom", "valid_from"],
                filters=[["price_list", "=", price_list_name]],
                page_size=1000,
            ):
                sku = str(r.get("item_code") or "").strip()
                if not sku:
                    continue
                cur = str(r.get("currency") or "").strip()
                if cur and cur != str(args.currency):
                    continue
                raw_rate = _to_dec(r.get("price_list_rate"))
                if raw_rate <= 0:
                    continue
                normalized = normalize_to_stock_uom(sku, str(r.get("uom") or "").strip(), raw_rate)
                if normalized is None or normalized <= 0:
                    continue
                cur_vf = str(r.get("valid_from") or "")
                prev_vf = latest_vf.get(sku, "")
                # Latest valid_from wins where possible.
                if sku not in out or cur_vf >= prev_vf:
                    out[sku] = normalized
                    latest_vf[sku] = cur_vf

        pull_price_list(str(args.sell_price_list), sell_by_sku)
        pull_price_list(str(args.buy_price_list), buy_by_sku)

        # 3) Pull POS companies/items/current effective prices
        pos = PosClient(str(args.api_base))
        pos.login(str(args.email), str(args.password))
        companies = pos.get_companies()
        if not companies:
            _die("no POS companies found")

        summary: list[dict[str, Any]] = []
        for c in companies:
            cid = str(c.get("id") or "")
            cname = str(c.get("name") or "")
            items = pos.list_items(cid)
            price_catalog = pos.pricing_catalog(cid) if not args.skip_prices else []
            current_price_by_sku = {str(r.get("sku") or ""): _to_dec(r.get("price_usd")) for r in price_catalog}

            item_ids = [str(it.get("id") or "").strip() for it in items if str(it.get("id") or "").strip()]
            conv_by_item = pos.lookup_uom_conversions(cid, item_ids) if item_ids else {}
            stock_to_base_factor_by_item: dict[str, Decimal] = {}
            missing_stock_to_base = 0

            for it in items:
                iid = str(it.get("id") or "").strip()
                sku = str(it.get("sku") or "").strip()
                if not iid or not sku:
                    continue
                base_uom = _norm_uom(it.get("unit_of_measure"))
                stock_uom = _norm_uom((item_meta.get(sku) or {}).get("stock_uom"))

                f = Decimal("1")
                if stock_uom and base_uom and stock_uom != base_uom:
                    found = Decimal("0")
                    for row in (conv_by_item.get(iid) or []):
                        if _norm_uom(row.get("uom_code")) != stock_uom:
                            continue
                        v = _to_dec(row.get("to_base_factor"))
                        if v > 0:
                            found = v
                            break
                    if found <= 0:
                        missing_stock_to_base += 1
                        continue
                    f = found
                stock_to_base_factor_by_item[iid] = f

            price_lines: list[dict[str, str]] = []
            cost_updates: list[tuple[str, Decimal, Decimal]] = []  # (item_id, old, new)
            for it in items:
                sku = str(it.get("sku") or "")
                if not sku:
                    continue
                iid = str(it.get("id") or "")
                if not iid:
                    continue
                stock_to_base = stock_to_base_factor_by_item.get(iid)
                if not stock_to_base or stock_to_base <= 0:
                    continue

                # Prices
                if not args.skip_prices:
                    sell = sell_by_sku.get(sku)
                    if sell and sell > 0:
                        sell = sell / stock_to_base
                        if sell <= 0:
                            continue
                        curp = current_price_by_sku.get(sku, Decimal("0"))
                        if args.only_missing_price and curp > 0:
                            pass
                        else:
                            price_lines.append({"sku": sku, "price_usd": str(sell), "price_lbp": "0"})

                # Costs
                if not args.skip_costs:
                    buy = buy_by_sku.get(sku)
                    if buy and buy > 0:
                        buy = buy / stock_to_base
                        # Align with DB numeric(18,4) precision to avoid infinite no-op rewrites.
                        buy = buy.quantize(Decimal("0.0001"))
                        old_cost = _to_dec(it.get("standard_cost_usd")).quantize(Decimal("0.0001"))
                        if args.only_missing_cost and old_cost > 0:
                            pass
                        else:
                            if iid and old_cost != buy:
                                cost_updates.append((iid, old_cost, buy))

            rec = {
                "company": cname,
                "company_id": cid,
                "items_total": len(items),
                "price_rows_prepared": len(price_lines),
                "cost_rows_prepared": len(cost_updates),
                "price_rows_applied": 0,
                "cost_rows_applied": 0,
                "items_missing_stock_to_base_factor": int(missing_stock_to_base),
            }

            if not args.dry_run:
                if price_lines:
                    applied = 0
                    for batch in _chunks(price_lines, 1000):
                        pos.bulk_prices(cid, str(args.effective_from), batch)
                        applied += len(batch)
                    rec["price_rows_applied"] = applied

                if cost_updates:
                    applied = 0
                    for item_id, _old, new_cost in cost_updates:
                        pos.patch_item_cost(cid, item_id, new_cost)
                        applied += 1
                    rec["cost_rows_applied"] = applied

            summary.append(rec)

        print(
            json.dumps(
                {
                    "ok": True,
                    "dry_run": bool(args.dry_run),
                    "api_base": args.api_base,
                    "erp_base": args.erp_base,
                    "sell_price_list": args.sell_price_list,
                    "buy_price_list": args.buy_price_list,
                    "currency": args.currency,
                    "effective_from": args.effective_from,
                    "erp_items": len(item_meta),
                    "erp_sell_prices": len(sell_by_sku),
                    "erp_buy_costs": len(buy_by_sku),
                    "companies": summary,
                },
                indent=2,
            )
        )
        return 0
    except Exception as e:
        _die(str(e))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
