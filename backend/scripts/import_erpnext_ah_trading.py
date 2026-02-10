#!/usr/bin/env python3
"""
Import AH Trading "cleaned" ERPNext CSV exports into this system.

Designed for fast UAT data loads and to be safe to re-run:
- Uses stable keys (customer/supplier code, item sku) for upserts.
- Uses deterministic UUIDs for item prices and opening stock moves.

By default, this imports master data only (customers, suppliers, items, prices, opening stock).
Sales invoices are intentionally NOT imported by default because the ERPNext export format
can produce very large cross-product CSVs.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

import psycopg
from psycopg.rows import dict_row


NAMESPACE = uuid.UUID("8d5fe1a9-64b2-4dd4-9f45-4d2045b0fd4a")


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _norm(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    # ERPNext exports sometimes wrap IDs in repeated quotes (e.g. """AL-001""").
    s = s.strip('"').strip()
    return s or None


def _to_bool01(v: Optional[str]) -> Optional[bool]:
    v = _norm(v)
    if v is None:
        return None
    if v in {"1", "true", "True", "yes", "YES"}:
        return True
    if v in {"0", "false", "False", "no", "NO"}:
        return False
    return None


def _to_int(v: Optional[str]) -> Optional[int]:
    v = _norm(v)
    if v is None:
        return None
    try:
        return int(Decimal(v))
    except Exception:
        return None


def _to_decimal(v: Optional[str]) -> Decimal:
    v = _norm(v)
    if v is None:
        return Decimal("0")
    try:
        return Decimal(v)
    except Exception:
        return Decimal("0")


def _parse_date(v: Optional[str]) -> Optional[date]:
    v = _norm(v)
    if not v:
        return None
    # Accept "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS...."
    try:
        return date.fromisoformat(v[:10])
    except Exception:
        return None


def _uuid5(tag: str) -> str:
    return str(uuid.uuid5(NAMESPACE, tag))


def _set_company_context(cur, company_id: str) -> None:
    # Safe even when RLS is bypassed (e.g. admin role); helps if running under APP_DATABASE_URL.
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


@dataclass(frozen=True)
class ImportPaths:
    customers_csv: str
    suppliers_csv: str
    items_csv: str


def _paths(data_dir: str) -> ImportPaths:
    return ImportPaths(
        customers_csv=os.path.join(data_dir, "Customer_cleaned.csv"),
        suppliers_csv=os.path.join(data_dir, "Supplier_cleaned.csv"),
        items_csv=os.path.join(data_dir, "Item_cleaned.csv"),
    )


def _open_csv(path: str):
    # utf-8-sig strips BOM if present.
    return open(path, "r", encoding="utf-8-sig", newline="")


def _header_index(header: list[str]) -> dict[str, int]:
    # Note: Item_cleaned.csv contains duplicate column names, so we must only use
    # columns we expect to be unique (e.g. "Item Name", "Barcode").
    idx: dict[str, int] = {}
    for i, h in enumerate(header):
        k = (h or "").strip()
        if not k or k in idx:
            continue
        idx[k] = i
    return idx


def _get_company_id(cur, company_name: Optional[str], company_id: Optional[str]) -> str:
    if company_id:
        cur.execute("SELECT id, name FROM companies WHERE id=%s", (company_id,))
        row = cur.fetchone()
        if not row:
            _die(f"company_id not found: {company_id}")
        return str(row["id"])

    name = (company_name or "").strip()
    if not name:
        _die("provide --company-id or --company-name")
    cur.execute("SELECT id, name FROM companies WHERE lower(name)=lower(%s)", (name,))
    rows = cur.fetchall()
    if not rows:
        _die(f"company not found by name: {name}")
    if len(rows) > 1:
        _die(f"multiple companies match name: {name}")
    return str(rows[0]["id"])

def _get_company_id_by_name(cur, name: str) -> str:
    name = (name or "").strip()
    if not name:
        _die("company name is empty")
    cur.execute("SELECT id FROM companies WHERE lower(name)=lower(%s) LIMIT 2", (name,))
    rows = cur.fetchall()
    if not rows:
        _die(f"company not found by name: {name}")
    if len(rows) > 1:
        _die(f"multiple companies match name: {name}")
    return str(rows[0]["id"])

def _parse_kv_list(values: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in values or []:
        s = (raw or "").strip()
        if not s:
            continue
        if "=" not in s:
            _die(f"invalid mapping (expected A=B): {raw}")
        a, b = s.split("=", 1)
        a = a.strip()
        b = b.strip()
        if not a or not b:
            _die(f"invalid mapping (expected A=B): {raw}")
        out[a] = b
    return out


def _get_or_create_category(cur, company_id: str, name: str) -> Optional[str]:
    name = (name or "").strip()
    if not name:
        return None
    cur.execute(
        "SELECT id FROM item_categories WHERE company_id=%s AND name=%s",
        (company_id, name),
    )
    row = cur.fetchone()
    if row:
        return str(row["id"])
    cid = _uuid5(f"item_category:{company_id}:{name}")
    cur.execute(
        """
        INSERT INTO item_categories (id, company_id, name, parent_id, is_active)
        VALUES (%s::uuid, %s::uuid, %s, NULL, true)
        """,
        (cid, company_id, name),
    )
    return cid


def _parse_tax_rate(name: str) -> Decimal:
    """
    ERPNext "Item Tax Template" values in this dataset look like "11%".
    Store as fractional rate (0.11) to match app computations.
    """
    s = (name or "").strip()
    if not s:
        return Decimal("0")
    if s.endswith("%"):
        try:
            pct = Decimal(s[:-1].strip())
            return (pct / Decimal("100")).quantize(Decimal("0.0001"))
        except Exception:
            return Decimal("0")
    try:
        d = Decimal(s)
        # If someone exported 11 instead of 0.11, treat values > 1 as percent.
        if d > 1:
            return (d / Decimal("100")).quantize(Decimal("0.0001"))
        return d.quantize(Decimal("0.0001"))
    except Exception:
        return Decimal("0")


def _get_or_create_tax_code(cur, company_id: str, name: str) -> Optional[str]:
    name = (name or "").strip()
    if not name:
        return None
    cur.execute(
        "SELECT id, rate FROM tax_codes WHERE company_id=%s AND name=%s",
        (company_id, name),
    )
    row = cur.fetchone()
    rate = _parse_tax_rate(name)
    if row:
        tid = str(row["id"])
        # Keep existing, but if rate differs (rare), update to the parsed one.
        try:
            existing = Decimal(str(row["rate"] or 0))
        except Exception:
            existing = Decimal("0")
        if existing != rate:
            cur.execute(
                "UPDATE tax_codes SET rate=%s WHERE company_id=%s AND id=%s",
                (rate, company_id, tid),
            )
        return tid

    tid = _uuid5(f"tax_code:{company_id}:{name}")
    cur.execute(
        """
        INSERT INTO tax_codes (id, company_id, name, rate, tax_type, reporting_currency)
        VALUES (%s::uuid, %s::uuid, %s, %s, 'vat', 'LBP')
        """,
        (tid, company_id, name, rate),
    )
    return tid


def _get_or_create_warehouse(cur, company_id: str, name: str) -> Optional[str]:
    name = (name or "").strip()
    if not name:
        return None
    cur.execute(
        "SELECT id FROM warehouses WHERE company_id=%s AND name=%s LIMIT 1",
        (company_id, name),
    )
    row = cur.fetchone()
    if row:
        return str(row["id"])
    wid = _uuid5(f"warehouse:{company_id}:{name}")
    cur.execute(
        "INSERT INTO warehouses (id, company_id, name, location) VALUES (%s::uuid, %s::uuid, %s, NULL)",
        (wid, company_id, name),
    )
    return wid


def import_customers(cur, company_id: str, path: str) -> dict[str, int]:
    inserted = 0
    updated = 0
    skipped = 0

    with _open_csv(path) as f:
        r = csv.reader(f)
        header = next(r, None)
        if not header:
            _die(f"empty csv: {path}")
        idx = _header_index([str(h) for h in header])

        required = ["ID", "Customer Name"]
        for k in required:
            if k not in idx:
                _die(f"missing column '{k}' in {path}")

        for row in r:
            code = _norm(row[idx["ID"]]) or None
            name = _norm(row[idx["Customer Name"]]) or None
            if not code or not name:
                skipped += 1
                continue

            phone = _norm(row[idx.get("Mobile No", -1)]) if "Mobile No" in idx else None
            email = _norm(row[idx.get("Email Id", -1)]) if "Email Id" in idx else None
            tax_id = _norm(row[idx.get("Tax ID", -1)]) if "Tax ID" in idx else None
            cust_type = _norm(row[idx.get("Customer Type", -1)]) if "Customer Type" in idx else None
            disabled = _to_bool01(row[idx.get("Disabled", -1)]) if "Disabled" in idx else False
            is_active = not bool(disabled)
            party_type = "business" if (cust_type or "").lower() == "company" else "individual"

            cur.execute(
                """
                INSERT INTO customers
                  (id, company_id, code, name, phone, email, party_type, tax_id, is_active)
                VALUES
                  (%s::uuid, %s::uuid, %s, %s, %s, %s, %s::party_type, %s, %s)
                ON CONFLICT (company_id, code) WHERE code IS NOT NULL AND code <> ''
                DO UPDATE SET
                  name = EXCLUDED.name,
                  phone = EXCLUDED.phone,
                  email = EXCLUDED.email,
                  party_type = EXCLUDED.party_type,
                  tax_id = EXCLUDED.tax_id,
                  is_active = EXCLUDED.is_active
                RETURNING (xmax = 0) AS inserted
                """,
                (_uuid5(f"customer:{company_id}:{code}"), company_id, code, name, phone, email, party_type, tax_id, is_active),
            )
            res = cur.fetchone()
            if res and res.get("inserted"):
                inserted += 1
            else:
                updated += 1

    return {"inserted": inserted, "updated": updated, "skipped": skipped}


def import_suppliers(cur, company_id: str, path: str) -> dict[str, int]:
    inserted = 0
    updated = 0
    skipped = 0

    with _open_csv(path) as f:
        r = csv.reader(f)
        header = next(r, None)
        if not header:
            _die(f"empty csv: {path}")
        idx = _header_index([str(h) for h in header])

        required = ["ID", "Supplier Name"]
        for k in required:
            if k not in idx:
                _die(f"missing column '{k}' in {path}")

        for row in r:
            code = _norm(row[idx["ID"]]) or None
            name = _norm(row[idx["Supplier Name"]]) or None
            if not code or not name:
                skipped += 1
                continue

            phone = _norm(row[idx.get("Mobile No", -1)]) if "Mobile No" in idx else None
            email = _norm(row[idx.get("Email Id", -1)]) if "Email Id" in idx else None
            tax_id = _norm(row[idx.get("Tax ID", -1)]) if "Tax ID" in idx else None
            disabled = _to_bool01(row[idx.get("Disabled", -1)]) if "Disabled" in idx else False
            is_active = not bool(disabled)
            sup_type = _norm(row[idx.get("Supplier Type", -1)]) if "Supplier Type" in idx else None
            party_type = "business" if (sup_type or "").lower() == "company" else "business"

            cur.execute(
                """
                INSERT INTO suppliers
                  (id, company_id, code, name, phone, email, party_type, tax_id, is_active)
                VALUES
                  (%s::uuid, %s::uuid, %s, %s, %s, %s, %s::party_type, %s, %s)
                ON CONFLICT (company_id, code) WHERE code IS NOT NULL AND code <> ''
                DO UPDATE SET
                  name = EXCLUDED.name,
                  phone = EXCLUDED.phone,
                  email = EXCLUDED.email,
                  party_type = EXCLUDED.party_type,
                  tax_id = EXCLUDED.tax_id,
                  is_active = EXCLUDED.is_active
                RETURNING (xmax = 0) AS inserted
                """,
                (_uuid5(f"supplier:{company_id}:{code}"), company_id, code, name, phone, email, party_type, tax_id, is_active),
            )
            res = cur.fetchone()
            if res and res.get("inserted"):
                inserted += 1
            else:
                updated += 1

    return {"inserted": inserted, "updated": updated, "skipped": skipped}


def import_items(
    cur,
    default_company_id: str,
    path: str,
    *,
    import_prices: bool,
    import_opening_stock: bool,
    default_warehouse_name: Optional[str],
    link_item_suppliers: bool,
    company_alias_to_id: dict[str, str],
) -> dict[str, int]:
    upserted = 0
    skipped = 0
    barcodes_upserted = 0
    prices_upserted = 0
    stock_moves_upserted = 0
    supplier_links = 0

    default_warehouse_id = None
    if default_warehouse_name:
        default_warehouse_id = _get_or_create_warehouse(cur, default_company_id, default_warehouse_name)

    with _open_csv(path) as f:
        r = csv.reader(f)
        header = next(r, None)
        if not header:
            _die(f"empty csv: {path}")
        header = [str(h) for h in header]
        idx = _header_index(header)

        # Required unique columns.
        required = ["ID", "Item Name", "Item Group", "Default Unit of Measure"]
        for k in required:
            if k not in idx:
                _die(f"missing column '{k}' in {path}")

        # Best-effort optional columns.
        c_disabled = idx.get("Disabled")
        c_brand = idx.get("Brand")
        c_desc = idx.get("Description")
        c_barcode = idx.get("Barcode")
        c_group = idx.get("Item Group")
        c_uom = idx.get("Default Unit of Measure")
        c_opening = idx.get("Opening Stock")
        c_val_rate = idx.get("Valuation Rate")
        c_last_purchase_rate = idx.get("Last Purchase Rate")
        c_sell_rate = idx.get("Standard Selling Rate")
        c_allow_neg = idx.get("Allow Negative Stock")
        c_has_batch = idx.get("Has Batch No")
        c_has_expiry = idx.get("Has Expiry Date")
        c_shelf_life = idx.get("Shelf Life In Days")
        c_default_wh = idx.get("Default Warehouse")
        c_tax_tpl = idx.get("Item Tax Template")
        c_supplier = idx.get("Supplier")
        c_company = idx.get("Company")

        for row in r:
            # Pick the target company for this item row.
            row_company_name = _norm(row[c_company]) if c_company is not None else None
            company_id = company_alias_to_id.get(row_company_name or "", None) or default_company_id

            _set_company_context(cur, company_id)

            sku = _norm(row[idx["ID"]]) or None
            name = _norm(row[idx["Item Name"]]) or None
            if not sku or not name:
                skipped += 1
                continue

            uom = _norm(row[c_uom]) if c_uom is not None else None
            uom = uom or "EA"
            group = _norm(row[c_group]) if c_group is not None else None
            category_id = _get_or_create_category(cur, company_id, group or "") if group else None

            disabled = _to_bool01(row[c_disabled]) if c_disabled is not None else False
            is_active = not bool(disabled)
            brand = _norm(row[c_brand]) if c_brand is not None else None
            desc = _norm(row[c_desc]) if c_desc is not None else None

            allow_negative_stock = None
            if c_allow_neg is not None:
                allow_negative_stock = _to_bool01(row[c_allow_neg])

            track_batches = bool(_to_bool01(row[c_has_batch]) or False) if c_has_batch is not None else False
            track_expiry = bool(_to_bool01(row[c_has_expiry]) or False) if c_has_expiry is not None else False
            shelf_life_days = _to_int(row[c_shelf_life]) if c_shelf_life is not None else None

            barcode = _norm(row[c_barcode]) if c_barcode is not None else None

            tax_code_id = None
            if c_tax_tpl is not None:
                tax_name = _norm(row[c_tax_tpl]) or ""
                if tax_name:
                    tax_code_id = _get_or_create_tax_code(cur, company_id, tax_name)

            cur.execute(
                """
                INSERT INTO items
                  (id, company_id, sku, barcode, name, unit_of_measure,
                   tax_code_id, is_active, category_id, brand, description,
                   track_batches, track_expiry, default_shelf_life_days, allow_negative_stock)
                VALUES
                  (%s::uuid, %s::uuid, %s, %s, %s, %s,
                   %s::uuid, %s, %s::uuid, %s, %s,
                   %s, %s, %s, %s)
                ON CONFLICT (company_id, sku) DO UPDATE SET
                  barcode = EXCLUDED.barcode,
                  name = EXCLUDED.name,
                  unit_of_measure = EXCLUDED.unit_of_measure,
                  tax_code_id = EXCLUDED.tax_code_id,
                  is_active = EXCLUDED.is_active,
                  category_id = EXCLUDED.category_id,
                  brand = EXCLUDED.brand,
                  description = EXCLUDED.description,
                  track_batches = EXCLUDED.track_batches,
                  track_expiry = EXCLUDED.track_expiry,
                  default_shelf_life_days = EXCLUDED.default_shelf_life_days,
                  allow_negative_stock = EXCLUDED.allow_negative_stock
                RETURNING id
                """,
                (
                    _uuid5(f"item:{company_id}:{sku}"),
                    company_id,
                    sku,
                    barcode,
                    name,
                    uom,
                    tax_code_id,
                    is_active,
                    category_id,
                    brand,
                    desc,
                    track_batches,
                    track_expiry,
                    shelf_life_days,
                    allow_negative_stock,
                ),
            )
            item_id = str(cur.fetchone()["id"])
            upserted += 1

            # Extra barcode table (scan support).
            if barcode:
                cur.execute(
                    """
                    INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, label, is_primary)
                    VALUES (%s::uuid, %s::uuid, %s::uuid, %s, 1, NULL, true)
                    ON CONFLICT (company_id, barcode) DO UPDATE
                    SET is_primary = true
                    WHERE item_barcodes.item_id = EXCLUDED.item_id
                    """,
                    (_uuid5(f"item_barcode:{company_id}:{barcode}"), company_id, item_id, barcode),
                )
                barcodes_upserted += 1

            # Item supplier link (best effort).
            if link_item_suppliers and c_supplier is not None:
                sup_name = _norm(row[c_supplier])
                if sup_name:
                    cur.execute(
                        "SELECT id FROM suppliers WHERE company_id=%s AND name=%s LIMIT 1",
                        (company_id, sup_name),
                    )
                    srow = cur.fetchone()
                    if srow:
                        supplier_id = str(srow["id"])
                        last_cost = _to_decimal(row[c_last_purchase_rate]) if c_last_purchase_rate is not None else Decimal("0")
                        min_order_qty = _to_decimal(row[idx.get("Minimum Order Qty")]) if "Minimum Order Qty" in idx else Decimal("0")
                        lead_time_days = int(_to_decimal(row[idx.get("Lead Time in days")])) if "Lead Time in days" in idx else 0
                        cur.execute(
                            """
                            INSERT INTO item_suppliers
                              (id, company_id, item_id, supplier_id, is_primary, lead_time_days, min_order_qty, last_cost_usd, last_cost_lbp)
                            VALUES
                              (%s::uuid, %s::uuid, %s::uuid, %s::uuid, true, %s, %s, %s, 0)
                            ON CONFLICT (company_id, item_id, supplier_id) DO UPDATE
                            SET is_primary = EXCLUDED.is_primary,
                                lead_time_days = EXCLUDED.lead_time_days,
                                min_order_qty = EXCLUDED.min_order_qty,
                                last_cost_usd = EXCLUDED.last_cost_usd
                            """,
                            (
                                _uuid5(f"item_supplier:{company_id}:{item_id}:{supplier_id}"),
                                company_id,
                                item_id,
                                supplier_id,
                                lead_time_days,
                                min_order_qty,
                                last_cost,
                            ),
                        )
                        supplier_links += 1

            # Prices (item_prices) for quick POS tests.
            if import_prices and c_sell_rate is not None:
                price_usd = _to_decimal(row[c_sell_rate])
                if price_usd > 0:
                    eff = date.today()
                    price_id = _uuid5(f"item_price:{item_id}:{eff.isoformat()}")
                    cur.execute(
                        """
                        INSERT INTO item_prices (id, item_id, price_usd, price_lbp, effective_from, effective_to)
                        VALUES (%s::uuid, %s::uuid, %s, 0, %s, NULL)
                        ON CONFLICT (id) DO UPDATE
                        SET price_usd = EXCLUDED.price_usd,
                            effective_to = EXCLUDED.effective_to
                        """,
                        (price_id, item_id, price_usd, eff),
                    )
                    prices_upserted += 1

            # Opening stock as an idempotent stock_move per item.
            if import_opening_stock and c_opening is not None:
                qty = _to_decimal(row[c_opening])
                if qty and qty > 0:
                    wh_name = _norm(row[c_default_wh]) if c_default_wh is not None else None
                    wid = _get_or_create_warehouse(cur, company_id, wh_name) if wh_name else default_warehouse_id
                    if not wid:
                        # If no warehouse is known, skip stock but still import item.
                        continue
                    unit_cost = Decimal("0")
                    if c_val_rate is not None:
                        unit_cost = _to_decimal(row[c_val_rate])
                    if unit_cost <= 0 and c_last_purchase_rate is not None:
                        unit_cost = _to_decimal(row[c_last_purchase_rate])
                    move_id = _uuid5(f"opening_stock_move:{company_id}:{sku}:{wid}")
                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, batch_id, qty_in, qty_out,
                           unit_cost_usd, unit_cost_lbp, source_type, source_id, created_at)
                        VALUES
                          (%s::uuid, %s::uuid, %s::uuid, %s::uuid, NULL, %s, 0,
                           %s, 0, 'erpnext_opening_stock', %s::uuid, %s)
                        ON CONFLICT (id) DO NOTHING
                        RETURNING id
                        """,
                        (
                            move_id,
                            company_id,
                            item_id,
                            wid,
                            qty,
                            unit_cost,
                            _uuid5(f"opening_stock_source:{company_id}:{sku}:{wid}"),
                            datetime.utcnow(),
                        ),
                    )
                    if cur.fetchone():
                        stock_moves_upserted += 1

    return {
        "upserted": upserted,
        "skipped": skipped,
        "barcodes_upserted": barcodes_upserted,
        "prices_upserted": prices_upserted,
        "opening_stock_moves_upserted": stock_moves_upserted,
        "item_supplier_links_upserted": supplier_links,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="Data AH Trading", help="Path to the data folder")
    ap.add_argument("--db-url", default=os.getenv("DATABASE_URL") or os.getenv("APP_DATABASE_URL") or "")
    ap.add_argument("--company-id", default="", help="Default target company id (fallback for items missing Company)")
    ap.add_argument("--company-name", default="AH Trading Official", help="Default target company name (fallback for items missing Company)")
    ap.add_argument(
        "--company-alias",
        action="append",
        default=[],
        help="Map ERPNext company name to our company name, e.g. \"Antoine Hage Trading=AH Trading Official\". Can be repeated.",
    )
    ap.add_argument(
        "--customers-companies",
        default="AH Trading Official,AH Trading Unofficial",
        help="Comma-separated company names to import customers into (shared customers).",
    )
    ap.add_argument(
        "--suppliers-company",
        default="AH Trading Official",
        help="Company name to import suppliers into.",
    )
    ap.add_argument("--apply", action="store_true", help="Commit changes (default: dry-run / rollback)")
    ap.add_argument("--skip-customers", action="store_true")
    ap.add_argument("--skip-suppliers", action="store_true")
    ap.add_argument("--skip-items", action="store_true")
    ap.add_argument("--skip-prices", action="store_true")
    ap.add_argument("--skip-opening-stock", action="store_true")
    ap.add_argument("--default-warehouse", default="Main Warehouse")
    ap.add_argument("--link-item-suppliers", action="store_true", help="Create item_suppliers links when Supplier is present")
    args = ap.parse_args()

    if not args.db_url:
        _die("db url missing: set DATABASE_URL/APP_DATABASE_URL or pass --db-url")

    p = _paths(args.data_dir)
    for fp in [p.customers_csv, p.suppliers_csv, p.items_csv]:
        if not os.path.exists(fp):
            _die(f"missing file: {fp}")

    with psycopg.connect(args.db_url, row_factory=dict_row) as conn:
        try:
            with conn.cursor() as cur:
                default_company_id = _get_company_id(cur, args.company_name, (args.company_id or "").strip() or None)

                # Default alias mappings for this dataset (can be overridden via --company-alias).
                alias = {
                    "Antoine Hage Trading": "AH Trading Official",
                    "UNDISCLOSED COMPANY": "AH Trading Unofficial",
                    # Best-effort: treat accounting as official unless overridden.
                    "ACOUNTING COMPANY": "AH Trading Official",
                }
                alias.update(_parse_kv_list(args.company_alias))

                # Resolve alias -> company_id.
                company_alias_to_id: dict[str, str] = {}
                for erpnext_name, our_name in alias.items():
                    try:
                        company_alias_to_id[erpnext_name] = _get_company_id_by_name(cur, our_name)
                    except SystemExit:
                        raise

                customers_company_names = [x.strip() for x in (args.customers_companies or "").split(",") if x.strip()]
                if not customers_company_names:
                    _die("--customers-companies cannot be empty")
                customers_company_ids = {n: _get_company_id_by_name(cur, n) for n in customers_company_names}

                suppliers_company_id = _get_company_id_by_name(cur, (args.suppliers_company or "").strip())

            with conn.cursor() as cur:
                _set_company_context(cur, default_company_id)

                print(f"default_company_id={default_company_id}")
                print(f"company_alias_to_id={company_alias_to_id}")
                print(f"customers_company_ids={customers_company_ids}")
                print(f"suppliers_company_id={suppliers_company_id}")
                print(f"data_dir={args.data_dir}")

                if not args.skip_customers:
                    totals = {"inserted": 0, "updated": 0, "skipped": 0}
                    for cname, cid in customers_company_ids.items():
                        _set_company_context(cur, cid)
                        res = import_customers(cur, cid, p.customers_csv)
                        print(f"customers[{cname}]: {res}")
                        for k in totals:
                            totals[k] += int(res.get(k) or 0)
                    print(f"customers_total: {totals}")

                if not args.skip_suppliers:
                    _set_company_context(cur, suppliers_company_id)
                    res = import_suppliers(cur, suppliers_company_id, p.suppliers_csv)
                    print(f"suppliers: {res}")

                if not args.skip_items:
                    res = import_items(
                        cur,
                        default_company_id,
                        p.items_csv,
                        import_prices=not args.skip_prices,
                        import_opening_stock=not args.skip_opening_stock,
                        default_warehouse_name=(args.default_warehouse or "").strip() or None,
                        link_item_suppliers=bool(args.link_item_suppliers),
                        company_alias_to_id=company_alias_to_id,
                    )
                    print(f"items: {res}")

            if args.apply:
                conn.commit()
                print("ok (applied)")
            else:
                conn.rollback()
                print("ok (dry-run)")
            return 0
        except Exception:
            # Ensure we don't leave a partial import behind.
            try:
                conn.rollback()
            except Exception:
                pass
            raise


if __name__ == "__main__":
    raise SystemExit(main())
