#!/usr/bin/env python3
"""
Import opening stock into POS from ERPNext live Bin balances.

Flow:
1) Read ERPNext Warehouse -> Company map.
2) Read ERPNext Bin rows (item_code, warehouse, actual_qty, valuation_rate).
3) Aggregate qty by (company, sku) and compute weighted-average unit cost.
4) Fetch existing POS opening-stock moves and subtract them (to avoid double counting prior bad imports).
5) Import into POS /inventory/opening-stock/import in chunks.

This script is additive-safe for reruns in the same day due to deterministic import_id per chunk.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


def _to_dec(v: Any) -> Decimal:
    try:
        s = str(v or "").strip()
        return Decimal(s) if s else Decimal("0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


@dataclass(frozen=True)
class ErpClient:
    base_url: str
    api_key: str
    api_secret: str
    timeout_s: int = 60

    def _req(self, method: str, path: str, params: Optional[dict[str, Any]] = None) -> dict:
        url = self.base_url.rstrip("/") + path
        if params:
            url += "?" + urlencode(params, doseq=True)
        headers = {
            "Authorization": f"token {self.api_key}:{self.api_secret}",
            "Accept": "application/json",
            "User-Agent": "codex-opening-stock/1.0",
        }
        req = Request(url, headers=headers, method=method)
        with urlopen(req, timeout=self.timeout_s) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}

    def iter_list(self, doctype: str, fields: list[str], filters: Optional[list] = None, page: int = 1000):
        start = 0
        while True:
            params: dict[str, Any] = {
                "fields": json.dumps(fields),
                "limit_start": start,
                "limit_page_length": page,
            }
            if filters is not None:
                params["filters"] = json.dumps(filters)
            rows = self._req("GET", f"/api/resource/{quote(doctype, safe='')}", params=params).get("data") or []
            if not rows:
                break
            for r in rows:
                yield dict(r)
            if len(rows) < page:
                break
            start += len(rows)


@dataclass(frozen=True)
class PosClient:
    api_base: str
    email: str
    password: str
    timeout_s: int = 60
    max_retries: int = 5

    def __post_init__(self):
        object.__setattr__(self, "token", "")

    def _req_json(self, method: str, path: str, payload: Any | None = None, token: Optional[str] = None) -> dict:
        url = self.api_base.rstrip("/") + path
        data = None
        headers = {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "codex-opening-stock/1.0"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
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
                if e.code in {429, 500, 502, 503, 504} and attempt < self.max_retries:
                    time.sleep(min(2**attempt, 10))
                    attempt += 1
                    continue
                raise RuntimeError(f"HTTP {e.code} {path}: {body[:400]}") from None
            except URLError as e:
                if attempt < self.max_retries:
                    time.sleep(min(2**attempt, 10))
                    attempt += 1
                    continue
                raise RuntimeError(f"network error {path}: {e}") from None

    def login(self) -> str:
        j = self._req_json("POST", "/auth/login", {"email": self.email, "password": self.password})
        token = str(j.get("token") or "").strip()
        if not token:
            raise RuntimeError("POS login failed: no token")
        object.__setattr__(self, "token", token)
        return token

    def get(self, path: str) -> dict:
        return self._req_json("GET", path, token=self.token)

    def post(self, path: str, payload: Any) -> dict:
        return self._req_json("POST", path, payload, token=self.token)


def _chunks(xs: list[dict], n: int):
    for i in range(0, len(xs), n):
        yield xs[i : i + n]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--erp-base", default="https://erp.ahagetrading.com")
    ap.add_argument("--erp-api-key", required=True)
    ap.add_argument("--erp-api-secret", required=True)
    ap.add_argument("--pos-api-base", default="https://app.melqard.com/api")
    ap.add_argument("--pos-email", required=True)
    ap.add_argument("--pos-password", required=True)
    ap.add_argument("--company-official", default="AH Trading Official")
    ap.add_argument("--company-unofficial", default="AH Trading Unofficial")
    ap.add_argument("--chunk", type=int, default=800)
    args = ap.parse_args()

    erp = ErpClient(args.erp_base, args.erp_api_key, args.erp_api_secret)
    pos = PosClient(args.pos_api_base, args.pos_email, args.pos_password)
    pos.login()

    companies = pos.get("/companies").get("companies") or []
    cid_by_name = {str(c.get("name") or ""): str(c.get("id") or "") for c in companies}
    official_id = cid_by_name.get(args.company_official) or ""
    unofficial_id = cid_by_name.get(args.company_unofficial) or ""
    if not official_id or not unofficial_id:
        raise RuntimeError("required POS companies not found")

    erp_to_pos_company = {
        "Antoine Hage Trading": official_id,
        "ACOUNTING COMPANY": official_id,
        "UNDISCLOSED COMPANY": unofficial_id,
    }

    # 1) ERP warehouse -> company map.
    warehouse_company: dict[str, str] = {}
    for w in erp.iter_list("Warehouse", fields=["name", "company", "is_group", "disabled"]):
        if int(w.get("is_group") or 0) == 1:
            continue
        if int(w.get("disabled") or 0) == 1:
            continue
        name = str(w.get("name") or "").strip()
        company = str(w.get("company") or "").strip()
        if name and company:
            warehouse_company[name] = company

    # 2) ERP bins aggregate.
    qty_sum: dict[tuple[str, str], Decimal] = defaultdict(lambda: Decimal("0"))
    val_sum: dict[tuple[str, str], Decimal] = defaultdict(lambda: Decimal("0"))
    for b in erp.iter_list("Bin", fields=["item_code", "warehouse", "actual_qty", "valuation_rate"]):
        sku = str(b.get("item_code") or "").strip()
        wh = str(b.get("warehouse") or "").strip()
        if not sku or not wh:
            continue
        erp_company = warehouse_company.get(wh, "")
        pos_company = erp_to_pos_company.get(erp_company, "")
        if not pos_company:
            continue
        qty = _to_dec(b.get("actual_qty"))
        if qty <= 0:
            continue
        vr = _to_dec(b.get("valuation_rate"))
        k = (pos_company, sku)
        qty_sum[k] += qty
        val_sum[k] += qty * (vr if vr > 0 else Decimal("0"))

    # 3) Fetch current opening stock already imported and subtract it.
    existing_opening_qty_by_company_sku: dict[tuple[str, str], Decimal] = defaultdict(lambda: Decimal("0"))
    for cid in [official_id, unofficial_id]:
        pos.post("/auth/select-company", {"company_id": cid})
        moves = pos.get("/inventory/moves?source_type=opening_stock&limit=1000").get("moves") or []
        if not moves:
            continue
        item_ids = list({str(m.get("item_id") or "") for m in moves if str(m.get("item_id") or "")})
        item_id_to_sku: dict[str, str] = {}
        # Build item lookup via typeahead per SKU isn't possible from id, so read /items list once.
        items = pos.get("/items").get("items") or []
        for it in items:
            item_id_to_sku[str(it.get("id") or "")] = str(it.get("sku") or "").strip()
        for m in moves:
            iid = str(m.get("item_id") or "")
            sku = item_id_to_sku.get(iid, "")
            if not sku:
                continue
            q_in = _to_dec(m.get("qty_in"))
            q_out = _to_dec(m.get("qty_out"))
            existing_opening_qty_by_company_sku[(cid, sku)] += q_in - q_out

    # 4) Prepare import lines per company after subtraction.
    lines_by_company: dict[str, list[dict[str, str]]] = {official_id: [], unofficial_id: []}
    for (cid, sku), qty in qty_sum.items():
        existing = existing_opening_qty_by_company_sku.get((cid, sku), Decimal("0"))
        adj_qty = qty - existing
        if adj_qty <= 0:
            continue
        unit = Decimal("0")
        if qty > 0:
            unit = (val_sum[(cid, sku)] / qty).quantize(Decimal("0.000001"))
        lines_by_company[cid].append(
            {"sku": sku, "qty": str(adj_qty), "unit_cost_usd": str(unit if unit > 0 else Decimal("0")), "unit_cost_lbp": "0"}
        )

    # 5) Warehouse mapping in POS.
    warehouse_id_by_company: dict[str, str] = {}
    for cid in [official_id, unofficial_id]:
        pos.post("/auth/select-company", {"company_id": cid})
        ws = pos.get("/warehouses").get("warehouses") or []
        wh = next((w for w in ws if str(w.get("name") or "").strip().lower() == "main warehouse"), None) or (ws[0] if ws else None)
        if not wh:
            raise RuntimeError(f"no warehouse in POS company {cid}")
        warehouse_id_by_company[cid] = str(wh.get("id") or "")

    # 6) Import in chunks.
    summary: dict[str, Any] = {"ok": True, "date": date.today().isoformat(), "results": []}
    for cid, cname in [(official_id, args.company_official), (unofficial_id, args.company_unofficial)]:
        pos.post("/auth/select-company", {"company_id": cid})
        warehouse_id = warehouse_id_by_company[cid]
        lines = lines_by_company[cid]
        imported_lines = 0
        imports = 0
        for i, chunk in enumerate(_chunks(lines, max(1, int(args.chunk))), start=1):
            import_id = f"{date.today().strftime('%Y%m%d')}-{cid.replace('-', '')[:10]}-{i:04d}"
            # Convert to UUID-like deterministic id (backend expects UUID).
            # 32 hex chars: date+cid fragment+chunk index hash-ish.
            hex_part = f"{date.today().strftime('%Y%m%d')}{cid.replace('-', '')[:20]}{i:04d}"
            hex_part = (hex_part + "0" * 32)[:32]
            uuid_like = f"{hex_part[:8]}-{hex_part[8:12]}-{hex_part[12:16]}-{hex_part[16:20]}-{hex_part[20:32]}"
            res = pos.post(
                "/inventory/opening-stock/import",
                {
                    "import_id": uuid_like,
                    "warehouse_id": warehouse_id,
                    "posting_date": date.today().isoformat(),
                    "lines": chunk,
                },
            )
            imports += 1
            imported_lines += len(chunk)
            # respect idempotent behavior; re-run may return already_applied
            _ = bool(res.get("already_applied"))
        summary["results"].append(
            {
                "company": cname,
                "company_id": cid,
                "warehouse_id": warehouse_id,
                "prepared_lines": len(lines),
                "imported_lines": imported_lines,
                "import_calls": imports,
            }
        )

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

