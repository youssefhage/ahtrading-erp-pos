#!/usr/bin/env python3
"""
Build POS masterdata CSVs from ERPNext's Item.csv export (no ERPNext API access required).

This is a fallback when ERPNext API permissions block listing child doctypes.

Inputs:
- Data AH Trading/Item.csv (original ERPNext export; includes child tables inline)
- (optional) Data AH Trading/erpnext_pos_items_prices.csv (prices/costs from live ERPNext Item Price)

Outputs (into --out-dir, default Data AH Trading/):
- erpnext_pos_items.csv
- erpnext_pos_prices.csv
- erpnext_pos_uom_conversions.csv
- erpnext_pos_barcodes.csv
- erpnext_pos_categories.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Optional


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _to_decimal(v: Any) -> Decimal:
    try:
        s = str(v or "").strip()
        if not s:
            return Decimal("0")
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _norm(v: Any) -> str:
    return str(v or "").strip()


def _strip_wrapped_quotes(v: str) -> str:
    s = (v or "").strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1]
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--item-csv", default="Data AH Trading/Item.csv")
    ap.add_argument("--prices-csv", default="Data AH Trading/erpnext_pos_items_prices.csv")
    ap.add_argument("--out-dir", default="Data AH Trading")
    args = ap.parse_args()

    item_csv = Path(str(args.item_csv))
    if not item_csv.exists():
        _die(f"missing input: {item_csv}")
    out_dir = Path(str(args.out_dir))
    out_dir.mkdir(parents=True, exist_ok=True)

    # Optional richer price/cost source (generated from ERPNext API Item Price).
    price_map: dict[str, dict[str, str]] = {}
    prices_csv = Path(str(args.prices_csv))
    if prices_csv.exists():
        with prices_csv.open(newline="", encoding="utf-8") as f:
            r = csv.DictReader(f)
            for row in r:
                sku = _norm(row.get("sku"))
                if not sku:
                    continue
                price_map[sku] = {
                    "name": _norm(row.get("name")),
                    "uom": _norm(row.get("unit_of_measure")),
                    "cost": _norm(row.get("standard_cost_usd")),
                    "price": _norm(row.get("price_usd")),
                }

    # Parse Item.csv (ERPNext export with child tables inline).
    with item_csv.open(newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r, None) or []
        # ERPNext exports include duplicate column names (child tables). We want the *first*
        # occurrence for base fields.
        idx: dict[str, int] = {}
        for i, h in enumerate(header):
            k = str(h)
            if k not in idx:
                idx[k] = i

        def col(name: str) -> Optional[int]:
            i = idx.get(name)
            return i if i is not None else None

        # Base columns.
        c_id = col("ID")
        c_name = col("Item Name")
        c_uom = col("Default Unit of Measure")
        c_group = col("Item Group")
        c_val = col("Valuation Rate")
        c_sell = col("Standard Selling Rate")

        # Child sections.
        # There are two "UOM" columns: conversions at index 74, barcode UOM at index 82.
        uom_cols = [i for i, h in enumerate(header) if (h or "").strip() == "UOM"]
        c_conv_uom = uom_cols[0] if len(uom_cols) >= 1 else None
        c_bc_uom = uom_cols[1] if len(uom_cols) >= 2 else None
        c_conv_factor = col("Conversion Factor")
        c_barcode = col("Barcode")
        c_tax_tmpl = col("Item Tax Template")

        if c_id is None or c_name is None or c_uom is None:
            _die("Item.csv missing required headers: ID, Item Name, Default Unit of Measure")

        items: dict[str, dict[str, str]] = {}
        conv: dict[str, dict[str, Decimal]] = {}
        barcodes: list[dict[str, str]] = []
        tax_by_sku: dict[str, str] = {}
        categories: set[str] = set()
        prices_out: dict[str, str] = {}

        current_sku = ""
        current_uom = ""

        for row in r:
            sku_cell = _strip_wrapped_quotes(row[c_id]) if c_id < len(row) else ""
            if sku_cell:
                current_sku = sku_cell
                current_uom = (_norm(row[c_uom]) if c_uom is not None and c_uom < len(row) else "EA").strip()
                name = _norm(row[c_name]) if c_name is not None and c_name < len(row) else current_sku
                group = _norm(row[c_group]) if c_group is not None and c_group < len(row) else ""
                if group:
                    categories.add(group)

                val = _to_decimal(row[c_val]) if c_val is not None and c_val < len(row) else Decimal("0")
                sell = _to_decimal(row[c_sell]) if c_sell is not None and c_sell < len(row) else Decimal("0")

                items[current_sku] = {
                    "sku": current_sku,
                    "name": name,
                    "unit_of_measure": current_uom or "EA",
                    "tax_code": "",
                    "standard_cost_usd": str(val) if val > 0 else "",
                    "category_name": group,
                }
                if sell > 0:
                    prices_out[current_sku] = str(sell)

            if not current_sku:
                continue

            # Tax template may be on a child row.
            if c_tax_tmpl is not None and c_tax_tmpl < len(row):
                tmpl = _norm(row[c_tax_tmpl])
                if tmpl and current_sku not in tax_by_sku:
                    tax_by_sku[current_sku] = tmpl

            # Conversions.
            if c_conv_uom is not None and c_conv_factor is not None and c_conv_uom < len(row) and c_conv_factor < len(row):
                u = _norm(row[c_conv_uom])
                f = _to_decimal(row[c_conv_factor])
                if u and f > 0:
                    conv.setdefault(current_sku, {})[u] = f

            # Barcodes.
            if c_barcode is not None and c_barcode < len(row):
                bc = _norm(row[c_barcode])
                if bc:
                    bc_u = _norm(row[c_bc_uom]) if c_bc_uom is not None and c_bc_uom < len(row) else ""
                    bc_u = bc_u or current_uom or "EA"
                    barcodes.append({"sku": current_sku, "barcode": bc, "uom_code": bc_u, "is_primary": "false"})

        # Apply tax template + upgrade costs/prices from price_map when present.
        for sku, it in items.items():
            if sku in tax_by_sku:
                it["tax_code"] = tax_by_sku[sku]
            pm = price_map.get(sku)
            if pm:
                if pm.get("name"):
                    it["name"] = pm["name"]
                if pm.get("uom"):
                    it["unit_of_measure"] = pm["uom"]
                if pm.get("cost"):
                    it["standard_cost_usd"] = pm["cost"]
                if pm.get("price"):
                    prices_out[sku] = pm["price"]

        # Mark first barcode per SKU as primary, compute qty_factor from conversions.
        # Ensure base UOM conversion exists.
        for sku, it in items.items():
            base = it.get("unit_of_measure") or "EA"
            conv.setdefault(sku, {}).setdefault(base, Decimal("1"))

        seen_bc = set()
        barcodes_out: list[dict[str, str]] = []
        for b in barcodes:
            sku = b["sku"]
            bc = b["barcode"]
            if (sku, bc) in seen_bc:
                continue
            seen_bc.add((sku, bc))
            base = (items.get(sku, {}) or {}).get("unit_of_measure") or "EA"
            u = b.get("uom_code") or base
            factor = conv.get(sku, {}).get(u)
            if factor is None:
                # If missing, default to 1 (better than dropping the barcode).
                factor = Decimal("1")
            barcodes_out.append(
                {
                    "sku": sku,
                    "barcode": bc,
                    "uom_code": u,
                    "qty_factor": str(factor),
                    "is_primary": "false",
                }
            )

        # Primary barcode = first encountered for the SKU.
        first_by_sku: dict[str, int] = {}
        for i, row in enumerate(barcodes_out):
            sku = row["sku"]
            if sku not in first_by_sku:
                first_by_sku[sku] = i
                row["is_primary"] = "true"

        # UOM conversions output.
        uoms_out: list[dict[str, str]] = []
        for sku, m in conv.items():
            for u, f in m.items():
                if not u or f <= 0:
                    continue
                uoms_out.append({"sku": sku, "uom_code": u, "to_base_factor": str(f), "is_active": "true"})

    # Write output CSVs.
    def write_csv(path: Path, rows: list[dict[str, str]], cols: list[str]) -> None:
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in cols})

    items_path = out_dir / "erpnext_pos_items.csv"
    prices_path = out_dir / "erpnext_pos_prices.csv"
    uoms_path = out_dir / "erpnext_pos_uom_conversions.csv"
    barcodes_path = out_dir / "erpnext_pos_barcodes.csv"
    cats_path = out_dir / "erpnext_pos_categories.csv"

    write_csv(items_path, list(items.values()), ["sku", "name", "unit_of_measure", "tax_code", "standard_cost_usd", "category_name"])
    write_csv(prices_path, [{"sku": sku, "price_usd": p, "price_lbp": "0"} for sku, p in sorted(prices_out.items())], ["sku", "price_usd", "price_lbp"])
    write_csv(uoms_path, uoms_out, ["sku", "uom_code", "to_base_factor", "is_active"])
    write_csv(barcodes_path, barcodes_out, ["sku", "barcode", "uom_code", "qty_factor", "is_primary"])
    write_csv(cats_path, [{"name": n, "parent_name": "", "is_active": "true"} for n in sorted(categories)], ["name", "parent_name", "is_active"])

    print(
        json.dumps(
            {
                "ok": True,
                "out_dir": str(out_dir),
                "items": len(items),
                "prices": len(prices_out),
                "uoms": len(uoms_out),
                "barcodes": len(barcodes_out),
                "categories": len(categories),
                "paths": {
                    "items": str(items_path),
                    "prices": str(prices_path),
                    "uoms": str(uoms_path),
                    "barcodes": str(barcodes_path),
                    "categories": str(cats_path),
                },
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
