from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import List
from decimal import Decimal
from datetime import datetime, date
import json
from ..db import get_conn, get_admin_conn, set_company_context
from ..deps import get_company_id, require_permission
from ..deps import get_current_user
from ..account_defaults import ensure_company_account_defaults
from ..journal_utils import auto_balance_journal, assert_journal_balanced, fetch_exchange_rate, q_usd, q_lbp

router = APIRouter(prefix="/intercompany", tags=["intercompany"])

def _assert_user_perm_in_company(user_id: str, company_id: str, perm_code: str):
    # Use the admin connection to check roles/permissions across companies regardless of current context.
    with get_admin_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1
                FROM user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE ur.user_id=%s AND ur.company_id=%s AND p.code=%s
                LIMIT 1
                """,
                (user_id, company_id, perm_code),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=403, detail=f"missing permission {perm_code} for company {company_id}")


def _fetch_market_rate(cur, company_id: str) -> Decimal:
    """Fetch current market exchange rate for a company; raise if unavailable."""
    rate, _stale = fetch_exchange_rate(cur, company_id, date.today(), "market")
    if not rate or rate <= 0:
        raise HTTPException(status_code=400, detail=f"No valid exchange rate found for company {company_id}")
    return rate


class IntercompanyLine(BaseModel):
    item_id: str
    qty: Decimal
    unit_cost_usd: Decimal
    unit_cost_lbp: Decimal

    @field_validator("qty")
    @classmethod
    def qty_must_be_positive(cls, v):
        if v is None or v <= 0:
            raise ValueError("qty must be greater than 0")
        return v

    @field_validator("unit_cost_usd", "unit_cost_lbp")
    @classmethod
    def cost_must_be_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("unit cost must be >= 0")
        return v


class IntercompanyIssueIn(BaseModel):
    source_company_id: str
    issue_company_id: str
    sell_company_id: str
    source_invoice_id: str
    warehouse_id: str
    lines: List[IntercompanyLine]


class IntercompanySettleIn(BaseModel):
    from_company_id: str
    to_company_id: str
    amount_usd: Decimal
    amount_lbp: Decimal
    exchange_rate: Decimal
    method: str = "bank"  # cash|bank

    @field_validator("amount_usd", "amount_lbp")
    @classmethod
    def amounts_must_be_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("amount must be greater than 0")
        return v

    @field_validator("exchange_rate")
    @classmethod
    def exchange_rate_must_be_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("exchange_rate must be greater than 0")
        return v


@router.post("/issue", dependencies=[Depends(require_permission("intercompany:write"))])
def intercompany_issue(data: IntercompanyIssueIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    # -- MEDIUM: Self-transfer check --
    if data.issue_company_id == data.sell_company_id:
        raise HTTPException(status_code=400, detail="issue and sell company must differ")

    # -- MEDIUM: Input validation on lines --
    if not data.lines:
        raise HTTPException(status_code=400, detail="at least one line is required")

    # Caller must be operating from one of the involved companies and must have intercompany:write
    # in all companies we will touch.
    if company_id not in {data.source_company_id, data.issue_company_id, data.sell_company_id}:
        raise HTTPException(status_code=403, detail="active company must be one of the involved companies")
    _assert_user_perm_in_company(user["user_id"], data.source_company_id, "intercompany:write")
    _assert_user_perm_in_company(user["user_id"], data.issue_company_id, "intercompany:write")
    _assert_user_perm_in_company(user["user_id"], data.sell_company_id, "intercompany:write")

    total_cost_usd = Decimal("0")
    total_cost_lbp = Decimal("0")
    for l in data.lines:
        total_cost_usd += q_usd(l.qty * l.unit_cost_usd)
        total_cost_lbp += q_lbp(l.qty * l.unit_cost_lbp)

    # -- CRITICAL 1: Wrap ALL operations in a SINGLE admin transaction --
    # Admin conn bypasses RLS so we can operate across companies atomically.
    with get_admin_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                # -- MEDIUM: Company existence validation --
                for cid, label in [
                    (data.source_company_id, "source_company_id"),
                    (data.issue_company_id, "issue_company_id"),
                    (data.sell_company_id, "sell_company_id"),
                ]:
                    cur.execute("SELECT 1 FROM companies WHERE id=%s", (cid,))
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail=f"Company not found: {label}")

                # -- HIGH 2: Warehouse ownership validation --
                cur.execute(
                    "SELECT 1 FROM warehouses WHERE id=%s AND company_id=%s",
                    (data.warehouse_id, data.issue_company_id),
                )
                if not cur.fetchone():
                    raise HTTPException(
                        status_code=400,
                        detail="warehouse_id not found or does not belong to the issue company",
                    )

                # -- HIGH 3: Item existence validation --
                item_ids = sorted({str(l.item_id) for l in data.lines})
                cur.execute(
                    "SELECT id FROM items WHERE company_id=%s AND id = ANY(%s::uuid[])",
                    (data.issue_company_id, item_ids),
                )
                found_items = {str(r["id"]) for r in cur.fetchall()}
                missing_items = [iid for iid in item_ids if iid not in found_items]
                if missing_items:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Items not found in issue company: {', '.join(missing_items[:5])}",
                    )

                # -- HIGH 4: Stock availability validation --
                for l in data.lines:
                    cur.execute(
                        """
                        SELECT COALESCE(SUM(qty_in), 0) - COALESCE(SUM(qty_out), 0) AS available
                        FROM stock_moves
                        WHERE company_id=%s AND item_id=%s AND warehouse_id=%s
                        """,
                        (data.issue_company_id, l.item_id, data.warehouse_id),
                    )
                    row = cur.fetchone()
                    available = Decimal(str(row["available"])) if row else Decimal("0")
                    if available < l.qty:
                        raise HTTPException(
                            status_code=409,
                            detail=f"Insufficient stock for item {l.item_id}: available={available}, requested={l.qty}",
                        )

                # -- MEDIUM: Duplicate transfer detection --
                cur.execute(
                    """
                    SELECT id FROM intercompany_documents
                    WHERE source_company_id=%s AND issue_company_id=%s AND sell_company_id=%s
                      AND source_id=%s AND settlement_status='open'
                      AND created_at > now() - interval '5 minutes'
                    LIMIT 1
                    """,
                    (data.source_company_id, data.issue_company_id, data.sell_company_id, data.source_invoice_id),
                )
                if cur.fetchone():
                    raise HTTPException(
                        status_code=409,
                        detail="A similar intercompany document was created recently; possible duplicate",
                    )

                # -- CRITICAL 2: Fetch actual exchange rate --
                fx_rate = _fetch_market_rate(cur, data.issue_company_id)

                # Create intercompany document
                cur.execute(
                    """
                    INSERT INTO intercompany_documents
                      (id, source_company_id, issue_company_id, sell_company_id, source_type, source_id, settlement_status)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, 'sales_invoice', %s, 'open')
                    RETURNING id
                    """,
                    (
                        data.source_company_id,
                        data.issue_company_id,
                        data.sell_company_id,
                        data.source_invoice_id,
                    ),
                )
                doc_id = cur.fetchone()["id"]

                # ---- Issue company: stock out + intercompany AR ----
                # Stock moves
                for l in data.lines:
                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                           source_type, source_id, created_by_user_id, reason)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, CURRENT_DATE, 'intercompany_issue', %s, %s, %s)
                        """,
                        (
                            data.issue_company_id,
                            l.item_id,
                            data.warehouse_id,
                            l.qty,
                            l.unit_cost_usd,
                            l.unit_cost_lbp,
                            doc_id,
                            user["user_id"],
                            "Intercompany issue",
                        ),
                    )

                # GL posting (issue company)
                defaults = ensure_company_account_defaults(cur, data.issue_company_id, roles=("INTERCO_AR", "INVENTORY", "AR"))
                interco_ar = defaults.get("INTERCO_AR")
                inventory = defaults.get("INVENTORY")
                if not (interco_ar and inventory):
                    raise HTTPException(status_code=400, detail="Missing INTERCO_AR or INVENTORY account defaults")

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type,
                       exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'intercompany_issue', %s, CURRENT_DATE, 'market',
                       %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        data.issue_company_id,
                        f"IC-ISSUE-{str(doc_id)[:8]}",
                        doc_id,
                        fx_rate,
                        f"Intercompany issue {str(doc_id)[:8]}",
                        user["user_id"],
                    ),
                )
                issue_journal_id = cur.fetchone()["id"]

                # Debit intercompany receivable
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Intercompany receivable')
                    """,
                    (issue_journal_id, interco_ar, total_cost_usd, total_cost_lbp),
                )

                # Credit inventory
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory issued', %s)
                    """,
                    (issue_journal_id, inventory, total_cost_usd, total_cost_lbp, data.warehouse_id),
                )

                try:
                    auto_balance_journal(cur, data.issue_company_id, issue_journal_id, warehouse_id=data.warehouse_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
                assert_journal_balanced(cur, issue_journal_id)

                # ---- Sell company: COGS + intercompany AP ----
                # Fetch sell company rate (may differ from issue company)
                fx_rate_sell = _fetch_market_rate(cur, data.sell_company_id)

                defaults = ensure_company_account_defaults(cur, data.sell_company_id, roles=("INTERCO_AP", "COGS", "AP"))
                interco_ap = defaults.get("INTERCO_AP")
                cogs = defaults.get("COGS")
                if not (interco_ap and cogs):
                    raise HTTPException(status_code=400, detail="Missing INTERCO_AP or COGS account defaults")

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type,
                       exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'intercompany_issue', %s, CURRENT_DATE, 'market',
                       %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        data.sell_company_id,
                        f"IC-SELL-{str(doc_id)[:8]}",
                        doc_id,
                        fx_rate_sell,
                        f"Intercompany sell-side COGS {str(doc_id)[:8]}",
                        user["user_id"],
                    ),
                )
                sell_journal_id = cur.fetchone()["id"]

                # Debit COGS
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'COGS (intercompany)')
                    """,
                    (sell_journal_id, cogs, total_cost_usd, total_cost_lbp),
                )

                # Credit intercompany payable
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Intercompany payable')
                    """,
                    (sell_journal_id, interco_ap, total_cost_usd, total_cost_lbp),
                )

                try:
                    auto_balance_journal(cur, data.sell_company_id, sell_journal_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
                assert_journal_balanced(cur, sell_journal_id)

                # -- HIGH 5: Settlement row with journal_id (use sell-side journal) --
                cur.execute(
                    """
                    INSERT INTO intercompany_settlements
                      (id, from_company_id, to_company_id, amount_usd, amount_lbp, exchange_rate, journal_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        data.sell_company_id,
                        data.issue_company_id,
                        total_cost_usd,
                        total_cost_lbp,
                        fx_rate,
                        sell_journal_id,
                    ),
                )

                # -- MEDIUM: Audit trail --
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'intercompany_issue_created', 'intercompany_document', %s, %s::jsonb)
                    """,
                    (
                        data.source_company_id,
                        user["user_id"],
                        doc_id,
                        json.dumps({
                            "issue_company_id": str(data.issue_company_id),
                            "sell_company_id": str(data.sell_company_id),
                            "warehouse_id": str(data.warehouse_id),
                            "total_cost_usd": str(total_cost_usd),
                            "total_cost_lbp": str(total_cost_lbp),
                            "lines": len(data.lines),
                        }),
                    ),
                )

    return {"intercompany_document_id": doc_id}


@router.post("/settle", dependencies=[Depends(require_permission("intercompany:write"))])
def intercompany_settle(data: IntercompanySettleIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    # From company pays to company
    method = (data.method or "bank").lower()
    if method not in {"cash", "bank"}:
        raise HTTPException(status_code=400, detail="method must be cash or bank")

    # -- MEDIUM: Self-transfer check --
    if data.from_company_id == data.to_company_id:
        raise HTTPException(status_code=400, detail="from and to company must differ")

    if company_id not in {data.from_company_id, data.to_company_id}:
        raise HTTPException(status_code=403, detail="active company must be payer or receiver company")
    _assert_user_perm_in_company(user["user_id"], data.from_company_id, "intercompany:write")
    _assert_user_perm_in_company(user["user_id"], data.to_company_id, "intercompany:write")

    # Both payer and receiver journals + settlement record in a single connection/transaction.
    # Use admin conn to bypass RLS for cross-company atomicity.
    with get_admin_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                # -- MEDIUM: Company existence validation --
                for cid, label in [
                    (data.from_company_id, "from_company_id"),
                    (data.to_company_id, "to_company_id"),
                ]:
                    cur.execute("SELECT 1 FROM companies WHERE id=%s", (cid,))
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail=f"Company not found: {label}")

                # -- HIGH 6: FOR UPDATE lock on open settlement documents --
                cur.execute(
                    """
                    SELECT id FROM intercompany_documents
                    WHERE (issue_company_id=%s AND sell_company_id=%s)
                       OR (issue_company_id=%s AND sell_company_id=%s)
                    AND settlement_status='open'
                    FOR UPDATE
                    """,
                    (data.from_company_id, data.to_company_id, data.to_company_id, data.from_company_id),
                )

                # Payer company: Dr Interco AP, Cr Cash/Bank
                defaults = ensure_company_account_defaults(cur, data.from_company_id, roles=("INTERCO_AP", "CASH", "BANK", "AP"))
                interco_ap = defaults.get("INTERCO_AP")
                pay_account = defaults.get("BANK") if method == "bank" else defaults.get("CASH")
                if not (interco_ap and pay_account):
                    raise HTTPException(status_code=400, detail="Missing INTERCO_AP or CASH/BANK defaults")

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type,
                       exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'intercompany_settlement', NULL, CURRENT_DATE, 'market',
                       %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        data.from_company_id,
                        f"IC-SETTLE-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                        data.exchange_rate,
                        "Intercompany settlement (payer)",
                        user["user_id"],
                    ),
                )
                payer_journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Intercompany settlement')
                    """,
                    (payer_journal_id, interco_ap, data.amount_usd, data.amount_lbp),
                )

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Payment')
                    """,
                    (payer_journal_id, pay_account, data.amount_usd, data.amount_lbp),
                )

                try:
                    auto_balance_journal(cur, data.from_company_id, payer_journal_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
                assert_journal_balanced(cur, payer_journal_id)

                # Receiver company: Dr Cash/Bank, Cr Interco AR
                defaults = ensure_company_account_defaults(cur, data.to_company_id, roles=("INTERCO_AR", "CASH", "BANK", "AR"))
                interco_ar = defaults.get("INTERCO_AR")
                recv_account = defaults.get("BANK") if method == "bank" else defaults.get("CASH")
                if not (interco_ar and recv_account):
                    raise HTTPException(status_code=400, detail="Missing INTERCO_AR or CASH/BANK defaults")

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type,
                       exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'intercompany_settlement', NULL, CURRENT_DATE, 'market',
                       %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        data.to_company_id,
                        f"IC-RECV-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                        data.exchange_rate,
                        "Intercompany settlement (receiver)",
                        user["user_id"],
                    ),
                )
                recv_journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Intercompany receipt')
                    """,
                    (recv_journal_id, recv_account, data.amount_usd, data.amount_lbp),
                )

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Intercompany AR settlement')
                    """,
                    (recv_journal_id, interco_ar, data.amount_usd, data.amount_lbp),
                )

                try:
                    auto_balance_journal(cur, data.to_company_id, recv_journal_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
                assert_journal_balanced(cur, recv_journal_id)

                # -- HIGH 5: Settlement record with journal_id (use payer journal) --
                cur.execute(
                    """
                    INSERT INTO intercompany_settlements
                      (id, from_company_id, to_company_id, amount_usd, amount_lbp, exchange_rate, journal_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        data.from_company_id,
                        data.to_company_id,
                        data.amount_usd,
                        data.amount_lbp,
                        data.exchange_rate,
                        payer_journal_id,
                    ),
                )
                settlement_id = cur.fetchone()["id"]

                # -- HIGH 1: Update settlement_status on related open documents --
                cur.execute(
                    """
                    UPDATE intercompany_documents
                    SET settlement_status = 'settled'
                    WHERE settlement_status = 'open'
                      AND (
                        (issue_company_id=%s AND sell_company_id=%s)
                        OR (issue_company_id=%s AND sell_company_id=%s)
                      )
                    """,
                    (data.from_company_id, data.to_company_id, data.to_company_id, data.from_company_id),
                )

                # -- MEDIUM: Audit trail --
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'intercompany_settlement_created', 'intercompany_settlement', %s, %s::jsonb)
                    """,
                    (
                        data.from_company_id,
                        user["user_id"],
                        settlement_id,
                        json.dumps({
                            "to_company_id": str(data.to_company_id),
                            "amount_usd": str(data.amount_usd),
                            "amount_lbp": str(data.amount_lbp),
                            "method": method,
                            "payer_journal_id": str(payer_journal_id),
                            "recv_journal_id": str(recv_journal_id),
                        }),
                    ),
                )

    return {"ok": True, "settlement_id": settlement_id}


# -- MEDIUM: Pagination on list endpoints --
@router.get("/documents", dependencies=[Depends(require_permission("intercompany:write"))])
def list_intercompany_documents(
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    company_id: str = Depends(get_company_id),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.id,
                       d.source_company_id, sc.name AS source_company_name,
                       d.issue_company_id, ic.name AS issue_company_name,
                       d.sell_company_id, sl.name AS sell_company_name,
                       d.source_type, d.source_id, d.settlement_status, d.created_at
                FROM intercompany_documents d
                LEFT JOIN companies sc ON sc.id = d.source_company_id
                LEFT JOIN companies ic ON ic.id = d.issue_company_id
                LEFT JOIN companies sl ON sl.id = d.sell_company_id
                WHERE d.source_company_id = %s
                   OR d.issue_company_id = %s
                   OR d.sell_company_id = %s
                ORDER BY d.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (company_id, company_id, company_id, limit, offset),
            )
            return {"documents": cur.fetchall()}


@router.get("/settlements", dependencies=[Depends(require_permission("intercompany:write"))])
def list_intercompany_settlements(
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    company_id: str = Depends(get_company_id),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id,
                       s.from_company_id, fc.name AS from_company_name,
                       s.to_company_id, tc.name AS to_company_name,
                       s.amount_usd, s.amount_lbp, s.exchange_rate, s.journal_id, s.created_at
                FROM intercompany_settlements s
                LEFT JOIN companies fc ON fc.id = s.from_company_id
                LEFT JOIN companies tc ON tc.id = s.to_company_id
                WHERE s.from_company_id = %s OR s.to_company_id = %s
                ORDER BY s.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (company_id, company_id, limit, offset),
            )
            return {"settlements": cur.fetchall()}
