from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional, List
import json
import uuid
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..period_locks import assert_period_open
from backend.workers import pos_processor
from ..journal_utils import auto_balance_journal

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
    location_id: Optional[str] = None
    batch_id: Optional[str] = None
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None
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
                    WITH on_hand AS (
                      SELECT item_id, warehouse_id,
                             SUM(qty_in) AS qty_in,
                             SUM(qty_out) AS qty_out,
                             SUM(qty_in) - SUM(qty_out) AS qty_on_hand
                      FROM stock_moves
                      WHERE company_id = %s
                      GROUP BY item_id, warehouse_id
                    ),
                    reserved AS (
                      SELECT l.item_id, i.warehouse_id,
                             COALESCE(SUM(l.qty), 0) AS reserved_qty
                      FROM sales_invoice_lines l
                      JOIN sales_invoices i ON i.id = l.invoice_id
                      WHERE i.company_id = %s
                        AND i.status = 'draft'
                        AND COALESCE(i.reserve_stock, false) = true
                      GROUP BY l.item_id, i.warehouse_id
                    ),
                    incoming AS (
                      SELECT pol.item_id, po.warehouse_id,
                             GREATEST(
                               COALESCE(SUM(pol.qty), 0) -
                               COALESCE(SUM(CASE WHEN gr.status = 'posted' THEN grl.qty ELSE 0 END), 0),
                               0
                             ) AS incoming_qty
                      FROM purchase_order_lines pol
                      JOIN purchase_orders po
                        ON po.company_id = pol.company_id AND po.id = pol.purchase_order_id
                      LEFT JOIN goods_receipt_lines grl
                        ON grl.company_id = pol.company_id AND grl.purchase_order_line_id = pol.id
                      LEFT JOIN goods_receipts gr
                        ON gr.company_id = grl.company_id AND gr.id = grl.goods_receipt_id
                      WHERE po.company_id = %s
                        AND po.status = 'posted'
                      GROUP BY pol.item_id, po.warehouse_id
                    )
                    SELECT o.item_id, o.warehouse_id,
                           o.qty_in, o.qty_out,
                           o.qty_on_hand,
                           COALESCE(r.reserved_qty, 0) AS reserved_qty,
                           (o.qty_on_hand - COALESCE(r.reserved_qty, 0)) AS qty_available,
                           COALESCE(inc.incoming_qty, 0) AS incoming_qty
                    FROM on_hand o
                    LEFT JOIN reserved r
                      ON r.item_id = o.item_id AND r.warehouse_id = o.warehouse_id
                    LEFT JOIN incoming inc
                      ON inc.item_id = o.item_id AND inc.warehouse_id = o.warehouse_id
                    WHERE 1=1
                """
            params = [company_id]
            if not by_batch:
                # CTEs each need company_id.
                params = [company_id, company_id, company_id]
            if item_id:
                if by_batch:
                    sql += " AND sm.item_id = %s"
                else:
                    sql += " AND o.item_id = %s"
                params.append(item_id)
            if warehouse_id:
                if by_batch:
                    sql += " AND sm.warehouse_id = %s"
                else:
                    sql += " AND o.warehouse_id = %s"
                params.append(warehouse_id)
            if by_batch:
                sql += " GROUP BY sm.item_id, sm.warehouse_id, sm.batch_id, b.batch_no, b.expiry_date"
            else:
                sql += " ORDER BY o.item_id, o.warehouse_id"
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
                # Enforce batch capture for tracked items.
                cur.execute(
                    """
                    SELECT track_batches, track_expiry
                    FROM items
                    WHERE company_id=%s AND id=%s
                    """,
                    (company_id, data.item_id),
                )
                it = cur.fetchone() or {}
                tracked = bool(it.get("track_batches")) or bool(it.get("track_expiry"))
                batch_id = data.batch_id
                if tracked:
                    # Resolve/create batch using provided batch_id or (batch_no, expiry_date).
                    if not batch_id:
                        batch_id = _get_or_create_batch(cur, company_id, data.item_id, data.batch_no, data.expiry_date)
                    if not batch_id:
                        raise HTTPException(status_code=400, detail="batch_id (or batch_no/expiry_date) is required for tracked items")
                else:
                    batch_id = batch_id or None

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
                      (id, company_id, item_id, warehouse_id, location_id, batch_id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                       source_type, source_id, created_by_user_id, reason)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'inventory_adjustment', NULL, %s, %s)
                    RETURNING id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp
                    """,
                    (
                        company_id,
                        data.item_id,
                        data.warehouse_id,
                        data.location_id,
                        batch_id,
                        data.qty_in,
                        data.qty_out,
                        unit_cost_usd,
                        unit_cost_lbp,
                        date.today(),
                        user["user_id"],
                        (data.reason or "Inventory adjustment").strip() if data.reason is not None else None,
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

                try:
                    auto_balance_journal(cur, company_id, journal_id, warehouse_id=data.warehouse_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

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
                       qty_in, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                       source_type, source_id, created_by_user_id, reason)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s,
                       0, %s, %s, %s, %s,
                       'expiry_writeoff', NULL, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        data.item_id,
                        data.warehouse_id,
                        batch_id,
                        data.qty_out,
                        unit_cost_usd,
                        unit_cost_lbp,
                        date.today(),
                        user["user_id"],
                        (data.reason or "Expiry write-off").strip() if data.reason is not None else None,
                    ),
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

                try:
                    auto_balance_journal(cur, company_id, journal_id, warehouse_id=data.warehouse_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

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
                           qty_in, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                           source_type, source_id, created_by_user_id, reason)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s,
                           %s, 0, %s, %s, %s,
                           'opening_stock', %s, %s, %s)
                        """,
                        (
                            company_id,
                            item_id,
                            data.warehouse_id,
                            batch_id,
                            qty,
                            unit_usd,
                            unit_lbp,
                            posting_date,
                            import_id,
                            user["user_id"],
                            "Opening stock import",
                        ),
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

                try:
                    auto_balance_journal(cur, company_id, journal_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

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
    from_location_id: Optional[str] = None
    to_location_id: Optional[str] = None
    qty: Decimal
    unit_cost_usd: Decimal = Decimal("0")
    unit_cost_lbp: Decimal = Decimal("0")
    reason: Optional[str] = None


class StockMoveReasonIn(BaseModel):
    code: str
    name: str
    is_active: bool = True


class StockMoveReasonUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/stock-move-reasons", dependencies=[Depends(require_permission("inventory:read"))])
def list_stock_move_reasons(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, is_active, created_at, updated_at
                FROM stock_move_reasons
                WHERE company_id = %s
                ORDER BY is_active DESC, code ASC
                """,
                (company_id,),
            )
            return {"reasons": cur.fetchall()}


@router.post("/stock-move-reasons", dependencies=[Depends(require_permission("inventory:write"))])
def create_stock_move_reason(data: StockMoveReasonIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    code = (data.code or "").strip()
    name = (data.name or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO stock_move_reasons (id, company_id, code, name, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    ON CONFLICT (company_id, code) DO UPDATE
                      SET name = EXCLUDED.name,
                          is_active = EXCLUDED.is_active,
                          updated_at = now()
                    RETURNING id
                    """,
                    (company_id, code, name, data.is_active),
                )
                rid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_move_reason_upsert', 'stock_move_reason', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], rid, json.dumps(data.model_dump())),
                )
                return {"id": rid}


@router.patch("/stock-move-reasons/{reason_id}", dependencies=[Depends(require_permission("inventory:write"))])
def update_stock_move_reason(reason_id: str, data: StockMoveReasonUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    if "code" in patch:
        patch["code"] = (patch["code"] or "").strip()
        if not patch["code"]:
            raise HTTPException(status_code=400, detail="code cannot be empty")
    if "name" in patch:
        patch["name"] = (patch["name"] or "").strip()
        if not patch["name"]:
            raise HTTPException(status_code=400, detail="name cannot be empty")

    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
    params.extend([company_id, reason_id])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE stock_move_reasons
                    SET {', '.join(fields)}, updated_at = now()
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="reason not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_move_reason_update', 'stock_move_reason', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], reason_id, json.dumps(patch)),
                )
                return {"ok": True}


class BatchUpdateIn(BaseModel):
    status: Optional[str] = None  # available|quarantine|expired
    hold_reason: Optional[str] = None
    notes: Optional[str] = None


@router.get("/batches", dependencies=[Depends(require_permission("inventory:read"))])
def list_batches(
    item_id: Optional[str] = None,
    status: Optional[str] = None,
    exp_from: Optional[date] = None,
    exp_to: Optional[date] = None,
    limit: int = 500,
    company_id: str = Depends(get_company_id),
):
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")
    if status and status not in {"available", "quarantine", "expired"}:
        raise HTTPException(status_code=400, detail="invalid status")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT b.id, b.item_id, i.sku AS item_sku, i.name AS item_name,
                       b.batch_no, b.expiry_date, b.status, b.hold_reason, b.notes,
                       b.received_at, b.received_source_type, b.received_source_id,
                       b.received_supplier_id, s.name AS received_supplier_name,
                       b.created_at, b.updated_at
                FROM batches b
                JOIN items i ON i.id = b.item_id
                LEFT JOIN suppliers s ON s.id = b.received_supplier_id
                WHERE b.company_id = %s
            """
            params: list = [company_id]
            if item_id:
                sql += " AND b.item_id = %s"
                params.append(item_id)
            if status:
                sql += " AND b.status = %s"
                params.append(status)
            if exp_from:
                sql += " AND b.expiry_date >= %s"
                params.append(exp_from)
            if exp_to:
                sql += " AND b.expiry_date <= %s"
                params.append(exp_to)
            sql += " ORDER BY b.expiry_date NULLS LAST, b.created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"batches": cur.fetchall()}


@router.patch("/batches/{batch_id}", dependencies=[Depends(require_permission("inventory:write"))])
def update_batch(batch_id: str, data: BatchUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    if "status" in patch:
        st = (patch["status"] or "").strip().lower()
        if st not in {"available", "quarantine", "expired"}:
            raise HTTPException(status_code=400, detail="invalid status")
        patch["status"] = st
        if st == "quarantine" and not (patch.get("hold_reason") or data.hold_reason):
            raise HTTPException(status_code=400, detail="hold_reason is required when status=quarantine")
        if st != "quarantine":
            # Clear hold reason unless explicitly set.
            patch["hold_reason"] = patch.get("hold_reason") if "hold_reason" in patch else None
    if "hold_reason" in patch:
        patch["hold_reason"] = (patch["hold_reason"] or "").strip() or None
    if "notes" in patch:
        patch["notes"] = (patch["notes"] or "").strip() or None

    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
    params.extend([company_id, batch_id])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE batches
                    SET {', '.join(fields)}
                    WHERE company_id = %s AND id = %s
                    RETURNING id, status
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="batch not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'batch_update', 'batch', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], batch_id, json.dumps(patch)),
                )
                return {"ok": True, "status": row["status"]}


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
                # Keep inventory movements aligned with accounting period locks (even though we don't post GL here).
                assert_period_open(cur, company_id, date.today())
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

                # Preserve batch integrity by allocating from source batches (FEFO).
                cur.execute(
                    """
                    SELECT track_batches, track_expiry, min_shelf_life_days_for_sale
                    FROM items
                    WHERE company_id=%s AND id=%s
                    """,
                    (company_id, data.item_id),
                )
                pol = cur.fetchone() or {}
                tracked = bool(pol.get("track_batches")) or bool(pol.get("track_expiry")) or int(pol.get("min_shelf_life_days_for_sale") or 0) > 0
                allow_negative_stock = pos_processor.resolve_allow_negative_stock(cur, company_id, data.item_id, data.from_warehouse_id)
                transfer_date = date.today()
                min_days = int(pol.get("min_shelf_life_days_for_sale") or 0)
                min_exp = (transfer_date + timedelta(days=min_days)) if min_days > 0 else None
                if bool(pol.get("track_expiry")) and not min_exp:
                    min_exp = transfer_date

                allocations = pos_processor.allocate_fefo_batches(
                    cur,
                    company_id,
                    data.item_id,
                    data.from_warehouse_id,
                    data.qty,
                    min_expiry_date=min_exp,
                    allow_unbatched_remainder=not tracked,
                    allow_negative_stock=allow_negative_stock,
                )

                # Stock out (from)
                out_id = None
                in_id = None
                for batch_id, q in allocations:
                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, location_id, batch_id, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                           source_type, source_id, created_by_user_id, reason)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, 'inventory_transfer', NULL, %s, %s)
                        RETURNING id
                        """,
                        (
                            company_id,
                            data.item_id,
                            data.from_warehouse_id,
                            data.from_location_id,
                            batch_id,
                            q,
                            unit_cost_usd,
                            unit_cost_lbp,
                            transfer_date,
                            user["user_id"],
                            (data.reason or "Inventory transfer").strip() if data.reason is not None else None,
                        ),
                    )
                    out_id = out_id or cur.fetchone()["id"]

                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, location_id, batch_id, qty_in, unit_cost_usd, unit_cost_lbp, move_date,
                           source_type, source_id, created_by_user_id, reason)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, 'inventory_transfer', NULL, %s, %s)
                        RETURNING id
                        """,
                        (
                            company_id,
                            data.item_id,
                            data.to_warehouse_id,
                            data.to_location_id,
                            batch_id,
                            q,
                            unit_cost_usd,
                            unit_cost_lbp,
                            transfer_date,
                            user["user_id"],
                            (data.reason or "Inventory transfer").strip() if data.reason is not None else None,
                        ),
                    )
                    in_id = in_id or cur.fetchone()["id"]

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
    batch_id: Optional[str] = None
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None


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
                        SELECT track_batches, track_expiry
                        FROM items
                        WHERE company_id=%s AND id=%s
                        """,
                        (company_id, line.item_id),
                    )
                    it = cur.fetchone() or {}
                    tracked = bool(it.get("track_batches")) or bool(it.get("track_expiry"))

                    batch_id = (line.batch_id or "").strip() or None
                    batch_no = (line.batch_no or "").strip() or None
                    exp = line.expiry_date
                    if tracked and not (batch_id or batch_no or exp):
                        raise HTTPException(status_code=400, detail="tracked items require batch_id (or batch_no/expiry_date) for cycle count")
                    if batch_id:
                        cur.execute(
                            """
                            SELECT id
                            FROM batches
                            WHERE company_id=%s AND id=%s AND item_id=%s
                            """,
                            (company_id, batch_id, line.item_id),
                        )
                        if not cur.fetchone():
                            raise HTTPException(status_code=400, detail="invalid batch_id for item")
                    elif batch_no or exp:
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
                            (company_id, line.item_id, batch_no, exp),
                        )
                        b = cur.fetchone()
                        if not b:
                            raise HTTPException(status_code=400, detail="batch not found for batch_no/expiry_date")
                        batch_id = b["id"]

                    cur.execute(
                        """
                        SELECT COALESCE(SUM(qty_in) - SUM(qty_out), 0) AS qty_on_hand
                        FROM stock_moves
                        WHERE company_id = %s AND item_id = %s AND warehouse_id = %s
                          AND batch_id IS NOT DISTINCT FROM %s
                        """,
                        (company_id, line.item_id, data.warehouse_id, batch_id),
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
                          (id, company_id, item_id, warehouse_id, batch_id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                           source_type, source_id, created_by_user_id, reason)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, 'cycle_count', NULL, %s, %s)
                        RETURNING id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp
                        """,
                        (
                            company_id,
                            line.item_id,
                            data.warehouse_id,
                            batch_id,
                            qty_in,
                            qty_out,
                            unit_cost_usd,
                            unit_cost_lbp,
                            date.today(),
                            user["user_id"],
                            (data.reason or "Cycle count").strip() if data.reason is not None else None,
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
                    created.append({"item_id": line.item_id, "batch_id": str(batch_id) if batch_id else None, "move_id": str(move_id), "diff": str(diff)})

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

                    try:
                        auto_balance_journal(cur, company_id, journal_id, warehouse_id=data.warehouse_id)
                    except ValueError as e:
                        raise HTTPException(status_code=400, detail=str(e))

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
                SELECT id, item_id, warehouse_id, location_id, batch_id, move_date,
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
                       b.batch_no, b.expiry_date, b.status, b.hold_reason,
                       SUM(sm.qty_in) - SUM(sm.qty_out) AS qty_on_hand
                FROM stock_moves sm
                JOIN batches b ON b.id = sm.batch_id
                WHERE sm.company_id = %s
                  AND b.expiry_date IS NOT NULL
                  AND b.expiry_date <= (CURRENT_DATE + (%s || ' days')::interval)
                GROUP BY sm.item_id, sm.warehouse_id, sm.batch_id, b.batch_no, b.expiry_date, b.status, b.hold_reason
                HAVING (SUM(sm.qty_in) - SUM(sm.qty_out)) > 0
                ORDER BY b.expiry_date ASC, b.status ASC
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
