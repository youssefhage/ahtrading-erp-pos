#!/usr/bin/env python3
"""
Enforce ERPNext -> Cloud item company alignment for AH Trading.

Why:
- Prevent sellable items from being active in the wrong company.
- Keep a single active copy per SKU based on ERP Item Default (latest row).

What it does:
1) Reads ERP Item docs and resolves target company from latest Item Default row.
2) Upserts target-company item/UOM/barcode (+ optional price).
3) Deactivates active copies in the other company.
4) Verifies active placement.

Notes:
- Inactive historical rows may still exist in the non-target company by design.
- Optional price sync writes both item_prices and default price-list rows so
  /pricing/catalog reflects ERP price.
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


def _uom(v: Any) -> str:
    return str(v or "").strip().upper()


def _chunks(xs: list[Any], n: int):
    for i in range(0, len(xs), n):
        yield xs[i : i + n]


@dataclass(frozen=True)
class ErpClient:
    base_url: str
    api_key: str
    api_secret: str
    timeout_s: int = 90

    def _req_json(self, method: str, path: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        url = self.base_url.rstrip("/") + path
        if params:
            url += "?" + urlencode(params, doseq=True)
        req = Request(
            url,
            method=method.upper(),
            headers={
                "Authorization": f"token {self.api_key}:{self.api_secret}",
                "Accept": "application/json",
                "User-Agent": "codex-company-alignment/1.0",
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
            time.sleep(0.03)

    def get_item_doc(self, sku: str) -> dict[str, Any]:
        return dict(self._req_json("GET", f"/api/resource/Item/{quote(sku, safe='')}").get("data") or {})


class PosClient:
    def __init__(self, api_base: str, timeout_s: int = 90, retries: int = 4):
        self.api_base = api_base.rstrip("/") + "/"
        self.timeout_s = int(timeout_s)
        self.retries = int(retries)
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))

    def _req(self, method: str, path: str, body: Optional[dict] = None, headers: Optional[dict[str, str]] = None) -> Any:
        url = self.api_base + path.lstrip("/")
        data = None
        hdrs = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "codex-company-alignment/1.0"}
        if headers:
            hdrs.update(headers)
        if body is not None:
            data = json.dumps(body, default=str).encode("utf-8")
        last_err: Optional[Exception] = None
        for attempt in range(self.retries + 1):
            req = Request(url=url, method=method.upper(), headers=hdrs, data=data)
            try:
                with self.opener.open(req, timeout=self.timeout_s) as resp:
                    raw = resp.read().decode("utf-8") if resp is not None else ""
                    return json.loads(raw) if raw else {}
            except HTTPError as e:
                raw = ""
                try:
                    raw = e.read().decode("utf-8", errors="replace")
                except Exception:
                    raw = ""
                if e.code in {429, 500, 502, 503, 504} and attempt < self.retries:
                    time.sleep(min(2**attempt, 8))
                    continue
                last_err = RuntimeError(f"POS {method} {path} -> HTTP {e.code}: {raw[:300]}")
                break
            except URLError as e:
                if attempt < self.retries:
                    time.sleep(min(2**attempt, 8))
                    continue
                last_err = RuntimeError(f"POS {method} {path} -> network error: {e}")
                break
        if last_err:
            raise last_err
        return {}

    def login(self, email: str, password: str) -> None:
        self._req("POST", "/auth/login", {"email": email, "password": password})

    def get_companies(self) -> list[dict[str, Any]]:
        return list(self._req("GET", "/companies").get("companies") or [])

    def list_items(self, company_id: str) -> list[dict[str, Any]]:
        return list(self._req("GET", "/items", headers={"X-Company-Id": company_id}).get("items") or [])

    def list_items_min(self, company_id: str, include_inactive: bool = False) -> list[dict[str, Any]]:
        q = "/items/min?include_inactive=true" if include_inactive else "/items/min"
        return list(self._req("GET", q, headers={"X-Company-Id": company_id}).get("items") or [])

    def bulk_items(self, company_id: str, rows: list[dict[str, Any]]) -> None:
        self._req("POST", "/items/bulk", {"items": rows}, headers={"X-Company-Id": company_id})

    def bulk_uoms(self, company_id: str, rows: list[dict[str, Any]]) -> None:
        self._req("POST", "/items/uom-conversions/bulk", {"lines": rows}, headers={"X-Company-Id": company_id})

    def bulk_barcodes(self, company_id: str, rows: list[dict[str, Any]]) -> None:
        self._req("POST", "/items/barcodes/bulk", {"lines": rows}, headers={"X-Company-Id": company_id})

    def bulk_prices(self, company_id: str, effective_from: str, rows: list[dict[str, Any]]) -> None:
        self._req("POST", "/items/prices/bulk", {"effective_from": effective_from, "lines": rows}, headers={"X-Company-Id": company_id})

    def patch_item(self, company_id: str, item_id: str, patch: dict[str, Any]) -> None:
        self._req("PATCH", f"/items/{quote(item_id, safe='')}", patch, headers={"X-Company-Id": company_id})

    def list_item_barcodes(self, company_id: str, item_id: str) -> list[dict[str, Any]]:
        return list(self._req("GET", f"/items/{quote(item_id, safe='')}/barcodes", headers={"X-Company-Id": company_id}).get("barcodes") or [])

    def delete_item_barcode(self, company_id: str, barcode_id: str) -> None:
        self._req("DELETE", f"/items/barcodes/{quote(barcode_id, safe='')}", headers={"X-Company-Id": company_id})

    def list_item_uom_conversions(self, company_id: str, item_id: str) -> list[dict[str, Any]]:
        return list(
            self._req("GET", f"/items/{quote(item_id, safe='')}/uom-conversions", headers={"X-Company-Id": company_id}).get("conversions") or []
        )

    def delete_item_uom_conversion(self, company_id: str, item_id: str, uom_code: str) -> None:
        self._req(
            "DELETE",
            f"/items/{quote(item_id, safe='')}/uom-conversions/{quote(str(uom_code or ''), safe='')}",
            headers={"X-Company-Id": company_id},
        )

    def get_company_settings(self, company_id: str) -> list[dict[str, Any]]:
        return list(self._req("GET", "/pricing/company-settings", headers={"X-Company-Id": company_id}).get("settings") or [])

    def get_tax_codes(self, company_id: str) -> list[dict[str, Any]]:
        return list(self._req("GET", "/config/tax-codes", headers={"X-Company-Id": company_id}).get("tax_codes") or [])

    def upsert_price_list_item(self, company_id: str, list_id: str, item_id: str, price_usd: Decimal, effective_from: str) -> None:
        self._req(
            "POST",
            f"/pricing/lists/{quote(list_id, safe='')}/items",
            {
                "item_id": item_id,
                "price_usd": str(price_usd),
                "price_lbp": "0",
                "effective_from": effective_from,
                "effective_to": None,
            },
            headers={"X-Company-Id": company_id},
        )


def _target_from_item_defaults(doc: dict[str, Any]) -> Optional[str]:
    rows = list(doc.get("item_defaults") or [])
    if not rows:
        return None

    def _k(r: dict[str, Any]) -> tuple[int, str, str]:
        return (
            int(r.get("idx") or 0),
            str(r.get("creation") or ""),
            str(r.get("modified") or ""),
        )

    rows_sorted = sorted(rows, key=_k)
    latest = rows_sorted[-1]
    cname = str(latest.get("company") or "").strip()
    if cname in {"Antoine Hage Trading", "ACOUNTING COMPANY"}:
        return "official"
    if cname == "UNDISCLOSED COMPANY":
        return "unofficial"
    return None


def _erp_item_tax_template(doc: dict[str, Any]) -> str:
    rows = list(doc.get("taxes") or [])
    if not rows:
        return ""

    def _k(r: dict[str, Any]) -> tuple[int, str, str]:
        return (
            int(r.get("idx") or 0),
            str(r.get("creation") or ""),
            str(r.get("modified") or ""),
        )

    rows_sorted = sorted(rows, key=_k)
    return str((rows_sorted[-1] or {}).get("item_tax_template") or "").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", required=True, help="POS API base, e.g. https://api.melqard.com")
    ap.add_argument("--email", default=os.getenv("MELQARD_ADMIN_EMAIL") or "")
    ap.add_argument("--password", default=os.getenv("MELQARD_ADMIN_PASSWORD") or "")
    ap.add_argument("--erp-base", default=os.getenv("ERPNEXT_BASE_URL") or "https://erp.ahagetrading.com")
    ap.add_argument("--erp-key", default=os.getenv("ERPNEXT_API_KEY") or "")
    ap.add_argument("--erp-secret", default=os.getenv("ERPNEXT_API_SECRET") or "")
    ap.add_argument("--since", default="", help="Optional ERP Item.modified >= YYYY-MM-DD")
    ap.add_argument("--max-items", type=int, default=0, help="Debug cap; 0 means all")
    ap.add_argument("--workers-note", default="", help="Reserved flag for future parallel version.")
    ap.add_argument("--skip-prices", action="store_true", help="Skip ERP price sync")
    ap.add_argument(
        "--allow-active-without-price",
        action="store_true",
        help="Allow ERP-active items to stay active even when ERP has no positive Standard Selling USD price.",
    )
    ap.add_argument(
        "--sterilize-wrong-company",
        action="store_true",
        help="For wrong-company copies, remove barcodes/non-base UOM conversions and force inactive.",
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out-json", default=".cache/erp_company_alignment_enforcement.json")
    args = ap.parse_args()

    if not args.email or not args.password:
        _die("missing POS credentials: --email/--password")
    if not args.erp_key or not args.erp_secret:
        _die("missing ERP credentials: --erp-key/--erp-secret")

    erp = ErpClient(str(args.erp_base), str(args.erp_key), str(args.erp_secret))
    pos = PosClient(str(args.api_base))

    # ERP universe
    item_filters: list[Any] = []
    if args.since:
        item_filters.append(["modified", ">=", str(args.since)])
    erp_items = list(
        erp.iter_list(
            "Item",
            fields=["item_code", "modified", "disabled"],
            filters=(item_filters or None),
            page_size=1000,
        )
    )
    if args.max_items and int(args.max_items) > 0:
        erp_items = erp_items[: int(args.max_items)]
    skus = [str(r.get("item_code") or "").strip() for r in erp_items if str(r.get("item_code") or "").strip()]

    # Pull latest ERP selling price by SKU for provided universe.
    latest_sell: dict[str, dict[str, Any]] = {}
    require_price_for_active = not bool(args.allow_active_without_price)
    need_latest_sell = (not args.skip_prices) or require_price_for_active
    if need_latest_sell and skus:
        sku_set = set(skus)
        for r in erp.iter_list(
            "Item Price",
            fields=["item_code", "price_list_rate", "currency", "uom", "valid_from", "modified", "price_list"],
            filters=[["price_list", "=", "Standard Selling"], ["currency", "=", "USD"]],
            page_size=1000,
        ):
            sku = str(r.get("item_code") or "").strip()
            if sku not in sku_set:
                continue
            k = (str(r.get("valid_from") or ""), str(r.get("modified") or ""))
            prev = latest_sell.get(sku)
            if prev is None or k > (str(prev.get("valid_from") or ""), str(prev.get("modified") or "")):
                latest_sell[sku] = dict(r)

    # Resolve ERP docs and target company.
    resolved: dict[str, dict[str, Any]] = {}
    unresolved: list[str] = []
    for i, sku in enumerate(skus, 1):
        doc = erp.get_item_doc(sku)
        target = _target_from_item_defaults(doc)
        if not target:
            unresolved.append(sku)
            continue
        resolved[sku] = doc
        if i % 250 == 0:
            print(f"progress: ERP docs {i}/{len(skus)}")

    # Cloud base data
    pos.login(str(args.email), str(args.password))
    companies = pos.get_companies()
    by_name = {str(c.get("name") or ""): str(c.get("id") or "") for c in companies}
    official_id = by_name.get("AH Trading Official") or ""
    unofficial_id = by_name.get("AH Trading Unofficial") or ""
    if not official_id or not unofficial_id:
        _die("missing cloud companies: AH Trading Official / AH Trading Unofficial")

    off_items = pos.list_items(official_id)
    un_items = pos.list_items(unofficial_id)
    off_by_sku = {str(i.get("sku") or "").strip(): i for i in off_items if str(i.get("sku") or "").strip()}
    un_by_sku = {str(i.get("sku") or "").strip(): i for i in un_items if str(i.get("sku") or "").strip()}
    tax_name_by_id: dict[str, dict[str, str]] = {}
    tax_names: dict[str, set[str]] = {}
    for cid in [official_id, unofficial_id]:
        try:
            codes = pos.get_tax_codes(cid)
        except Exception:
            codes = []
        by_id: dict[str, str] = {}
        by_name: set[str] = set()
        for c in codes:
            tid = str(c.get("id") or "").strip()
            tname = str(c.get("name") or "").strip()
            if tid and tname:
                by_id[tid] = tname
                by_name.add(tname)
        tax_name_by_id[cid] = by_id
        tax_names[cid] = by_name

    # Default price list ids (for pricing/catalog safety).
    default_pl_by_company: dict[str, str] = {}
    if not args.skip_prices:
        for cid in [official_id, unofficial_id]:
            settings = pos.get_company_settings(cid)
            pl_id = ""
            for s in settings:
                if str(s.get("key") or "").strip() == "default_price_list_id":
                    pl_id = str((s.get("value_json") or {}).get("id") or "").strip()
                    break
            default_pl_by_company[cid] = pl_id

    payload = {
        official_id: {"items": [], "uoms": [], "barcodes": [], "prices": [], "target_skus": []},
        unofficial_id: {"items": [], "uoms": [], "barcodes": [], "prices": [], "target_skus": []},
    }
    to_deactivate: list[dict[str, str]] = []
    to_sterilize: list[dict[str, str]] = []
    move_counts = {"to_official": 0, "to_unofficial": 0, "already_aligned": 0}
    action_skus: list[str] = []
    forced_inactive_no_price_count = 0

    for sku, doc in resolved.items():
        target = _target_from_item_defaults(doc)
        if target not in {"official", "unofficial"}:
            continue

        target_id = official_id if target == "official" else unofficial_id
        source_id = unofficial_id if target == "official" else official_id
        target_map = off_by_sku if target == "official" else un_by_sku
        source_map = un_by_sku if target == "official" else off_by_sku

        in_target = sku in target_map
        in_source = sku in source_map
        target_item = target_map.get(sku) or {}
        source_item = source_map.get(sku) or {}

        stock_uom = _uom(doc.get("stock_uom") or "EA")
        item_name = str(doc.get("item_name") or sku).strip() or sku
        erp_active = not bool(int(doc.get("disabled") or 0))
        valuation = _to_dec(doc.get("valuation_rate"))
        erp_tax_template = _erp_item_tax_template(doc)

        conv: dict[str, Decimal] = {stock_uom: Decimal("1")}
        for r in doc.get("uoms") or []:
            cu = _uom(r.get("uom"))
            cf = _to_dec(r.get("conversion_factor"))
            if cu and cf > 0:
                conv[cu] = cf

        # Normalize latest ERP selling price to stock UOM.
        sell_price_stock = Decimal("0")
        pr = latest_sell.get(sku)
        if pr is not None:
            raw = _to_dec(pr.get("price_list_rate"))
            pu = _uom(pr.get("uom") or stock_uom)
            if raw > 0:
                if pu == stock_uom:
                    sell_price_stock = raw
                elif {pu, stock_uom} == {"PC", "UNIT"}:
                    # Legacy alias fallback used elsewhere in ops scripts.
                    sell_price_stock = raw
                else:
                    f = conv.get(pu, Decimal("0"))
                    if f > 0:
                        sell_price_stock = raw / f

        has_sell_price = sell_price_stock > 0
        target_active_value = bool(erp_active and (args.allow_active_without_price or has_sell_price))
        if erp_active and require_price_for_active and (not has_sell_price):
            forced_inactive_no_price_count += 1

        source_active = bool(source_item.get("is_active")) if source_item else False
        target_missing = not in_target
        target_active_mismatch = in_target and (bool(target_item.get("is_active")) != target_active_value)
        needs_action = target_missing or target_active_mismatch or source_active

        if in_target and (not in_source) and (not target_active_mismatch):
            move_counts["already_aligned"] += 1
        else:
            if target == "official":
                move_counts["to_official"] += 1
            else:
                move_counts["to_unofficial"] += 1

        if not needs_action:
            continue

        action_skus.append(sku)
        existing_tax_name = ""
        if in_target:
            etid = str((target_item or {}).get("tax_code_id") or "").strip()
            if etid:
                existing_tax_name = str((tax_name_by_id.get(target_id) or {}).get(etid) or "").strip()

        mapped_tax_name = existing_tax_name
        if target == "official":
            # Align official company tax to ERP template when template is recognized in POS.
            if erp_tax_template in {"11%", "0%"} and erp_tax_template in (tax_names.get(target_id) or set()):
                mapped_tax_name = erp_tax_template
            elif not mapped_tax_name:
                mapped_tax_name = ""
        else:
            # Unofficial company policy: no VAT.
            mapped_tax_name = ""

        payload[target_id]["items"].append(
            {
                "sku": sku,
                "name": item_name,
                "unit_of_measure": stock_uom,
                "is_active": target_active_value,
                "barcode": None,
                "tax_code_name": (mapped_tax_name or None),
                "reorder_point": 0,
                "reorder_qty": 0,
                "standard_cost_usd": (str(valuation) if valuation > 0 else None),
                "standard_cost_lbp": None,
            }
        )
        payload[target_id]["target_skus"].append(sku)
        for cu, cf in conv.items():
            payload[target_id]["uoms"].append({"sku": sku, "uom_code": cu, "to_base_factor": str(cf), "is_active": True})

        seen = set()
        for b in doc.get("barcodes") or []:
            code = str(b.get("barcode") or "").strip()
            if not code:
                continue
            bu = _uom(b.get("uom") or stock_uom)
            bf = conv.get(bu)
            if bf is None or bf <= 0:
                continue
            k = (code, bu, str(bf))
            if k in seen:
                continue
            seen.add(k)
            payload[target_id]["barcodes"].append(
                {
                    "sku": sku,
                    "barcode": code,
                    "uom_code": bu,
                    "qty_factor": str(bf),
                    "is_primary": False,
                }
            )

        if not args.skip_prices:
            if sell_price_stock > 0:
                payload[target_id]["prices"].append({"sku": sku, "price_usd": str(sell_price_stock), "price_lbp": "0"})

        src_it = source_map.get(sku)
        if src_it and src_it.get("id"):
            to_sterilize.append(
                {
                    "company_id": source_id,
                    "item_id": str(src_it["id"]),
                    "sku": sku,
                    "base_uom": _uom(src_it.get("unit_of_measure")),
                }
            )
        if src_it and src_it.get("id") and bool(src_it.get("is_active")):
            to_deactivate.append({"company_id": source_id, "item_id": str(src_it["id"]), "sku": sku})

    unresolved_active = []
    for sku in unresolved:
        off_it = off_by_sku.get(sku)
        un_it = un_by_sku.get(sku)
        off_active = bool((off_it or {}).get("is_active"))
        un_active = bool((un_it or {}).get("is_active"))
        if off_active or un_active:
            unresolved_active.append(
                {
                    "sku": sku,
                    "active_in_official": off_active,
                    "active_in_unofficial": un_active,
                }
            )

    summary: dict[str, Any] = {
        "since": str(args.since or ""),
        "items_scanned": len(skus),
        "items_resolved": len(resolved),
        "items_unresolved_no_target": len(unresolved),
        "require_price_for_active": require_price_for_active,
        "forced_inactive_no_price_count": forced_inactive_no_price_count,
        "unresolved_active_count": len(unresolved_active),
        "unresolved_active_sample": unresolved_active[:100],
        "move_counts": move_counts,
        "action_skus_count": len(action_skus),
        "action_skus_sample": action_skus[:100],
        "planned": {
            "items_upsert": len(payload[official_id]["items"]) + len(payload[unofficial_id]["items"]),
            "uoms_upsert": len(payload[official_id]["uoms"]) + len(payload[unofficial_id]["uoms"]),
            "barcodes_upsert": len(payload[official_id]["barcodes"]) + len(payload[unofficial_id]["barcodes"]),
            "prices_upsert": len(payload[official_id]["prices"]) + len(payload[unofficial_id]["prices"]),
            "deactivate_in_other_company": len(to_deactivate),
            "sterilize_wrong_company_copies": len(to_sterilize) if bool(args.sterilize_wrong_company) else 0,
        },
        "dry_run": bool(args.dry_run),
    }

    if not args.dry_run:
        applied = {
            "items": 0,
            "uoms": 0,
            "barcodes": 0,
            "prices": 0,
            "deactivated": 0,
            "sterilized_items": 0,
            "sterilized_barcodes_deleted": 0,
            "sterilized_uoms_deleted": 0,
            "price_list_rows": 0,
            "errors": [],
        }
        for cid in [official_id, unofficial_id]:
            try:
                for b in _chunks(payload[cid]["items"], 200):
                    if b:
                        pos.bulk_items(cid, b)
                        applied["items"] += len(b)
                for b in _chunks(payload[cid]["uoms"], 500):
                    if b:
                        pos.bulk_uoms(cid, b)
                        applied["uoms"] += len(b)
                for b in _chunks(payload[cid]["barcodes"], 500):
                    if b:
                        pos.bulk_barcodes(cid, b)
                        applied["barcodes"] += len(b)
                if not args.skip_prices:
                    for b in _chunks(payload[cid]["prices"], 500):
                        if b:
                            pos.bulk_prices(cid, date.today().isoformat(), b)
                            applied["prices"] += len(b)
            except Exception as e:
                applied["errors"].append({"company_id": cid, "stage": "bulk_upsert", "error": str(e)[:500]})

        # Deactivate wrong-company copies.
        for row in to_deactivate:
            try:
                pos.patch_item(row["company_id"], row["item_id"], {"is_active": False})
                applied["deactivated"] += 1
            except Exception as e:
                applied["errors"].append({"company_id": row["company_id"], "sku": row["sku"], "stage": "deactivate", "error": str(e)[:500]})

        # Optionally sterilize wrong-company copies to reduce scan/lookup ambiguity.
        if bool(args.sterilize_wrong_company):
            for row in to_sterilize:
                cid = str(row.get("company_id") or "")
                iid = str(row.get("item_id") or "")
                sku = str(row.get("sku") or "")
                base_uom = _uom(row.get("base_uom"))
                if not cid or not iid:
                    continue
                try:
                    pos.patch_item(cid, iid, {"is_active": False, "barcode": None})
                    applied["sterilized_items"] += 1
                except Exception as e:
                    applied["errors"].append({"company_id": cid, "sku": sku, "stage": "sterilize_patch", "error": str(e)[:500]})

                try:
                    bcs = pos.list_item_barcodes(cid, iid)
                    for b in bcs:
                        bid = str(b.get("id") or "").strip()
                        if not bid:
                            continue
                        pos.delete_item_barcode(cid, bid)
                        applied["sterilized_barcodes_deleted"] += 1
                except Exception as e:
                    applied["errors"].append({"company_id": cid, "sku": sku, "stage": "sterilize_barcodes", "error": str(e)[:500]})

                try:
                    convs = pos.list_item_uom_conversions(cid, iid)
                    for c in convs:
                        cu = _uom(c.get("uom_code"))
                        if not cu or (base_uom and cu == base_uom):
                            continue
                        pos.delete_item_uom_conversion(cid, iid, cu)
                        applied["sterilized_uoms_deleted"] += 1
                except Exception as e:
                    applied["errors"].append({"company_id": cid, "sku": sku, "stage": "sterilize_uoms", "error": str(e)[:500]})

        # Ensure default price list reflects ERP price for touched rows.
        if not args.skip_prices:
            off_now = pos.list_items(official_id)
            un_now = pos.list_items(unofficial_id)
            off_now_by_sku = {str(i.get("sku") or "").strip(): i for i in off_now if str(i.get("sku") or "").strip()}
            un_now_by_sku = {str(i.get("sku") or "").strip(): i for i in un_now if str(i.get("sku") or "").strip()}
            for cid, map_now in [(official_id, off_now_by_sku), (unofficial_id, un_now_by_sku)]:
                pl_id = default_pl_by_company.get(cid) or ""
                if not pl_id:
                    continue
                for ln in payload[cid]["prices"]:
                    sku = str(ln.get("sku") or "").strip()
                    item = map_now.get(sku)
                    if not item or not item.get("id"):
                        continue
                    p = _to_dec(ln.get("price_usd"))
                    if p <= 0:
                        continue
                    try:
                        pos.upsert_price_list_item(cid, pl_id, str(item["id"]), p, date.today().isoformat())
                        applied["price_list_rows"] += 1
                    except Exception as e:
                        applied["errors"].append({"company_id": cid, "sku": sku, "stage": "price_list_row", "error": str(e)[:500]})

        # Verify active placement.
        act_off = {str(i.get("sku") or "").strip() for i in pos.list_items_min(official_id, include_inactive=False)}
        act_un = {str(i.get("sku") or "").strip() for i in pos.list_items_min(unofficial_id, include_inactive=False)}
        active_mismatch = []
        for sku, doc in resolved.items():
            target = _target_from_item_defaults(doc)
            expected_active = not bool(int(doc.get("disabled") or 0))
            in_off = sku in act_off
            in_un = sku in act_un
            if expected_active:
                if target == "official":
                    if (not in_off) or in_un:
                        active_mismatch.append({"sku": sku, "expected": "official", "active_in_official": in_off, "active_in_unofficial": in_un})
                elif target == "unofficial":
                    if (not in_un) or in_off:
                        active_mismatch.append({"sku": sku, "expected": "unofficial", "active_in_official": in_off, "active_in_unofficial": in_un})
            else:
                # Disabled ERP items should not be active in either company.
                if in_off or in_un:
                    active_mismatch.append({"sku": sku, "expected": "disabled", "active_in_official": in_off, "active_in_unofficial": in_un})

        summary["applied"] = applied
        summary["verify_active_mismatch_count"] = len(active_mismatch)
        summary["verify_active_mismatch_examples"] = active_mismatch[:50]
        summary["ok"] = len(applied["errors"]) == 0 and len(active_mismatch) == 0

    with open(str(args.out_json), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
