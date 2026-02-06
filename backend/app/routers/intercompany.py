from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
from decimal import Decimal
from datetime import datetime
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/intercompany", tags=["intercompany"])


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
def intercompany_issue(data: IntercompanyIssueIn, company_id: str = Depends(get_company_id)):
    if data.issue_company_id == data.sell_company_id:
        raise HTTPException(status_code=400, detail="issue and sell company must differ")

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
                    INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                    VALUES (gen_random_uuid(), %s, %s, 'intercompany_issue', %s, CURRENT_DATE, 'market')
                    RETURNING id
                    """,
                    (data.issue_company_id, f"IC-ISSUE-{str(doc_id)[:8]}", doc_id),
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
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory issued')
                    """,
                    (journal_id, inventory, total_cost_usd, total_cost_lbp),
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
                    INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                    VALUES (gen_random_uuid(), %s, %s, 'intercompany_issue', %s, CURRENT_DATE, 'market')
                    RETURNING id
                    """,
                    (data.sell_company_id, f"IC-SELL-{str(doc_id)[:8]}", doc_id),
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
def intercompany_settle(data: IntercompanySettleIn, company_id: str = Depends(get_company_id)):
    # From company pays to company
    method = (data.method or "bank").lower()
    if method not in {"cash", "bank"}:
        raise HTTPException(status_code=400, detail="method must be cash or bank")

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
                    INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                    VALUES (gen_random_uuid(), %s, %s, 'intercompany_settlement', NULL, CURRENT_DATE, 'market')
                    RETURNING id
                    """,
                    (data.from_company_id, f"IC-SETTLE-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",),
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
                    INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                    VALUES (gen_random_uuid(), %s, %s, 'intercompany_settlement', NULL, CURRENT_DATE, 'market')
                    RETURNING id
                    """,
                    (data.to_company_id, f"IC-RECV-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",),
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
