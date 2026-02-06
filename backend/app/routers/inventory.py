from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from decimal import Decimal
from typing import Optional, List
import json
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
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO stock_moves
                  (id, company_id, item_id, warehouse_id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp,
                   source_type, source_id)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, 'inventory_adjustment', NULL)
                RETURNING id
                """,
                (
                    company_id,
                    data.item_id,
                    data.warehouse_id,
                    data.qty_in,
                    data.qty_out,
                    data.unit_cost_usd,
                    data.unit_cost_lbp,
                ),
            )
            move_id = cur.fetchone()["id"]

            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'inventory_adjust', 'stock_move', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], move_id, json.dumps({"reason": data.reason})),
            )
            return {"id": move_id}


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
        with conn.transaction():
            with conn.cursor() as cur:
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
                        RETURNING id
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
                    move_id = cur.fetchone()["id"]
                    created.append({"item_id": line.item_id, "move_id": str(move_id), "diff": str(diff)})

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'cycle_count', 'warehouse', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], data.warehouse_id, json.dumps({"reason": data.reason, "created": created})),
                )

        return {"created": created}
