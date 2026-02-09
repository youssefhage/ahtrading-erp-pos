from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from datetime import date
import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission

router = APIRouter(prefix="/inventory/landed-costs", tags=["inventory"])


def _next_doc_no(cur, company_id: str, doc_type: str) -> str:
    cur.execute("SELECT next_document_no(%s, %s) AS doc_no", (company_id, doc_type))
    return cur.fetchone()["doc_no"]


def _normalize_dual_amounts(usd: Decimal, lbp: Decimal, exchange_rate: Decimal) -> tuple[Decimal, Decimal]:
    if exchange_rate and exchange_rate != 0:
        if usd == 0 and lbp != 0:
            usd = lbp / exchange_rate
        elif lbp == 0 and usd != 0:
            lbp = usd * exchange_rate
    return usd, lbp


class LandedCostLineIn(BaseModel):
    description: Optional[str] = None
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")


class LandedCostDraftIn(BaseModel):
    goods_receipt_id: str
    memo: Optional[str] = None
    exchange_rate: Decimal = Decimal("0")
    lines: List[LandedCostLineIn]


@router.get("", dependencies=[Depends(require_permission("purchases:read"))])
def list_landed_costs(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.id, c.landed_cost_no, c.goods_receipt_id, gr.receipt_no AS goods_receipt_no,
                       c.status, c.memo, c.exchange_rate, c.total_usd, c.total_lbp, c.created_at, c.posted_at
                FROM landed_costs c
                LEFT JOIN goods_receipts gr ON gr.company_id=c.company_id AND gr.id=c.goods_receipt_id
                WHERE c.company_id=%s
                ORDER BY c.created_at DESC
                """,
                (company_id,),
            )
            return {"landed_costs": cur.fetchall()}


@router.get("/{landed_cost_id}", dependencies=[Depends(require_permission("purchases:read"))])
def get_landed_cost(landed_cost_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.*, gr.receipt_no AS goods_receipt_no
                FROM landed_costs c
                LEFT JOIN goods_receipts gr ON gr.company_id=c.company_id AND gr.id=c.goods_receipt_id
                WHERE c.company_id=%s AND c.id=%s
                """,
                (company_id, landed_cost_id),
            )
            doc = cur.fetchone()
            if not doc:
                raise HTTPException(status_code=404, detail="landed cost not found")
            cur.execute(
                """
                SELECT id, description, amount_usd, amount_lbp, created_at
                FROM landed_cost_lines
                WHERE company_id=%s AND landed_cost_id=%s
                ORDER BY created_at ASC
                """,
                (company_id, landed_cost_id),
            )
            return {"landed_cost": doc, "lines": cur.fetchall()}


@router.post("/drafts", dependencies=[Depends(require_permission("purchases:write"))])
def create_landed_cost_draft(data: LandedCostDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.goods_receipt_id:
        raise HTTPException(status_code=400, detail="goods_receipt_id is required")
    if not data.lines:
        raise HTTPException(status_code=400, detail="at least one line is required")

    ex = Decimal(str(data.exchange_rate or 0))
    total_usd = Decimal("0")
    total_lbp = Decimal("0")
    for ln in data.lines:
        usd, lbp = _normalize_dual_amounts(Decimal(str(ln.amount_usd or 0)), Decimal(str(ln.amount_lbp or 0)), ex)
        total_usd += usd
        total_lbp += lbp

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM goods_receipts WHERE company_id=%s AND id=%s", (company_id, data.goods_receipt_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="goods receipt not found")

                no = _next_doc_no(cur, company_id, "LC")
                cur.execute(
                    """
                    INSERT INTO landed_costs
                      (id, company_id, landed_cost_no, goods_receipt_id, status, memo, exchange_rate, total_usd, total_lbp, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, 'draft', %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, no, data.goods_receipt_id, data.memo, ex, total_usd, total_lbp, user["user_id"]),
                )
                doc_id = cur.fetchone()["id"]

                for ln in data.lines:
                    usd, lbp = _normalize_dual_amounts(Decimal(str(ln.amount_usd or 0)), Decimal(str(ln.amount_lbp or 0)), ex)
                    cur.execute(
                        """
                        INSERT INTO landed_cost_lines (id, company_id, landed_cost_id, description, amount_usd, amount_lbp)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                        """,
                        (company_id, doc_id, (ln.description or None), usd, lbp),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'landed_cost_draft_created', 'landed_cost', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], doc_id, json.dumps({"landed_cost_no": no, "total_usd": str(total_usd), "lines": len(data.lines)})),
                )
                return {"id": doc_id, "landed_cost_no": no}


@router.post("/{landed_cost_id}/post", dependencies=[Depends(require_permission("purchases:write"))])
def post_landed_cost(landed_cost_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Allocate landed costs across the batches received on a posted Goods Receipt.

    v1 notes:
    - Updates `batch_cost_layers.landed_cost_total_*` for the goods receipt line cost layers.
    - Best-effort updates `item_warehouse_costs.avg_cost_*` only when the full received qty is still on-hand.
      (This keeps costing roughly correct for early operations without deep retroactive valuation.)
    """
    warnings: list[str] = []
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, goods_receipt_id, status, exchange_rate, total_usd, total_lbp
                    FROM landed_costs
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, landed_cost_id),
                )
                doc = cur.fetchone()
                if not doc:
                    raise HTTPException(status_code=404, detail="landed cost not found")
                if doc["status"] == "posted":
                    return {"ok": True}
                if doc["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft landed costs can be posted")

                cur.execute(
                    """
                    SELECT id, status, warehouse_id
                    FROM goods_receipts
                    WHERE company_id=%s AND id=%s
                    """,
                    (company_id, doc["goods_receipt_id"]),
                )
                gr = cur.fetchone()
                if not gr:
                    raise HTTPException(status_code=404, detail="goods receipt not found")
                if gr.get("status") != "posted":
                    raise HTTPException(status_code=409, detail="goods receipt must be posted before allocating landed costs")

                cur.execute(
                    """
                    SELECT l.id AS goods_receipt_line_id, l.item_id, l.batch_id, l.qty, l.unit_cost_usd, l.unit_cost_lbp
                    FROM goods_receipt_lines l
                    WHERE l.company_id=%s AND l.goods_receipt_id=%s
                    ORDER BY l.id
                    """,
                    (company_id, doc["goods_receipt_id"]),
                )
                gr_lines = cur.fetchall() or []
                if not gr_lines:
                    raise HTTPException(status_code=409, detail="goods receipt has no lines")

                # Compute allocation weights.
                base_usd = Decimal("0")
                base_lbp = Decimal("0")
                for l in gr_lines:
                    qty = Decimal(str(l.get("qty") or 0))
                    base_usd += qty * Decimal(str(l.get("unit_cost_usd") or 0))
                    base_lbp += qty * Decimal(str(l.get("unit_cost_lbp") or 0))
                total_usd = Decimal(str(doc.get("total_usd") or 0))
                total_lbp = Decimal(str(doc.get("total_lbp") or 0))

                if total_usd <= 0 and total_lbp <= 0:
                    raise HTTPException(status_code=400, detail="landed cost total must be > 0")

                # Allocate and apply.
                for l in gr_lines:
                    qty = Decimal(str(l.get("qty") or 0))
                    if qty <= 0:
                        continue
                    w_usd = (qty * Decimal(str(l.get("unit_cost_usd") or 0))) if base_usd > 0 else qty
                    w_lbp = (qty * Decimal(str(l.get("unit_cost_lbp") or 0))) if base_lbp > 0 else qty
                    denom_usd = base_usd if base_usd > 0 else Decimal(str(sum(Decimal(str(x.get("qty") or 0)) for x in gr_lines) or 0) or 1)
                    denom_lbp = base_lbp if base_lbp > 0 else Decimal(str(sum(Decimal(str(x.get("qty") or 0)) for x in gr_lines) or 0) or 1)

                    alloc_usd = (total_usd * (w_usd / denom_usd)) if total_usd > 0 else Decimal("0")
                    alloc_lbp = (total_lbp * (w_lbp / denom_lbp)) if total_lbp > 0 else Decimal("0")

                    # Keep GRN lines in sync for UI/reporting (v1).
                    cur.execute(
                        """
                        UPDATE goods_receipt_lines
                        SET landed_cost_total_usd = COALESCE(landed_cost_total_usd, 0) + %s,
                            landed_cost_total_lbp = COALESCE(landed_cost_total_lbp, 0) + %s
                        WHERE company_id=%s AND goods_receipt_id=%s AND id=%s
                        """,
                        (alloc_usd, alloc_lbp, company_id, doc["goods_receipt_id"], l["goods_receipt_line_id"]),
                    )

                    # Update the cost layer created by goods receipt posting.
                    if not l.get("batch_id"):
                        warnings.append(f"goods receipt line {l['goods_receipt_line_id']} has no batch_id; cost-layer update skipped")
                    else:
                        cur.execute(
                            """
                            UPDATE batch_cost_layers
                            SET landed_cost_total_usd = landed_cost_total_usd + %s,
                                landed_cost_total_lbp = landed_cost_total_lbp + %s
                            WHERE company_id=%s
                              AND batch_id=%s
                              AND source_type='goods_receipt'
                              AND source_id=%s
                              AND source_line_id=%s
                            """,
                            (alloc_usd, alloc_lbp, company_id, l["batch_id"], doc["goods_receipt_id"], l["goods_receipt_line_id"]),
                        )
                        if cur.rowcount == 0:
                            warnings.append(f"missing batch_cost_layer for goods receipt line {l['goods_receipt_line_id']}")

                    # Best-effort: bump avg cost only if the full received qty is still on-hand.
                    cur.execute(
                        """
                        SELECT on_hand_qty, avg_cost_usd, avg_cost_lbp
                        FROM item_warehouse_costs
                        WHERE company_id=%s AND item_id=%s AND warehouse_id=%s
                        """,
                        (company_id, l["item_id"], gr["warehouse_id"]),
                    )
                    c = cur.fetchone() or {}
                    on_hand = Decimal(str(c.get("on_hand_qty") or 0))
                    if on_hand >= qty and on_hand > 0:
                        bump_usd = alloc_usd / qty if qty else Decimal("0")
                        bump_lbp = alloc_lbp / qty if qty else Decimal("0")
                        cur.execute(
                            """
                            UPDATE item_warehouse_costs
                            SET avg_cost_usd = avg_cost_usd + %s,
                                avg_cost_lbp = avg_cost_lbp + %s,
                                updated_at = now()
                            WHERE company_id=%s AND item_id=%s AND warehouse_id=%s
                            """,
                            (bump_usd, bump_lbp, company_id, l["item_id"], gr["warehouse_id"]),
                        )
                    else:
                        warnings.append(f"avg cost not adjusted for item {l['item_id']} (on_hand {on_hand} < received {qty})")

                cur.execute(
                    """
                    UPDATE landed_costs
                    SET status='posted',
                        posted_at=now(),
                        posted_by_user_id=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], company_id, landed_cost_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'landed_cost_posted', 'landed_cost', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], landed_cost_id, json.dumps({"warnings": warnings[:50]})),
                )
                return {"ok": True, "warnings": warnings}


class CancelIn(BaseModel):
    reason: Optional[str] = None


@router.post("/{landed_cost_id}/cancel", dependencies=[Depends(require_permission("purchases:write"))])
def cancel_landed_cost(landed_cost_id: str, data: CancelIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    reason = (data.reason or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT status
                    FROM landed_costs
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, landed_cost_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="landed cost not found")
                if row["status"] == "canceled":
                    return {"ok": True}
                if row["status"] == "posted":
                    raise HTTPException(status_code=409, detail="posted landed costs cannot be canceled in v1 (would require reversing allocations)")
                cur.execute(
                    """
                    UPDATE landed_costs
                    SET status='canceled', canceled_at=now(), canceled_by_user_id=%s, cancel_reason=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], reason, company_id, landed_cost_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'landed_cost_canceled', 'landed_cost', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], landed_cost_id, json.dumps({"reason": reason})),
                )
                return {"ok": True}
