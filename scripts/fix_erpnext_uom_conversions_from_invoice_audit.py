#!/usr/bin/env python3
"""
Build/apply ERPNext Item UOM conversion fixes from invoice replay audit output.

Default mode is dry-run:
- Reads missing UOM conversion findings from the audit report JSON.
- Proposes per-item conversion factors with confidence/reason.
- Writes plan artifacts under .cache/.

Apply mode:
- Adds missing Item.uoms rows in ERPNext using PUT /api/resource/Item/{name}.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, build_opener


Q6 = Decimal("0.000001")


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _to_dec(v: Any) -> Decimal:
    s = str(v or "").strip()
    if not s:
        return Decimal("0")
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _q6(v: Decimal) -> Decimal:
    return v.quantize(Q6, rounding=ROUND_HALF_UP)


def _uom(v: Any) -> str:
    return str(v or "").strip().upper()


def _extract_pack_count(item_name: str, description: str) -> Optional[int]:
    text = f"{item_name or ''} {description or ''}"
    nums: list[int] = []
    # e.g. "24x25g" -> 24
    for m in re.finditer(r"(?i)(?:^|[^0-9])(\d{1,3})\s*[xX]\s*\d", text):
        n = int(m.group(1))
        if 2 <= n <= 200:
            nums.append(n)
    # e.g. "x24", "*24"
    for m in re.finditer(r"(?i)[xX*]\s*(\d{1,3})(?!\d)", text):
        n = int(m.group(1))
        if 2 <= n <= 200:
            nums.append(n)
    if not nums:
        return None
    # Most items include one meaningful pack count; use the first candidate.
    return nums[0]


class ErpClient:
    def __init__(self, base_url: str, api_key: str, api_secret: str, timeout_s: int = 60):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.api_secret = api_secret
        self.timeout_s = int(timeout_s)
        self.opener = build_opener()

    def _req_json(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        body: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        url = self.base_url + path
        if params:
            url += "?" + urlencode(params, doseq=True)
        headers = {
            "Authorization": f"token {self.api_key}:{self.api_secret}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "codex-erpnext-uom-fix/1.0",
        }
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = Request(url, method=method.upper(), headers=headers, data=data)
        try:
            with self.opener.open(req, timeout=self.timeout_s) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {e.code} {path}: {raw[:500]}") from None
        except URLError as e:
            raise RuntimeError(f"network error {path}: {e}") from None

    def get_item(self, item_code: str) -> dict[str, Any]:
        return dict(self._req_json("GET", f"/api/resource/Item/{quote(item_code, safe='')}").get("data") or {})

    def list_item_prices(self, item_code: str, price_list: str, currency: str) -> list[dict[str, Any]]:
        params = {
            "fields": json.dumps(["uom", "price_list_rate", "valid_from"]),
            "filters": json.dumps([["item_code", "=", item_code], ["price_list", "=", price_list], ["currency", "=", currency]]),
            "limit_start": 0,
            "limit_page_length": 200,
        }
        return list(self._req_json("GET", "/api/resource/Item%20Price", params=params).get("data") or [])

    def put_item_uoms(self, item_code: str, uoms_payload: list[dict[str, Any]]) -> dict[str, Any]:
        return self._req_json("PUT", f"/api/resource/Item/{quote(item_code, safe='')}", body={"uoms": uoms_payload})


@dataclass
class PlanRow:
    item_code: str
    stock_uom: str
    missing_uom: str
    factor: Optional[Decimal]
    reason: str
    confidence: str
    item_name: str
    pack_count: Optional[int]
    price_missing_uom: Decimal
    price_stock_uom: Decimal
    status: str


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default=".cache/erpnext_sales_invoice_pos_replay_report_feb2026.json")
    ap.add_argument("--erp-base", default=os.getenv("ERPNEXT_BASE_URL") or "https://erp.ahagetrading.com")
    ap.add_argument("--api-key", default=os.getenv("ERPNEXT_API_KEY") or "")
    ap.add_argument("--api-secret", default=os.getenv("ERPNEXT_API_SECRET") or "")
    ap.add_argument("--price-list", default="Standard Selling")
    ap.add_argument("--currency", default="USD")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--apply-min-confidence", choices=["high", "medium", "low"], default="medium")
    ap.add_argument("--sleep-ms", type=int, default=80)
    return ap.parse_args()


def _confidence_rank(x: str) -> int:
    return {"high": 3, "medium": 2, "low": 1}.get(x, 0)


def main() -> int:
    args = _parse_args()
    if not args.api_key or not args.api_secret:
        _die("missing ERP credentials: ERPNEXT_API_KEY / ERPNEXT_API_SECRET")

    report_path = Path(str(args.report))
    if not report_path.exists():
        _die(f"missing report file: {report_path}")

    report = json.loads(report_path.read_text(encoding="utf-8"))
    missing = list((report.get("issue_examples") or {}).get("missing_item_uom_conversion") or [])
    if not missing:
        print("No missing_item_uom_conversion rows found in report; nothing to fix.")
        return 0

    pairs = sorted({(str(r.get("item_code") or "").strip(), _uom(r.get("stock_uom")), _uom(r.get("uom"))) for r in missing})
    pairs = [p for p in pairs if p[0] and p[1] and p[2] and p[1] != p[2]]

    cli = ErpClient(str(args.erp_base), str(args.api_key), str(args.api_secret))

    plan: list[PlanRow] = []
    item_cache: dict[str, dict[str, Any]] = {}

    for item_code, stock_uom, missing_uom in pairs:
        doc = item_cache.get(item_code)
        if doc is None:
            doc = cli.get_item(item_code)
            item_cache[item_code] = doc
            time.sleep(max(0, int(args.sleep_ms or 0)) / 1000.0)

        item_name = str(doc.get("item_name") or "")
        desc = str(doc.get("description") or "")
        existing = {_uom(r.get("uom")): _to_dec(r.get("conversion_factor")) for r in (doc.get("uoms") or []) if _uom(r.get("uom"))}
        pack_count = _extract_pack_count(item_name, desc)

        prices = cli.list_item_prices(item_code, str(args.price_list), str(args.currency))
        by_uom: dict[str, tuple[str, Decimal]] = {}
        for p in prices:
            uu = _uom(p.get("uom"))
            if not uu:
                continue
            vf = str(p.get("valid_from") or "")
            rr = _to_dec(p.get("price_list_rate"))
            prev = by_uom.get(uu)
            if prev is None or vf >= prev[0]:
                by_uom[uu] = (vf, rr)

        price_missing = by_uom.get(missing_uom, ("", Decimal("0")))[1]
        price_stock = by_uom.get(stock_uom, ("", Decimal("0")))[1]

        factor: Optional[Decimal] = None
        reason = "unresolved"
        confidence = "low"
        status = "proposed"

        if missing_uom in existing:
            factor = _q6(existing[missing_uom])
            reason = "already_exists_on_item"
            confidence = "high"
            status = "already_exists"
        else:
            if {missing_uom, stock_uom} == {"PC", "UNIT"}:
                factor = Decimal("1")
                reason = "pc_unit_alias"
                confidence = "high"
            elif stock_uom == "BOX" and missing_uom in {"PC", "UNIT"} and pack_count:
                factor = Decimal("1") / Decimal(pack_count)
                reason = f"pack_count_{pack_count}_from_name"
                confidence = "medium"
            elif missing_uom == "BOX" and stock_uom in {"PC", "UNIT"} and pack_count:
                factor = Decimal(pack_count)
                reason = f"pack_count_{pack_count}_from_name"
                confidence = "medium"
            elif price_missing > 0 and price_stock > 0:
                factor = price_missing / price_stock
                reason = "price_ratio_missing_over_stock"
                confidence = "medium"

        if factor is not None:
            factor = _q6(factor)
            if factor <= 0:
                factor = None
                reason = "resolved_nonpositive_factor"
                confidence = "low"
        if factor is None:
            status = "manual_review_required"

        plan.append(
            PlanRow(
                item_code=item_code,
                stock_uom=stock_uom,
                missing_uom=missing_uom,
                factor=factor,
                reason=reason,
                confidence=confidence,
                item_name=item_name,
                pack_count=pack_count,
                price_missing_uom=price_missing,
                price_stock_uom=price_stock,
                status=status,
            )
        )

    out_json = Path(".cache/erpnext_uom_fix_plan.json")
    out_csv = Path(".cache/erpnext_uom_fix_plan.csv")
    out_json.parent.mkdir(parents=True, exist_ok=True)

    plan_rows_json = [
        {
            "item_code": r.item_code,
            "item_name": r.item_name,
            "stock_uom": r.stock_uom,
            "missing_uom": r.missing_uom,
            "proposed_factor": (str(r.factor) if r.factor is not None else None),
            "reason": r.reason,
            "confidence": r.confidence,
            "pack_count": r.pack_count,
            "latest_price_missing_uom": str(r.price_missing_uom),
            "latest_price_stock_uom": str(r.price_stock_uom),
            "status": r.status,
        }
        for r in plan
    ]
    out_json.write_text(json.dumps(plan_rows_json, ensure_ascii=False, indent=2), encoding="utf-8")

    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "item_code",
                "item_name",
                "stock_uom",
                "missing_uom",
                "proposed_factor",
                "reason",
                "confidence",
                "pack_count",
                "latest_price_missing_uom",
                "latest_price_stock_uom",
                "status",
            ]
        )
        for r in plan:
            w.writerow(
                [
                    r.item_code,
                    r.item_name,
                    r.stock_uom,
                    r.missing_uom,
                    (str(r.factor) if r.factor is not None else ""),
                    r.reason,
                    r.confidence,
                    (str(r.pack_count) if r.pack_count is not None else ""),
                    str(r.price_missing_uom),
                    str(r.price_stock_uom),
                    r.status,
                ]
            )

    min_rank = _confidence_rank(str(args.apply_min_confidence))
    apply_candidates = [
        r
        for r in plan
        if r.status == "proposed" and r.factor is not None and _confidence_rank(r.confidence) >= min_rank
    ]

    applied = 0
    skipped = 0
    failed: list[dict[str, str]] = []

    if args.apply:
        for r in apply_candidates:
            doc = item_cache.get(r.item_code) or cli.get_item(r.item_code)
            existing_rows = list(doc.get("uoms") or [])
            existing_uoms = {_uom(x.get("uom")) for x in existing_rows if _uom(x.get("uom"))}
            if r.missing_uom in existing_uoms:
                skipped += 1
                continue
            payload: list[dict[str, Any]] = []
            for x in existing_rows:
                ux = _uom(x.get("uom"))
                fx = _to_dec(x.get("conversion_factor"))
                if not ux or fx <= 0:
                    continue
                row = {
                    "doctype": "UOM Conversion Detail",
                    "uom": ux,
                    "conversion_factor": float(_q6(fx)),
                }
                # Keep row identity when present.
                if str(x.get("name") or "").strip():
                    row["name"] = str(x.get("name"))
                if x.get("idx") is not None:
                    row["idx"] = int(x.get("idx"))
                payload.append(row)

            payload.append(
                {
                    "doctype": "UOM Conversion Detail",
                    "uom": r.missing_uom,
                    "conversion_factor": float(_q6(r.factor)),
                }
            )

            try:
                cli.put_item_uoms(r.item_code, payload)
                applied += 1
            except Exception as e:
                failed.append({"item_code": r.item_code, "missing_uom": r.missing_uom, "error": str(e)})
            time.sleep(max(0, int(args.sleep_ms or 0)) / 1000.0)

    summary = {
        "pairs_seen": len(plan),
        "proposed_pairs": len([r for r in plan if r.status == "proposed" and r.factor is not None]),
        "manual_review_required": len([r for r in plan if r.status == "manual_review_required"]),
        "already_exists": len([r for r in plan if r.status == "already_exists"]),
        "apply_requested": bool(args.apply),
        "apply_candidates": len(apply_candidates),
        "applied": applied,
        "skipped_existing_during_apply": skipped,
        "failed": len(failed),
        "plan_json": str(out_json),
        "plan_csv": str(out_csv),
    }
    if failed:
        fail_path = Path(".cache/erpnext_uom_fix_apply_failures.json")
        fail_path.write_text(json.dumps(failed, ensure_ascii=False, indent=2), encoding="utf-8")
        summary["failures_json"] = str(fail_path)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
