#!/usr/bin/env python3
"""
Check for active cloud items with missing/non-positive catalog price.

Why:
- Active items with null/zero price can create revenue-loss risk at POS.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener

import http.cookiejar


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _to_dec(v: Any) -> Decimal:
    try:
        s = str(v if v is not None else "").strip()
        return Decimal(s) if s else Decimal("0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


class PosClient:
    def __init__(self, api_base: str):
        self.api_base = api_base.rstrip("/") + "/"
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))

    def _req(self, method: str, path: str, body: Optional[dict] = None, headers: Optional[dict[str, str]] = None) -> Any:
        url = self.api_base + path.lstrip("/")
        data = None
        hdrs = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "codex-price-safety/1.0"}
        if headers:
            hdrs.update(headers)
        if body is not None:
            data = json.dumps(body, default=str).encode("utf-8")
        req = Request(url=url, method=method.upper(), headers=hdrs, data=data)
        try:
            with self.opener.open(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8") if resp is not None else ""
                return json.loads(raw) if raw else {}
        except HTTPError as e:
            raw = ""
            try:
                raw = e.read().decode("utf-8", errors="replace")
            except Exception:
                raw = ""
            raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {raw[:300]}") from None
        except URLError as e:
            raise RuntimeError(f"{method} {path} -> network error: {e}") from None

    def login(self, email: str, password: str) -> None:
        self._req("POST", "/auth/login", {"email": email, "password": password})

    def companies(self) -> list[dict[str, Any]]:
        return list(self._req("GET", "/companies").get("companies") or [])

    def active_items(self, company_id: str) -> set[str]:
        rows = list(self._req("GET", "/items/min", headers={"X-Company-Id": company_id}).get("items") or [])
        return {str(r.get("sku") or "").strip() for r in rows if str(r.get("sku") or "").strip()}

    def catalog(self, company_id: str) -> list[dict[str, Any]]:
        return list(self._req("GET", "/pricing/catalog", headers={"X-Company-Id": company_id}).get("items") or [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", required=True, help="POS API base URL")
    ap.add_argument("--email", default=os.getenv("MELQARD_ADMIN_EMAIL") or "")
    ap.add_argument("--password", default=os.getenv("MELQARD_ADMIN_PASSWORD") or "")
    ap.add_argument("--max-examples", type=int, default=25)
    ap.add_argument("--out-json", default=".cache/active_items_price_safety_check.json")
    args = ap.parse_args()

    if not args.email or not args.password:
        _die("missing admin credentials: --email/--password")

    pos = PosClient(str(args.api_base))
    pos.login(str(args.email), str(args.password))
    comps = pos.companies()
    by_name = {str(c.get("name") or ""): str(c.get("id") or "") for c in comps}

    targets = [
        ("AH Trading Official", by_name.get("AH Trading Official") or ""),
        ("AH Trading Unofficial", by_name.get("AH Trading Unofficial") or ""),
    ]

    report: list[dict[str, Any]] = []
    total_risky = 0
    for cname, cid in targets:
        if not cid:
            continue
        active = pos.active_items(cid)
        catalog = pos.catalog(cid)
        risky = []
        for r in catalog:
            sku = str(r.get("sku") or "").strip()
            if not sku or sku not in active:
                continue
            p = r.get("price_usd")
            if p is None or _to_dec(p) <= 0:
                risky.append({"sku": sku, "price_usd": p})
        total_risky += len(risky)
        report.append(
            {
                "company": cname,
                "active_items": len(active),
                "active_missing_or_nonpositive_price": len(risky),
                "examples": risky[: int(args.max_examples)],
            }
        )

    out = {
        "ok": total_risky == 0,
        "total_risky_active_items": total_risky,
        "companies": report,
    }
    with open(str(args.out_json), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

