from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional

import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/banking", tags=["banking"])


class BankAccountIn(BaseModel):
    name: str
    currency: str = "USD"
    gl_account_id: str
    is_active: bool = True


class BankAccountUpdate(BaseModel):
    name: Optional[str] = None
    currency: Optional[str] = None
    gl_account_id: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/accounts", dependencies=[Depends(require_permission("accounting:read"))])
def list_bank_accounts(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.id, a.name, a.currency, a.gl_account_id, c.account_code, c.name_en,
                       a.is_active, a.created_at, a.updated_at
                FROM bank_accounts a
                JOIN company_coa_accounts c ON c.id = a.gl_account_id
                WHERE a.company_id = %s
                ORDER BY a.name
                """,
                (company_id,),
            )
            return {"accounts": cur.fetchall()}


@router.post("/accounts", dependencies=[Depends(require_permission("accounting:write"))])
def create_bank_account(data: BankAccountIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    if data.currency not in {"USD", "LBP"}:
        raise HTTPException(status_code=400, detail="currency must be USD or LBP")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM company_coa_accounts WHERE company_id = %s AND id = %s",
                    (company_id, data.gl_account_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail="invalid gl_account_id")

                cur.execute(
                    """
                    INSERT INTO bank_accounts (id, company_id, name, currency, gl_account_id, is_active)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, data.name.strip(), data.currency, data.gl_account_id, data.is_active),
                )
                account_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'bank_account_create', 'bank_account', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], account_id, json.dumps(data.model_dump())),
                )
                return {"id": account_id}


@router.patch("/accounts/{account_id}", dependencies=[Depends(require_permission("accounting:write"))])
def update_bank_account(account_id: str, data: BankAccountUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    if "currency" in patch and patch["currency"] not in {"USD", "LBP"}:
        raise HTTPException(status_code=400, detail="currency must be USD or LBP")

    fields = []
    params = []
    for k, v in patch.items():
        fields.append(f"{k} = %s")
        params.append(v)
    params.extend([company_id, account_id])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if "gl_account_id" in patch:
                    cur.execute(
                        "SELECT 1 FROM company_coa_accounts WHERE company_id = %s AND id = %s",
                        (company_id, patch["gl_account_id"]),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail="invalid gl_account_id")

                cur.execute(
                    f"""
                    UPDATE bank_accounts
                    SET {', '.join(fields)}, updated_at = now()
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="bank account not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'bank_account_update', 'bank_account', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], account_id, json.dumps(patch)),
                )
                return {"ok": True}


class BankTxnIn(BaseModel):
    bank_account_id: str
    txn_date: date
    direction: str  # inflow|outflow
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")
    description: Optional[str] = None
    reference: Optional[str] = None
    counterparty: Optional[str] = None


class BankTxnMatchIn(BaseModel):
    journal_id: str


@router.get("/transactions", dependencies=[Depends(require_permission("accounting:read"))])
def list_transactions(
    bank_account_id: Optional[str] = None,
    matched: Optional[bool] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = 500,
    company_id: str = Depends(get_company_id),
):
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT t.id, t.bank_account_id, a.name AS bank_account_name, a.currency,
                       t.txn_date, t.direction, t.amount_usd, t.amount_lbp,
                       t.description, t.reference, t.counterparty,
                       t.matched_journal_id, t.matched_at, t.created_at
                FROM bank_transactions t
                JOIN bank_accounts a ON a.id = t.bank_account_id
                WHERE t.company_id = %s
            """
            params = [company_id]
            if bank_account_id:
                sql += " AND t.bank_account_id = %s"
                params.append(bank_account_id)
            if matched is True:
                sql += " AND t.matched_journal_id IS NOT NULL"
            if matched is False:
                sql += " AND t.matched_journal_id IS NULL"
            if date_from:
                sql += " AND t.txn_date >= %s"
                params.append(date_from)
            if date_to:
                sql += " AND t.txn_date <= %s"
                params.append(date_to)
            sql += " ORDER BY t.txn_date DESC, t.created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"transactions": cur.fetchall()}


@router.post("/transactions", dependencies=[Depends(require_permission("accounting:write"))])
def create_transaction(data: BankTxnIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    direction = (data.direction or "").strip().lower()
    if direction not in {"inflow", "outflow"}:
        raise HTTPException(status_code=400, detail="direction must be inflow or outflow")
    if data.amount_usd < 0 or data.amount_lbp < 0:
        raise HTTPException(status_code=400, detail="amounts must be >= 0")
    if data.amount_usd == 0 and data.amount_lbp == 0:
        raise HTTPException(status_code=400, detail="amount is required")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM bank_accounts WHERE company_id = %s AND id = %s",
                    (company_id, data.bank_account_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail="invalid bank_account_id")
                cur.execute(
                    """
                    INSERT INTO bank_transactions
                      (id, company_id, bank_account_id, txn_date, direction, amount_usd, amount_lbp,
                       description, reference, counterparty)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        data.bank_account_id,
                        data.txn_date,
                        direction,
                        data.amount_usd,
                        data.amount_lbp,
                        data.description,
                        data.reference,
                        data.counterparty,
                    ),
                )
                txn_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'bank_txn_create', 'bank_transaction', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], txn_id, json.dumps(data.model_dump(), default=str)),
                )
                return {"id": txn_id}


@router.post("/transactions/{txn_id}/match", dependencies=[Depends(require_permission("accounting:write"))])
def match_transaction(txn_id: str, data: BankTxnMatchIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM gl_journals WHERE company_id = %s AND id = %s",
                    (company_id, data.journal_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail="invalid journal_id")
                cur.execute(
                    """
                    UPDATE bank_transactions
                    SET matched_journal_id = %s,
                        matched_at = now(),
                        updated_at = now()
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    (data.journal_id, company_id, txn_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="transaction not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'bank_txn_match', 'bank_transaction', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], txn_id, json.dumps({"journal_id": data.journal_id})),
                )
                return {"ok": True}


@router.post("/transactions/{txn_id}/unmatch", dependencies=[Depends(require_permission("accounting:write"))])
def unmatch_transaction(txn_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE bank_transactions
                    SET matched_journal_id = NULL,
                        matched_at = NULL,
                        updated_at = now()
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    (company_id, txn_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="transaction not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'bank_txn_unmatch', 'bank_transaction', %s, '{}'::jsonb)
                    """,
                    (company_id, user["user_id"], txn_id),
                )
                return {"ok": True}

