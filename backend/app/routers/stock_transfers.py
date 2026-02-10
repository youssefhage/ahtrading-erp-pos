from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from datetime import date, timedelta
import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission
from ..period_locks import assert_period_open

try:
    from ..workers import pos_processor
except Exception:  # pragma: no cover
    # Import path fallback for some environments.
    from backend.workers import pos_processor

router = APIRouter(prefix="/inventory/transfers", tags=["inventory"])


def _next_doc_no(cur, company_id: str) -> str:
    cur.execute("SELECT next_document_no(%s, %s) AS doc_no", (company_id, "ST"))
    return cur.fetchone()["doc_no"]


class TransferLineIn(BaseModel):
    item_id: str
    qty: Decimal
    notes: Optional[str] = None


class TransferDraftIn(BaseModel):
    from_warehouse_id: str
    to_warehouse_id: str
    from_location_id: Optional[str] = None
    to_location_id: Optional[str] = None
    memo: Optional[str] = None
    lines: List[TransferLineIn]


class TransferDraftUpdateIn(BaseModel):
    from_warehouse_id: Optional[str] = None
    to_warehouse_id: Optional[str] = None
    from_location_id: Optional[str] = None
    to_location_id: Optional[str] = None
    memo: Optional[str] = None
    lines: Optional[List[TransferLineIn]] = None


@router.get("", dependencies=[Depends(require_permission("inventory:read"))])
def list_transfers(
    q: str = Query("", description="Search transfer no / memo"),
    status: str = Query("", description="draft|picked|posted|canceled"),
    limit: int = Query(200, ge=1, le=1000),
    company_id: str = Depends(get_company_id),
):
    qq = (q or "").strip()
    st = (status or "").strip().lower()
    if st and st not in {"draft", "picked", "posted", "canceled"}:
        raise HTTPException(status_code=400, detail="invalid status")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT t.id, t.transfer_no, t.status,
                       t.from_warehouse_id, wf.name AS from_warehouse_name,
                       t.to_warehouse_id, wt.name AS to_warehouse_name,
                       t.from_location_id, lf.code AS from_location_code, lf.name AS from_location_name,
                       t.to_location_id, lt.code AS to_location_code, lt.name AS to_location_name,
                       t.memo, t.created_at, t.picked_at, t.posted_at
                FROM stock_transfers t
                LEFT JOIN warehouses wf ON wf.company_id=t.company_id AND wf.id=t.from_warehouse_id
                LEFT JOIN warehouses wt ON wt.company_id=t.company_id AND wt.id=t.to_warehouse_id
                LEFT JOIN warehouse_locations lf ON lf.company_id=t.company_id AND lf.id=t.from_location_id
                LEFT JOIN warehouse_locations lt ON lt.company_id=t.company_id AND lt.id=t.to_location_id
                WHERE t.company_id=%s
            """
            params: list = [company_id]
            if st:
                sql += " AND t.status=%s"
                params.append(st)
            if qq:
                sql += " AND (t.transfer_no ILIKE %s OR COALESCE(t.memo,'') ILIKE %s)"
                like = f"%{qq}%"
                params.extend([like, like])
            sql += " ORDER BY t.created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"transfers": cur.fetchall()}


@router.get("/{transfer_id}", dependencies=[Depends(require_permission("inventory:read"))])
def get_transfer(transfer_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.*,
                       wf.name AS from_warehouse_name,
                       wt.name AS to_warehouse_name,
                       lf.code AS from_location_code,
                       lf.name AS from_location_name,
                       lt.code AS to_location_code,
                       lt.name AS to_location_name
                FROM stock_transfers t
                LEFT JOIN warehouses wf ON wf.company_id=t.company_id AND wf.id=t.from_warehouse_id
                LEFT JOIN warehouses wt ON wt.company_id=t.company_id AND wt.id=t.to_warehouse_id
                LEFT JOIN warehouse_locations lf ON lf.company_id=t.company_id AND lf.id=t.from_location_id
                LEFT JOIN warehouse_locations lt ON lt.company_id=t.company_id AND lt.id=t.to_location_id
                WHERE t.company_id=%s AND t.id=%s
                """,
                (company_id, transfer_id),
            )
            doc = cur.fetchone()
            if not doc:
                raise HTTPException(status_code=404, detail="transfer not found")
            cur.execute(
                """
                SELECT l.id, l.line_no, l.item_id, i.sku AS item_sku, i.name AS item_name,
                       l.qty, l.picked_qty, l.notes
                FROM stock_transfer_lines l
                JOIN items i ON i.company_id=l.company_id AND i.id=l.item_id
                WHERE l.company_id=%s AND l.stock_transfer_id=%s
                ORDER BY l.line_no ASC
                """,
                (company_id, transfer_id),
            )
            lines = cur.fetchall() or []
            line_ids = [str(l["id"]) for l in lines]
            alloc_by_line: dict[str, list] = {lid: [] for lid in line_ids}
            if line_ids:
                cur.execute(
                    """
                    SELECT a.id, a.stock_transfer_line_id, a.batch_id, b.batch_no, b.expiry_date, a.qty, a.created_at
                    FROM stock_transfer_line_allocations a
                    LEFT JOIN batches b ON b.company_id=a.company_id AND b.id=a.batch_id
                    WHERE a.company_id=%s AND a.stock_transfer_line_id = ANY(%s::uuid[])
                    ORDER BY a.created_at ASC, a.id ASC
                    """,
                    (company_id, line_ids),
                )
                for r in cur.fetchall() or []:
                    alloc_by_line[str(r["stock_transfer_line_id"])].append(r)
            return {"transfer": doc, "lines": lines, "allocations_by_line": alloc_by_line}


def _validate_location(cur, company_id: str, loc_id: Optional[str], expected_wh_id: str, label: str):
    if not loc_id:
        return
    cur.execute(
        """
        SELECT warehouse_id, is_active
        FROM warehouse_locations
        WHERE company_id=%s AND id=%s
        """,
        (company_id, loc_id),
    )
    r = cur.fetchone()
    if not r:
        raise HTTPException(status_code=400, detail=f"{label} not found")
    if str(r["warehouse_id"]) != str(expected_wh_id):
        raise HTTPException(status_code=400, detail=f"{label} does not belong to the specified warehouse")
    if r.get("is_active") is False:
        raise HTTPException(status_code=400, detail=f"{label} is inactive")


@router.post("/drafts", dependencies=[Depends(require_permission("inventory:write"))])
def create_transfer_draft(data: TransferDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.lines:
        raise HTTPException(status_code=400, detail="at least one line is required")
    if data.from_warehouse_id == data.to_warehouse_id and data.from_location_id == data.to_location_id:
        raise HTTPException(status_code=400, detail="from/to must differ (warehouse or location)")
    for ln in data.lines:
        if Decimal(str(ln.qty or 0)) <= 0:
            raise HTTPException(status_code=400, detail="line qty must be > 0")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                _validate_location(cur, company_id, data.from_location_id, data.from_warehouse_id, "from_location_id")
                _validate_location(cur, company_id, data.to_location_id, data.to_warehouse_id, "to_location_id")

                no = _next_doc_no(cur, company_id)
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
                        no,
                        data.from_warehouse_id,
                        data.to_warehouse_id,
                        data.from_location_id,
                        data.to_location_id,
                        (data.memo or "").strip() or None,
                        user["user_id"],
                    ),
                )
                tid = cur.fetchone()["id"]
                cur.execute(
                    """
                    SELECT id, unit_of_measure
                    FROM items
                    WHERE company_id=%s AND id = ANY(%s::uuid[])
                    """,
                    (company_id, sorted({str(ln.item_id) for ln in (data.lines or []) if ln.item_id})),
                )
                uom_by_item = {str(r["id"]): (r.get("unit_of_measure") or "") for r in cur.fetchall()}
                for idx, ln in enumerate(data.lines, start=1):
                    base_uom = (uom_by_item.get(str(ln.item_id)) or "").strip() or None
                    cur.execute(
                        """
                        INSERT INTO stock_transfer_lines
                          (id, company_id, stock_transfer_id, line_no, item_id, qty,
                           uom, qty_factor, qty_entered,
                           picked_qty, notes)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s,
                           %s, 1, %s,
                           0, %s)
                        """,
                        (company_id, tid, idx, ln.item_id, ln.qty, base_uom, ln.qty, (ln.notes or "").strip() or None),
                    )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_transfer_draft_created', 'stock_transfer', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], tid, json.dumps({"transfer_no": no, "lines": len(data.lines)})),
                )
                return {"id": tid, "transfer_no": no}


@router.patch("/{transfer_id}/draft", dependencies=[Depends(require_permission("inventory:write"))])
def update_transfer_draft(transfer_id: str, data: TransferDraftUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, from_warehouse_id, to_warehouse_id
                    FROM stock_transfers
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, transfer_id),
                )
                doc = cur.fetchone()
                if not doc:
                    raise HTTPException(status_code=404, detail="transfer not found")
                if doc["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft transfers can be edited")

                from_wh = patch.get("from_warehouse_id") or doc["from_warehouse_id"]
                to_wh = patch.get("to_warehouse_id") or doc["to_warehouse_id"]
                from_loc = patch.get("from_location_id") if "from_location_id" in patch else None
                to_loc = patch.get("to_location_id") if "to_location_id" in patch else None
                if "from_location_id" in patch:
                    _validate_location(cur, company_id, patch.get("from_location_id"), from_wh, "from_location_id")
                if "to_location_id" in patch:
                    _validate_location(cur, company_id, patch.get("to_location_id"), to_wh, "to_location_id")

                sets = []
                params = []
                for k in ["from_warehouse_id", "to_warehouse_id", "from_location_id", "to_location_id", "memo"]:
                    if k in patch:
                        val = patch.get(k)
                        if k == "memo":
                            val = (val or "").strip() or None
                        sets.append(f"{k}=%s")
                        params.append(val)
                if sets:
                    params.extend([company_id, transfer_id])
                    cur.execute(
                        f"""
                        UPDATE stock_transfers
                        SET {', '.join(sets)}, updated_at=now()
                        WHERE company_id=%s AND id=%s
                        """,
                        params,
                    )

                if "lines" in patch:
                    lines = patch.get("lines") or []
                    if not lines:
                        raise HTTPException(status_code=400, detail="lines cannot be empty")
                    for ln in lines:
                        if Decimal(str(ln.get("qty") or 0)) <= 0:
                            raise HTTPException(status_code=400, detail="line qty must be > 0")
                    cur.execute("DELETE FROM stock_transfer_lines WHERE company_id=%s AND stock_transfer_id=%s", (company_id, transfer_id))
                    cur.execute(
                        """
                        SELECT id, unit_of_measure
                        FROM items
                        WHERE company_id=%s AND id = ANY(%s::uuid[])
                        """,
                        (company_id, sorted({str(ln.get("item_id")) for ln in (lines or []) if ln.get("item_id")})),
                    )
                    uom_by_item = {str(r["id"]): (r.get("unit_of_measure") or "") for r in cur.fetchall()}
                    for idx, ln in enumerate(lines, start=1):
                        base_uom = (uom_by_item.get(str(ln.get("item_id"))) or "").strip() or None
                        cur.execute(
                            """
                            INSERT INTO stock_transfer_lines
                              (id, company_id, stock_transfer_id, line_no, item_id, qty,
                               uom, qty_factor, qty_entered,
                               picked_qty, notes)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s,
                               %s, 1, %s,
                               0, %s)
                            """,
                            (company_id, transfer_id, idx, ln["item_id"], ln["qty"], base_uom, ln["qty"], (ln.get("notes") or "").strip() or None),
                        )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_transfer_draft_updated', 'stock_transfer', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], transfer_id, json.dumps({"updated": sorted(patch.keys())})),
                )
                return {"ok": True}


@router.post("/{transfer_id}/pick", dependencies=[Depends(require_permission("inventory:write"))])
def pick_transfer(transfer_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Compute batch allocations (FEFO) for each transfer line (v1).
    This does not move stock; it prepares allocations for posting.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, from_warehouse_id, to_warehouse_id, from_location_id, to_location_id
                    FROM stock_transfers
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, transfer_id),
                )
                doc = cur.fetchone()
                if not doc:
                    raise HTTPException(status_code=404, detail="transfer not found")
                if doc["status"] == "posted":
                    return {"ok": True}
                if doc["status"] not in {"draft", "picked"}:
                    raise HTTPException(status_code=400, detail="only draft/picked transfers can be picked")

                assert_period_open(cur, company_id, date.today())

                cur.execute(
                    """
                    SELECT id, line_no, item_id, qty
                    FROM stock_transfer_lines
                    WHERE company_id=%s AND stock_transfer_id=%s
                    ORDER BY line_no ASC
                    """,
                    (company_id, transfer_id),
                )
                lines = cur.fetchall() or []
                if not lines:
                    raise HTTPException(status_code=400, detail="transfer has no lines")

                # Clear old allocations.
                line_ids = [str(l["id"]) for l in lines]
                cur.execute(
                    "DELETE FROM stock_transfer_line_allocations WHERE company_id=%s AND stock_transfer_line_id = ANY(%s::uuid[])",
                    (company_id, line_ids),
                )

                warnings: list[str] = []

                for ln in lines:
                    item_id = str(ln["item_id"])
                    qty = Decimal(str(ln["qty"] or 0))
                    if qty <= 0:
                        continue

                    cur.execute(
                        """
                        SELECT track_batches, track_expiry, min_shelf_life_days_for_sale
                        FROM items
                        WHERE company_id=%s AND id=%s
                        """,
                        (company_id, item_id),
                    )
                    pol = cur.fetchone() or {}
                    tracked = bool(pol.get("track_batches")) or bool(pol.get("track_expiry")) or int(pol.get("min_shelf_life_days_for_sale") or 0) > 0
                    allow_negative_stock = pos_processor.resolve_allow_negative_stock(cur, company_id, item_id, doc["from_warehouse_id"])

                    transfer_date = date.today()
                    min_days = int(pol.get("min_shelf_life_days_for_sale") or 0)
                    min_exp = (transfer_date + timedelta(days=min_days)) if min_days > 0 else None
                    if bool(pol.get("track_expiry")) and not min_exp:
                        min_exp = transfer_date

                    try:
                        allocations = pos_processor.allocate_fefo_batches(
                            cur,
                            company_id,
                            item_id,
                            doc["from_warehouse_id"],
                            qty,
                            min_expiry_date=min_exp,
                            allow_unbatched_remainder=not tracked,
                            allow_negative_stock=allow_negative_stock,
                            location_id=doc.get("from_location_id"),
                            strict_location=bool(doc.get("from_location_id")),
                        )
                    except ValueError as ex:
                        # Most common case: not enough stock in the selected bin when negative stock is disabled.
                        raise HTTPException(status_code=409, detail=str(ex))
                    picked_qty = Decimal("0")
                    for batch_id, q in allocations:
                        picked_qty += Decimal(str(q or 0))
                        cur.execute(
                            """
                            INSERT INTO stock_transfer_line_allocations
                              (id, company_id, stock_transfer_line_id, batch_id, qty)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s)
                            """,
                            (company_id, ln["id"], batch_id, q),
                        )
                    cur.execute(
                        """
                        UPDATE stock_transfer_lines
                        SET picked_qty=%s
                        WHERE company_id=%s AND id=%s
                        """,
                        (picked_qty, company_id, ln["id"]),
                    )
                    if picked_qty != qty:
                        warnings.append(f"line {ln['line_no']}: picked {picked_qty} != requested {qty}")

                cur.execute(
                    """
                    UPDATE stock_transfers
                    SET status='picked',
                        picked_by_user_id=%s,
                        picked_at=now(),
                        updated_at=now()
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], company_id, transfer_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_transfer_picked', 'stock_transfer', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], transfer_id, json.dumps({"warnings": warnings[:50]})),
                )
                return {"ok": True, "warnings": warnings}


class AllocationQtyUpdateIn(BaseModel):
    id: str
    qty: Decimal


class AllocationUpdateIn(BaseModel):
    allocations: List[AllocationQtyUpdateIn]


@router.patch("/{transfer_id}/allocations", dependencies=[Depends(require_permission("inventory:write"))])
def update_transfer_allocations(
    transfer_id: str,
    data: AllocationUpdateIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Edit picked allocations (pick/confirm v1): allows adjusting qty on existing allocations.
    Only allowed while transfer is `picked`.
    """
    updates = data.allocations or []
    if not updates:
        return {"ok": True}

    # Validate payload upfront.
    for u in updates:
        if Decimal(str(u.qty or 0)) < 0:
            raise HTTPException(status_code=400, detail="allocation qty must be >= 0")

    alloc_ids = [str(u.id) for u in updates]

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status
                    FROM stock_transfers
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, transfer_id),
                )
                tr = cur.fetchone()
                if not tr:
                    raise HTTPException(status_code=404, detail="transfer not found")
                if tr["status"] != "picked":
                    raise HTTPException(status_code=400, detail="allocations can only be edited while status=picked")

                cur.execute(
                    """
                    SELECT id
                    FROM stock_transfer_lines
                    WHERE company_id=%s AND stock_transfer_id=%s
                    """,
                    (company_id, transfer_id),
                )
                line_ids = {str(r["id"]) for r in (cur.fetchall() or [])}
                if not line_ids:
                    raise HTTPException(status_code=400, detail="transfer has no lines")

                cur.execute(
                    """
                    SELECT id, stock_transfer_line_id
                    FROM stock_transfer_line_allocations
                    WHERE company_id=%s AND id = ANY(%s::uuid[])
                    """,
                    (company_id, alloc_ids),
                )
                found = cur.fetchall() or []
                found_map = {str(r["id"]): str(r["stock_transfer_line_id"]) for r in found}

                missing = [aid for aid in alloc_ids if aid not in found_map]
                if missing:
                    raise HTTPException(status_code=404, detail="allocation not found")

                # Ensure allocations belong to this transfer.
                bad = [aid for aid, lid in found_map.items() if lid not in line_ids]
                if bad:
                    raise HTTPException(status_code=400, detail="allocation does not belong to this transfer")

                touched_lines: set[str] = set()
                for u in updates:
                    q = Decimal(str(u.qty or 0))
                    lid = found_map[str(u.id)]
                    touched_lines.add(lid)
                    if q == 0:
                        cur.execute(
                            "DELETE FROM stock_transfer_line_allocations WHERE company_id=%s AND id=%s",
                            (company_id, u.id),
                        )
                    else:
                        cur.execute(
                            """
                            UPDATE stock_transfer_line_allocations
                            SET qty=%s
                            WHERE company_id=%s AND id=%s
                            """,
                            (q, company_id, u.id),
                        )

                # Recompute picked_qty per touched line.
                cur.execute(
                    """
                    SELECT stock_transfer_line_id, COALESCE(SUM(qty),0) AS picked_qty
                    FROM stock_transfer_line_allocations
                    WHERE company_id=%s AND stock_transfer_line_id = ANY(%s::uuid[])
                    GROUP BY stock_transfer_line_id
                    """,
                    (company_id, list(touched_lines)),
                )
                sums = {str(r["stock_transfer_line_id"]): Decimal(str(r["picked_qty"] or 0)) for r in (cur.fetchall() or [])}
                for lid in touched_lines:
                    cur.execute(
                        """
                        UPDATE stock_transfer_lines
                        SET picked_qty=%s
                        WHERE company_id=%s AND id=%s
                        """,
                        (sums.get(lid, Decimal("0")), company_id, lid),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_transfer_allocations_updated', 'stock_transfer', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], transfer_id, json.dumps({"allocations": len(updates)})),
                )
                return {"ok": True}


@router.post("/{transfer_id}/post", dependencies=[Depends(require_permission("inventory:write"))])
def post_transfer(transfer_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Post a picked transfer by writing stock moves out/in for each allocation.
    """
    warnings: list[str] = []
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, from_warehouse_id, to_warehouse_id, from_location_id, to_location_id
                    FROM stock_transfers
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, transfer_id),
                )
                doc = cur.fetchone()
                if not doc:
                    raise HTTPException(status_code=404, detail="transfer not found")
                if doc["status"] == "posted":
                    return {"ok": True}
                if doc["status"] != "picked":
                    raise HTTPException(status_code=400, detail="transfer must be picked before posting")

                assert_period_open(cur, company_id, date.today())

                cur.execute(
                    """
                    SELECT id, line_no, item_id, qty, picked_qty
                    FROM stock_transfer_lines
                    WHERE company_id=%s AND stock_transfer_id=%s
                    ORDER BY line_no ASC
                    """,
                    (company_id, transfer_id),
                )
                lines = cur.fetchall() or []
                if not lines:
                    raise HTTPException(status_code=400, detail="transfer has no lines")

                # Load allocations per line.
                line_ids = [str(l["id"]) for l in lines]
                cur.execute(
                    """
                    SELECT stock_transfer_line_id, batch_id, qty
                    FROM stock_transfer_line_allocations
                    WHERE company_id=%s AND stock_transfer_line_id = ANY(%s::uuid[])
                    ORDER BY created_at ASC, id ASC
                    """,
                    (company_id, line_ids),
                )
                allocs_by_line: dict[str, list] = {lid: [] for lid in line_ids}
                for r in cur.fetchall() or []:
                    allocs_by_line[str(r["stock_transfer_line_id"])].append(r)

                move_date = date.today()
                out_move_id = None
                in_move_id = None
                for ln in lines:
                    lid = str(ln["id"])
                    item_id = str(ln["item_id"])
                    req_qty = Decimal(str(ln.get("qty") or 0))
                    picked_qty = Decimal(str(ln.get("picked_qty") or 0))
                    if picked_qty <= 0:
                        warnings.append(f"line {ln['line_no']}: picked_qty is 0")
                        continue
                    if picked_qty != req_qty:
                        warnings.append(f"line {ln['line_no']}: posting picked_qty {picked_qty} (requested {req_qty})")
                    allocs = allocs_by_line.get(lid) or []
                    if not allocs:
                        # Allow unbatched posting for non-tracked items: post as a single move with batch_id NULL.
                        allocs = [{"batch_id": None, "qty": picked_qty}]

                    # Cost: use current avg cost from source warehouse.
                    cur.execute(
                        """
                        SELECT avg_cost_usd, avg_cost_lbp
                        FROM item_warehouse_costs
                        WHERE company_id=%s AND item_id=%s AND warehouse_id=%s
                        """,
                        (company_id, item_id, doc["from_warehouse_id"]),
                    )
                    c = cur.fetchone() or {}
                    unit_cost_usd = Decimal(str(c.get("avg_cost_usd") or 0))
                    unit_cost_lbp = Decimal(str(c.get("avg_cost_lbp") or 0))

                    for a in allocs:
                        q = Decimal(str(a.get("qty") or 0))
                        if q <= 0:
                            continue
                        batch_id = a.get("batch_id")
                        cur.execute(
                            """
                            INSERT INTO stock_moves
                              (id, company_id, item_id, warehouse_id, location_id, batch_id, qty_out,
                               unit_cost_usd, unit_cost_lbp, move_date,
                               source_type, source_id, source_line_type, source_line_id,
                               created_by_user_id, reason)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s,
                               %s, %s, %s,
                               'stock_transfer', %s, 'stock_transfer_line', %s,
                               %s, %s)
                            RETURNING id
                            """,
                            (
                                company_id,
                                item_id,
                                doc["from_warehouse_id"],
                                doc["from_location_id"],
                                batch_id,
                                q,
                                unit_cost_usd,
                                unit_cost_lbp,
                                move_date,
                                transfer_id,
                                lid,
                                user["user_id"],
                                "Stock transfer",
                            ),
                        )
                        out_move_id = out_move_id or cur.fetchone()["id"]
                        cur.execute(
                            """
                            INSERT INTO stock_moves
                              (id, company_id, item_id, warehouse_id, location_id, batch_id, qty_in,
                               unit_cost_usd, unit_cost_lbp, move_date,
                               source_type, source_id, source_line_type, source_line_id,
                               created_by_user_id, reason)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s,
                               %s, %s, %s,
                               'stock_transfer', %s, 'stock_transfer_line', %s,
                               %s, %s)
                            RETURNING id
                            """,
                            (
                                company_id,
                                item_id,
                                doc["to_warehouse_id"],
                                doc["to_location_id"],
                                batch_id,
                                q,
                                unit_cost_usd,
                                unit_cost_lbp,
                                move_date,
                                transfer_id,
                                lid,
                                user["user_id"],
                                "Stock transfer",
                            ),
                        )
                        in_move_id = in_move_id or cur.fetchone()["id"]

                cur.execute(
                    """
                    UPDATE stock_transfers
                    SET status='posted',
                        transfer_date=%s,
                        posted_by_user_id=%s,
                        posted_at=now(),
                        updated_at=now()
                    WHERE company_id=%s AND id=%s
                    """,
                    (move_date, user["user_id"], company_id, transfer_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_transfer_posted', 'stock_transfer', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], transfer_id, json.dumps({"out_move_id": str(out_move_id) if out_move_id else None, "in_move_id": str(in_move_id) if in_move_id else None, "warnings": warnings[:50]})),
                )
                return {"ok": True, "warnings": warnings}


class CancelIn(BaseModel):
    reason: Optional[str] = None


@router.post("/{transfer_id}/cancel", dependencies=[Depends(require_permission("inventory:write"))])
def cancel_transfer(transfer_id: str, data: CancelIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    reason = (data.reason or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT status
                    FROM stock_transfers
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, transfer_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="transfer not found")
                if row["status"] == "canceled":
                    return {"ok": True}
                if row["status"] == "posted":
                    raise HTTPException(status_code=409, detail="posted transfers cannot be canceled in v1")
                cur.execute(
                    """
                    UPDATE stock_transfers
                    SET status='canceled',
                        canceled_by_user_id=%s,
                        canceled_at=now(),
                        cancel_reason=%s,
                        updated_at=now()
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], reason, company_id, transfer_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_transfer_canceled', 'stock_transfer', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], transfer_id, json.dumps({"reason": reason})),
                )
                return {"ok": True}


class ReverseDraftIn(BaseModel):
    reason: Optional[str] = None


@router.post("/{transfer_id}/reverse-draft", dependencies=[Depends(require_permission("inventory:write"))])
def create_reverse_draft(
    transfer_id: str,
    data: ReverseDraftIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Create a reversal transfer draft for a posted transfer (v1).
    The reversal draft swaps from/to warehouses (and locations if available) and copies moved quantities.
    User can pick/post the reversal as a normal transfer (safer than mutating the posted document).
    """
    reason = (data.reason or "").strip()
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, transfer_no, status,
                           from_warehouse_id, to_warehouse_id,
                           from_location_id, to_location_id,
                           memo
                    FROM stock_transfers
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, transfer_id),
                )
                doc = cur.fetchone()
                if not doc:
                    raise HTTPException(status_code=404, detail="transfer not found")
                if doc["status"] != "posted":
                    raise HTTPException(status_code=409, detail="only posted transfers can be reversed")

                cur.execute(
                    """
                    SELECT item_id, qty, picked_qty, notes
                    FROM stock_transfer_lines
                    WHERE company_id=%s AND stock_transfer_id=%s
                    ORDER BY line_no ASC
                    """,
                    (company_id, transfer_id),
                )
                lines = cur.fetchall() or []
                if not lines:
                    raise HTTPException(status_code=400, detail="transfer has no lines")

                no = _next_doc_no(cur, company_id)
                memo = f"Reversal of {doc['transfer_no']}"
                if reason:
                    memo += f": {reason}"

                cur.execute(
                    """
                    INSERT INTO stock_transfers
                      (id, company_id, transfer_no, status, from_warehouse_id, to_warehouse_id,
                       from_location_id, to_location_id, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'draft', %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        no,
                        doc["to_warehouse_id"],
                        doc["from_warehouse_id"],
                        doc.get("to_location_id"),
                        doc.get("from_location_id"),
                        memo,
                        user["user_id"],
                    ),
                )
                new_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    SELECT id, unit_of_measure
                    FROM items
                    WHERE company_id=%s AND id = ANY(%s::uuid[])
                    """,
                    (company_id, sorted({str(ln.get("item_id")) for ln in (lines or []) if ln.get("item_id")})),
                )
                uom_by_item = {str(r["id"]): (r.get("unit_of_measure") or "") for r in cur.fetchall()}
                for idx, ln in enumerate(lines, start=1):
                    q = Decimal(str(ln.get("picked_qty") or 0)) or Decimal(str(ln.get("qty") or 0))
                    if q <= 0:
                        continue
                    base_uom = (uom_by_item.get(str(ln.get("item_id"))) or "").strip() or None
                    cur.execute(
                        """
                        INSERT INTO stock_transfer_lines
                          (id, company_id, stock_transfer_id, line_no, item_id, qty,
                           uom, qty_factor, qty_entered,
                           picked_qty, notes)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s,
                           %s, 1, %s,
                           0, %s)
                        """,
                        (company_id, new_id, idx, ln["item_id"], q, base_uom, q, (ln.get("notes") or "").strip() or None),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'stock_transfer_reverse_draft_created', 'stock_transfer', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], new_id, json.dumps({"reverses_transfer_id": str(transfer_id), "reverses_transfer_no": doc["transfer_no"]})),
                )
                return {"id": new_id, "transfer_no": no}
