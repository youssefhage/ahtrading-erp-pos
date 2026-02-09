from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Literal
from decimal import Decimal
from datetime import date
import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission
from ..period_locks import assert_period_open
from ..journal_utils import q_usd, q_lbp, auto_balance_journal
from ..validation import RateType

router = APIRouter(prefix="/purchases/credits", tags=["purchases"])

def _clamp01(x: Decimal) -> Decimal:
    if x <= 0:
        return Decimal("0")
    if x >= 1:
        return Decimal("1")
    return x


def _next_doc_no(cur, company_id: str) -> str:
    cur.execute("SELECT next_document_no(%s, %s) AS doc_no", (company_id, "SC"))
    return cur.fetchone()["doc_no"]


def _default_exchange_rate(cur, company_id: str) -> Decimal:
    cur.execute(
        """
        SELECT usd_to_lbp
        FROM exchange_rates
        WHERE company_id = %s
        ORDER BY rate_date DESC, created_at DESC
        LIMIT 1
        """,
        (company_id,),
    )
    r = cur.fetchone()
    if r and r.get("usd_to_lbp") is not None:
        try:
            ex = Decimal(str(r["usd_to_lbp"] or 0))
            if ex > 0:
                return ex
        except Exception:
            pass
    return Decimal("90000")


def _normalize_dual_amounts(usd: Decimal, lbp: Decimal, exchange_rate: Decimal) -> tuple[Decimal, Decimal]:
    if exchange_rate and exchange_rate != 0:
        if usd == 0 and lbp != 0:
            usd = lbp / exchange_rate
        elif lbp == 0 and usd != 0:
            lbp = usd * exchange_rate
    return usd, lbp


class CreditLineIn(BaseModel):
    description: Optional[str] = None
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")


class CreditDraftIn(BaseModel):
    supplier_id: str
    kind: Literal["expense", "receipt"] = "expense"
    goods_receipt_id: Optional[str] = None
    credit_date: Optional[date] = None
    rate_type: RateType = "market"
    exchange_rate: Optional[Decimal] = None
    memo: Optional[str] = None
    lines: List[CreditLineIn]


class CreditDraftUpdateIn(BaseModel):
    kind: Optional[Literal["expense", "receipt"]] = None
    goods_receipt_id: Optional[str] = None
    credit_date: Optional[date] = None
    rate_type: Optional[RateType] = None
    exchange_rate: Optional[Decimal] = None
    memo: Optional[str] = None
    lines: Optional[List[CreditLineIn]] = None


class ApplyIn(BaseModel):
    supplier_invoice_id: str
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")


@router.get("", dependencies=[Depends(require_permission("purchases:read"))])
def list_supplier_credits(
    q: str = Query("", description="Search credit no / memo"),
    status: str = Query("", description="draft|posted|canceled"),
    supplier_id: str = Query("", description="Filter by supplier id"),
    limit: int = Query(200, ge=1, le=1000),
    company_id: str = Depends(get_company_id),
):
    qq = (q or "").strip()
    st = (status or "").strip().lower()
    if st and st not in {"draft", "posted", "canceled"}:
        raise HTTPException(status_code=400, detail="invalid status")
    sid = (supplier_id or "").strip()

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT c.id, c.credit_no, c.status, c.kind,
                       c.supplier_id, s.name AS supplier_name,
                       c.goods_receipt_id, gr.id AS goods_receipt_id,
                       gr.status AS goods_receipt_status,
                       c.credit_date, c.total_usd, c.total_lbp,
                       COALESCE(app.applied_usd, 0) AS applied_usd,
                       COALESCE(app.applied_lbp, 0) AS applied_lbp,
                       (c.total_usd - COALESCE(app.applied_usd, 0)) AS remaining_usd,
                       (c.total_lbp - COALESCE(app.applied_lbp, 0)) AS remaining_lbp,
                       c.created_at, c.posted_at
                FROM supplier_credit_notes c
                LEFT JOIN suppliers s ON s.id = c.supplier_id
                LEFT JOIN goods_receipts gr ON gr.id = c.goods_receipt_id
                LEFT JOIN (
                  SELECT supplier_credit_note_id,
                         SUM(amount_usd) AS applied_usd,
                         SUM(amount_lbp) AS applied_lbp
                  FROM supplier_credit_note_applications
                  WHERE company_id=%s
                  GROUP BY supplier_credit_note_id
                ) app ON app.supplier_credit_note_id = c.id
                WHERE c.company_id=%s
            """
            params: list = [company_id, company_id]
            if st:
                sql += " AND c.status=%s"
                params.append(st)
            if sid:
                sql += " AND c.supplier_id=%s"
                params.append(sid)
            if qq:
                sql += " AND (c.credit_no ILIKE %s OR COALESCE(c.memo,'') ILIKE %s)"
                like = f"%{qq}%"
                params.extend([like, like])
            sql += " ORDER BY c.created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"credits": cur.fetchall()}


@router.get("/{credit_id}", dependencies=[Depends(require_permission("purchases:read"))])
def get_supplier_credit(credit_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.*, s.name AS supplier_name, gr.receipt_no AS goods_receipt_no
                FROM supplier_credit_notes c
                LEFT JOIN suppliers s ON s.id = c.supplier_id
                LEFT JOIN goods_receipts gr ON gr.id = c.goods_receipt_id
                WHERE c.company_id=%s AND c.id=%s
                """,
                (company_id, credit_id),
            )
            doc = cur.fetchone()
            if not doc:
                raise HTTPException(status_code=404, detail="credit not found")
            cur.execute(
                """
                SELECT id, line_no, description, amount_usd, amount_lbp, created_at
                FROM supplier_credit_note_lines
                WHERE company_id=%s AND supplier_credit_note_id=%s
                ORDER BY line_no ASC
                """,
                (company_id, credit_id),
            )
            lines = cur.fetchall() or []
            cur.execute(
                """
                SELECT a.id, a.supplier_invoice_id, si.invoice_no, si.invoice_date,
                       a.amount_usd, a.amount_lbp, a.created_at
                FROM supplier_credit_note_applications a
                JOIN supplier_invoices si ON si.id = a.supplier_invoice_id
                WHERE a.company_id=%s AND a.supplier_credit_note_id=%s
                ORDER BY a.created_at DESC
                """,
                (company_id, credit_id),
            )
            apps = cur.fetchall() or []
            cur.execute(
                """
                SELECT id, goods_receipt_line_id, batch_id, amount_usd, amount_lbp, created_at
                FROM supplier_credit_note_allocations
                WHERE company_id=%s AND supplier_credit_note_id=%s
                ORDER BY created_at ASC, id ASC
                """,
                (company_id, credit_id),
            )
            allocs = cur.fetchall() or []
            return {"credit": doc, "lines": lines, "applications": apps, "allocations": allocs}


@router.post("/drafts", dependencies=[Depends(require_permission("purchases:write"))])
def create_supplier_credit_draft(data: CreditDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.supplier_id:
        raise HTTPException(status_code=400, detail="supplier_id is required")
    if not data.lines:
        raise HTTPException(status_code=400, detail="at least one line is required")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Validate supplier exists.
                cur.execute("SELECT 1 FROM suppliers WHERE company_id=%s AND id=%s", (company_id, data.supplier_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="supplier not found")

                if data.kind == "receipt" and not (data.goods_receipt_id or "").strip():
                    raise HTTPException(status_code=400, detail="goods_receipt_id is required when kind=receipt")

                ex = Decimal(str(data.exchange_rate or 0))
                if ex <= 0:
                    ex = _default_exchange_rate(cur, company_id)

                total_usd = Decimal("0")
                total_lbp = Decimal("0")
                for ln in data.lines:
                    usd, lbp = _normalize_dual_amounts(Decimal(str(ln.amount_usd or 0)), Decimal(str(ln.amount_lbp or 0)), ex)
                    total_usd += usd
                    total_lbp += lbp

                total_usd = q_usd(total_usd)
                total_lbp = q_lbp(total_lbp)
                if total_usd <= 0 and total_lbp <= 0:
                    raise HTTPException(status_code=400, detail="credit total must be > 0")

                if (data.goods_receipt_id or "").strip():
                    cur.execute(
                        "SELECT id, status, supplier_id FROM goods_receipts WHERE company_id=%s AND id=%s",
                        (company_id, data.goods_receipt_id),
                    )
                    gr = cur.fetchone()
                    if not gr:
                        raise HTTPException(status_code=404, detail="goods receipt not found")
                    if gr.get("status") != "posted":
                        raise HTTPException(status_code=409, detail="goods receipt must be posted")
                    if gr.get("supplier_id") and str(gr.get("supplier_id")) != str(data.supplier_id):
                        raise HTTPException(status_code=400, detail="goods receipt supplier does not match")

                no = _next_doc_no(cur, company_id)
                cdate = data.credit_date or date.today()
                cur.execute(
                    """
                    INSERT INTO supplier_credit_notes
                      (id, company_id, credit_no, status, supplier_id, kind, goods_receipt_id, credit_date,
                       rate_type, exchange_rate, memo, total_usd, total_lbp, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        no,
                        data.supplier_id,
                        data.kind,
                        (data.goods_receipt_id or "").strip() or None,
                        cdate,
                        data.rate_type,
                        ex,
                        (data.memo or "").strip() or None,
                        total_usd,
                        total_lbp,
                        user["user_id"],
                    ),
                )
                cid = cur.fetchone()["id"]
                for idx, ln in enumerate(data.lines, start=1):
                    usd, lbp = _normalize_dual_amounts(Decimal(str(ln.amount_usd or 0)), Decimal(str(ln.amount_lbp or 0)), ex)
                    usd = q_usd(usd)
                    lbp = q_lbp(lbp)
                    if usd == 0 and lbp == 0:
                        continue
                    cur.execute(
                        """
                        INSERT INTO supplier_credit_note_lines
                          (id, company_id, supplier_credit_note_id, line_no, description, amount_usd, amount_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                        """,
                        (company_id, cid, idx, (ln.description or "").strip() or None, usd, lbp),
                    )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_credit_draft_created', 'supplier_credit', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], cid, json.dumps({"credit_no": no, "kind": data.kind})),
                )
                return {"id": cid, "credit_no": no}


@router.patch("/{credit_id}/draft", dependencies=[Depends(require_permission("purchases:write"))])
def update_supplier_credit_draft(credit_id: str, data: CreditDraftUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, supplier_id
                    FROM supplier_credit_notes
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, credit_id),
                )
                doc = cur.fetchone()
                if not doc:
                    raise HTTPException(status_code=404, detail="credit not found")
                if doc["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft credits can be edited")

                kind = patch.get("kind")
                gr_id = (patch.get("goods_receipt_id") or "").strip() or None if "goods_receipt_id" in patch else None
                if kind == "receipt" and not (gr_id or patch.get("goods_receipt_id") or "").strip():
                    raise HTTPException(status_code=400, detail="goods_receipt_id is required when kind=receipt")

                if gr_id:
                    cur.execute(
                        "SELECT id, status, supplier_id FROM goods_receipts WHERE company_id=%s AND id=%s",
                        (company_id, gr_id),
                    )
                    gr = cur.fetchone()
                    if not gr:
                        raise HTTPException(status_code=404, detail="goods receipt not found")
                    if gr.get("status") != "posted":
                        raise HTTPException(status_code=409, detail="goods receipt must be posted")
                    if gr.get("supplier_id") and str(gr.get("supplier_id")) != str(doc["supplier_id"]):
                        raise HTTPException(status_code=400, detail="goods receipt supplier does not match")

                # Rate.
                ex = patch.get("exchange_rate")
                if ex is None:
                    cur.execute("SELECT exchange_rate FROM supplier_credit_notes WHERE company_id=%s AND id=%s", (company_id, credit_id))
                    r = cur.fetchone()
                    ex = Decimal(str((r or {}).get("exchange_rate") or 0))
                ex = Decimal(str(ex or 0))
                if ex <= 0:
                    ex = _default_exchange_rate(cur, company_id)

                # Update header fields.
                sets = []
                params = []
                for k in ["kind", "goods_receipt_id", "credit_date", "rate_type", "exchange_rate", "memo"]:
                    if k in patch:
                        val = patch.get(k)
                        if k in {"memo"}:
                            val = (val or "").strip() or None
                        if k == "goods_receipt_id":
                            val = (val or "").strip() or None
                        sets.append(f"{k}=%s")
                        params.append(val)
                if sets:
                    params.extend([company_id, credit_id])
                    cur.execute(
                        f"""
                        UPDATE supplier_credit_notes
                        SET {', '.join(sets)}, updated_at=now()
                        WHERE company_id=%s AND id=%s
                        """,
                        params,
                    )

                # Replace lines if provided.
                if "lines" in patch:
                    lines = patch.get("lines") or []
                    if not lines:
                        raise HTTPException(status_code=400, detail="lines cannot be empty")
                    cur.execute(
                        "DELETE FROM supplier_credit_note_lines WHERE company_id=%s AND supplier_credit_note_id=%s",
                        (company_id, credit_id),
                    )
                    total_usd = Decimal("0")
                    total_lbp = Decimal("0")
                    for idx, ln in enumerate(lines, start=1):
                        usd, lbp = _normalize_dual_amounts(Decimal(str(ln.get("amount_usd") or 0)), Decimal(str(ln.get("amount_lbp") or 0)), ex)
                        usd = q_usd(usd)
                        lbp = q_lbp(lbp)
                        if usd == 0 and lbp == 0:
                            continue
                        total_usd += usd
                        total_lbp += lbp
                        cur.execute(
                            """
                            INSERT INTO supplier_credit_note_lines
                              (id, company_id, supplier_credit_note_id, line_no, description, amount_usd, amount_lbp)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                            """,
                            (company_id, credit_id, idx, (ln.get("description") or "").strip() or None, usd, lbp),
                        )
                    total_usd = q_usd(total_usd)
                    total_lbp = q_lbp(total_lbp)
                    if total_usd <= 0 and total_lbp <= 0:
                        raise HTTPException(status_code=400, detail="credit total must be > 0")
                    cur.execute(
                        """
                        UPDATE supplier_credit_notes
                        SET total_usd=%s, total_lbp=%s, exchange_rate=%s, updated_at=now()
                        WHERE company_id=%s AND id=%s
                        """,
                        (total_usd, total_lbp, ex, company_id, credit_id),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_credit_draft_updated', 'supplier_credit', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], credit_id, json.dumps({"updated": sorted(patch.keys())})),
                )
                return {"ok": True}


@router.post("/{credit_id}/post", dependencies=[Depends(require_permission("purchases:write"))])
def post_supplier_credit(credit_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT *
                    FROM supplier_credit_notes
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, credit_id),
                )
                doc = cur.fetchone()
                if not doc:
                    raise HTTPException(status_code=404, detail="credit not found")
                if doc["status"] == "posted":
                    return {"ok": True}
                if doc["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft credits can be posted")

                cdate = doc.get("credit_date") or date.today()
                assert_period_open(cur, company_id, cdate)

                total_usd = q_usd(Decimal(str(doc.get("total_usd") or 0)))
                total_lbp = q_lbp(Decimal(str(doc.get("total_lbp") or 0)))
                if total_usd <= 0 and total_lbp <= 0:
                    raise HTTPException(status_code=400, detail="credit total must be > 0")

                ex = Decimal(str(doc.get("exchange_rate") or 0))
                if ex <= 0:
                    ex = _default_exchange_rate(cur, company_id)

                # Resolve account defaults.
                cur.execute(
                    """
                    SELECT role_code, account_id
                    FROM company_account_defaults
                    WHERE company_id=%s
                    """,
                    (company_id,),
                )
                defaults = {r["role_code"]: str(r["account_id"]) for r in cur.fetchall()}
                ap = defaults.get("AP")
                purchases_exp = defaults.get("PURCHASES_EXPENSE")
                purchase_rebates = defaults.get("PURCHASE_REBATES")
                inventory = defaults.get("INVENTORY")
                cogs = defaults.get("COGS")
                if not ap:
                    raise HTTPException(status_code=400, detail="Missing AP account default")
                if doc.get("kind") == "receipt":
                    if not (inventory and cogs):
                        raise HTTPException(status_code=400, detail="Missing INVENTORY/COGS account defaults")
                else:
                    if not purchases_exp:
                        raise HTTPException(status_code=400, detail="Missing PURCHASES_EXPENSE account default")

                if doc.get("kind") == "receipt":
                    gr_id = doc.get("goods_receipt_id")
                    if not gr_id:
                        raise HTTPException(status_code=400, detail="goods_receipt_id is required for receipt credits")
                    cur.execute(
                        "SELECT id, status, supplier_id, warehouse_id FROM goods_receipts WHERE company_id=%s AND id=%s",
                        (company_id, gr_id),
                    )
                    gr = cur.fetchone()
                    if not gr:
                        raise HTTPException(status_code=404, detail="goods receipt not found")
                    if gr.get("status") != "posted":
                        raise HTTPException(status_code=409, detail="goods receipt must be posted")
                    if gr.get("supplier_id") and str(gr.get("supplier_id")) != str(doc.get("supplier_id")):
                        raise HTTPException(status_code=400, detail="goods receipt supplier does not match")

                # Create journal.
                cur.execute("SELECT next_document_no(%s,%s) AS doc_no", (company_id, "SCJ"))
                jno = cur.fetchone()["doc_no"]
                memo = f"Supplier credit {doc['credit_no']}" + (f" ({doc.get('memo')})" if doc.get("memo") else "")
                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type,
                       exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'supplier_credit_note', %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, jno, credit_id, cdate, doc.get("rate_type") or "market", ex, memo[:240], user["user_id"]),
                )
                journal_id = cur.fetchone()["id"]

                # Optional allocation for receipt-linked rebates (per batch cost tracking).
                warnings: list[str] = []
                inv_credit_total_usd = Decimal("0")
                inv_credit_total_lbp = Decimal("0")
                inv_by_item: dict[str, tuple[Decimal, Decimal]] = {}

                if doc.get("kind") == "receipt":
                    gr_id = str(doc.get("goods_receipt_id"))
                    warehouse_id = str(gr.get("warehouse_id") or "")
                    if not warehouse_id:
                        raise HTTPException(status_code=400, detail="goods receipt missing warehouse_id")
                    cur.execute(
                        """
                        SELECT id, item_id, qty, unit_cost_usd, unit_cost_lbp, batch_id
                        FROM goods_receipt_lines
                        WHERE company_id=%s AND goods_receipt_id=%s
                        ORDER BY id
                        """,
                        (company_id, gr_id),
                    )
                    gr_lines = cur.fetchall() or []
                    if not gr_lines:
                        warnings.append("goods receipt has no lines; allocation skipped")
                    else:
                        # Prefetch batch on-hand per line for inventory/COGS split (best-effort).
                        batch_ids = [l.get("batch_id") for l in gr_lines if l.get("batch_id")]
                        batch_on_hand: dict[str, Decimal] = {}
                        if batch_ids:
                            cur.execute(
                                """
                                SELECT batch_id, GREATEST(COALESCE(SUM(qty_in) - SUM(qty_out), 0), 0) AS qty_on_hand
                                FROM stock_moves
                                WHERE company_id=%s AND warehouse_id=%s AND batch_id = ANY(%s)
                                GROUP BY batch_id
                                """,
                                (company_id, warehouse_id, batch_ids),
                            )
                            for rr in cur.fetchall() or []:
                                batch_on_hand[str(rr["batch_id"])] = Decimal(str(rr.get("qty_on_hand") or 0))

                        item_ids = sorted({str(l.get("item_id")) for l in gr_lines if l.get("item_id")})
                        item_on_hand: dict[str, Decimal] = {}
                        if item_ids:
                            cur.execute(
                                """
                                SELECT item_id, COALESCE(on_hand_qty, 0) AS on_hand_qty
                                FROM item_warehouse_costs
                                WHERE company_id=%s AND warehouse_id=%s AND item_id = ANY(%s)
                                """,
                                (company_id, warehouse_id, item_ids),
                            )
                            for rr in cur.fetchall() or []:
                                item_on_hand[str(rr["item_id"])] = Decimal(str(rr.get("on_hand_qty") or 0))

                        base_usd = Decimal("0")
                        base_lbp = Decimal("0")
                        total_qty = Decimal("0")
                        for l in gr_lines:
                            qty = Decimal(str(l.get("qty") or 0))
                            total_qty += qty
                            base_usd += qty * Decimal(str(l.get("unit_cost_usd") or 0))
                            base_lbp += qty * Decimal(str(l.get("unit_cost_lbp") or 0))

                        denom_usd = base_usd if base_usd > 0 else (total_qty if total_qty > 0 else Decimal("1"))
                        denom_lbp = base_lbp if base_lbp > 0 else (total_qty if total_qty > 0 else Decimal("1"))

                        # Clean any old allocations (draft->post is one-time, but keep idempotent).
                        cur.execute(
                            "DELETE FROM supplier_credit_note_allocations WHERE company_id=%s AND supplier_credit_note_id=%s",
                            (company_id, credit_id),
                        )

                        for l in gr_lines:
                            qty = Decimal(str(l.get("qty") or 0))
                            if qty <= 0:
                                continue
                            w_usd = (qty * Decimal(str(l.get("unit_cost_usd") or 0))) if base_usd > 0 else qty
                            w_lbp = (qty * Decimal(str(l.get("unit_cost_lbp") or 0))) if base_lbp > 0 else qty
                            alloc_usd = q_usd(total_usd * (w_usd / denom_usd)) if total_usd != 0 else Decimal("0")
                            alloc_lbp = q_lbp(total_lbp * (w_lbp / denom_lbp)) if total_lbp != 0 else Decimal("0")

                            # Split allocation between inventory (still on-hand) vs COGS (already sold/consumed).
                            item_id = str(l.get("item_id") or "")
                            b_id = l.get("batch_id")
                            remaining_qty = Decimal("0")
                            if b_id:
                                remaining_qty = batch_on_hand.get(str(b_id), Decimal("0"))
                            elif item_id:
                                remaining_qty = item_on_hand.get(item_id, Decimal("0"))
                                warnings.append(f"goods receipt line {l['id']} has no batch_id; inventory/COGS split uses item on_hand")

                            ratio = _clamp01((remaining_qty / qty) if qty else Decimal("0"))
                            inv_usd = q_usd(alloc_usd * ratio) if alloc_usd else Decimal("0")
                            inv_lbp = q_lbp(alloc_lbp * ratio) if alloc_lbp else Decimal("0")
                            inv_credit_total_usd += inv_usd
                            inv_credit_total_lbp += inv_lbp
                            if item_id:
                                prev = inv_by_item.get(item_id) or (Decimal("0"), Decimal("0"))
                                inv_by_item[item_id] = (prev[0] + inv_usd, prev[1] + inv_lbp)

                            cur.execute(
                                """
                                INSERT INTO supplier_credit_note_allocations
                                  (id, company_id, supplier_credit_note_id, goods_receipt_line_id, batch_id, amount_usd, amount_lbp)
                                VALUES
                                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                                """,
                                (company_id, credit_id, l["id"], l.get("batch_id"), alloc_usd, alloc_lbp),
                            )
                            # Update totals for reporting.
                            cur.execute(
                                """
                                UPDATE goods_receipt_lines
                                SET rebate_total_usd = rebate_total_usd + %s,
                                    rebate_total_lbp = rebate_total_lbp + %s
                                WHERE company_id=%s AND id=%s
                                """,
                                (alloc_usd, alloc_lbp, company_id, l["id"]),
                            )
                            if l.get("batch_id"):
                                cur.execute(
                                    """
                                    UPDATE batch_cost_layers
                                    SET rebate_total_usd = rebate_total_usd + %s,
                                        rebate_total_lbp = rebate_total_lbp + %s
                                    WHERE company_id=%s
                                      AND batch_id=%s
                                      AND source_type='goods_receipt'
                                      AND source_id=%s
                                      AND source_line_id=%s
                                    """,
                                    (alloc_usd, alloc_lbp, company_id, l["batch_id"], gr_id, l["id"]),
                                )
                                if cur.rowcount == 0:
                                    warnings.append(f"missing batch_cost_layer for goods receipt line {l['id']}")
                            else:
                                warnings.append(f"goods receipt line {l['id']} has no batch_id; cost-layer rebate update skipped")

                # GL posting:
                # - Expense credit: Dr AP, Cr PURCHASE_REBATES (if configured) else PURCHASES_EXPENSE
                # - Receipt-linked credit: Dr AP, Cr INVENTORY (for on-hand portion), Cr COGS (for sold portion)
                if doc.get("kind") == "receipt":
                    # Any rounding leftovers are pushed into COGS so the journal stays coherent.
                    inv_usd = q_usd(inv_credit_total_usd)
                    inv_lbp = q_lbp(inv_credit_total_lbp)
                    cogs_usd = q_usd(total_usd - inv_usd)
                    cogs_lbp = q_lbp(total_lbp - inv_lbp)

                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, %s)
                        """,
                        (journal_id, ap, total_usd, total_lbp, "AP (supplier credit note)"),
                    )
                    if inv_usd != 0 or inv_lbp != 0:
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory rebate', %s)
                            """,
                            (journal_id, inventory, inv_usd, inv_lbp, gr.get("warehouse_id")),
                        )
                    if cogs_usd != 0 or cogs_lbp != 0:
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'COGS rebate (sold portion)', %s)
                            """,
                            (journal_id, cogs, cogs_usd, cogs_lbp, gr.get("warehouse_id")),
                        )
                else:
                    credit_account = purchase_rebates or purchases_exp
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, %s)
                        """,
                        (journal_id, ap, total_usd, total_lbp, "AP (supplier credit note)"),
                    )
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, %s)
                        """,
                        (journal_id, credit_account, total_usd, total_lbp, "Purchase rebate/credit"),
                    )

                try:
                    auto_balance_journal(cur, company_id, journal_id, memo="Rounding (credit note auto-balance)")
                except ValueError as exv:
                    raise HTTPException(status_code=400, detail=str(exv))

                # Best-effort reversible avg-cost adjustment for the inventory portion (receipt-linked credits only).
                if doc.get("kind") == "receipt" and inv_by_item:
                    # Ensure idempotency within the transaction.
                    cur.execute(
                        """
                        DELETE FROM inventory_cost_adjustments
                        WHERE company_id=%s AND source_type='supplier_credit_note' AND source_id=%s
                        """,
                        (company_id, credit_id),
                    )
                    warehouse_id = str(gr.get("warehouse_id"))
                    for item_id, (inv_usd, inv_lbp) in inv_by_item.items():
                        inv_usd = q_usd(inv_usd)
                        inv_lbp = q_lbp(inv_lbp)
                        if inv_usd == 0 and inv_lbp == 0:
                            continue
                        cur.execute(
                            """
                            SELECT on_hand_qty
                            FROM item_warehouse_costs
                            WHERE company_id=%s AND item_id=%s AND warehouse_id=%s
                            """,
                            (company_id, item_id, warehouse_id),
                        )
                        c = cur.fetchone() or {}
                        on_hand = Decimal(str(c.get("on_hand_qty") or 0))
                        if on_hand <= 0:
                            warnings.append(f"avg cost not adjusted for item {item_id} (on_hand {on_hand})")
                            continue
                        delta_usd = (inv_usd / on_hand).quantize(Decimal("0.000001"))
                        delta_lbp = (inv_lbp / on_hand).quantize(Decimal("0.000001"))
                        cur.execute(
                            """
                            UPDATE item_warehouse_costs
                            SET avg_cost_usd = GREATEST(avg_cost_usd - %s, 0),
                                avg_cost_lbp = GREATEST(avg_cost_lbp - %s, 0),
                                updated_at = now()
                            WHERE company_id=%s AND item_id=%s AND warehouse_id=%s
                            """,
                            (delta_usd, delta_lbp, company_id, item_id, warehouse_id),
                        )
                        cur.execute(
                            """
                            INSERT INTO inventory_cost_adjustments
                              (id, company_id, source_type, source_id, item_id, warehouse_id, delta_avg_cost_usd, delta_avg_cost_lbp)
                            VALUES
                              (gen_random_uuid(), %s, 'supplier_credit_note', %s, %s, %s, %s, %s)
                            """,
                            (company_id, credit_id, item_id, warehouse_id, delta_usd, delta_lbp),
                        )

                cur.execute(
                    """
                    UPDATE supplier_credit_notes
                    SET status='posted',
                        posted_by_user_id=%s,
                        posted_at=now(),
                        exchange_rate=%s,
                        updated_at=now()
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], ex, company_id, credit_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_credit_posted', 'supplier_credit', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], credit_id, json.dumps({"journal_id": str(journal_id), "warnings": warnings[:50]})),
                )
                return {"ok": True, "journal_id": journal_id, "warnings": warnings}


class CancelIn(BaseModel):
    cancel_date: Optional[date] = None
    reason: Optional[str] = None


def _safe_journal_no(prefix: str, base: str) -> str:
    base = (base or "").strip().replace(" ", "-")
    base = "".join([c for c in base if c.isalnum() or c in {"-", "_"}])[:40]
    import uuid as _uuid

    return f"{prefix}-{base}-{_uuid.uuid4().hex[:6]}"


def _reverse_gl_journal(cur, company_id: str, source_type: str, source_id: str, cancel_source_type: str, cancel_date: date, user_id: str, memo: str):
    cur.execute(
        """
        SELECT id, journal_no, rate_type, exchange_rate, memo
        FROM gl_journals
        WHERE company_id = %s AND source_type = %s AND source_id = %s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (company_id, source_type, source_id),
    )
    orig = cur.fetchone()
    if not orig:
        raise HTTPException(status_code=400, detail=f"missing GL journal for {source_type}")

    cur.execute(
        """
        SELECT id
        FROM gl_journals
        WHERE company_id = %s AND source_type = %s AND source_id = %s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (company_id, cancel_source_type, source_id),
    )
    existing = cur.fetchone()
    if existing:
        return existing["id"]

    journal_no = _safe_journal_no("VOID", orig["journal_no"])
    cur.execute(
        """
        INSERT INTO gl_journals
          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
        VALUES
          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            company_id,
            journal_no,
            cancel_source_type,
            source_id,
            cancel_date,
            orig["rate_type"],
            orig.get("exchange_rate") or 0,
            memo,
            user_id,
        ),
    )
    jid = cur.fetchone()["id"]

    cur.execute("SELECT account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo FROM gl_entries WHERE journal_id=%s", (orig["id"],))
    for e in cur.fetchall() or []:
        cur.execute(
            """
            INSERT INTO gl_entries
              (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                jid,
                e["account_id"],
                e.get("credit_usd") or 0,
                e.get("debit_usd") or 0,
                e.get("credit_lbp") or 0,
                e.get("debit_lbp") or 0,
                e.get("memo"),
            ),
        )
    try:
        auto_balance_journal(cur, company_id, jid, memo="Rounding (void auto-balance)")
    except ValueError:
        pass
    return jid


@router.post("/{credit_id}/cancel", dependencies=[Depends(require_permission("purchases:write"))])
def cancel_supplier_credit(credit_id: str, data: CancelIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    cancel_date = data.cancel_date or date.today()
    reason = (data.reason or "").strip() or None

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, cancel_date)
                cur.execute(
                    """
                    SELECT id, credit_no, status, kind
                    FROM supplier_credit_notes
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, credit_id),
                )
                doc = cur.fetchone()
                if not doc:
                    raise HTTPException(status_code=404, detail="credit not found")
                if doc["status"] == "canceled":
                    return {"ok": True}
                if doc["status"] != "posted":
                    raise HTTPException(status_code=400, detail="only posted credits can be canceled")

                # Disallow cancel when applied to invoices (v1). Require unapply (delete applications) first.
                cur.execute(
                    "SELECT 1 FROM supplier_credit_note_applications WHERE company_id=%s AND supplier_credit_note_id=%s LIMIT 1",
                    (company_id, credit_id),
                )
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="cannot cancel a credit note that has applications; unapply first")

                memo = f"Void supplier credit {doc['credit_no']}" + (f" ({reason})" if reason else "")
                void_journal_id = _reverse_gl_journal(
                    cur,
                    company_id,
                    "supplier_credit_note",
                    credit_id,
                    "supplier_credit_note_cancel",
                    cancel_date,
                    user["user_id"],
                    memo,
                )

                # Reverse avg-cost adjustments (best-effort, exact delta reversal).
                cur.execute(
                    """
                    SELECT item_id, warehouse_id, delta_avg_cost_usd, delta_avg_cost_lbp
                    FROM inventory_cost_adjustments
                    WHERE company_id=%s AND source_type='supplier_credit_note' AND source_id=%s
                    """,
                    (company_id, credit_id),
                )
                for adj in cur.fetchall() or []:
                    cur.execute(
                        """
                        UPDATE item_warehouse_costs
                        SET avg_cost_usd = avg_cost_usd + %s,
                            avg_cost_lbp = avg_cost_lbp + %s,
                            updated_at = now()
                        WHERE company_id=%s AND item_id=%s AND warehouse_id=%s
                        """,
                        (
                            Decimal(str(adj.get("delta_avg_cost_usd") or 0)),
                            Decimal(str(adj.get("delta_avg_cost_lbp") or 0)),
                            company_id,
                            adj["item_id"],
                            adj["warehouse_id"],
                        ),
                    )
                cur.execute(
                    """
                    DELETE FROM inventory_cost_adjustments
                    WHERE company_id=%s AND source_type='supplier_credit_note' AND source_id=%s
                    """,
                    (company_id, credit_id),
                )

                # Reverse rebate allocations, if any.
                cur.execute(
                    """
                    SELECT goods_receipt_line_id, batch_id, amount_usd, amount_lbp
                    FROM supplier_credit_note_allocations
                    WHERE company_id=%s AND supplier_credit_note_id=%s
                    """,
                    (company_id, credit_id),
                )
                for a in cur.fetchall() or []:
                    cur.execute(
                        """
                        UPDATE goods_receipt_lines
                        SET rebate_total_usd = rebate_total_usd - %s,
                            rebate_total_lbp = rebate_total_lbp - %s
                        WHERE company_id=%s AND id=%s
                        """,
                        (Decimal(str(a.get("amount_usd") or 0)), Decimal(str(a.get("amount_lbp") or 0)), company_id, a["goods_receipt_line_id"]),
                    )
                    if a.get("batch_id"):
                        cur.execute(
                            """
                            UPDATE batch_cost_layers
                            SET rebate_total_usd = rebate_total_usd - %s,
                                rebate_total_lbp = rebate_total_lbp - %s
                            WHERE company_id=%s AND batch_id=%s
                            """,
                            (Decimal(str(a.get("amount_usd") or 0)), Decimal(str(a.get("amount_lbp") or 0)), company_id, a["batch_id"]),
                        )
                cur.execute(
                    "DELETE FROM supplier_credit_note_allocations WHERE company_id=%s AND supplier_credit_note_id=%s",
                    (company_id, credit_id),
                )

                cur.execute(
                    """
                    UPDATE supplier_credit_notes
                    SET status='canceled',
                        canceled_at=now(),
                        canceled_by_user_id=%s,
                        cancel_reason=%s,
                        updated_at=now()
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], reason, company_id, credit_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_credit_canceled', 'supplier_credit', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], credit_id, json.dumps({"journal_id": str(void_journal_id), "reason": reason})),
                )
                return {"ok": True, "journal_id": void_journal_id}


@router.get("/open-invoices", dependencies=[Depends(require_permission("purchases:read"))])
def list_open_invoices_for_credit(
    supplier_id: str = Query(..., description="Supplier id"),
    q: str = Query("", description="Search invoice no"),
    limit: int = Query(50, ge=1, le=200),
    company_id: str = Depends(get_company_id),
):
    qq = (q or "").strip()
    sid = (supplier_id or "").strip()
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT
                  si.id, si.invoice_no, si.invoice_date, si.due_date,
                  si.total_usd, si.total_lbp,
                  COALESCE(sp.paid_usd, 0) AS paid_usd,
                  COALESCE(sp.paid_lbp, 0) AS paid_lbp,
                  COALESCE(app.credits_applied_usd, 0) AS credits_applied_usd,
                  COALESCE(app.credits_applied_lbp, 0) AS credits_applied_lbp,
                  (si.total_usd - COALESCE(sp.paid_usd, 0) - COALESCE(app.credits_applied_usd, 0)) AS balance_usd,
                  (si.total_lbp - COALESCE(sp.paid_lbp, 0) - COALESCE(app.credits_applied_lbp, 0)) AS balance_lbp
                FROM supplier_invoices si
                LEFT JOIN (
                  SELECT supplier_invoice_id,
                         SUM(amount_usd) AS paid_usd,
                         SUM(amount_lbp) AS paid_lbp
                  FROM supplier_payments
                  GROUP BY supplier_invoice_id
                ) sp ON sp.supplier_invoice_id = si.id
                LEFT JOIN (
                  SELECT supplier_invoice_id,
                         SUM(amount_usd) AS credits_applied_usd,
                         SUM(amount_lbp) AS credits_applied_lbp
                  FROM supplier_credit_note_applications
                  WHERE company_id = %s
                  GROUP BY supplier_invoice_id
                ) app ON app.supplier_invoice_id = si.id
                WHERE si.company_id=%s
                  AND si.status='posted'
                  AND si.supplier_id=%s
            """
            params: list = [company_id, company_id, sid]
            if qq:
                sql += " AND si.invoice_no ILIKE %s"
                params.append(f"%{qq}%")
            sql += """
                GROUP BY si.id, si.invoice_no, si.invoice_date, si.due_date, si.total_usd, si.total_lbp,
                         sp.paid_usd, sp.paid_lbp, app.credits_applied_usd, app.credits_applied_lbp
                HAVING (si.total_usd - COALESCE(sp.paid_usd, 0) - COALESCE(app.credits_applied_usd, 0)) > 0
                    OR (si.total_lbp - COALESCE(sp.paid_lbp, 0) - COALESCE(app.credits_applied_lbp, 0)) > 0
                ORDER BY si.due_date ASC, si.invoice_no ASC
                LIMIT %s
            """
            params.append(limit)
            cur.execute(sql, params)
            return {"invoices": cur.fetchall()}


@router.post("/{credit_id}/apply", dependencies=[Depends(require_permission("purchases:write"))])
def apply_credit_to_invoice(credit_id: str, data: ApplyIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    inv_id = (data.supplier_invoice_id or "").strip()
    if not inv_id:
        raise HTTPException(status_code=400, detail="supplier_invoice_id is required")
    usd_in = Decimal(str(data.amount_usd or 0))
    lbp_in = Decimal(str(data.amount_lbp or 0))
    if usd_in == 0 and lbp_in == 0:
        raise HTTPException(status_code=400, detail="amount_usd or amount_lbp is required")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, supplier_id, exchange_rate, total_usd, total_lbp
                    FROM supplier_credit_notes
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, credit_id),
                )
                cr = cur.fetchone()
                if not cr:
                    raise HTTPException(status_code=404, detail="credit not found")
                if cr["status"] != "posted":
                    raise HTTPException(status_code=400, detail="credit must be posted before applying")

                cur.execute(
                    """
                    SELECT id, status, supplier_id, total_usd, total_lbp, exchange_rate
                    FROM supplier_invoices
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, inv_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="invoice not found")
                if inv["status"] != "posted":
                    raise HTTPException(status_code=400, detail="invoice must be posted to apply credits")
                if inv.get("supplier_id") and str(inv.get("supplier_id")) != str(cr.get("supplier_id")):
                    raise HTTPException(status_code=400, detail="supplier mismatch")

                # Remaining credit.
                cur.execute(
                    """
                    SELECT COALESCE(SUM(amount_usd),0) AS applied_usd, COALESCE(SUM(amount_lbp),0) AS applied_lbp
                    FROM supplier_credit_note_applications
                    WHERE company_id=%s AND supplier_credit_note_id=%s
                    """,
                    (company_id, credit_id),
                )
                applied = cur.fetchone() or {}
                remaining_usd = q_usd(Decimal(str(cr.get("total_usd") or 0)) - Decimal(str(applied.get("applied_usd") or 0)))
                remaining_lbp = q_lbp(Decimal(str(cr.get("total_lbp") or 0)) - Decimal(str(applied.get("applied_lbp") or 0)))

                # Invoice open balance (considering payments + prior credit applications).
                cur.execute(
                    """
                    SELECT COALESCE(SUM(amount_usd),0) AS paid_usd, COALESCE(SUM(amount_lbp),0) AS paid_lbp
                    FROM supplier_payments
                    WHERE supplier_invoice_id=%s
                    """,
                    (inv_id,),
                )
                paid = cur.fetchone() or {}
                cur.execute(
                    """
                    SELECT COALESCE(SUM(amount_usd),0) AS c_usd, COALESCE(SUM(amount_lbp),0) AS c_lbp
                    FROM supplier_credit_note_applications
                    WHERE company_id=%s AND supplier_invoice_id=%s
                    """,
                    (company_id, inv_id),
                )
                inv_cred = cur.fetchone() or {}
                inv_balance_usd = q_usd(Decimal(str(inv.get("total_usd") or 0)) - Decimal(str(paid.get("paid_usd") or 0)) - Decimal(str(inv_cred.get("c_usd") or 0)))
                inv_balance_lbp = q_lbp(Decimal(str(inv.get("total_lbp") or 0)) - Decimal(str(paid.get("paid_lbp") or 0)) - Decimal(str(inv_cred.get("c_lbp") or 0)))

                ex = Decimal(str(cr.get("exchange_rate") or 0))
                if ex <= 0:
                    ex = _default_exchange_rate(cur, company_id)
                usd, lbp = _normalize_dual_amounts(usd_in, lbp_in, ex)
                usd = q_usd(usd)
                lbp = q_lbp(lbp)
                if usd <= 0 and lbp <= 0:
                    raise HTTPException(status_code=400, detail="apply amount must be > 0")

                if usd > remaining_usd + Decimal("0.0001") or lbp > remaining_lbp + Decimal("0.01"):
                    raise HTTPException(status_code=409, detail="apply amount exceeds remaining credit")
                if usd > inv_balance_usd + Decimal("0.0001") or lbp > inv_balance_lbp + Decimal("0.01"):
                    raise HTTPException(status_code=409, detail="apply amount exceeds invoice balance")

                cur.execute(
                    """
                    INSERT INTO supplier_credit_note_applications
                      (id, company_id, supplier_credit_note_id, supplier_invoice_id, amount_usd, amount_lbp, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, credit_id, inv_id, usd, lbp, user["user_id"]),
                )
                app_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_credit_applied', 'supplier_credit', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], credit_id, json.dumps({"application_id": str(app_id), "invoice_id": inv_id, "amount_usd": str(usd), "amount_lbp": str(lbp)})),
                )
                return {"ok": True, "application_id": app_id}
