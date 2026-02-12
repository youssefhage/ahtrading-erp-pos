#!/usr/bin/env python3
"""
Create Wholesale/Retail price lists in the hosted POS system and backfill Wholesale
from current effective item prices.

Why:
- Today we price via item_prices (fallback mechanism).
- Creating a default WHOLESALE price list + backfilling gives us a clean structure
  to later add RETAIL overrides without changing the existing effective prices.

What it does (per company):
1) Ensure price lists exist:
   - WHOLESALE (default)
   - RETAIL (non-default)
2) Set company setting default_price_list_id -> WHOLESALE list id
3) Backfill WHOLESALE price_list_items using /pricing/catalog "effective price"
   (which already falls back to item_prices when the list is empty).

Safety:
- Skips zero prices so we don't override item_prices with 0.
- By default, aborts backfill if the WHOLESALE list already has any items (to
  avoid creating duplicates; price_list_items currently has no unique constraint).

Usage:
  MELQARD_ADMIN_EMAIL=... MELQARD_ADMIN_PASSWORD=... \\
    python3 scripts/setup_price_lists_wholesale_retail.py --api-base https://app.melqard.com/api
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener

import http.cookiejar


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _norm(v: Any) -> str:
    return str(v or "").strip()


def _to_dec(v: Any) -> Decimal:
    try:
        s = _norm(v)
        return Decimal(s) if s else Decimal("0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _chunks(seq: list[Any], n: int):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


@dataclass
class ApiClient:
    api_base: str
    timeout_s: int = 60
    max_retries: int = 5

    def __post_init__(self) -> None:
        self.api_base = self.api_base.rstrip("/") + "/"
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))

    def _req(self, method: str, path: str, body: Optional[dict] = None, headers: Optional[dict[str, str]] = None) -> Any:
        url = urljoin(self.api_base, path.lstrip("/"))
        data = None
        hdrs = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "codex-price-lists/1.0"}
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
                # Retry transient errors / rate-limits.
                if e.code in {429, 500, 502, 503, 504} and attempt < self.max_retries:
                    time.sleep(min(2 ** attempt, 10))
                    attempt += 1
                    continue
                try:
                    detail = json.loads(raw).get("detail") if raw else None
                except Exception:
                    detail = raw or None
                raise RuntimeError(f"{method} {url} -> HTTP {e.code}: {detail}") from None
            except URLError as e:
                if attempt < self.max_retries:
                    time.sleep(min(2 ** attempt, 10))
                    attempt += 1
                    continue
                raise RuntimeError(f"{method} {url} -> network error: {e}") from None

    def login(self, email: str, password: str) -> None:
        self._req("POST", "/auth/login", {"email": email, "password": password})

    def companies(self) -> list[dict[str, Any]]:
        return list(self._req("GET", "/companies").get("companies") or [])

    def list_price_lists(self, company_id: str) -> list[dict[str, Any]]:
        return list(self._req("GET", "/pricing/lists", headers={"X-Company-Id": company_id}).get("lists") or [])

    def create_price_list(self, company_id: str, code: str, name: str, currency: str = "USD", is_default: bool = False) -> str:
        res = self._req(
            "POST",
            "/pricing/lists",
            {"code": code, "name": name, "currency": currency, "is_default": bool(is_default)},
            headers={"X-Company-Id": company_id},
        )
        return str(res.get("id") or "").strip()

    def patch_price_list(self, company_id: str, list_id: str, patch: dict[str, Any]) -> None:
        self._req("PATCH", f"/pricing/lists/{quote(list_id, safe='')}", patch, headers={"X-Company-Id": company_id})

    def upsert_company_setting(self, company_id: str, key: str, value_json: dict[str, Any]) -> None:
        self._req(
            "POST",
            "/pricing/company-settings",
            {"key": key, "value_json": value_json},
            headers={"X-Company-Id": company_id},
        )

    def pricing_catalog(self, company_id: str) -> list[dict[str, Any]]:
        return list(self._req("GET", "/pricing/catalog", headers={"X-Company-Id": company_id}).get("items") or [])

    def list_price_list_items_sample(self, company_id: str, list_id: str) -> list[dict[str, Any]]:
        # Endpoint returns max 500; we only need to know "is it empty?"
        return list(
            self._req("GET", f"/pricing/lists/{quote(list_id, safe='')}/items", headers={"X-Company-Id": company_id}).get("items") or []
        )

    def add_price_list_item(self, company_id: str, list_id: str, item_id: str, price_usd: Decimal, price_lbp: Decimal, eff_from: str) -> None:
        self._req(
            "POST",
            f"/pricing/lists/{quote(list_id, safe='')}/items",
            {
                "item_id": item_id,
                "price_usd": str(price_usd),
                "price_lbp": str(price_lbp),
                "effective_from": eff_from,
                "effective_to": None,
            },
            headers={"X-Company-Id": company_id},
        )


def ensure_lists(cli: ApiClient, company_id: str, wholesale_code: str, retail_code: str, currency: str) -> tuple[str, str]:
    lists = cli.list_price_lists(company_id)
    by_code = {str(l.get("code") or "").strip().upper(): l for l in lists}

    w = by_code.get(wholesale_code)
    r = by_code.get(retail_code)

    wholesale_id = str(w.get("id")) if w else ""
    retail_id = str(r.get("id")) if r else ""

    if not wholesale_id:
        wholesale_id = cli.create_price_list(company_id, wholesale_code, "Wholesale", currency=currency, is_default=True)
        if not wholesale_id:
            _die(f"failed to create price list {wholesale_code} for company_id={company_id}")
    else:
        # Make sure it shows as default in UI.
        cli.patch_price_list(company_id, wholesale_id, {"is_default": True})

    if not retail_id:
        retail_id = cli.create_price_list(company_id, retail_code, "Retail", currency=currency, is_default=False)
        if not retail_id:
            _die(f"failed to create price list {retail_code} for company_id={company_id}")
    else:
        # Ensure retail isn't default.
        cli.patch_price_list(company_id, retail_id, {"is_default": False})

    # Actual default used by pricing logic:
    cli.upsert_company_setting(company_id, "default_price_list_id", {"id": wholesale_id})

    return wholesale_id, retail_id


def backfill_wholesale(
    cli: ApiClient,
    company_id: str,
    wholesale_list_id: str,
    effective_from: str,
    max_workers: int,
    allow_nonempty: bool,
) -> dict[str, Any]:
    existing = cli.list_price_list_items_sample(company_id, wholesale_list_id)
    if existing and not allow_nonempty:
        return {"skipped": True, "reason": "wholesale_list_not_empty", "existing_sample": len(existing)}

    items = cli.pricing_catalog(company_id)
    # Only backfill positive prices; never insert 0 because it would override fallback pricing.
    lines = []
    for it in items:
        iid = _norm(it.get("id"))
        p_usd = _to_dec(it.get("price_usd"))
        p_lbp = _to_dec(it.get("price_lbp"))
        if not iid:
            continue
        if p_usd <= 0 and p_lbp <= 0:
            continue
        lines.append((iid, p_usd, p_lbp))

    ok = 0
    failed = 0
    failures: list[dict[str, Any]] = []

    def push_one(args: tuple[str, Decimal, Decimal]) -> None:
        iid, p_usd, p_lbp = args
        cli.add_price_list_item(company_id, wholesale_list_id, iid, p_usd, p_lbp, effective_from)

    # Keep a cap on concurrency to avoid rate limiting.
    workers = max(1, min(int(max_workers or 8), 24))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(push_one, ln): ln for ln in lines}
        for fut in as_completed(futs):
            ln = futs[fut]
            try:
                fut.result()
                ok += 1
            except Exception as e:
                failed += 1
                iid, p_usd, p_lbp = ln
                failures.append({"item_id": iid, "price_usd": str(p_usd), "price_lbp": str(p_lbp), "error": str(e)[:500]})

    return {
        "skipped": False,
        "catalog_items": len(items),
        "rows_prepared": len(lines),
        "rows_inserted": ok,
        "rows_failed": failed,
        "failures": failures[:25],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default=os.getenv("POS_API_BASE_URL") or "https://app.melqard.com/api")
    ap.add_argument("--email", default=os.getenv("MELQARD_ADMIN_EMAIL") or "")
    ap.add_argument("--password", default=os.getenv("MELQARD_ADMIN_PASSWORD") or "")
    ap.add_argument("--companies", default="AH Trading Official,AH Trading Unofficial", help="Comma-separated company names")
    ap.add_argument("--currency", default="USD", choices=["USD", "LBP"])
    ap.add_argument("--wholesale-code", default="WHOLESALE")
    ap.add_argument("--retail-code", default="RETAIL")
    ap.add_argument("--effective-from", default=date.today().isoformat())
    ap.add_argument("--max-workers", type=int, default=10)
    ap.add_argument("--skip-backfill", action="store_true")
    ap.add_argument("--allow-nonempty", action="store_true", help="Allow backfill even if wholesale list already has items (may create duplicates)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.email or not args.password:
        _die("missing admin credentials: set MELQARD_ADMIN_EMAIL and MELQARD_ADMIN_PASSWORD (or pass --email/--password)")

    cli = ApiClient(str(args.api_base))
    cli.login(str(args.email), str(args.password))

    wanted = [c.strip() for c in str(args.companies or "").split(",") if c.strip()]
    if not wanted:
        _die("--companies is required")

    companies = cli.companies()
    by_name = {str(c.get("name") or "").strip().lower(): str(c.get("id") or "").strip() for c in companies}

    report: dict[str, Any] = {
        "ok": True,
        "api_base": str(args.api_base),
        "effective_from": str(args.effective_from),
        "companies": [],
    }

    for cname in wanted:
        cid = by_name.get(cname.strip().lower()) or ""
        if not cid:
            _die(f"company not found: {cname}")

        entry: dict[str, Any] = {"company": cname, "company_id": cid}

        if args.dry_run:
            entry["dry_run"] = True
            report["companies"].append(entry)
            continue

        wholesale_code = str(args.wholesale_code or "WHOLESALE").strip().upper()
        retail_code = str(args.retail_code or "RETAIL").strip().upper()

        w_id, r_id = ensure_lists(cli, cid, wholesale_code, retail_code, str(args.currency))
        entry["wholesale_list_id"] = w_id
        entry["retail_list_id"] = r_id

        if not args.skip_backfill:
            entry["backfill"] = backfill_wholesale(
                cli,
                cid,
                w_id,
                str(args.effective_from),
                int(args.max_workers),
                bool(args.allow_nonempty),
            )

        report["companies"].append(entry)

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

