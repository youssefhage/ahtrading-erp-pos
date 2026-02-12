#!/usr/bin/env python3
"""
Rebase exported POS masterdata CSVs to a target base UOM (default: Pc).

Input files (default under --dir):
- erpnext_pos_items.csv
- erpnext_pos_prices.csv
- erpnext_pos_uom_conversions.csv
- erpnext_pos_barcodes.csv

Output files are written to --out-dir with the same file names.

Why:
- When source ERP uses Box as stock/default UOM, fractional Pc factors (e.g. 0.04)
  can introduce pricing drift in wholesale.
- Rebasing to Pc makes pack factors integral (e.g. Box=24) and reduces rounding risk.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, getcontext
from typing import Any, Optional


getcontext().prec = 40

Q6 = Decimal("0.000001")
EPS = Decimal("0.0000001")


def _die(msg: str) -> None:
    raise SystemExit(f"error: {msg}")


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


def _fmt_dec(v: Decimal, places: Decimal = Q6) -> str:
    q = v.quantize(places, rounding=ROUND_HALF_UP)
    s = format(q, "f")
    s = s.rstrip("0").rstrip(".")
    return s or "0"


def _norm_uom(v: Any) -> str:
    return str(v or "").strip().upper()


def _is_pack_like_uom(u: str) -> bool:
    code = _norm_uom(u)
    if not code:
        return False
    pack_like = {
        "BOX",
        "CASE",
        "CARTON",
        "CTN",
        "PACK",
        "PK",
        "UNIT",
        "TRAY",
        "BAG",
        "SACK",
        "BOTTLE",
        "BTL",
        "JAR",
        "CAN",
    }
    if code in pack_like:
        return True
    return ("BOX" in code) or ("CASE" in code) or ("PACK" in code)


def _read_csv(path: str) -> tuple[list[str], list[dict[str, str]]]:
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        if not r.fieldnames:
            _die(f"missing header in {path}")
        rows = [dict(x) for x in r]
        return list(r.fieldnames), rows


def _write_csv(path: str, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in rows:
            out = {k: row.get(k, "") for k in fieldnames}
            w.writerow(out)


def _infer_pack_count(name: str) -> Optional[int]:
    """
    Best-effort pack-size parser from names like:
    - 400G*24
    - 24x330ML
    - X12
    """
    s = str(name or "").upper()
    if not s:
        return None

    candidates: list[int] = []

    # 24x350ML
    for m in re.finditer(r"\b(\d{1,3})\s*[X*]\s*\d+(?:[.,]\d+)?\s*(ML|L|G|GR|KG|GM|CL|OZ)\b", s):
        n = int(m.group(1))
        if 2 <= n <= 200:
            candidates.append(n)

    # 400G*24
    for m in re.finditer(r"\b\d+(?:[.,]\d+)?\s*(ML|L|G|GR|KG|GM|CL|OZ)\s*[X*]\s*(\d{1,3})\b", s):
        n = int(m.group(2))
        if 2 <= n <= 200:
            candidates.append(n)

    # Fallbacks around *24 / x24
    for m in re.finditer(r"[X*]\s*(\d{1,3})\b", s):
        n = int(m.group(1))
        if 2 <= n <= 200:
            candidates.append(n)

    if not candidates:
        return None

    # Prefer common wholesale packs when present.
    common = [24, 12, 6, 8, 10, 20, 30, 48]
    for c in common:
        if c in candidates:
            return c

    return candidates[-1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="Data AH Trading")
    ap.add_argument("--items", default="")
    ap.add_argument("--prices", default="")
    ap.add_argument("--uoms", default="")
    ap.add_argument("--barcodes", default="")
    ap.add_argument("--out-dir", default="")
    ap.add_argument("--target-base-uom", default="Pc")
    ap.add_argument("--prefer-pack-count", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base_dir = str(args.dir)
    items_path = str(args.items or os.path.join(base_dir, "erpnext_pos_items.csv"))
    prices_path = str(args.prices or os.path.join(base_dir, "erpnext_pos_prices.csv"))
    uoms_path = str(args.uoms or os.path.join(base_dir, "erpnext_pos_uom_conversions.csv"))
    barcodes_path = str(args.barcodes or os.path.join(base_dir, "erpnext_pos_barcodes.csv"))
    out_dir = str(args.out_dir or os.path.join(base_dir, "pc_base"))
    target = _norm_uom(args.target_base_uom or "Pc")
    if not target:
        _die("--target-base-uom is required")

    for p in [items_path, prices_path, uoms_path, barcodes_path]:
        if not os.path.exists(p):
            _die(f"missing file: {p}")

    items_fields, items_rows = _read_csv(items_path)
    prices_fields, prices_rows = _read_csv(prices_path)
    uoms_fields, uoms_rows = _read_csv(uoms_path)
    barcodes_fields, barcodes_rows = _read_csv(barcodes_path)

    items_by_sku: dict[str, dict[str, str]] = {}
    old_base_by_sku: dict[str, str] = {}
    name_by_sku: dict[str, str] = {}
    for r in items_rows:
        sku = str(r.get("sku") or "").strip()
        if not sku:
            continue
        items_by_sku[sku] = r
        old_base_by_sku[sku] = _norm_uom(r.get("unit_of_measure") or "")
        name_by_sku[sku] = str(r.get("name") or "")

    old_factor_by_sku_uom: dict[str, dict[str, Decimal]] = defaultdict(dict)
    for r in uoms_rows:
        sku = str(r.get("sku") or "").strip()
        u = _norm_uom(r.get("uom_code") or "")
        if not sku or not u:
            continue
        f = _to_dec(r.get("to_base_factor"))
        if f > 0:
            old_factor_by_sku_uom[sku][u] = f

    # Ensure old base factor exists (1) for robustness.
    for sku, old_base in old_base_by_sku.items():
        if old_base:
            old_factor_by_sku_uom[sku].setdefault(old_base, Decimal("1"))

    target_to_old_by_sku: dict[str, Decimal] = {}
    missing_target = 0
    pack_overrides = 0
    already_target = 0

    for sku, old_base in old_base_by_sku.items():
        if not old_base:
            continue
        if old_base == target:
            target_to_old_by_sku[sku] = Decimal("1")
            already_target += 1
            continue

        conv = old_factor_by_sku_uom.get(sku, {})
        target_to_old = conv.get(target)
        pack_n = _infer_pack_count(name_by_sku.get(sku, "")) if bool(args.prefer_pack_count) else None

        inferred = None
        if pack_n and target == "PC":
            # Generic Pc rebasing: works for Box/Case/Pack/etc and any pack count N
            # (x6, x8, x10, x12, x20, x24, ...), not only 24.
            if _is_pack_like_uom(old_base) or (target_to_old is None) or (target_to_old < Decimal("0.5")):
                inferred = Decimal("1") / Decimal(pack_n)

        if target_to_old and inferred:
            # If ERP factor is materially different from an obvious pack count, trust pack count.
            diff = (target_to_old - inferred).copy_abs()
            if diff > Decimal("0.0005"):
                target_to_old = inferred
                pack_overrides += 1
        elif not target_to_old and inferred:
            target_to_old = inferred
            pack_overrides += 1

        if target_to_old and target_to_old > 0:
            target_to_old_by_sku[sku] = target_to_old
        else:
            missing_target += 1

    # Transform items: set base uom to target, and convert standard cost to target base.
    # cost_target = cost_old * (target -> old_base)
    new_items_rows: list[dict[str, str]] = []
    rebased_items = 0
    for r in items_rows:
        sku = str(r.get("sku") or "").strip()
        out = dict(r)
        factor = target_to_old_by_sku.get(sku)
        if factor and factor > 0:
            out["unit_of_measure"] = target.title()
            c_usd = _to_dec(out.get("standard_cost_usd"))
            c_lbp = _to_dec(out.get("standard_cost_lbp"))
            if c_usd > 0:
                out["standard_cost_usd"] = _fmt_dec(c_usd * factor)
            if c_lbp > 0:
                out["standard_cost_lbp"] = _fmt_dec(c_lbp * factor)
            rebased_items += 1
        new_items_rows.append(out)

    # Transform prices to target base.
    # price_target = price_old * (target -> old_base)
    new_prices_rows: list[dict[str, str]] = []
    rebased_prices = 0
    for r in prices_rows:
        sku = str(r.get("sku") or "").strip()
        out = dict(r)
        factor = target_to_old_by_sku.get(sku)
        if factor and factor > 0:
            p_usd = _to_dec(out.get("price_usd"))
            p_lbp = _to_dec(out.get("price_lbp"))
            if p_usd > 0:
                out["price_usd"] = _fmt_dec(p_usd * factor)
            if p_lbp > 0:
                out["price_lbp"] = _fmt_dec(p_lbp * factor)
            rebased_prices += 1
        new_prices_rows.append(out)

    # Transform UOM conversions.
    # old: u -> old_base
    # new: u -> target where factor_new = factor_old / (target -> old_base)
    new_uom_map: dict[tuple[str, str], dict[str, str]] = {}
    for r in uoms_rows:
        sku = str(r.get("sku") or "").strip()
        u = _norm_uom(r.get("uom_code") or "")
        if not sku or not u:
            continue
        out = dict(r)
        factor = target_to_old_by_sku.get(sku)
        if factor and factor > 0:
            old_f = _to_dec(r.get("to_base_factor"))
            if old_f > 0:
                new_f = _q6(old_f / factor)
                out["to_base_factor"] = _fmt_dec(new_f)
        out["uom_code"] = out.get("uom_code", "")
        new_uom_map[(sku, _norm_uom(out.get("uom_code")))] = out

    # Ensure target base row exists with factor=1 for rebased SKUs.
    for sku, factor in target_to_old_by_sku.items():
        if not factor or factor <= 0:
            continue
        key = (sku, target)
        row = new_uom_map.get(key)
        if row is None:
            row = {"sku": sku, "uom_code": target.title(), "to_base_factor": "1", "is_active": "true"}
            new_uom_map[key] = row
        else:
            row["to_base_factor"] = "1"
            if "is_active" in row and not str(row.get("is_active") or "").strip():
                row["is_active"] = "true"

    new_uoms_rows = list(new_uom_map.values())
    new_factor_by_sku_uom: dict[tuple[str, str], Decimal] = {}
    for row in new_uoms_rows:
        sku = str(row.get("sku") or "").strip()
        u = _norm_uom(row.get("uom_code") or "")
        f = _to_dec(row.get("to_base_factor"))
        if sku and u and f > 0:
            new_factor_by_sku_uom[(sku, u)] = f

    # Build quick lookup of original barcode factor fallback.
    old_factor_qf: dict[tuple[str, str], Decimal] = {}
    for sku, by_u in old_factor_by_sku_uom.items():
        for u, f in by_u.items():
            if f > 0:
                old_factor_qf[(sku, u)] = f

    # Transform barcodes qty_factor to target base.
    new_barcodes_rows: list[dict[str, str]] = []
    rebased_barcodes = 0
    for r in barcodes_rows:
        sku = str(r.get("sku") or "").strip()
        out = dict(r)
        factor = target_to_old_by_sku.get(sku)
        if factor and factor > 0:
            u = _norm_uom(out.get("uom_code") or "")
            # Prefer exact post-rebase conversion table to avoid carrying old drift.
            if u:
                mapped = new_factor_by_sku_uom.get((sku, u))
                if mapped and mapped > 0:
                    out["qty_factor"] = _fmt_dec(_q6(mapped))
                    rebased_barcodes += 1
                else:
                    old_qf = _to_dec(out.get("qty_factor"))
                    if old_qf <= 0:
                        old_qf = old_factor_qf.get((sku, u), Decimal("0"))
                    if old_qf > 0:
                        new_qf = _q6(old_qf / factor)
                        out["qty_factor"] = _fmt_dec(new_qf)
                        rebased_barcodes += 1
        new_barcodes_rows.append(out)

    summary = {
        "target_base_uom": target,
        "items_total": len(items_rows),
        "items_rebased": rebased_items,
        "prices_total": len(prices_rows),
        "prices_rebased": rebased_prices,
        "uom_rows_total": len(uoms_rows),
        "uom_rows_out": len(new_uoms_rows),
        "barcode_rows_total": len(barcodes_rows),
        "barcode_rows_rebased": rebased_barcodes,
        "skus_already_target": already_target,
        "skus_missing_target_factor": missing_target,
        "pack_count_overrides_or_infers": pack_overrides,
        "out_dir": out_dir,
    }

    if args.dry_run:
        for k, v in summary.items():
            print(f"{k}: {v}")
        return 0

    _write_csv(os.path.join(out_dir, "erpnext_pos_items.csv"), items_fields, new_items_rows)
    _write_csv(os.path.join(out_dir, "erpnext_pos_prices.csv"), prices_fields, new_prices_rows)
    _write_csv(os.path.join(out_dir, "erpnext_pos_uom_conversions.csv"), uoms_fields, new_uoms_rows)
    _write_csv(os.path.join(out_dir, "erpnext_pos_barcodes.csv"), barcodes_fields, new_barcodes_rows)

    # Categories/customers/suppliers do not depend on base-UOM; copy if present.
    passthrough = [
        "erpnext_pos_categories.csv",
        "erpnext_pos_customers.csv",
        "erpnext_pos_suppliers.csv",
    ]
    for fn in passthrough:
        src = os.path.join(base_dir, fn)
        dst = os.path.join(out_dir, fn)
        if os.path.exists(src):
            with open(src, "rb") as fsrc:
                data = fsrc.read()
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as fdst:
                fdst.write(data)

    for k, v in summary.items():
        print(f"{k}: {v}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
