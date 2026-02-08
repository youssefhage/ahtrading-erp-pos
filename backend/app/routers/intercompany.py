from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
from decimal import Decimal
from datetime import datetime
from ..db import get_conn, get_admin_conn, set_company_context
from ..deps import get_company_id, require_permission
from ..deps import get_current_user

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


class IntercompanyLine(BaseModel):
    item_id: str
    qty: Decimal
    unit_cost_usd: Decimal
    unit_cost_lbp: Decimal


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


@router.post("/issue", dependencies=[Depends(require_permission("intercompany:write"))])
def intercompany_issue(data: IntercompanyIssueIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if data.issue_company_id == data.sell_company_id:
        raise HTTPException(status_code=400, detail="issue and sell company must differ")

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
        total_cost_usd += l.qty * l.unit_cost_usd
        total_cost_lbp += l.qty * l.unit_cost_lbp

    # Create intercompany document
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Use source company context for the document
            set_company_context(conn, data.source_company_id)
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

    # Issue company: stock out + intercompany AR
    with get_conn() as conn_issue:
        with conn_issue.transaction():
            with conn_issue.cursor() as cur:
                set_company_context(conn_issue, data.issue_company_id)

                # Stock moves
                for l in data.lines:
                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, qty_out, unit_cost_usd, unit_cost_lbp,
                           source_type, source_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'intercompany_issue', %s)
                        """,
                        (
                            data.issue_company_id,
                            l.item_id,
                            data.warehouse_id,
                            l.qty,
                            l.unit_cost_usd,
                            l.unit_cost_lbp,
                            doc_id,
                        ),
                    )

                # GL posting
                cur.execute(
                    """
                    SELECT role_code, account_id FROM company_account_defaults
                    WHERE company_id = %s
                    """,
                    (data.issue_company_id,),
                )
                defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
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
                        0,
                        f"Intercompany issue {str(doc_id)[:8]}",
                        user["user_id"],
                    ),
                )
                journal_id = cur.fetchone()["id"]

                # Debit intercompany receivable
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Intercompany receivable')
                    """,
                    (journal_id, interco_ar, total_cost_usd, total_cost_lbp),
                )

                # Credit inventory
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory issued', %s)
                    """,
                    (journal_id, inventory, total_cost_usd, total_cost_lbp, data.warehouse_id),
                )

    # Sell company: COGS + intercompany AP
    with get_conn() as conn_sell:
        with conn_sell.transaction():
            with conn_sell.cursor() as cur:
                set_company_context(conn_sell, data.sell_company_id)
                cur.execute(
                    """
                    SELECT role_code, account_id FROM company_account_defaults
                    WHERE company_id = %s
                    """,
                    (data.sell_company_id,),
                )
                defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
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
                        0,
                        f"Intercompany sell-side COGS {str(doc_id)[:8]}",
                        user["user_id"],
                    ),
                )
                journal_id = cur.fetchone()["id"]

                # Debit COGS
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'COGS (intercompany)')
                    """,
                    (journal_id, cogs, total_cost_usd, total_cost_lbp),
                )

                # Credit intercompany payable
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Intercompany payable')
                    """,
                    (journal_id, interco_ap, total_cost_usd, total_cost_lbp),
                )

    # Settlement row
    with get_conn() as conn:
        with conn.cursor() as cur:
            set_company_context(conn, data.sell_company_id)
            cur.execute(
                """
                INSERT INTO intercompany_settlements
                  (id, from_company_id, to_company_id, amount_usd, amount_lbp, exchange_rate, journal_id)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, NULL)
                """,
                (
                    data.sell_company_id,
                    data.issue_company_id,
                    total_cost_usd,
                    total_cost_lbp,
                    0,
                ),
            )

    return {"intercompany_document_id": doc_id}


@router.post("/settle", dependencies=[Depends(require_permission("intercompany:write"))])
def intercompany_settle(data: IntercompanySettleIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    # From company pays to company
    method = (data.method or "bank").lower()
    if method not in {"cash", "bank"}:
        raise HTTPException(status_code=400, detail="method must be cash or bank")

    if company_id not in {data.from_company_id, data.to_company_id}:
        raise HTTPException(status_code=403, detail="active company must be payer or receiver company")
    _assert_user_perm_in_company(user["user_id"], data.from_company_id, "intercompany:write")
    _assert_user_perm_in_company(user["user_id"], data.to_company_id, "intercompany:write")

    # Payer company: Dr Interco AP, Cr Cash/Bank
    with get_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                set_company_context(conn, data.from_company_id)
                cur.execute(
                    """
                    SELECT role_code, account_id FROM company_account_defaults
                    WHERE company_id = %s
                    """,
                    (data.from_company_id,),
                )
                defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
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
                journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Intercompany settlement')
                    """,
                    (journal_id, interco_ap, data.amount_usd, data.amount_lbp),
                )

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Payment')
                    """,
                    (journal_id, pay_account, data.amount_usd, data.amount_lbp),
                )

    # Receiver company: Dr Cash/Bank, Cr Interco AR
    with get_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                set_company_context(conn, data.to_company_id)
                cur.execute(
                    """
                    SELECT role_code, account_id FROM company_account_defaults
                    WHERE company_id = %s
                    """,
                    (data.to_company_id,),
                )
                defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
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
                journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Intercompany receipt')
                    """,
                    (journal_id, recv_account, data.amount_usd, data.amount_lbp),
                )

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Intercompany AR settlement')
                    """,
                    (journal_id, interco_ar, data.amount_usd, data.amount_lbp),
                )

    # Settlement record
    with get_conn() as conn:
        with conn.cursor() as cur:
            set_company_context(conn, data.from_company_id)
            cur.execute(
                """
                INSERT INTO intercompany_settlements
                  (id, from_company_id, to_company_id, amount_usd, amount_lbp, exchange_rate, journal_id)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, NULL)
                """,
                (
                    data.from_company_id,
                    data.to_company_id,
                    data.amount_usd,
                    data.amount_lbp,
                    data.exchange_rate,
                ),
            )

    return {"ok": True}


@router.get("/documents", dependencies=[Depends(require_permission("intercompany:write"))])
def list_intercompany_documents(limit: int = 200, company_id: str = Depends(get_company_id)):
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")
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
                LIMIT %s
                """,
                (company_id, company_id, company_id, limit),
            )
            return {"documents": cur.fetchall()}


@router.get("/settlements", dependencies=[Depends(require_permission("intercompany:write"))])
def list_intercompany_settlements(limit: int = 200, company_id: str = Depends(get_company_id)):
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")
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
                LIMIT %s
                """,
                (company_id, company_id, limit),
            )
            return {"settlements": cur.fetchall()}
