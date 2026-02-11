#!/usr/bin/env python3
"""
Build POS import CSVs for Customers and Suppliers from ERPNext CSV exports.

ERPNext export format (from "Data Export"):
- The first column is a dummy label column (often "Column Labels:") and is blank in data rows.
- After a blank column header, ERPNext may append child-table columns (we ignore anything after the first blank header).

Outputs (to --out-dir):
- erpnext_pos_customers.csv (code,name,party_type,customer_type,phone,email,tax_id,vat_no,payment_terms_days,is_active)
- erpnext_pos_suppliers.csv (code,name,party_type,phone,email,tax_id,vat_no,payment_terms_days,is_active)
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _strip(v: Any) -> str:
    s = str(v or "")
    s = s.strip()
    # ERPNext exports often wrap IDs in quotes like: '"ABDO"'
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1]
    return s.strip()


def _first_int(s: str) -> Optional[int]:
    s = (s or "").strip()
    if not s:
        return None
    m = re.search(r"(\d{1,4})", s)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None


def _read_erpnext_export_rows(path: str) -> Tuple[List[str], List[List[str]]]:
    """
    Returns (header, rows) where header/rows only include the "main" columns:
    - drop the first dummy column
    - stop at the first blank header cell (child table separator)
    """
    if not os.path.exists(path):
        _die(f"CSV not found: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        try:
            raw_header = next(r)
        except StopIteration:
            _die(f"CSV is empty: {path}")

        # Determine slice of "main" columns.
        start = 1  # skip dummy label column
        end = len(raw_header)
        for i in range(start, len(raw_header)):
            if (raw_header[i] or "").strip() == "":
                end = i
                break

        header = [str(c or "").strip() for c in raw_header[start:end]]
        rows = []
        for row in r:
            if not row:
                continue
            # Some exports can have shorter rows; pad for safe indexing.
            if len(row) < end:
                row = list(row) + [""] * (end - len(row))
            rows.append([str(c or "") for c in row[start:end]])
        return header, rows


def _rows_to_dicts(header: List[str], rows: List[List[str]]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for row in rows:
        d = {header[i]: (row[i] if i < len(row) else "") for i in range(len(header))}
        out.append(d)
    return out


def build_customers(customer_csv: str) -> List[Dict[str, Any]]:
    header, rows = _read_erpnext_export_rows(customer_csv)
    ds = _rows_to_dicts(header, rows)

    out_by_code: Dict[str, Dict[str, Any]] = {}
    for r in ds:
        code = _strip(r.get("ID"))
        name = _strip(r.get("Customer Name"))
        if not code or not name:
            continue

        ctype = _strip(r.get("Customer Type")).lower()
        party_type = "business" if ctype in {"company", "business"} else "individual"

        disabled = _strip(r.get("Disabled"))
        is_active = False if disabled in {"1", "true", "yes"} else True

        phone = _strip(r.get("Mobile No")) or None
        email = _strip(r.get("Email Id")) or None
        tax_id = _strip(r.get("Tax ID")) or None

        pt = _first_int(_strip(r.get("Default Payment Terms Template")))  # best-effort

        rec = {
            "code": code,
            "name": name,
            "party_type": party_type,
            "customer_type": "retail",
            "phone": phone,
            "email": email,
            "tax_id": tax_id,
            "vat_no": None,
            "payment_terms_days": pt,
            "is_active": is_active,
        }

        # De-dupe by code: keep the one with more contact details, and prefer active.
        prev = out_by_code.get(code)
        if not prev:
            out_by_code[code] = rec
            continue
        score = (1 if rec["is_active"] else 0) + (1 if rec["phone"] else 0) + (1 if rec["email"] else 0) + (1 if rec["tax_id"] else 0)
        prev_score = (1 if prev["is_active"] else 0) + (1 if prev["phone"] else 0) + (1 if prev["email"] else 0) + (1 if prev["tax_id"] else 0)
        if score > prev_score:
            out_by_code[code] = rec

    return list(out_by_code.values())


def build_suppliers(supplier_csv: str) -> List[Dict[str, Any]]:
    header, rows = _read_erpnext_export_rows(supplier_csv)
    ds = _rows_to_dicts(header, rows)

    out_by_code: Dict[str, Dict[str, Any]] = {}
    for r in ds:
        code = _strip(r.get("ID"))
        name = _strip(r.get("Supplier Name"))
        if not code or not name:
            continue

        stype = _strip(r.get("Supplier Type")).lower()
        party_type = "business" if stype in {"company", "business"} else "individual"

        disabled = _strip(r.get("Disabled"))
        is_active = False if disabled in {"1", "true", "yes"} else True

        phone = _strip(r.get("Mobile No")) or None
        email = _strip(r.get("Email Id")) or None
        tax_id = _strip(r.get("Tax ID")) or None

        pt = _first_int(_strip(r.get("Default Payment Terms Template")))

        rec = {
            "code": code,
            "name": name,
            "party_type": party_type,
            "phone": phone,
            "email": email,
            "tax_id": tax_id,
            "vat_no": None,
            "payment_terms_days": pt,
            "is_active": is_active,
        }

        prev = out_by_code.get(code)
        if not prev:
            out_by_code[code] = rec
            continue
        score = (1 if rec["is_active"] else 0) + (1 if rec["phone"] else 0) + (1 if rec["email"] else 0) + (1 if rec["tax_id"] else 0)
        prev_score = (1 if prev["is_active"] else 0) + (1 if prev["phone"] else 0) + (1 if prev["email"] else 0) + (1 if prev["tax_id"] else 0)
        if score > prev_score:
            out_by_code[code] = rec

    return list(out_by_code.values())


def write_csv(path: str, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in fieldnames})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--customers-csv", default="Data AH Trading/Customer.csv")
    ap.add_argument("--suppliers-csv", default="Data AH Trading/Supplier.csv")
    ap.add_argument("--out-dir", default="Data AH Trading")
    args = ap.parse_args()

    out_dir = str(args.out_dir)
    customers_csv = str(args.customers_csv)
    suppliers_csv = str(args.suppliers_csv)

    customers = build_customers(customers_csv) if customers_csv else []
    suppliers = build_suppliers(suppliers_csv) if suppliers_csv else []

    customers_out = os.path.join(out_dir, "erpnext_pos_customers.csv")
    suppliers_out = os.path.join(out_dir, "erpnext_pos_suppliers.csv")

    write_csv(
        customers_out,
        customers,
        ["code", "name", "party_type", "customer_type", "phone", "email", "tax_id", "vat_no", "payment_terms_days", "is_active"],
    )
    write_csv(
        suppliers_out,
        suppliers,
        ["code", "name", "party_type", "phone", "email", "tax_id", "vat_no", "payment_terms_days", "is_active"],
    )

    print(
        json.dumps(
            {
                "ok": True,
                "out_dir": out_dir,
                "customers": len(customers),
                "suppliers": len(suppliers),
                "paths": {"customers": customers_out, "suppliers": suppliers_out},
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

