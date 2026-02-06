from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
import json

router = APIRouter(prefix="/sales", tags=["sales"])


class SaleLine(BaseModel):
    item_id: str
    qty: Decimal
    unit_price_usd: Decimal
    unit_price_lbp: Decimal
    line_total_usd: Decimal
    line_total_lbp: Decimal
    unit_cost_usd: Optional[Decimal] = None
    unit_cost_lbp: Optional[Decimal] = None


class TaxBlock(BaseModel):
    tax_code_id: str
    base_usd: Decimal
    base_lbp: Decimal
    tax_usd: Decimal
    tax_lbp: Decimal
    tax_date: Optional[str] = None


class PaymentBlock(BaseModel):
    method: str
    amount_usd: Decimal
    amount_lbp: Decimal


class SalesInvoiceIn(BaseModel):
    device_id: str
    invoice_no: Optional[str] = None
    exchange_rate: Decimal
    pricing_currency: str = "USD"
    settlement_currency: str = "USD"
    customer_id: Optional[str] = None
    warehouse_id: Optional[str] = None
    shift_id: Optional[str] = None
    lines: List[SaleLine]
    tax: Optional[TaxBlock] = None
    payments: Optional[List[PaymentBlock]] = None


class SalesReturnIn(BaseModel):
    device_id: str
    invoice_id: Optional[str] = None
    exchange_rate: Decimal
    warehouse_id: Optional[str] = None
    lines: List[SaleLine]
    tax: Optional[TaxBlock] = None


class SalesPaymentIn(BaseModel):
    invoice_id: str
    method: str
    amount_usd: Decimal
    amount_lbp: Decimal

@router.get("/invoices", dependencies=[Depends(require_permission("sales:read"))])
def list_sales_invoices(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, invoice_no, customer_id, status, total_usd, total_lbp, created_at
                FROM sales_invoices
                WHERE company_id = %s
                ORDER BY created_at DESC
                """,
                (company_id,),
            )
            return {"invoices": cur.fetchall()}


@router.get("/returns", dependencies=[Depends(require_permission("sales:read"))])
def list_sales_returns(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, invoice_id, status, total_usd, total_lbp, created_at
                FROM sales_returns
                WHERE company_id = %s
                ORDER BY created_at DESC
                """,
                (company_id,),
            )
            return {"returns": cur.fetchall()}


@router.post("/payments", dependencies=[Depends(require_permission("sales:write"))])
def create_sales_payment(data: SalesPaymentIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT customer_id
                    FROM sales_invoices
                    WHERE id = %s AND company_id = %s
                    """,
                    (data.invoice_id, company_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="invoice not found")

                method = (data.method or "").strip().lower()
                if not method:
                    raise HTTPException(status_code=400, detail="method is required")

                cur.execute(
                    """
                    INSERT INTO sales_payments (id, invoice_id, method, amount_usd, amount_lbp)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (data.invoice_id, method, data.amount_usd, data.amount_lbp),
                )
                payment_id = cur.fetchone()["id"]

                if row["customer_id"]:
                    cur.execute(
                        """
                        UPDATE customers
                        SET credit_balance_usd = GREATEST(credit_balance_usd - %s, 0),
                            credit_balance_lbp = GREATEST(credit_balance_lbp - %s, 0)
                        WHERE company_id = %s AND id = %s
                        """,
                        (data.amount_usd, data.amount_lbp, company_id, row["customer_id"]),
                    )

                    # GL posting: Dr Cash/Bank, Cr AR
                    cur.execute(
                        """
                        SELECT role_code, account_id
                        FROM company_account_defaults
                        WHERE company_id = %s
                        """,
                        (company_id,),
                    )
                    defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
                    ar = defaults.get("AR")
                    if not ar:
                        raise HTTPException(status_code=400, detail="Missing AR default")

                    cur.execute(
                        """
                        SELECT m.method, d.account_id
                        FROM payment_method_mappings m
                        JOIN company_account_defaults d
                          ON d.company_id = m.company_id AND d.role_code = m.role_code
                        WHERE m.company_id = %s AND m.method = %s
                        """,
                        (company_id, method),
                    )
                    pay = cur.fetchone()
                    if not pay:
                        raise HTTPException(status_code=400, detail=f"Missing payment method mapping for {method}")
                    pay_account = pay["account_id"]

                    cur.execute(
                        """
                        INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                        VALUES (gen_random_uuid(), %s, %s, 'sales_payment', %s, CURRENT_DATE, 'market')
                        RETURNING id
                        """,
                        (company_id, f"CP-{str(payment_id)[:8]}", payment_id),
                    )
                    journal_id = cur.fetchone()["id"]

                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Customer payment')
                        """,
                        (journal_id, pay_account, data.amount_usd, data.amount_lbp),
                    )
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'AR settlement')
                        """,
                        (journal_id, ar, data.amount_usd, data.amount_lbp),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'sales_payment', 'sales_payment', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], payment_id, json.dumps({"invoice_id": data.invoice_id, "method": method})),
                )

                return {"id": payment_id}


@router.post("/invoices", dependencies=[Depends(require_permission("sales:write"))])
def create_sales_invoice(data: SalesInvoiceIn, company_id: str = Depends(get_company_id)):
    payload = data.model_dump()
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1 FROM pos_devices
                WHERE id = %s AND company_id = %s
                """,
                (data.device_id, company_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="invalid device_id")
            cur.execute(
                """
                INSERT INTO pos_events_outbox (id, device_id, event_type, payload_json)
                VALUES (gen_random_uuid(), %s, 'sale.completed', %s::jsonb)
                RETURNING id
                """,
                (data.device_id, json.dumps(payload, default=str)),
            )
            return {"event_id": cur.fetchone()["id"]}


@router.post("/returns", dependencies=[Depends(require_permission("sales:write"))])
def create_sales_return(data: SalesReturnIn, company_id: str = Depends(get_company_id)):
    payload = data.model_dump()
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1 FROM pos_devices
                WHERE id = %s AND company_id = %s
                """,
                (data.device_id, company_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="invalid device_id")
            cur.execute(
                """
                INSERT INTO pos_events_outbox (id, device_id, event_type, payload_json)
                VALUES (gen_random_uuid(), %s, 'sale.returned', %s::jsonb)
                RETURNING id
                """,
                (data.device_id, json.dumps(payload, default=str)),
            )
            return {"event_id": cur.fetchone()["id"]}
