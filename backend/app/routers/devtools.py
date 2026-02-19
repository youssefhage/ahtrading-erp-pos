from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional
import uuid
import json

from ..config import settings
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

# Reuse the real opening stock import logic so demo stock behaves like real go-live data.
from .inventory import OpeningStockImportIn, OpeningStockLineIn, import_opening_stock

router = APIRouter(prefix="/devtools", tags=["devtools"])


class DemoDataIn(BaseModel):
    size: str = "small"  # "small" | "medium"
    seed: Optional[int] = None
    with_opening_stock: bool = True
    posting_date: Optional[date] = None


@router.post("/demo-data/import", dependencies=[Depends(require_permission("config:write"))])
def import_demo_data(data: DemoDataIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Local/dev utility: seed demo master data + (optionally) opening stock so operators can test quickly.
    Disabled in non-local environments.
    """
    if settings.env not in {"local", "dev"}:
        # Act like it doesn't exist in production to avoid accidental exposure.
        raise HTTPException(status_code=404, detail="not found")

    size = (data.size or "small").strip().lower()
    if size not in {"small", "medium"}:
        raise HTTPException(status_code=400, detail="size must be small or medium")

    # Phase 1: seed master data and commit so subsequent routines (opening stock)
    # can safely use a new DB connection.
    warehouse_id = ""
    tax_code_id = None
    supplier_ids: list[str] = []
    customer_ids: list[str] = []
    created_item_ids: list[str] = []

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT value_json
                FROM company_settings
                WHERE company_id=%s AND key='demo_data'
                """,
                (company_id,),
            )
            existing = cur.fetchone()
            if existing and existing.get("value_json") and isinstance(existing["value_json"], dict):
                return {"ok": True, "already_seeded": True, "details": existing["value_json"]}

        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM warehouses WHERE company_id=%s ORDER BY name ASC LIMIT 1", (company_id,))
                w = cur.fetchone()
                if not w:
                    raise HTTPException(status_code=400, detail="no warehouse found (seed_bootstrap_master_data should create one)")
                warehouse_id = str(w["id"])

                cur.execute(
                    """
                    SELECT id
                    FROM tax_codes
                    WHERE company_id=%s
                    ORDER BY (tax_type='vat') DESC, name ASC
                    LIMIT 1
                    """,
                    (company_id,),
                )
                t = cur.fetchone()
                tax_code_id = str(t["id"]) if t else None

                demo_suppliers = [
                    ("DEMO-SUP-001", "Demo Supplier (Food)"),
                    ("DEMO-SUP-002", "Demo Supplier (Beverage)"),
                    ("DEMO-SUP-003", "Demo Supplier (Household)"),
                ]
                for code, name in demo_suppliers:
                    cur.execute(
                        """
                        INSERT INTO suppliers (id, company_id, code, name, payment_terms_days, is_active)
                        VALUES (gen_random_uuid(), %s, %s, %s, 7, true)
                        ON CONFLICT (company_id, code) WHERE code IS NOT NULL AND code <> '' DO UPDATE
                        SET name = EXCLUDED.name, is_active = true
                        RETURNING id
                        """,
                        (company_id, code, name),
                    )
                    supplier_ids.append(str(cur.fetchone()["id"]))

                demo_customers = [
                    ("DEMO-CUS-001", "Demo Customer (Retail)"),
                    ("DEMO-CUS-002", "Demo Customer (Wholesale)"),
                ]
                for code, name in demo_customers:
                    cur.execute(
                        """
                        INSERT INTO customers (id, company_id, code, name, is_active, payment_terms_days)
                        VALUES (gen_random_uuid(), %s, %s, %s, true, 0)
                        ON CONFLICT (company_id, code) WHERE code IS NOT NULL AND code <> '' DO UPDATE
                        SET name = EXCLUDED.name, is_active = true
                        RETURNING id
                        """,
                        (company_id, code, name),
                    )
                    customer_ids.append(str(cur.fetchone()["id"]))

                base_items = [
                    ("DEMO-0001", "Pringles Original 40g", "EA", "300000000001"),
                    ("DEMO-0002", "Pringles Paprika 40g", "EA", "300000000002"),
                    ("DEMO-0003", "Coca-Cola Can 330ml", "EA", "300000000003"),
                    ("DEMO-0004", "Pepsi Can 330ml", "EA", "300000000004"),
                    ("DEMO-0005", "Water Bottle 500ml", "EA", "300000000005"),
                    ("DEMO-0006", "Chocolate Bar 45g", "EA", "300000000006"),
                    ("DEMO-0007", "Detergent 1L", "EA", "300000000007"),
                    ("DEMO-0008", "Tissues Box", "EA", "300000000008"),
                    ("DEMO-0009", "Olive Oil 1L", "EA", "300000000009"),
                    ("DEMO-0010", "Rice 1kg", "EA", "300000000010"),
                ]

                extra_count = 20 if size == "small" else 80
                extra_items = []
                for i in range(1, extra_count + 1):
                    n = 1000 + i
                    sku = f"DEMO-{n:04d}"
                    name = f"Demo Item {i:02d}"
                    barcode = f"3000001{n:05d}"[:12]
                    extra_items.append((sku, name, "EA", barcode))

                items_to_create = base_items + extra_items
                needed_uoms = sorted(
                    {(u or "").strip().upper() for _, _, u, _ in items_to_create if (u or "").strip()} | {"BOX"}
                )
                for uom_code in needed_uoms:
                    cur.execute(
                        """
                        INSERT INTO unit_of_measures (id, company_id, code, name, is_active)
                        VALUES (gen_random_uuid(), %s, %s, %s, true)
                        ON CONFLICT (company_id, code) DO UPDATE
                        SET is_active = true,
                            updated_at = now()
                        """,
                        (company_id, uom_code, uom_code),
                    )

                for idx, (sku, name, uom, barcode) in enumerate(items_to_create):
                    base_uom = (uom or "").strip().upper()
                    price_usd = Decimal("0.50") + (Decimal(idx) * Decimal("0.15"))
                    cost_usd = max(Decimal("0.10"), price_usd * Decimal("0.65"))

                    cur.execute(
                        """
                        INSERT INTO items
                          (id, company_id, sku, barcode, name, unit_of_measure, tax_code_id, is_active)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, true)
                        ON CONFLICT (company_id, sku) DO UPDATE
                        SET barcode = EXCLUDED.barcode,
                            name = EXCLUDED.name,
                            unit_of_measure = EXCLUDED.unit_of_measure,
                            tax_code_id = EXCLUDED.tax_code_id,
                            is_active = true,
                            updated_at = now()
                        RETURNING id
                        """,
                        (company_id, sku, barcode, name, base_uom, tax_code_id),
                    )
                    item_id = str(cur.fetchone()["id"])
                    created_item_ids.append(item_id)

                    # Keep demo data POS-ready: default base conversion and case conversion.
                    cur.execute(
                        """
                        INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
                        VALUES (gen_random_uuid(), %s, %s, %s, 1, true)
                        ON CONFLICT (company_id, item_id, uom_code) DO UPDATE
                        SET to_base_factor = 1,
                            is_active = true,
                            updated_at = now()
                        """,
                        (company_id, item_id, base_uom),
                    )
                    cur.execute(
                        """
                        INSERT INTO item_uom_conversions (id, company_id, item_id, uom_code, to_base_factor, is_active)
                        VALUES (gen_random_uuid(), %s, %s, 'BOX', 12, true)
                        ON CONFLICT (company_id, item_id, uom_code) DO UPDATE
                        SET to_base_factor = 12,
                            is_active = true,
                            updated_at = now()
                        """,
                        (company_id, item_id),
                    )

                    if barcode:
                        cur.execute(
                            """
                            INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, uom_code, label, is_primary)
                            VALUES (gen_random_uuid(), %s, %s, %s, 1, %s, NULL, true)
                            ON CONFLICT (company_id, barcode) DO UPDATE
                            SET item_id = EXCLUDED.item_id,
                                qty_factor = EXCLUDED.qty_factor,
                                uom_code = EXCLUDED.uom_code,
                                is_primary = true,
                                updated_at = now()
                            """,
                            (company_id, item_id, barcode, base_uom),
                        )

                        if len(barcode) >= 2:
                            case_barcode = f"{barcode[:-1]}9"
                            if case_barcode == barcode:
                                case_barcode = f"{barcode[:-1]}8"
                        else:
                            case_barcode = f"{barcode}9"
                        cur.execute(
                            """
                            INSERT INTO item_barcodes (id, company_id, item_id, barcode, qty_factor, uom_code, label, is_primary)
                            VALUES (gen_random_uuid(), %s, %s, %s, 12, 'BOX', 'Case (12)', false)
                            ON CONFLICT (company_id, barcode) DO NOTHING
                            """,
                            (company_id, item_id, case_barcode),
                        )

                    cur.execute(
                        """
                        INSERT INTO item_prices (id, item_id, price_usd, price_lbp, effective_from)
                        SELECT gen_random_uuid(), %s, %s, 0, CURRENT_DATE
                        WHERE NOT EXISTS (SELECT 1 FROM item_prices p WHERE p.item_id=%s)
                        """,
                        (item_id, price_usd, item_id),
                    )

                    sup_id = supplier_ids[idx % len(supplier_ids)]
                    cur.execute(
                        """
                        INSERT INTO item_suppliers
                          (id, company_id, item_id, supplier_id, is_primary, lead_time_days, min_order_qty, last_cost_usd, last_cost_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, true, 2, 1, %s, 0)
                        ON CONFLICT (company_id, item_id, supplier_id) DO UPDATE
                        SET is_primary = true,
                            last_cost_usd = EXCLUDED.last_cost_usd
                        """,
                        (company_id, item_id, sup_id, cost_usd),
                    )

    # Phase 2: optional opening stock (separate connection/transaction).
    opening_stock_result = None
    opening_import_id = None
    if data.with_opening_stock:
        opening_import_id = str(uuid.uuid4())
        lines = []
        for idx, item_id in enumerate(created_item_ids):
            cost_usd = Decimal("0.10") + (Decimal(idx) * Decimal("0.10"))
            qty = Decimal("5") + (Decimal(idx) % Decimal("9"))
            lines.append(
                OpeningStockLineIn(
                    item_id=item_id,
                    sku=None,
                    qty=qty,
                    unit_cost_usd=cost_usd,
                    unit_cost_lbp=Decimal("0"),
                    batch_no=None,
                    expiry_date=None,
                )
            )
        opening_stock_result = import_opening_stock(
            OpeningStockImportIn(
                warehouse_id=warehouse_id,
                import_id=opening_import_id,
                posting_date=data.posting_date or date.today(),
                lines=lines,
            ),
            company_id=company_id,
            user=user,
        )

    details = {
        "seeded_at": date.today().isoformat(),
        "size": size,
        "warehouse_id": warehouse_id,
        "tax_code_id": tax_code_id,
        "items": len(created_item_ids),
        "suppliers": len(supplier_ids),
        "customers": len(customer_ids),
        "opening_stock": bool(data.with_opening_stock),
        "opening_stock_import_id": opening_import_id,
    }

    with get_conn() as conn2:
        set_company_context(conn2, company_id)
        with conn2.transaction():
            with conn2.cursor() as cur2:
                cur2.execute(
                    """
                    INSERT INTO company_settings (company_id, key, value_json)
                    VALUES (%s, 'demo_data', %s::jsonb)
                    ON CONFLICT (company_id, key) DO UPDATE
                    SET value_json = EXCLUDED.value_json, updated_at = now()
                    """,
                    (company_id, json.dumps(details)),
                )
                cur2.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'devtools.demo_data.import', 'company', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], company_id, json.dumps(details)),
                )

    return {"ok": True, "already_seeded": False, "details": details, "opening_stock_result": opening_stock_result}
