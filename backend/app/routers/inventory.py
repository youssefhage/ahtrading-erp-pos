from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional, List
import json
import uuid
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..period_locks import assert_period_open

router = APIRouter(prefix="/inventory", tags=["inventory"])

def _safe_journal_no(cur, company_id: str, base: str) -> str:
    base = (base or "").strip() or "J"
    base = base[:40]
    candidate = base
    for i in range(0, 20):
        cur.execute(
            "SELECT 1 FROM gl_journals WHERE company_id=%s AND journal_no=%s LIMIT 1",
            (company_id, candidate),
        )
        if not cur.fetchone():
            return candidate
        suffix = f"-{i+1}"
        candidate = (base[: max(1, 40 - len(suffix))] + suffix)
    return f"{base}-{uuid.uuid4().hex[:6]}"

def _get_or_create_batch(cur, company_id: str, item_id: str, batch_no: Optional[str], expiry_date: Optional[date]):
    batch_no = (batch_no or "").strip() or None
    if isinstance(expiry_date, str):
        expiry_date = date.fromisoformat(expiry_date[:10])
    cur.execute(
        """
        SELECT id
        FROM batches
        WHERE company_id=%s AND item_id=%s AND batch_no IS NOT DISTINCT FROM %s AND expiry_date IS NOT DISTINCT FROM %s
        """,
        (company_id, item_id, batch_no, expiry_date),
    )
    r = cur.fetchone()
    if r:
        return r["id"]
    cur.execute(
        """
        INSERT INTO batches (id, company_id, item_id, batch_no, expiry_date)
        VALUES (gen_random_uuid(), %s, %s, %s, %s)
        ON CONFLICT (company_id, item_id, batch_no, expiry_date) DO UPDATE SET batch_no = EXCLUDED.batch_no
        RETURNING id
        """,
        (company_id, item_id, batch_no, expiry_date),
    )
    return cur.fetchone()["id"]


class StockAdjustIn(BaseModel):
    item_id: str
    warehouse_id: str
    qty_in: Decimal = Decimal("0")
    qty_out: Decimal = Decimal("0")
    unit_cost_usd: Decimal = Decimal("0")
    unit_cost_lbp: Decimal = Decimal("0")
    reason: Optional[str] = None


class ExpiryWriteoffIn(BaseModel):
    item_id: str
    warehouse_id: str
    qty_out: Decimal
    batch_id: Optional[str] = None
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None
    unit_cost_usd: Decimal = Decimal("0")
    unit_cost_lbp: Decimal = Decimal("0")
    reason: Optional[str] = None


class OpeningStockLineIn(BaseModel):
    sku: Optional[str] = None
    item_id: Optional[str] = None
    qty: Decimal
    unit_cost_usd: Decimal = Decimal("0")
    unit_cost_lbp: Decimal = Decimal("0")
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None


class OpeningStockImportIn(BaseModel):
    import_id: Optional[str] = None
    warehouse_id: str
    posting_date: Optional[date] = None
    lines: List[OpeningStockLineIn]


@router.get("/stock", dependencies=[Depends(require_permission("inventory:read"))])
def stock_summary(
    item_id: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    by_batch: bool = False,
    company_id: str = Depends(get_company_id),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            if by_batch:
                sql = """
                    SELECT sm.item_id, sm.warehouse_id, sm.batch_id,
                           b.batch_no, b.expiry_date,
                           SUM(sm.qty_in) AS qty_in,
                           SUM(sm.qty_out) AS qty_out,
                           SUM(sm.qty_in) - SUM(sm.qty_out) AS qty_on_hand
                    FROM stock_moves sm
                    LEFT JOIN batches b ON b.id = sm.batch_id
                    WHERE sm.company_id = %s
                """
            else:
                sql = """
                    SELECT item_id, warehouse_id,
                           SUM(qty_in) AS qty_in,
                           SUM(qty_out) AS qty_out,
                           SUM(qty_in) - SUM(qty_out) AS qty_on_hand
                    FROM stock_moves
                    WHERE company_id = %s
                """
            params = [company_id]
            if item_id:
                sql += " AND item_id = %s"
                params.append(item_id)
            if warehouse_id:
                sql += " AND warehouse_id = %s"
                params.append(warehouse_id)
            if by_batch:
                sql += " GROUP BY sm.item_id, sm.warehouse_id, sm.batch_id, b.batch_no, b.expiry_date"
            else:
                sql += " GROUP BY item_id, warehouse_id"
            cur.execute(sql, params)
            return {"stock": cur.fetchall()}


@router.post("/adjust", dependencies=[Depends(require_permission("inventory:write"))])
def stock_adjust(data: StockAdjustIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if data.qty_in < 0 or data.qty_out < 0:
        raise HTTPException(status_code=400, detail="qty_in/qty_out must be >= 0")
    if data.qty_in > 0 and data.qty_out > 0:
        raise HTTPException(status_code=400, detail="qty_in and qty_out cannot both be > 0")
    if data.qty_in == 0 and data.qty_out == 0:
        raise HTTPException(status_code=400, detail="qty_in or qty_out is required")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, date.today())
                unit_cost_usd = data.unit_cost_usd
                unit_cost_lbp = data.unit_cost_lbp
                if unit_cost_usd == 0 and unit_cost_lbp == 0:
                    cur.execute(
                        """
                        SELECT avg_cost_usd, avg_cost_lbp
                        FROM item_warehouse_costs
                        WHERE company_id = %s AND item_id = %s AND warehouse_id = %s
                        """,
                        (company_id, data.item_id, data.warehouse_id),
                    )
                    row = cur.fetchone()
                    if row:
                        unit_cost_usd = Decimal(str(row["avg_cost_usd"] or 0))
                        unit_cost_lbp = Decimal(str(row["avg_cost_lbp"] or 0))

                cur.execute(
                    """
                    INSERT INTO stock_moves
                      (id, company_id, item_id, warehouse_id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp,
                       source_type, source_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, 'inventory_adjustment', NULL)
                    RETURNING id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp
                    """,
                    (
                        company_id,
                        data.item_id,
                        data.warehouse_id,
                        data.qty_in,
                        data.qty_out,
                        unit_cost_usd,
                        unit_cost_lbp,
                    ),
                )
                move = cur.fetchone()
                move_id = move["id"]

                # GL posting: Dr/Cr INVENTORY against INV_ADJ (or another configured account).
                cur.execute(
                    """
                    SELECT role_code, account_id
                    FROM company_account_defaults
                    WHERE company_id = %s
                    """,
                    (company_id,),
                )
                defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
                inventory = defaults.get("INVENTORY")
                inv_adj = defaults.get("INV_ADJ")
                if not (inventory and inv_adj):
                    raise HTTPException(status_code=400, detail="Missing INVENTORY/INV_ADJ account defaults for adjustment posting")

                qty_in = Decimal(str(move["qty_in"] or 0))
                qty_out = Decimal(str(move["qty_out"] or 0))
                unit_usd = Decimal(str(move["unit_cost_usd"] or 0))
                unit_lbp = Decimal(str(move["unit_cost_lbp"] or 0))
                amt_usd = (qty_in if qty_in > 0 else qty_out) * unit_usd
                amt_lbp = (qty_in if qty_in > 0 else qty_out) * unit_lbp

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'inventory_adjustment', %s, CURRENT_DATE, 'market', 0, %s, %s)
                    RETURNING id
                    """,
                    (company_id, f"ADJ-{str(move_id)[:8]}", move_id, (data.reason or "Inventory adjustment"), user["user_id"]),
                )
                journal_id = cur.fetchone()["id"]

                if qty_in > 0:
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Inventory adjustment (in)', %s)
                        """,
                        (journal_id, inventory, amt_usd, amt_lbp, data.warehouse_id),
                    )
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory adjustment (offset)', %s)
                        """,
                        (journal_id, inv_adj, amt_usd, amt_lbp, data.warehouse_id),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Inventory adjustment (out)', %s)
                        """,
                        (journal_id, inv_adj, amt_usd, amt_lbp, data.warehouse_id),
                    )
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory adjustment (asset)', %s)
                        """,
                        (journal_id, inventory, amt_usd, amt_lbp, data.warehouse_id),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'inventory_adjust', 'stock_move', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], move_id, json.dumps({"reason": data.reason, "journal_id": str(journal_id)})),
                )
                return {"id": move_id, "journal_id": journal_id}


@router.post("/writeoff/expiry", dependencies=[Depends(require_permission("inventory:write"))])
def expiry_writeoff(data: ExpiryWriteoffIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Post an expiry/shrinkage write-off:
    - stock_moves: qty_out
    - GL: Dr SHRINKAGE (fallback INV_ADJ), Cr INVENTORY
    """
    if data.qty_out <= 0:
        raise HTTPException(status_code=400, detail="qty_out must be > 0")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, date.today())

                # Resolve batch (optional but recommended when batches exist).
                batch_id = (data.batch_id or "").strip() or None
                if not batch_id and ((data.batch_no or "").strip() or data.expiry_date):
                    bno = (data.batch_no or "").strip() or None
                    exp = data.expiry_date
                    if isinstance(exp, str):
                        exp = date.fromisoformat(exp[:10])
                    cur.execute(
                        """
                        SELECT id
                        FROM batches
                        WHERE company_id=%s AND item_id=%s
                          AND batch_no IS NOT DISTINCT FROM %s
                          AND expiry_date IS NOT DISTINCT FROM %s
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                        (company_id, data.item_id, bno, exp),
                    )
                    r = cur.fetchone()
                    if not r:
                        raise HTTPException(status_code=400, detail="batch not found (use batch_id or existing batch_no/expiry_date)")
                    batch_id = r["id"]

                unit_cost_usd = data.unit_cost_usd
                unit_cost_lbp = data.unit_cost_lbp
                if unit_cost_usd == 0 and unit_cost_lbp == 0:
                    cur.execute(
                        """
                        SELECT avg_cost_usd, avg_cost_lbp
                        FROM item_warehouse_costs
                        WHERE company_id = %s AND item_id = %s AND warehouse_id = %s
                        """,
                        (company_id, data.item_id, data.warehouse_id),
                    )
                    row = cur.fetchone()
                    if row:
                        unit_cost_usd = Decimal(str(row["avg_cost_usd"] or 0))
                        unit_cost_lbp = Decimal(str(row["avg_cost_lbp"] or 0))

                cur.execute(
                    """
                    INSERT INTO stock_moves
                      (id, company_id, item_id, warehouse_id, batch_id,
                       qty_in, qty_out, unit_cost_usd, unit_cost_lbp,
                       source_type, source_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s,
                       0, %s, %s, %s,
                       'expiry_writeoff', NULL)
                    RETURNING id
                    """,
                    (company_id, data.item_id, data.warehouse_id, batch_id, data.qty_out, unit_cost_usd, unit_cost_lbp),
                )
                move_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    SELECT role_code, account_id
                    FROM company_account_defaults
                    WHERE company_id = %s
                    """,
                    (company_id,),
                )
                defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
                inventory = defaults.get("INVENTORY")
                shrink = defaults.get("SHRINKAGE") or defaults.get("INV_ADJ")
                if not (inventory and shrink):
                    raise HTTPException(status_code=400, detail="Missing INVENTORY and SHRINKAGE (or INV_ADJ fallback) account defaults")

                amt_usd = Decimal(str(data.qty_out)) * Decimal(str(unit_cost_usd or 0))
                amt_lbp = Decimal(str(data.qty_out)) * Decimal(str(unit_cost_lbp or 0))

                journal_no = _safe_journal_no(cur, company_id, f"EXP-{str(move_id)[:8]}")
                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'expiry_writeoff', %s, CURRENT_DATE, 'market', 0, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        journal_no,
                        move_id,
                        (data.reason or "Expiry write-off").strip(),
                        user["user_id"],
                    ),
                )
                journal_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO gl_entries
                      (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Expiry write-off', %s)
                    """,
                    (journal_id, shrink, amt_usd, amt_lbp, data.warehouse_id),
                )
                cur.execute(
                    """
                    INSERT INTO gl_entries
                      (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory (expiry write-off)', %s)
                    """,
                    (journal_id, inventory, amt_usd, amt_lbp, data.warehouse_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'expiry_writeoff', 'stock_move', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        move_id,
                        json.dumps({"reason": data.reason, "journal_id": str(journal_id), "batch_id": batch_id}),
                    ),
                )
                return {"id": move_id, "journal_id": journal_id}


@router.post("/opening-stock/import", dependencies=[Depends(require_permission("inventory:write"))])
def import_opening_stock(data: OpeningStockImportIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Go-live utility: import opening stock quantities and unit costs for a warehouse.
    - Inserts inbound stock_moves with source_type='opening_stock' and source_id=import_id
    - Posts a GL journal: Dr INVENTORY, Cr OPENING_STOCK (fallback: INV_ADJ)
    - Uses batch_no/expiry_date when provided.

    Idempotency: if import_id is provided and already exists, returns already_applied=true.
    """
    if not data.warehouse_id:
        raise HTTPException(status_code=400, detail="warehouse_id is required")
    if not data.lines:
        raise HTTPException(status_code=400, detail="lines is required")

    try:
        import_id = str(uuid.UUID((data.import_id or "").strip() or str(uuid.uuid4())))
    except Exception:
        raise HTTPException(status_code=400, detail="import_id must be a UUID")

    posting_date = data.posting_date or date.today()

    warnings: list[str] = []
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, posting_date)

                # Idempotency check.
                cur.execute(
                    """
                    SELECT 1
                    FROM stock_moves
                    WHERE company_id=%s AND source_type='opening_stock' AND source_id=%s
                    LIMIT 1
                    """,
                    (company_id, import_id),
                )
                if cur.fetchone():
                    return {"ok": True, "import_id": import_id, "already_applied": True, "warnings": []}

                # Account defaults for GL posting.
                cur.execute(
                    """
                    SELECT role_code, account_id
                    FROM company_account_defaults
                    WHERE company_id = %s
                    """,
                    (company_id,),
                )
                defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
                inventory = defaults.get("INVENTORY")
                # Prefer the generic opening balance offset if configured, otherwise fall back
                # to OPENING_STOCK (legacy) and then INV_ADJ.
                opening_offset = defaults.get("OPENING_BALANCE") or defaults.get("OPENING_STOCK") or defaults.get("INV_ADJ")
                if not inventory:
                    raise HTTPException(status_code=400, detail="Missing INVENTORY account default")
                if not opening_offset:
                    raise HTTPException(status_code=400, detail="Missing OPENING_BALANCE/OPENING_STOCK (or INV_ADJ fallback) account default")

                # Resolve SKUs in one query when possible.
                skus = sorted({(ln.sku or "").strip() for ln in data.lines if (ln.sku or "").strip()})
                sku_to_id: dict[str, str] = {}
                if skus:
                    cur.execute(
                        """
                        SELECT sku, id
                        FROM items
                        WHERE company_id=%s AND sku = ANY(%s::text[])
                        """,
                        (company_id, skus),
                    )
                    for r in cur.fetchall():
                        sku_to_id[str(r["sku"])] = str(r["id"])

                total_usd = Decimal("0")
                total_lbp = Decimal("0")
                created = 0

                for idx, ln in enumerate(data.lines):
                    qty = Decimal(str(ln.qty or 0))
                    if qty <= 0:
                        continue

                    item_id = (ln.item_id or "").strip() or None
                    sku = (ln.sku or "").strip() or None
                    if not item_id and sku:
                        item_id = sku_to_id.get(sku)
                    if not item_id:
                        raise HTTPException(status_code=400, detail=f"line {idx+1}: item_id or valid sku is required")

                    unit_usd = Decimal(str(ln.unit_cost_usd or 0))
                    unit_lbp = Decimal(str(ln.unit_cost_lbp or 0))
                    if unit_usd < 0 or unit_lbp < 0:
                        raise HTTPException(status_code=400, detail=f"line {idx+1}: unit costs must be >= 0")
                    if unit_usd == 0 and unit_lbp == 0:
                        warnings.append(f"line {idx+1}: unit_cost is 0; valuation will be 0 until corrected")

                    batch_id = None
                    if (ln.batch_no or "").strip() or ln.expiry_date:
                        batch_id = _get_or_create_batch(cur, company_id, item_id, ln.batch_no, ln.expiry_date)

                    # Insert inbound stock move. Costing trigger maintains avg cost.
                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, batch_id,
                           qty_in, qty_out, unit_cost_usd, unit_cost_lbp,
                           source_type, source_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s,
                           %s, 0, %s, %s,
                           'opening_stock', %s)
                        """,
                        (company_id, item_id, data.warehouse_id, batch_id, qty, unit_usd, unit_lbp, import_id),
                    )

                    total_usd += qty * unit_usd
                    total_lbp += qty * unit_lbp
                    created += 1

                if created == 0:
                    raise HTTPException(status_code=400, detail="no valid lines (need qty > 0)")

                journal_no = _safe_journal_no(cur, company_id, f"OS-{import_id[:8]}")
                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'opening_stock', %s, %s, 'market', 0, %s, %s)
                    RETURNING id
                    """,
                    (company_id, journal_no, import_id, posting_date, f"Opening stock import ({created} lines)", user["user_id"]),
                )
                journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Opening stock (inventory)')
                    """,
                    (journal_id, inventory, total_usd, total_lbp),
                )
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Opening stock (offset)')
                    """,
                    (journal_id, opening_offset, total_usd, total_lbp),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'opening_stock_import', 'warehouse', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        data.warehouse_id,
                        json.dumps({"import_id": import_id, "lines": created, "journal_id": str(journal_id), "warnings": warnings}),
                    ),
                )

                return {"ok": True, "import_id": import_id, "already_applied": False, "journal_id": journal_id, "lines": created, "warnings": warnings}


class StockTransferIn(BaseModel):
    item_id: str
    from_warehouse_id: str
    to_warehouse_id: str
    qty: Decimal
    unit_cost_usd: Decimal = Decimal("0")
    unit_cost_lbp: Decimal = Decimal("0")
    reason: Optional[str] = None


@router.post("/transfer", dependencies=[Depends(require_permission("inventory:write"))])
def transfer_stock(data: StockTransferIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if data.qty <= 0:
        raise HTTPException(status_code=400, detail="qty must be > 0")
    if data.from_warehouse_id == data.to_warehouse_id:
        raise HTTPException(status_code=400, detail="warehouses must differ")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # If cost not provided, use current moving-average cost from source warehouse.
                unit_cost_usd = data.unit_cost_usd
                unit_cost_lbp = data.unit_cost_lbp
                if unit_cost_usd == 0 and unit_cost_lbp == 0:
                    cur.execute(
                        """
                        SELECT avg_cost_usd, avg_cost_lbp
                        FROM item_warehouse_costs
                        WHERE company_id = %s AND item_id = %s AND warehouse_id = %s
                        """,
                        (company_id, data.item_id, data.from_warehouse_id),
                    )
                    row = cur.fetchone()
                    if row:
                        unit_cost_usd = Decimal(str(row["avg_cost_usd"] or 0))
                        unit_cost_lbp = Decimal(str(row["avg_cost_lbp"] or 0))

                # Stock out (from)
                cur.execute(
                    """
                    INSERT INTO stock_moves
                      (id, company_id, item_id, warehouse_id, qty_out, unit_cost_usd, unit_cost_lbp,
                       source_type, source_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'inventory_transfer', NULL)
                    RETURNING id
                    """,
                    (company_id, data.item_id, data.from_warehouse_id, data.qty, unit_cost_usd, unit_cost_lbp),
                )
                out_id = cur.fetchone()["id"]

                # Stock in (to)
                cur.execute(
                    """
                    INSERT INTO stock_moves
                      (id, company_id, item_id, warehouse_id, qty_in, unit_cost_usd, unit_cost_lbp,
                       source_type, source_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'inventory_transfer', NULL)
                    RETURNING id
                    """,
                    (company_id, data.item_id, data.to_warehouse_id, data.qty, unit_cost_usd, unit_cost_lbp),
                )
                in_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'inventory_transfer', 'stock_move', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        out_id,
                        json.dumps({
                            "in_id": str(in_id),
                            "reason": data.reason,
                            "from_warehouse_id": data.from_warehouse_id,
                            "to_warehouse_id": data.to_warehouse_id,
                            "qty": str(data.qty),
                        }),
                    ),
                )

                return {"out_id": out_id, "in_id": in_id}


class CycleCountLine(BaseModel):
    item_id: str
    counted_qty: Decimal


class CycleCountIn(BaseModel):
    warehouse_id: str
    lines: List[CycleCountLine]
    reason: Optional[str] = None


@router.post("/cycle-count", dependencies=[Depends(require_permission("inventory:write"))])
def cycle_count(data: CycleCountIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.lines:
        raise HTTPException(status_code=400, detail="lines is required")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        created = []
        inc_usd = Decimal("0")
        inc_lbp = Decimal("0")
        dec_usd = Decimal("0")
        dec_lbp = Decimal("0")

        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, date.today())
                # Fetch posting defaults once; enforce only if we actually create adjustments.
                cur.execute(
                    """
                    SELECT role_code, account_id
                    FROM company_account_defaults
                    WHERE company_id = %s
                    """,
                    (company_id,),
                )
                defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
                inventory = defaults.get("INVENTORY")
                inv_adj = defaults.get("INV_ADJ")

                for line in data.lines:
                    cur.execute(
                        """
                        SELECT COALESCE(SUM(qty_in) - SUM(qty_out), 0) AS qty_on_hand
                        FROM stock_moves
                        WHERE company_id = %s AND item_id = %s AND warehouse_id = %s
                        """,
                        (company_id, line.item_id, data.warehouse_id),
                    )
                    current_qty = Decimal(str(cur.fetchone()["qty_on_hand"] or 0))
                    diff = line.counted_qty - current_qty
                    if diff == 0:
                        continue

                    qty_in = diff if diff > 0 else Decimal("0")
                    qty_out = (-diff) if diff < 0 else Decimal("0")

                    # Use current average cost for outbound; for inbound use average as well (v1).
                    unit_cost_usd = Decimal("0")
                    unit_cost_lbp = Decimal("0")
                    cur.execute(
                        """
                        SELECT avg_cost_usd, avg_cost_lbp
                        FROM item_warehouse_costs
                        WHERE company_id = %s AND item_id = %s AND warehouse_id = %s
                        """,
                        (company_id, line.item_id, data.warehouse_id),
                    )
                    row = cur.fetchone()
                    if row:
                        unit_cost_usd = Decimal(str(row["avg_cost_usd"] or 0))
                        unit_cost_lbp = Decimal(str(row["avg_cost_lbp"] or 0))

                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp,
                           source_type, source_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, 'cycle_count', NULL)
                        RETURNING id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp
                        """,
                        (
                            company_id,
                            line.item_id,
                            data.warehouse_id,
                            qty_in,
                            qty_out,
                            unit_cost_usd,
                            unit_cost_lbp,
                        ),
                    )
                    move = cur.fetchone()
                    move_id = move["id"]
                    qin = Decimal(str(move["qty_in"] or 0))
                    qout = Decimal(str(move["qty_out"] or 0))
                    u_usd = Decimal(str(move["unit_cost_usd"] or 0))
                    u_lbp = Decimal(str(move["unit_cost_lbp"] or 0))
                    value_usd = (qin if qin > 0 else qout) * u_usd
                    value_lbp = (qin if qin > 0 else qout) * u_lbp
                    if qin > 0:
                        inc_usd += value_usd
                        inc_lbp += value_lbp
                    else:
                        dec_usd += value_usd
                        dec_lbp += value_lbp
                    created.append({"item_id": line.item_id, "move_id": str(move_id), "diff": str(diff)})

                journal_id = None
                if created:
                    if not (inventory and inv_adj):
                        raise HTTPException(status_code=400, detail="Missing INVENTORY/INV_ADJ account defaults for cycle count posting")

                    journal_no = f"CC-{uuid.uuid4().hex[:8]}"
                    cur.execute(
                        """
                        INSERT INTO gl_journals
                          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, 'cycle_count', %s, CURRENT_DATE, 'market', 0, %s, %s)
                        RETURNING id
                        """,
                        (company_id, journal_no, data.warehouse_id, (data.reason or "Cycle count"), user["user_id"]),
                    )
                    journal_id = cur.fetchone()["id"]

                    if inc_usd != 0 or inc_lbp != 0:
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Cycle count increase', %s)
                            """,
                            (journal_id, inventory, inc_usd, inc_lbp, data.warehouse_id),
                        )
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Cycle count offset', %s)
                            """,
                            (journal_id, inv_adj, inc_usd, inc_lbp, data.warehouse_id),
                        )

                    if dec_usd != 0 or dec_lbp != 0:
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Cycle count decrease', %s)
                            """,
                            (journal_id, inv_adj, dec_usd, dec_lbp, data.warehouse_id),
                        )
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Cycle count asset', %s)
                            """,
                            (journal_id, inventory, dec_usd, dec_lbp, data.warehouse_id),
                        )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'cycle_count', 'warehouse', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], data.warehouse_id, json.dumps({"reason": data.reason, "created": created, "journal_id": str(journal_id) if journal_id else None})),
                )

        return {"created": created, "journal_id": journal_id}


@router.get("/moves", dependencies=[Depends(require_permission("inventory:read"))])
def list_stock_moves(
    item_id: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    source_type: Optional[str] = None,
    limit: int = 200,
    company_id: str = Depends(get_company_id),
):
    if limit <= 0 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT id, item_id, warehouse_id, batch_id,
                       qty_in, qty_out, unit_cost_usd, unit_cost_lbp,
                       source_type, source_id, created_at
                FROM stock_moves
                WHERE company_id = %s
            """
            params = [company_id]
            if item_id:
                sql += " AND item_id = %s"
                params.append(item_id)
            if warehouse_id:
                sql += " AND warehouse_id = %s"
                params.append(warehouse_id)
            if source_type:
                sql += " AND source_type = %s"
                params.append(source_type)
            sql += " ORDER BY created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"moves": cur.fetchall()}


@router.get("/expiry-alerts", dependencies=[Depends(require_permission("inventory:read"))])
def expiry_alerts(days: int = 30, company_id: str = Depends(get_company_id)):
    """
    Return batches expiring within N days that still have qty on hand.
    """
    if days <= 0 or days > 3650:
        raise HTTPException(status_code=400, detail="days must be between 1 and 3650")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT sm.item_id, sm.warehouse_id, sm.batch_id,
                       b.batch_no, b.expiry_date,
                       SUM(sm.qty_in) - SUM(sm.qty_out) AS qty_on_hand
                FROM stock_moves sm
                JOIN batches b ON b.id = sm.batch_id
                WHERE sm.company_id = %s
                  AND b.expiry_date IS NOT NULL
                  AND b.expiry_date <= (CURRENT_DATE + (%s || ' days')::interval)
                GROUP BY sm.item_id, sm.warehouse_id, sm.batch_id, b.batch_no, b.expiry_date
                HAVING (SUM(sm.qty_in) - SUM(sm.qty_out)) > 0
                ORDER BY b.expiry_date ASC
                """,
                (company_id, days),
            )
            return {"rows": cur.fetchall()}


@router.get("/reorder-alerts", dependencies=[Depends(require_permission("inventory:read"))])
def reorder_alerts(warehouse_id: Optional[str] = None, company_id: str = Depends(get_company_id)):
    """
    Simple reorder alerts: items where on-hand < reorder_point.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            params = [company_id]
            wh_sql = ""
            if warehouse_id:
                wh_sql = " AND sm.warehouse_id = %s"
                params.append(warehouse_id)
            cur.execute(
                f"""
                SELECT i.id AS item_id, i.sku, i.name, i.reorder_point, i.reorder_qty,
                       sm.warehouse_id,
                       SUM(sm.qty_in) - SUM(sm.qty_out) AS qty_on_hand
                FROM items i
                JOIN stock_moves sm
                  ON sm.company_id = i.company_id AND sm.item_id = i.id
                WHERE i.company_id = %s
                  AND COALESCE(i.reorder_point, 0) > 0
                  {wh_sql}
                GROUP BY i.id, i.sku, i.name, i.reorder_point, i.reorder_qty, sm.warehouse_id
                HAVING (SUM(sm.qty_in) - SUM(sm.qty_out)) < COALESCE(i.reorder_point, 0)
                ORDER BY (COALESCE(i.reorder_point,0) - (SUM(sm.qty_in) - SUM(sm.qty_out))) DESC
                """,
                params,
            )
            return {"rows": cur.fetchall()}
