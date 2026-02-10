from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from decimal import Decimal
from datetime import date, timedelta
import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission
from ..period_locks import assert_period_open

router = APIRouter(prefix="/warehouse", tags=["warehouse"])


class ReplenishmentRuleIn(BaseModel):
    warehouse_id: str
    to_location_id: str
    item_id: str
    from_location_id: Optional[str] = None
    min_qty: Decimal = Decimal("0")
    target_qty: Decimal = Decimal("0")
    max_qty: Decimal = Decimal("0")
    is_active: bool = True


@router.get("/replenishment/rules", dependencies=[Depends(require_permission("inventory:read"))])
def list_replenishment_rules(
    warehouse_id: str = Query("", description="Filter by warehouse"),
    to_location_id: str = Query("", description="Filter by destination location"),
    item_id: str = Query("", description="Filter by item id"),
    limit: int = Query(500, ge=1, le=2000),
    company_id: str = Depends(get_company_id),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
              SELECT r.id, r.warehouse_id, w.name AS warehouse_name,
                     r.from_location_id, lf.code AS from_location_code,
                     r.to_location_id, lt.code AS to_location_code,
                     r.item_id, i.sku AS item_sku, i.name AS item_name,
                     r.min_qty, r.target_qty, r.max_qty, r.is_active, r.updated_at
              FROM replenishment_rules r
              JOIN warehouses w ON w.id = r.warehouse_id
              JOIN items i ON i.id = r.item_id
              LEFT JOIN warehouse_locations lf ON lf.id = r.from_location_id
              LEFT JOIN warehouse_locations lt ON lt.id = r.to_location_id
              WHERE r.company_id=%s
            """
            params: list = [company_id]
            if warehouse_id:
                sql += " AND r.warehouse_id=%s"
                params.append(warehouse_id)
            if to_location_id:
                sql += " AND r.to_location_id=%s"
                params.append(to_location_id)
            if item_id:
                sql += " AND r.item_id=%s"
                params.append(item_id)
            sql += " ORDER BY r.is_active DESC, r.updated_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"rules": cur.fetchall()}


@router.post("/replenishment/rules", dependencies=[Depends(require_permission("inventory:write"))])
def upsert_replenishment_rule(
    data: ReplenishmentRuleIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    if Decimal(str(data.min_qty or 0)) < 0 or Decimal(str(data.target_qty or 0)) < 0 or Decimal(str(data.max_qty or 0)) < 0:
        raise HTTPException(status_code=400, detail="quantities must be >= 0")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM warehouses WHERE company_id=%s AND id=%s", (company_id, data.warehouse_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="warehouse not found")
                cur.execute("SELECT 1 FROM items WHERE company_id=%s AND id=%s", (company_id, data.item_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="item not found")
                cur.execute(
                    """
                    SELECT 1
                    FROM warehouse_locations
                    WHERE company_id=%s AND id=%s AND warehouse_id=%s
                    """,
                    (company_id, data.to_location_id, data.warehouse_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail="to_location_id must belong to warehouse")
                if (data.from_location_id or "").strip():
                    cur.execute(
                        """
                        SELECT 1
                        FROM warehouse_locations
                        WHERE company_id=%s AND id=%s AND warehouse_id=%s
                        """,
                        (company_id, data.from_location_id, data.warehouse_id),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail="from_location_id must belong to warehouse")

                cur.execute(
                    """
                    INSERT INTO replenishment_rules
                      (id, company_id, warehouse_id, from_location_id, to_location_id, item_id,
                       min_qty, target_qty, max_qty, is_active)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (company_id, to_location_id, item_id) DO UPDATE
                      SET warehouse_id = EXCLUDED.warehouse_id,
                          from_location_id = EXCLUDED.from_location_id,
                          min_qty = EXCLUDED.min_qty,
                          target_qty = EXCLUDED.target_qty,
                          max_qty = EXCLUDED.max_qty,
                          is_active = EXCLUDED.is_active,
                          updated_at = now()
                    RETURNING id
                    """,
                    (
                        company_id,
                        data.warehouse_id,
                        data.from_location_id,
                        data.to_location_id,
                        data.item_id,
                        data.min_qty,
                        data.target_qty,
                        data.max_qty,
                        bool(data.is_active),
                    ),
                )
                rid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'replenishment_rule_upsert', 'replenishment_rule', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], rid, json.dumps(data.model_dump(), default=str)),
                )
                return {"id": rid}


def _stock_on_hand_by_item_location(cur, company_id: str, warehouse_id: str, location_id: str) -> dict[str, Decimal]:
    cur.execute(
        """
        SELECT item_id, COALESCE(SUM(qty_in),0) - COALESCE(SUM(qty_out),0) AS qty_on_hand
        FROM stock_moves
        WHERE company_id=%s AND warehouse_id=%s AND location_id=%s
        GROUP BY item_id
        """,
        (company_id, warehouse_id, location_id),
    )
    return {str(r["item_id"]): Decimal(str(r["qty_on_hand"] or 0)) for r in (cur.fetchall() or [])}


@router.get("/replenishment/suggestions", dependencies=[Depends(require_permission("inventory:read"))])
def replenishment_suggestions(
    warehouse_id: str = Query(...),
    to_location_id: str = Query(...),
    limit: int = Query(500, ge=1, le=2000),
    company_id: str = Depends(get_company_id),
):
    """
    Compute replenishment suggestions from rules + current location stock.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM warehouses WHERE company_id=%s AND id=%s", (company_id, warehouse_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="warehouse not found")
            cur.execute(
                "SELECT 1 FROM warehouse_locations WHERE company_id=%s AND id=%s AND warehouse_id=%s",
                (company_id, to_location_id, warehouse_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="location not found")

            cur.execute(
                """
                SELECT r.id, r.item_id, i.sku AS item_sku, i.name AS item_name,
                       r.from_location_id, lf.code AS from_location_code,
                       r.to_location_id, lt.code AS to_location_code,
                       r.min_qty, r.target_qty, r.max_qty
                FROM replenishment_rules r
                JOIN items i ON i.id = r.item_id
                LEFT JOIN warehouse_locations lf ON lf.id = r.from_location_id
                LEFT JOIN warehouse_locations lt ON lt.id = r.to_location_id
                WHERE r.company_id=%s
                  AND r.warehouse_id=%s
                  AND r.to_location_id=%s
                  AND r.is_active=true
                ORDER BY i.sku ASC
                LIMIT %s
                """,
                (company_id, warehouse_id, to_location_id, limit),
            )
            rules = cur.fetchall() or []
            on_hand = _stock_on_hand_by_item_location(cur, company_id, warehouse_id, to_location_id)
            out = []
            for r in rules:
                item_id = str(r["item_id"])
                qoh = on_hand.get(item_id, Decimal("0"))
                min_qty = Decimal(str(r["min_qty"] or 0))
                target = Decimal(str(r["target_qty"] or 0))
                if target <= 0:
                    target = min_qty
                if qoh < min_qty and target > qoh:
                    need = target - qoh
                    out.append(
                        {
                            "rule_id": r["id"],
                            "item_id": item_id,
                            "item_sku": r["item_sku"],
                            "item_name": r["item_name"],
                            "qty_on_hand": qoh,
                            "min_qty": min_qty,
                            "target_qty": target,
                            "qty_needed": need,
                            "from_location_id": r.get("from_location_id"),
                            "from_location_code": r.get("from_location_code"),
                            "to_location_id": r.get("to_location_id"),
                            "to_location_code": r.get("to_location_code"),
                        }
                    )
            return {"suggestions": out}


class ReplenishmentTransferLineIn(BaseModel):
    item_id: str
    qty: Decimal


class CreateReplenishmentTransferIn(BaseModel):
    warehouse_id: str
    from_location_id: Optional[str] = None
    to_location_id: str
    memo: Optional[str] = None
    lines: List[ReplenishmentTransferLineIn]


@router.post("/replenishment/create-transfer-draft", dependencies=[Depends(require_permission("inventory:write"))])
def create_replenishment_transfer_draft(
    data: CreateReplenishmentTransferIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Create a stock transfer draft to replenish a bin (within a warehouse).
    Uses the existing stock transfer document model.
    """
    if not data.lines:
        raise HTTPException(status_code=400, detail="lines is required")
    for ln in data.lines:
        if Decimal(str(ln.qty or 0)) <= 0:
            raise HTTPException(status_code=400, detail="line qty must be > 0")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM warehouses WHERE company_id=%s AND id=%s", (company_id, data.warehouse_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="warehouse not found")
                # Validate locations belong to warehouse (if provided).
                cur.execute(
                    "SELECT 1 FROM warehouse_locations WHERE company_id=%s AND id=%s AND warehouse_id=%s AND is_active=true",
                    (company_id, data.to_location_id, data.warehouse_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail="to_location_id invalid")
                if (data.from_location_id or "").strip():
                    cur.execute(
                        "SELECT 1 FROM warehouse_locations WHERE company_id=%s AND id=%s AND warehouse_id=%s AND is_active=true",
                        (company_id, data.from_location_id, data.warehouse_id),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail="from_location_id invalid")

                cur.execute("SELECT next_document_no(%s, %s) AS doc_no", (company_id, "ST"))
                transfer_no = cur.fetchone()["doc_no"]

                memo = (data.memo or "").strip() or "Replenishment"
                cur.execute(
                    """
                    INSERT INTO stock_transfers
                      (id, company_id, transfer_no, status, from_warehouse_id, to_warehouse_id, from_location_id, to_location_id, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'draft', %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        transfer_no,
                        data.warehouse_id,
                        data.warehouse_id,
                        data.from_location_id,
                        data.to_location_id,
                        memo,
                        user["user_id"],
                    ),
                )
                tid = cur.fetchone()["id"]

                item_ids = sorted({str(ln.item_id) for ln in (data.lines or []) if getattr(ln, "item_id", None)})
                item_uom = {}
                if item_ids:
                    cur.execute(
                        """
                        SELECT id, unit_of_measure
                        FROM items
                        WHERE company_id=%s AND id = ANY(%s::uuid[])
                        """,
                        (company_id, item_ids),
                    )
                    item_uom = {str(r["id"]): (r.get("unit_of_measure") or "EA") for r in cur.fetchall()}

                for idx, ln in enumerate(data.lines, start=1):
                    uom = (item_uom.get(str(ln.item_id)) or "EA").strip().upper()
                    cur.execute(
                        """
                        INSERT INTO stock_transfer_lines
                          (id, company_id, stock_transfer_id, line_no, item_id,
                           qty, uom, qty_factor, qty_entered,
                           picked_qty, notes)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s,
                           %s, %s, 1, %s,
                           0, NULL)
                        """,
                        (company_id, tid, idx, ln.item_id, ln.qty, uom, ln.qty),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'replenishment_transfer_draft_created', 'stock_transfer', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], tid, json.dumps({"transfer_no": transfer_no, "lines": len(data.lines)})),
                )
                return {"id": tid, "transfer_no": transfer_no}


class CycleCountPlanIn(BaseModel):
    name: str
    warehouse_id: str
    location_id: Optional[str] = None
    frequency_days: int = 7
    next_run_date: Optional[date] = None
    is_active: bool = True


@router.get("/cycle-count/plans", dependencies=[Depends(require_permission("inventory:read"))])
def list_cycle_count_plans(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT p.id, p.name, p.warehouse_id, w.name AS warehouse_name,
                       p.location_id, loc.code AS location_code,
                       p.frequency_days, p.next_run_date, p.is_active, p.updated_at
                FROM cycle_count_plans p
                JOIN warehouses w ON w.id = p.warehouse_id
                LEFT JOIN warehouse_locations loc ON loc.id = p.location_id
                WHERE p.company_id=%s
                ORDER BY p.is_active DESC, p.next_run_date ASC, p.name ASC
                """,
                (company_id,),
            )
            return {"plans": cur.fetchall()}


@router.post("/cycle-count/plans", dependencies=[Depends(require_permission("inventory:write"))])
def create_cycle_count_plan(data: CycleCountPlanIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    freq = int(data.frequency_days or 0)
    if freq <= 0 or freq > 365:
        raise HTTPException(status_code=400, detail="frequency_days must be between 1 and 365")
    next_run = data.next_run_date or date.today()
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM warehouses WHERE company_id=%s AND id=%s", (company_id, data.warehouse_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="warehouse not found")
                if (data.location_id or "").strip():
                    cur.execute(
                        "SELECT 1 FROM warehouse_locations WHERE company_id=%s AND id=%s AND warehouse_id=%s",
                        (company_id, data.location_id, data.warehouse_id),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail="location_id must belong to warehouse")
                cur.execute(
                    """
                    INSERT INTO cycle_count_plans
                      (id, company_id, name, warehouse_id, location_id, frequency_days, next_run_date, is_active, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, name, data.warehouse_id, data.location_id, freq, next_run, bool(data.is_active), user["user_id"]),
                )
                pid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'cycle_count_plan_created', 'cycle_count_plan', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], pid, json.dumps({"name": name, "warehouse_id": data.warehouse_id, "location_id": data.location_id, "frequency_days": freq, "next_run_date": str(next_run)})),
                )
                return {"id": pid}


def _create_cycle_count_task(cur, company_id: str, warehouse_id: str, location_id: Optional[str], plan_id: Optional[str], scheduled_date: date):
    cur.execute(
        """
        INSERT INTO cycle_count_tasks
          (id, company_id, plan_id, warehouse_id, location_id, status, scheduled_date)
        VALUES
          (gen_random_uuid(), %s, %s, %s, %s, 'open', %s)
        RETURNING id
        """,
        (company_id, plan_id, warehouse_id, location_id, scheduled_date),
    )
    task_id = cur.fetchone()["id"]

    # Snapshot expected on-hand by item in the location (or entire warehouse if location_id is NULL).
    if location_id:
        cur.execute(
            """
            SELECT item_id, COALESCE(SUM(qty_in),0) - COALESCE(SUM(qty_out),0) AS qty_on_hand
            FROM stock_moves
            WHERE company_id=%s AND warehouse_id=%s AND location_id=%s
            GROUP BY item_id
            """,
            (company_id, warehouse_id, location_id),
        )
    else:
        cur.execute(
            """
            SELECT item_id, COALESCE(SUM(qty_in),0) - COALESCE(SUM(qty_out),0) AS qty_on_hand
            FROM stock_moves
            WHERE company_id=%s AND warehouse_id=%s
            GROUP BY item_id
            """,
            (company_id, warehouse_id),
        )
    rows = cur.fetchall() or []
    for r in rows:
        cur.execute(
            """
            INSERT INTO cycle_count_lines
              (id, company_id, task_id, item_id, expected_qty)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s)
            """,
            (company_id, task_id, r["item_id"], r["qty_on_hand"] or 0),
        )
    return task_id


@router.post("/cycle-count/plans/{plan_id}/run", dependencies=[Depends(require_permission("inventory:write"))])
def run_cycle_count_plan_now(plan_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    today = date.today()
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, warehouse_id, location_id, is_active
                    FROM cycle_count_plans
                    WHERE company_id=%s AND id=%s
                    """,
                    (company_id, plan_id),
                )
                p = cur.fetchone()
                if not p:
                    raise HTTPException(status_code=404, detail="plan not found")
                if not p["is_active"]:
                    raise HTTPException(status_code=400, detail="plan is inactive")
                task_id = _create_cycle_count_task(cur, company_id, str(p["warehouse_id"]), str(p["location_id"]) if p.get("location_id") else None, plan_id, today)
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'cycle_count_task_created', 'cycle_count_task', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], task_id, json.dumps({"plan_id": plan_id, "scheduled_date": str(today)})),
                )
                return {"id": task_id}


@router.get("/cycle-count/tasks", dependencies=[Depends(require_permission("inventory:read"))])
def list_cycle_count_tasks(
    status: str = Query("open"),
    limit: int = Query(200, ge=1, le=2000),
    company_id: str = Depends(get_company_id),
):
    st = (status or "").strip().lower()
    if st and st not in {"open", "in_progress", "posted", "canceled"}:
        raise HTTPException(status_code=400, detail="invalid status")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
              SELECT t.id, t.plan_id, p.name AS plan_name,
                     t.warehouse_id, w.name AS warehouse_name,
                     t.location_id, loc.code AS location_code,
                     t.status, t.scheduled_date, t.created_at
              FROM cycle_count_tasks t
              LEFT JOIN cycle_count_plans p ON p.id = t.plan_id
              JOIN warehouses w ON w.id = t.warehouse_id
              LEFT JOIN warehouse_locations loc ON loc.id = t.location_id
              WHERE t.company_id=%s
            """
            params: list = [company_id]
            if st:
                sql += " AND t.status=%s"
                params.append(st)
            sql += " ORDER BY t.created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"tasks": cur.fetchall()}


@router.get("/cycle-count/tasks/{task_id}", dependencies=[Depends(require_permission("inventory:read"))])
def get_cycle_count_task(task_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, plan_id, warehouse_id, location_id, status, scheduled_date, created_at
                FROM cycle_count_tasks
                WHERE company_id=%s AND id=%s
                """,
                (company_id, task_id),
            )
            t = cur.fetchone()
            if not t:
                raise HTTPException(status_code=404, detail="task not found")
            cur.execute(
                """
                SELECT l.id, l.item_id, i.sku AS item_sku, i.name AS item_name,
                       l.expected_qty, l.counted_qty, l.notes
                FROM cycle_count_lines l
                JOIN items i ON i.id = l.item_id
                WHERE l.company_id=%s AND l.task_id=%s
                ORDER BY i.sku ASC
                """,
                (company_id, task_id),
            )
            return {"task": t, "lines": cur.fetchall()}


class CycleCountLineUpdateIn(BaseModel):
    id: str
    counted_qty: Optional[Decimal] = None
    notes: Optional[str] = None


class CycleCountUpdateIn(BaseModel):
    lines: List[CycleCountLineUpdateIn]


@router.patch("/cycle-count/tasks/{task_id}/count", dependencies=[Depends(require_permission("inventory:write"))])
def update_cycle_count_counts(
    task_id: str,
    data: CycleCountUpdateIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    updates = data.lines or []
    if not updates:
        return {"ok": True}
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT status FROM cycle_count_tasks WHERE company_id=%s AND id=%s FOR UPDATE",
                    (company_id, task_id),
                )
                t = cur.fetchone()
                if not t:
                    raise HTTPException(status_code=404, detail="task not found")
                if t["status"] in {"posted", "canceled"}:
                    raise HTTPException(status_code=409, detail="task cannot be edited")

                ids = [u.id for u in updates]
                cur.execute(
                    """
                    SELECT id
                    FROM cycle_count_lines
                    WHERE company_id=%s AND task_id=%s AND id = ANY(%s::uuid[])
                    """,
                    (company_id, task_id, ids),
                )
                found = {str(r["id"]) for r in (cur.fetchall() or [])}
                missing = [i for i in ids if str(i) not in found]
                if missing:
                    raise HTTPException(status_code=404, detail="line not found")

                for u in updates:
                    sets = []
                    params = []
                    if u.counted_qty is not None:
                        if Decimal(str(u.counted_qty or 0)) < 0:
                            raise HTTPException(status_code=400, detail="counted_qty must be >= 0")
                        sets.append("counted_qty=%s")
                        params.append(u.counted_qty)
                    if u.notes is not None:
                        sets.append("notes=%s")
                        params.append((u.notes or "").strip() or None)
                    if not sets:
                        continue
                    params.extend([company_id, task_id, u.id])
                    cur.execute(
                        f"""
                        UPDATE cycle_count_lines
                        SET {', '.join(sets)}
                        WHERE company_id=%s AND task_id=%s AND id=%s
                        """,
                        params,
                    )

                cur.execute(
                    "UPDATE cycle_count_tasks SET status='in_progress', started_at=COALESCE(started_at, now()), updated_at=now() WHERE company_id=%s AND id=%s",
                    (company_id, task_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'cycle_count_counts_updated', 'cycle_count_task', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], task_id, json.dumps({"lines": len(updates)})),
                )
                return {"ok": True}


@router.post("/cycle-count/tasks/{task_id}/post", dependencies=[Depends(require_permission("inventory:write"))])
def post_cycle_count_task(task_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Posts stock adjustments for variances between expected and counted quantities.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, warehouse_id, location_id
                    FROM cycle_count_tasks
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, task_id),
                )
                t = cur.fetchone()
                if not t:
                    raise HTTPException(status_code=404, detail="task not found")
                if t["status"] == "posted":
                    return {"ok": True}
                if t["status"] == "canceled":
                    raise HTTPException(status_code=409, detail="task canceled")

                assert_period_open(cur, company_id, date.today())

                cur.execute(
                    """
                    SELECT item_id, expected_qty, counted_qty
                    FROM cycle_count_lines
                    WHERE company_id=%s AND task_id=%s
                    """,
                    (company_id, task_id),
                )
                lines = cur.fetchall() or []
                if not lines:
                    raise HTTPException(status_code=400, detail="task has no lines")

                wh = str(t["warehouse_id"])
                loc = str(t["location_id"]) if t.get("location_id") else None
                # Post adjustments per item.
                moved = 0
                for ln in lines:
                    exp = Decimal(str(ln["expected_qty"] or 0))
                    cnt = ln.get("counted_qty")
                    if cnt is None:
                        continue
                    cnt = Decimal(str(cnt or 0))
                    diff = cnt - exp
                    if diff == 0:
                        continue
                    qty_in = diff if diff > 0 else Decimal("0")
                    qty_out = (-diff) if diff < 0 else Decimal("0")
                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, location_id, batch_id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp,
                           move_date, source_type, source_id, created_by_user_id, reason)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, NULL, %s, %s, 0, 0, %s, 'cycle_count', %s, %s, %s)
                        """,
                        (
                            company_id,
                            ln["item_id"],
                            wh,
                            loc,
                            qty_in,
                            qty_out,
                            date.today(),
                            task_id,
                            user["user_id"],
                            "Cycle count adjustment",
                        ),
                    )
                    moved += 1

                cur.execute(
                    """
                    UPDATE cycle_count_tasks
                    SET status='posted',
                        completed_at=now(),
                        posted_by_user_id=%s,
                        posted_at=now(),
                        updated_at=now()
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], company_id, task_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'cycle_count_posted', 'cycle_count_task', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], task_id, json.dumps({"adjusted_items": moved})),
                )
                return {"ok": True, "adjusted_items": moved}
