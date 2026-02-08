from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional

import json
import uuid

from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..validation import BankDirection, CurrencyCode

router = APIRouter(prefix="/banking", tags=["banking"])


class BankAccountIn(BaseModel):
    name: str
    currency: CurrencyCode = "USD"
    gl_account_id: str
    is_active: bool = True


class BankAccountUpdate(BaseModel):
    name: Optional[str] = None
    currency: Optional[CurrencyCode] = None
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
    direction: BankDirection  # inflow|outflow
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")
    description: Optional[str] = None
    reference: Optional[str] = None
    counterparty: Optional[str] = None
    # Optional traceability fields (mostly for integrations/imports).
    source_type: Optional[str] = None
    source_id: Optional[str] = None
    import_batch_id: Optional[str] = None
    import_row_no: Optional[int] = None


class BankTxnMatchIn(BaseModel):
    journal_id: str


class BankImportBatchIn(BaseModel):
    source: str  # e.g. 'csv', 'manual', 'api'
    file_name: Optional[str] = None
    statement_date_from: Optional[date] = None
    statement_date_to: Optional[date] = None
    notes: Optional[str] = None


class BankImportTxnIn(BaseModel):
    row_no: int
    bank_account_id: str
    txn_date: date
    direction: BankDirection
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")
    description: Optional[str] = None
    reference: Optional[str] = None
    counterparty: Optional[str] = None


class BankImportTxnsIn(BaseModel):
    transactions: list[BankImportTxnIn]


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
                       t.source_type, t.source_id, t.import_batch_id, t.import_row_no,
                       t.imported_by_user_id, t.imported_at,
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


@router.get("/import-batches", dependencies=[Depends(require_permission("accounting:read"))])
def list_import_batches(limit: int = 200, company_id: str = Depends(get_company_id)):
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, source, file_name, statement_date_from, statement_date_to, notes,
                       imported_by_user_id, imported_at, created_at
                FROM bank_statement_import_batches
                WHERE company_id = %s
                ORDER BY imported_at DESC, created_at DESC
                LIMIT %s
                """,
                (company_id, limit),
            )
            return {"batches": cur.fetchall()}


@router.post("/import-batches", dependencies=[Depends(require_permission("accounting:write"))])
def create_import_batch(data: BankImportBatchIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    src = (data.source or "").strip().lower()
    if not src:
        raise HTTPException(status_code=400, detail="source is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO bank_statement_import_batches
                      (id, company_id, source, file_name, statement_date_from, statement_date_to, notes, imported_by_user_id, imported_at)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, now())
                    RETURNING id
                    """,
                    (
                        company_id,
                        src,
                        (data.file_name or None),
                        data.statement_date_from,
                        data.statement_date_to,
                        (data.notes or None),
                        user["user_id"],
                    ),
                )
                batch_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'bank_import_batch_create', 'bank_import_batch', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], batch_id, json.dumps(data.model_dump(), default=str)),
                )
                return {"id": batch_id}


@router.post("/import-batches/{batch_id}/transactions", dependencies=[Depends(require_permission("accounting:write"))])
def import_batch_transactions(batch_id: str, data: BankImportTxnsIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.transactions:
        raise HTTPException(status_code=400, detail="transactions is required")
    # Basic validation up front so we fail fast.
    for t in data.transactions:
        if t.row_no <= 0:
            raise HTTPException(status_code=400, detail="row_no must be > 0")
        if t.amount_usd < 0 or t.amount_lbp < 0:
            raise HTTPException(status_code=400, detail="amounts must be >= 0")
        if t.amount_usd == 0 and t.amount_lbp == 0:
            raise HTTPException(status_code=400, detail="amount is required")
    try:
        uuid.UUID(str(batch_id))
    except Exception:
        raise HTTPException(status_code=400, detail="batch_id must be a UUID")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM bank_statement_import_batches WHERE company_id=%s AND id=%s", (company_id, batch_id))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="import batch not found")

                # Validate bank accounts in one query.
                bank_ids = sorted({str(t.bank_account_id) for t in data.transactions if t.bank_account_id})
                if bank_ids:
                    cur.execute(
                        "SELECT id FROM bank_accounts WHERE company_id=%s AND id = ANY(%s::uuid[])",
                        (company_id, bank_ids),
                    )
                    ok = {str(r["id"]) for r in cur.fetchall()}
                    missing = [bid for bid in bank_ids if bid not in ok]
                    if missing:
                        raise HTTPException(status_code=400, detail=f"invalid bank_account_id(s): {', '.join(missing[:5])}")

                inserted = 0
                for t in data.transactions:
                    cur.execute(
                        """
                        INSERT INTO bank_transactions
                          (id, company_id, bank_account_id, txn_date, direction, amount_usd, amount_lbp,
                           description, reference, counterparty,
                           import_batch_id, import_row_no, imported_by_user_id, imported_at)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s,
                           %s, %s, %s,
                           %s, %s, %s, now())
                        ON CONFLICT (company_id, import_batch_id, import_row_no) DO UPDATE
                          SET bank_account_id = EXCLUDED.bank_account_id,
                              txn_date = EXCLUDED.txn_date,
                              direction = EXCLUDED.direction,
                              amount_usd = EXCLUDED.amount_usd,
                              amount_lbp = EXCLUDED.amount_lbp,
                              description = EXCLUDED.description,
                              reference = EXCLUDED.reference,
                              counterparty = EXCLUDED.counterparty,
                              imported_by_user_id = EXCLUDED.imported_by_user_id,
                              imported_at = now(),
                              updated_at = now()
                        """,
                        (
                            company_id,
                            t.bank_account_id,
                            t.txn_date,
                            t.direction,
                            t.amount_usd,
                            t.amount_lbp,
                            t.description,
                            t.reference,
                            t.counterparty,
                            batch_id,
                            t.row_no,
                            user["user_id"],
                        ),
                    )
                    inserted += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'bank_import_batch_transactions', 'bank_import_batch', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], batch_id, json.dumps({"count": inserted}, default=str)),
                )
                return {"ok": True, "count": inserted}


@router.post("/transactions", dependencies=[Depends(require_permission("accounting:write"))])
def create_transaction(data: BankTxnIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    direction = data.direction
    if data.amount_usd < 0 or data.amount_lbp < 0:
        raise HTTPException(status_code=400, detail="amounts must be >= 0")
    if data.amount_usd == 0 and data.amount_lbp == 0:
        raise HTTPException(status_code=400, detail="amount is required")
    if data.source_id:
        try:
            uuid.UUID(str(data.source_id))
        except Exception:
            raise HTTPException(status_code=400, detail="source_id must be a UUID")
    if data.import_batch_id:
        try:
            uuid.UUID(str(data.import_batch_id))
        except Exception:
            raise HTTPException(status_code=400, detail="import_batch_id must be a UUID")
    if data.import_row_no is not None and data.import_row_no <= 0:
        raise HTTPException(status_code=400, detail="import_row_no must be > 0")

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
                       description, reference, counterparty,
                       source_type, source_id, import_batch_id, import_row_no,
                       imported_by_user_id, imported_at)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s,
                       %s, %s, %s, %s,
                       %s, now())
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
                        (data.source_type or None),
                        (data.source_id or None),
                        (data.import_batch_id or None),
                        (data.import_row_no or None),
                        user["user_id"],
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
