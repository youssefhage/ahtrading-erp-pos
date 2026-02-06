from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from decimal import Decimal
from typing import Optional, List
import json
import uuid
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/inventory", tags=["inventory"])


class StockAdjustIn(BaseModel):
    item_id: str
    warehouse_id: str
    qty_in: Decimal = Decimal("0")
    qty_out: Decimal = Decimal("0")
    unit_cost_usd: Decimal = Decimal("0")
    unit_cost_lbp: Decimal = Decimal("0")
    reason: Optional[str] = None


@router.get("/stock", dependencies=[Depends(require_permission("inventory:read"))])
def stock_summary(item_id: Optional[str] = None, warehouse_id: Optional[str] = None, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
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
                    INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                    VALUES (gen_random_uuid(), %s, %s, 'inventory_adjustment', %s, CURRENT_DATE, 'market')
                    RETURNING id
                    """,
                    (company_id, f"ADJ-{str(move_id)[:8]}", move_id),
                )
                journal_id = cur.fetchone()["id"]

                if qty_in > 0:
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Inventory adjustment (in)')
                        """,
                        (journal_id, inventory, amt_usd, amt_lbp),
                    )
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory adjustment (offset)')
                        """,
                        (journal_id, inv_adj, amt_usd, amt_lbp),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Inventory adjustment (out)')
                        """,
                        (journal_id, inv_adj, amt_usd, amt_lbp),
                    )
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory adjustment (asset)')
                        """,
                        (journal_id, inventory, amt_usd, amt_lbp),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'inventory_adjust', 'stock_move', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], move_id, json.dumps({"reason": data.reason, "journal_id": str(journal_id)})),
                )
                return {"id": move_id, "journal_id": journal_id}


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
                        INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                        VALUES (gen_random_uuid(), %s, %s, 'cycle_count', %s, CURRENT_DATE, 'market')
                        RETURNING id
                        """,
                        (company_id, journal_no, data.warehouse_id),
                    )
                    journal_id = cur.fetchone()["id"]

                    if inc_usd != 0 or inc_lbp != 0:
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Cycle count increase')
                            """,
                            (journal_id, inventory, inc_usd, inc_lbp),
                        )
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Cycle count offset')
                            """,
                            (journal_id, inv_adj, inc_usd, inc_lbp),
                        )

                    if dec_usd != 0 or dec_lbp != 0:
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Cycle count decrease')
                            """,
                            (journal_id, inv_adj, dec_usd, dec_lbp),
                        )
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Cycle count asset')
                            """,
                            (journal_id, inventory, dec_usd, dec_lbp),
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
