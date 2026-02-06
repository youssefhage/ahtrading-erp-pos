from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
import json

router = APIRouter(prefix="/purchases", tags=["purchases"])


class PurchaseLine(BaseModel):
    item_id: str
    qty: Decimal
    unit_cost_usd: Decimal
    unit_cost_lbp: Decimal
    line_total_usd: Decimal
    line_total_lbp: Decimal


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


class GoodsReceiptIn(BaseModel):
    device_id: str
    supplier_id: str
    exchange_rate: Decimal
    warehouse_id: str
    lines: List[PurchaseLine]


class SupplierInvoiceIn(BaseModel):
    device_id: str
    supplier_id: str
    invoice_no: Optional[str] = None
    exchange_rate: Decimal
    lines: List[PurchaseLine]
    tax: Optional[TaxBlock] = None
    payments: Optional[List[PaymentBlock]] = None


class PurchaseOrderLine(BaseModel):
    item_id: str
    qty: Decimal
    unit_cost_usd: Decimal
    unit_cost_lbp: Decimal
    line_total_usd: Decimal
    line_total_lbp: Decimal


class PurchaseOrderIn(BaseModel):
    supplier_id: str
    exchange_rate: Decimal
    lines: List[PurchaseOrderLine]


class SupplierPaymentIn(BaseModel):
    supplier_invoice_id: str
    method: str = "bank"  # cash|bank|transfer|other
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")


@router.get("/receipts", dependencies=[Depends(require_permission("purchases:read"))])
def list_goods_receipts(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, supplier_id, status, total_usd, total_lbp, created_at
                FROM goods_receipts
                WHERE company_id = %s
                ORDER BY created_at DESC
                """,
                (company_id,),
            )
            return {"receipts": cur.fetchall()}


@router.get("/invoices", dependencies=[Depends(require_permission("purchases:read"))])
def list_supplier_invoices(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, invoice_no, supplier_id, status, total_usd, total_lbp, created_at
                FROM supplier_invoices
                WHERE company_id = %s
                ORDER BY created_at DESC
                """,
                (company_id,),
            )
            return {"invoices": cur.fetchall()}


@router.get("/orders", dependencies=[Depends(require_permission("purchases:read"))])
def list_purchase_orders(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, supplier_id, status, total_usd, total_lbp, created_at
                FROM purchase_orders
                WHERE company_id = %s
                ORDER BY created_at DESC
                """,
                (company_id,),
            )
            return {"orders": cur.fetchall()}


@router.post("/orders", dependencies=[Depends(require_permission("purchases:write"))])
def create_purchase_order(data: PurchaseOrderIn, company_id: str = Depends(get_company_id)):
    total_usd = sum([l.line_total_usd for l in data.lines])
    total_lbp = sum([l.line_total_lbp for l in data.lines])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO purchase_orders
                  (id, company_id, supplier_id, status, total_usd, total_lbp, exchange_rate)
                VALUES
                  (gen_random_uuid(), %s, %s, 'posted', %s, %s, %s)
                RETURNING id
                """,
                (company_id, data.supplier_id, total_usd, total_lbp, data.exchange_rate),
            )
            po_id = cur.fetchone()["id"]
            for l in data.lines:
                cur.execute(
                    """
                    INSERT INTO purchase_order_lines
                      (id, company_id, purchase_order_id, item_id, qty, unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        company_id,
                        po_id,
                        l.item_id,
                        l.qty,
                        l.unit_cost_usd,
                        l.unit_cost_lbp,
                        l.line_total_usd,
                        l.line_total_lbp,
                    ),
                )
            return {"id": po_id}


@router.post("/receipts", dependencies=[Depends(require_permission("purchases:write"))])
def create_goods_receipt(data: GoodsReceiptIn, company_id: str = Depends(get_company_id)):
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
                VALUES (gen_random_uuid(), %s, 'purchase.received', %s::jsonb)
                RETURNING id
                """,
                (data.device_id, json.dumps(payload, default=str)),
            )
            return {"event_id": cur.fetchone()["id"]}


@router.post("/invoices", dependencies=[Depends(require_permission("purchases:write"))])
def create_supplier_invoice(data: SupplierInvoiceIn, company_id: str = Depends(get_company_id)):
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
                VALUES (gen_random_uuid(), %s, 'purchase.invoice', %s::jsonb)
                RETURNING id
                """,
                (data.device_id, json.dumps(payload, default=str)),
            )
            return {"event_id": cur.fetchone()["id"]}


@router.post("/payments", dependencies=[Depends(require_permission("purchases:write"))])
def create_supplier_payment(data: SupplierPaymentIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    method = (data.method or "bank").strip().lower()
    if method not in {"cash", "bank", "transfer", "other"}:
        raise HTTPException(status_code=400, detail="invalid method")
    if data.amount_usd < 0 or data.amount_lbp < 0:
        raise HTTPException(status_code=400, detail="amounts must be >= 0")
    if data.amount_usd == 0 and data.amount_lbp == 0:
        raise HTTPException(status_code=400, detail="amount is required")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, supplier_id
                    FROM supplier_invoices
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, data.supplier_invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="supplier invoice not found")

                cur.execute(
                    """
                    INSERT INTO supplier_payments (id, supplier_invoice_id, method, amount_usd, amount_lbp)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (data.supplier_invoice_id, method, data.amount_usd, data.amount_lbp),
                )
                payment_id = cur.fetchone()["id"]

                # GL posting: Dr AP, Cr Cash/Bank
                cur.execute(
                    """
                    SELECT role_code, account_id
                    FROM company_account_defaults
                    WHERE company_id = %s
                    """,
                    (company_id,),
                )
                defaults = {r["role_code"]: r["account_id"] for r in cur.fetchall()}
                ap = defaults.get("AP")
                pay_account = defaults.get("BANK")
                if method == "cash":
                    pay_account = defaults.get("CASH")
                if not (ap and pay_account):
                    raise HTTPException(status_code=400, detail="Missing AP and/or CASH/BANK defaults")

                cur.execute(
                    """
                    INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_payment', %s, CURRENT_DATE, 'market')
                    RETURNING id
                    """,
                    (company_id, f"SP-{str(payment_id)[:8]}", payment_id),
                )
                journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Supplier payment')
                    """,
                    (journal_id, ap, data.amount_usd, data.amount_lbp),
                )
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Cash/Bank out')
                    """,
                    (journal_id, pay_account, data.amount_usd, data.amount_lbp),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_payment', 'supplier_payment', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], payment_id, json.dumps({"invoice_id": data.supplier_invoice_id, "method": method})),
                )

            return {"id": payment_id}
