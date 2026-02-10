#!/usr/bin/env python3
"""
Audit ERPNext import quality against the cloud API.

What it checks (per company):
- VAT mapping: ERPNext Item Tax Template -> items.tax_code_id (by tax code name).
- Standard cost: ERPNext Valuation Rate -> items.standard_cost_usd.
- UOM sanity: item.unit_of_measure looks normal; optional CSV vs DB mismatch.
- Barcode/UOM conversions: barcode.uom_code + qty_factor look sane.

Usage:
  MELQARD_ADMIN_EMAIL=... MELQARD_ADMIN_PASSWORD=... \\
    python3 scripts/audit_erpnext_import_cloud.py --api-base https://api.melqard.com --data-dir "Data AH Trading"
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
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


def _strip_wrapped_quotes(v: Any) -> str:
    s = _norm(v)
    while len(s) >= 2 and s.startswith('"') and s.endswith('"'):
        s = s[1:-1].strip()
    return s


def _to_decimal(v: Any) -> Decimal:
    s = _norm(v)
    if not s:
        return Decimal("0")
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _header_first_index(header: list[str]) -> dict[str, int]:
    idx: dict[str, int] = {}
    for i, h in enumerate(header):
        k = (h or "").strip()
        if not k or k in idx:
            continue
        idx[k] = i
    return idx


class ApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/") + "/"
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))

    def _req(self, method: str, path: str, body: Optional[dict] = None, headers: Optional[dict] = None) -> Any:
        url = urljoin(self.base_url, path.lstrip("/"))
        data = None
        hdrs = {"Content-Type": "application/json"}
        if headers:
            hdrs.update(headers)
        if body is not None:
            data = json.dumps(body, default=str).encode("utf-8")
        req = Request(url=url, method=method.upper(), data=data, headers=hdrs)
        try:
            with self.opener.open(req, timeout=45) as resp:
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
            raise RuntimeError(f"{method} {url} -> HTTP {e.code}: {detail}") from None
        except URLError as e:
            raise RuntimeError(f"{method} {url} -> network error: {e}") from None

    def login(self, email: str, password: str) -> None:
        self._req("POST", "/auth/login", {"email": email, "password": password})

    def get_companies(self) -> list[dict]:
        res = self._req("GET", "/companies")
        return list(res.get("companies") or [])

    def list_items_full(self, company_id: str) -> list[dict]:
        res = self._req("GET", "/items", headers={"X-Company-Id": company_id})
        return list(res.get("items") or [])

    def list_all_barcodes(self, company_id: str) -> list[dict]:
        res = self._req("GET", "/items/barcodes", headers={"X-Company-Id": company_id})
        return list(res.get("barcodes") or [])

    def list_tax_codes(self, company_id: str) -> list[dict]:
        res = self._req("GET", "/config/tax-codes", headers={"X-Company-Id": company_id})
        return list(res.get("tax_codes") or [])

    def list_uoms_manage(self, company_id: str) -> list[dict]:
        res = self._req("GET", "/items/uoms/manage", headers={"X-Company-Id": company_id})
        return list(res.get("uoms") or [])


@dataclass(frozen=True)
class CsvExpectedItem:
    sku: str
    company_name: str
    base_uom: str
    valuation_rate: Decimal
    tax_template: str  # "", "11%", "0%", ...


def load_expected_from_csv(items_csv: Path) -> dict[str, CsvExpectedItem]:
    """
    Returns expected rows keyed by ERPNext item code (CSV column 0: first 'ID').
    """
    out: dict[str, CsvExpectedItem] = {}
    with items_csv.open(newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r, None)
        if not header:
            _die(f"empty csv: {items_csv}")
        idx = _header_first_index([str(h) for h in header])
        for k in ["ID", "Default Unit of Measure", "Valuation Rate"]:
            if k not in idx:
                _die(f"missing column '{k}' in {items_csv}")
        c_company = idx.get("Company")
        c_tax = idx.get("Item Tax Template")

        for row in r:
            sku = _strip_wrapped_quotes(row[idx["ID"]]) if idx["ID"] < len(row) else ""
            if not sku:
                continue
            company_name = _strip_wrapped_quotes(row[c_company]) if c_company is not None and c_company < len(row) else ""
            base_uom = _norm(row[idx["Default Unit of Measure"]]) if idx["Default Unit of Measure"] < len(row) else ""
            base_uom = (base_uom or "EA").strip().upper()[:32]
            valuation = _to_decimal(row[idx["Valuation Rate"]]) if idx["Valuation Rate"] < len(row) else Decimal("0")
            tax_template = _norm(row[c_tax]) if c_tax is not None and c_tax < len(row) else ""
            out[sku] = CsvExpectedItem(
                sku=sku,
                company_name=company_name,
                base_uom=base_uom,
                valuation_rate=valuation,
                tax_template=tax_template,
            )
    return out


_UOM_OK_RE = re.compile(r"^[A-Z0-9][A-Z0-9._/-]{0,31}$")


def _looks_weird_uom(code: str) -> bool:
    c = (code or "").strip().upper()
    if not c:
        return True
    if len(c) > 32:
        return True
    return _UOM_OK_RE.match(c) is None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", required=True, help="Cloud API base URL (example: https://api.melqard.com)")
    ap.add_argument("--email", default=os.getenv("MELQARD_ADMIN_EMAIL") or "")
    ap.add_argument("--password", default=os.getenv("MELQARD_ADMIN_PASSWORD") or "")
    ap.add_argument("--data-dir", default="Data AH Trading")
    ap.add_argument("--max-examples", type=int, default=25)
    args = ap.parse_args()

    if not args.email or not args.password:
        _die("missing admin credentials: pass --email/--password or set MELQARD_ADMIN_EMAIL/MELQARD_ADMIN_PASSWORD")

    data_dir = Path(args.data_dir)
    items_csv = data_dir / "Item_cleaned.csv"
    if not items_csv.exists():
        _die(f"missing file: {items_csv}")

    expected = load_expected_from_csv(items_csv)

    api = ApiClient(args.api_base)
    api.login(args.email, args.password)

    companies = api.get_companies()
    by_name = {str(c.get("name") or ""): str(c.get("id") or "") for c in companies}
    official_id = by_name.get("AH Trading Official") or ""
    unofficial_id = by_name.get("AH Trading Unofficial") or ""
    if not official_id or not unofficial_id:
        _die("missing required companies in cloud: AH Trading Official / AH Trading Unofficial")

    # CSV company name -> cloud company id
    alias = {
        "Antoine Hage Trading": official_id,
        "ACOUNTING COMPANY": official_id,
        "UNDISCLOSED COMPANY": unofficial_id,
    }

    report_lines: list[str] = []
    report_lines.append("# ERPNext Import Audit (Cloud)")
    report_lines.append("")
    report_lines.append(f"API: {args.api_base}")
    report_lines.append("")

    for cid, label in [(official_id, "Official"), (unofficial_id, "Unofficial")]:
        items = api.list_items_full(cid)
        barcodes = api.list_all_barcodes(cid)
        tax_codes = api.list_tax_codes(cid)
        uoms = api.list_uoms_manage(cid)

        tax_name_by_id = {str(t.get("id")): str(t.get("name") or "") for t in tax_codes}
        tax_id_by_name = {str(t.get("name") or "").strip().lower(): str(t.get("id")) for t in tax_codes}
        uom_codes = {str(u.get("code") or "").strip().upper() for u in uoms}

        # Index expected by sku for this company.
        expected_for_company: dict[str, CsvExpectedItem] = {}
        for sku, ex in expected.items():
            ecid = alias.get(ex.company_name, official_id)
            if ecid == cid:
                expected_for_company[sku] = ex

        by_sku = {str(it.get("sku") or ""): it for it in items}

        report_lines.append(f"## {label}")
        report_lines.append("")
        report_lines.append(f"- Items in DB: {len(items)}")
        report_lines.append(f"- Barcodes in DB: {len(barcodes)}")
        report_lines.append(f"- UOM codes (master): {len(uom_codes)}")
        report_lines.append("")

        # VAT audit
        vat_missing = []
        vat_unexpected = []
        vat_mismatch = []
        for sku, it in by_sku.items():
            ex = expected_for_company.get(sku)
            if not ex:
                continue

            actual_tax_id = it.get("tax_code_id")
            actual_tax_name = tax_name_by_id.get(str(actual_tax_id)) if actual_tax_id else ""

            expected_tax_template = (ex.tax_template or "").strip()
            if cid == unofficial_id:
                # Per business rule: unofficial items must have no VAT.
                if actual_tax_id:
                    vat_unexpected.append((sku, actual_tax_name))
                continue

            if expected_tax_template in {"11%", "0%"}:
                expected_tax_id = tax_id_by_name.get(expected_tax_template.lower(), "")
                if not actual_tax_id:
                    vat_missing.append((sku, expected_tax_template))
                elif expected_tax_id and str(actual_tax_id) != expected_tax_id:
                    vat_mismatch.append((sku, expected_tax_template, actual_tax_name))
            else:
                # Expect no VAT when blank or unknown template.
                if actual_tax_id:
                    vat_unexpected.append((sku, actual_tax_name))

        report_lines.append("### VAT")
        report_lines.append(f"- Missing VAT where ERPNext template is 11%/0%: {len(vat_missing)}")
        report_lines.append(f"- Unexpected VAT (ERPNext blank/unknown, or unofficial items): {len(vat_unexpected)}")
        report_lines.append(f"- VAT mismatch (expected template vs actual tax code): {len(vat_mismatch)}")
        if vat_missing:
            report_lines.append("")
            report_lines.append("Examples (missing VAT):")
            for sku, tmpl in vat_missing[: int(args.max_examples)]:
                report_lines.append(f"- {sku} (expected {tmpl})")
        if vat_unexpected:
            report_lines.append("")
            report_lines.append("Examples (unexpected VAT):")
            for sku, name in vat_unexpected[: int(args.max_examples)]:
                report_lines.append(f"- {sku} (has {name})")
        if vat_mismatch:
            report_lines.append("")
            report_lines.append("Examples (VAT mismatch):")
            for sku, exp, act in vat_mismatch[: int(args.max_examples)]:
                report_lines.append(f"- {sku} (expected {exp}, has {act})")
        report_lines.append("")

        # Cost audit (valuation rate -> standard_cost_usd)
        cost_missing = []
        cost_mismatch = []
        for sku, it in by_sku.items():
            ex = expected_for_company.get(sku)
            if not ex:
                continue
            if ex.valuation_rate <= 0:
                continue
            actual_cost = it.get("standard_cost_usd")
            actual_cost_d = _to_decimal(actual_cost)
            if actual_cost is None or actual_cost_d <= 0:
                cost_missing.append((sku, str(ex.valuation_rate)))
            else:
                # allow tiny rounding differences
                if (actual_cost_d - ex.valuation_rate).copy_abs() > Decimal("0.01"):
                    cost_mismatch.append((sku, str(ex.valuation_rate), str(actual_cost_d)))

        report_lines.append("### Cost (Valuation Rate -> Standard Cost USD)")
        report_lines.append(f"- Missing cost where valuation rate > 0: {len(cost_missing)}")
        report_lines.append(f"- Cost mismatch (> $0.01): {len(cost_mismatch)}")
        if cost_missing:
            report_lines.append("")
            report_lines.append("Examples (missing cost):")
            for sku, exp in cost_missing[: int(args.max_examples)]:
                report_lines.append(f"- {sku} (expected {exp})")
        if cost_mismatch:
            report_lines.append("")
            report_lines.append("Examples (cost mismatch):")
            for sku, exp, act in cost_mismatch[: int(args.max_examples)]:
                report_lines.append(f"- {sku} (expected {exp}, has {act})")
        report_lines.append("")

        # UOM audit
        weird_uoms = []
        uom_not_in_master = []
        uom_csv_mismatch = []
        for sku, it in by_sku.items():
            uom = str(it.get("unit_of_measure") or "")
            uom_up = uom.strip().upper()
            if _looks_weird_uom(uom):
                weird_uoms.append((sku, uom))
            if uom_up and uom_up not in uom_codes:
                uom_not_in_master.append((sku, uom_up))

            ex = expected_for_company.get(sku)
            if ex:
                if ex.base_uom and uom_up and ex.base_uom != uom_up:
                    uom_csv_mismatch.append((sku, ex.base_uom, uom_up))

        report_lines.append("### UOM")
        report_lines.append(f"- Weird base UOM codes: {len(weird_uoms)}")
        report_lines.append(f"- Base UOM not in UOM master: {len(uom_not_in_master)}")
        report_lines.append(f"- CSV vs DB base UOM mismatch: {len(uom_csv_mismatch)}")
        if weird_uoms:
            report_lines.append("")
            report_lines.append("Examples (weird UOM):")
            for sku, uom in weird_uoms[: int(args.max_examples)]:
                report_lines.append(f"- {sku} (uom={uom!r})")
        if uom_csv_mismatch:
            report_lines.append("")
            report_lines.append("Examples (CSV vs DB UOM mismatch):")
            for sku, exp, act in uom_csv_mismatch[: int(args.max_examples)]:
                report_lines.append(f"- {sku} (csv={exp}, db={act})")
        report_lines.append("")

        # Barcode sanity
        # We flag cases where barcode uom != base but qty_factor is 1 (often means missing conversion).
        barcode_by_item: dict[str, list[dict]] = {}
        for bc in barcodes:
            item_id = str(bc.get("item_id") or "")
            barcode_by_item.setdefault(item_id, []).append(bc)

        suspicious_barcodes = []
        for it in items:
            item_id = str(it.get("id") or "")
            sku = str(it.get("sku") or "")
            base_uom = str(it.get("unit_of_measure") or "").strip().upper()
            for bc in barcode_by_item.get(item_id, []):
                uom_code = str(bc.get("uom_code") or "").strip().upper() or base_uom
                qty_factor = _to_decimal(bc.get("qty_factor"))
                if uom_code and base_uom and uom_code != base_uom and qty_factor == Decimal("1"):
                    suspicious_barcodes.append((sku, str(bc.get("barcode") or ""), base_uom, uom_code, str(qty_factor)))
                if qty_factor <= 0:
                    suspicious_barcodes.append((sku, str(bc.get("barcode") or ""), base_uom, uom_code, str(qty_factor)))

        report_lines.append("### Barcodes / Conversions")
        report_lines.append(f"- Suspicious barcode rows (uom != base but factor=1, or factor<=0): {len(suspicious_barcodes)}")
        if suspicious_barcodes:
            report_lines.append("")
            report_lines.append("Examples (suspicious barcodes):")
            for sku, barcode, base, uom_code, factor in suspicious_barcodes[: int(args.max_examples)]:
                report_lines.append(f"- {sku} barcode={barcode} (base={base}, uom={uom_code}, factor={factor})")
        report_lines.append("")

    print("\n".join(report_lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

