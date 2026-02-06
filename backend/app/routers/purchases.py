from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
import uuid
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
import json

router = APIRouter(prefix="/purchases", tags=["purchases"])

def _next_doc_no(cur, company_id: str, doc_type: str) -> str:
    cur.execute("SELECT next_document_no(%s, %s) AS doc_no", (company_id, doc_type))
    return cur.fetchone()["doc_no"]

def _normalize_dual_amounts(usd: Decimal, lbp: Decimal, exchange_rate: Decimal) -> tuple[Decimal, Decimal]:
    # Backward compatibility for clients sending only one currency.
    if exchange_rate and exchange_rate != 0:
        if usd == 0 and lbp != 0:
            usd = lbp / exchange_rate
        elif lbp == 0 and usd != 0:
            lbp = usd * exchange_rate
    return usd, lbp

def _fetch_account_defaults(cur, company_id: str) -> dict:
    cur.execute(
        """
        SELECT role_code, account_id
        FROM company_account_defaults
        WHERE company_id = %s
        """,
        (company_id,),
    )
    return {r["role_code"]: r["account_id"] for r in cur.fetchall()}

def _fetch_payment_method_accounts(cur, company_id: str) -> dict:
    cur.execute(
        """
        SELECT m.method, d.account_id
        FROM payment_method_mappings m
        JOIN company_account_defaults d
          ON d.company_id = m.company_id AND d.role_code = m.role_code
        WHERE m.company_id = %s
        """,
        (company_id,),
    )
    return {r["method"]: r["account_id"] for r in cur.fetchall()}


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

class GoodsReceiptDirectIn(BaseModel):
    supplier_id: str
    receipt_no: Optional[str] = None
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

class SupplierInvoiceDirectIn(BaseModel):
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
    order_no: Optional[str] = None
    exchange_rate: Decimal
    lines: List[PurchaseOrderLine]

class PurchaseOrderStatusUpdate(BaseModel):
    status: str  # draft|posted|canceled


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
                SELECT id, receipt_no, supplier_id, warehouse_id, status, total_usd, total_lbp, created_at
                FROM goods_receipts
                WHERE company_id = %s
                ORDER BY created_at DESC
                """,
                (company_id,),
            )
            return {"receipts": cur.fetchall()}

@router.get("/receipts/{receipt_id}", dependencies=[Depends(require_permission("purchases:read"))])
def get_goods_receipt(receipt_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, receipt_no, supplier_id, warehouse_id, status,
                       total_usd, total_lbp, exchange_rate, created_at
                FROM goods_receipts
                WHERE company_id = %s AND id = %s
                """,
                (company_id, receipt_id),
            )
            rec = cur.fetchone()
            if not rec:
                raise HTTPException(status_code=404, detail="receipt not found")
            cur.execute(
                """
                SELECT id, item_id, qty, unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp
                FROM goods_receipt_lines
                WHERE company_id = %s AND goods_receipt_id = %s
                ORDER BY id
                """,
                (company_id, receipt_id),
            )
            return {"receipt": rec, "lines": cur.fetchall()}


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

@router.get("/invoices/{invoice_id}", dependencies=[Depends(require_permission("purchases:read"))])
def get_supplier_invoice(invoice_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, invoice_no, supplier_id, status,
                       total_usd, total_lbp, exchange_rate, created_at
                FROM supplier_invoices
                WHERE company_id = %s AND id = %s
                """,
                (company_id, invoice_id),
            )
            inv = cur.fetchone()
            if not inv:
                raise HTTPException(status_code=404, detail="invoice not found")
            cur.execute(
                """
                SELECT id, item_id, qty, unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp
                FROM supplier_invoice_lines
                WHERE company_id = %s AND supplier_invoice_id = %s
                ORDER BY id
                """,
                (company_id, invoice_id),
            )
            lines = cur.fetchall()
            cur.execute(
                """
                SELECT id, method, amount_usd, amount_lbp, created_at
                FROM supplier_payments
                WHERE supplier_invoice_id = %s
                ORDER BY created_at ASC
                """,
                (invoice_id,),
            )
            payments = cur.fetchall()
            cur.execute(
                """
                SELECT id, tax_code_id, base_usd, base_lbp, tax_usd, tax_lbp, tax_date, created_at
                FROM tax_lines
                WHERE company_id = %s AND source_type = 'supplier_invoice' AND source_id = %s
                ORDER BY created_at ASC
                """,
                (company_id, invoice_id),
            )
            tax_lines = cur.fetchall()
            return {"invoice": inv, "lines": lines, "payments": payments, "tax_lines": tax_lines}


@router.get("/orders", dependencies=[Depends(require_permission("purchases:read"))])
def list_purchase_orders(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, order_no, supplier_id, status, total_usd, total_lbp, created_at
                FROM purchase_orders
                WHERE company_id = %s
                ORDER BY created_at DESC
                """,
                (company_id,),
            )
            return {"orders": cur.fetchall()}

@router.get("/orders/{order_id}", dependencies=[Depends(require_permission("purchases:read"))])
def get_purchase_order(order_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, order_no, supplier_id, status, total_usd, total_lbp, exchange_rate, created_at
                FROM purchase_orders
                WHERE company_id = %s AND id = %s
                """,
                (company_id, order_id),
            )
            po = cur.fetchone()
            if not po:
                raise HTTPException(status_code=404, detail="order not found")
            cur.execute(
                """
                SELECT id, item_id, qty, unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp
                FROM purchase_order_lines
                WHERE company_id = %s AND purchase_order_id = %s
                ORDER BY id
                """,
                (company_id, order_id),
            )
            return {"order": po, "lines": cur.fetchall()}


@router.post("/orders", dependencies=[Depends(require_permission("purchases:write"))])
def create_purchase_order(data: PurchaseOrderIn, company_id: str = Depends(get_company_id)):
    total_usd = sum([l.line_total_usd for l in data.lines])
    total_lbp = sum([l.line_total_lbp for l in data.lines])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                order_no = data.order_no
                if not order_no:
                    order_no = _next_doc_no(cur, company_id, "PO")
            cur.execute(
                """
                INSERT INTO purchase_orders
                  (id, company_id, order_no, supplier_id, status, total_usd, total_lbp, exchange_rate)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, 'posted', %s, %s, %s)
                RETURNING id
                """,
                (company_id, order_no, data.supplier_id, total_usd, total_lbp, data.exchange_rate),
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
            return {"id": po_id, "order_no": order_no}


@router.patch("/orders/{order_id}", dependencies=[Depends(require_permission("purchases:write"))])
def update_purchase_order_status(order_id: str, data: PurchaseOrderStatusUpdate, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if data.status not in {"draft", "posted", "canceled"}:
        raise HTTPException(status_code=400, detail="invalid status")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE purchase_orders
                    SET status = %s
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    (data.status, company_id, order_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="order not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'purchase_order_status', 'purchase_order', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], order_id, json.dumps({"status": data.status})),
                )
                return {"ok": True}


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

@router.post("/receipts/direct", dependencies=[Depends(require_permission("purchases:write"))])
def create_goods_receipt_direct(data: GoodsReceiptDirectIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.lines:
        raise HTTPException(status_code=400, detail="lines is required")
    total_usd = sum([l.line_total_usd for l in data.lines])
    total_lbp = sum([l.line_total_lbp for l in data.lines])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                receipt_no = data.receipt_no or _next_doc_no(cur, company_id, "GR")
                cur.execute(
                    """
                    INSERT INTO goods_receipts
                      (id, company_id, receipt_no, supplier_id, warehouse_id, status,
                       total_usd, total_lbp, exchange_rate, source_event_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, 'posted', %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        receipt_no,
                        data.supplier_id,
                        data.warehouse_id,
                        total_usd,
                        total_lbp,
                        data.exchange_rate,
                        None,
                    ),
                )
                receipt_id = cur.fetchone()["id"]

                for l in data.lines:
                    cur.execute(
                        """
                        INSERT INTO goods_receipt_lines
                          (id, company_id, goods_receipt_id, item_id, qty,
                           unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            receipt_id,
                            l.item_id,
                            l.qty,
                            l.unit_cost_usd,
                            l.unit_cost_lbp,
                            l.line_total_usd,
                            l.line_total_lbp,
                        ),
                    )
                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, qty_in, unit_cost_usd, unit_cost_lbp,
                           source_type, source_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'goods_receipt', %s)
                        """,
                        (
                            company_id,
                            l.item_id,
                            data.warehouse_id,
                            l.qty,
                            l.unit_cost_usd,
                            l.unit_cost_lbp,
                            receipt_id,
                        ),
                    )

                defaults = _fetch_account_defaults(cur, company_id)
                inventory = defaults.get("INVENTORY")
                grni = defaults.get("GRNI")
                if not (inventory and grni):
                    raise HTTPException(status_code=400, detail="Missing INVENTORY/GRNI account defaults")

                cur.execute(
                    """
                    INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                    VALUES (gen_random_uuid(), %s, %s, 'goods_receipt', %s, CURRENT_DATE, 'market')
                    RETURNING id
                    """,
                    (company_id, f"GR-{receipt_no}", receipt_id),
                )
                journal_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Inventory received')
                    """,
                    (journal_id, inventory, total_usd, total_lbp),
                )
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'GRNI')
                    """,
                    (journal_id, grni, total_usd, total_lbp),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'goods_receipt', 'goods_receipt', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], receipt_id, json.dumps({"receipt_no": receipt_no})),
                )

                cur.execute(
                    """
                    INSERT INTO events (id, company_id, event_type, source_type, source_id, payload_json)
                    VALUES (gen_random_uuid(), %s, 'purchase.received', 'goods_receipt', %s, %s::jsonb)
                    """,
                    (company_id, receipt_id, json.dumps({"goods_receipt_id": str(receipt_id), "receipt_no": receipt_no}, default=str)),
                )

                return {"id": receipt_id, "receipt_no": receipt_no}


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

@router.post("/invoices/direct", dependencies=[Depends(require_permission("purchases:write"))])
def create_supplier_invoice_direct(data: SupplierInvoiceDirectIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.lines:
        raise HTTPException(status_code=400, detail="lines is required")

    exchange_rate = Decimal(str(data.exchange_rate or 0))
    base_usd = sum([l.line_total_usd for l in data.lines])
    base_lbp = sum([l.line_total_lbp for l in data.lines])

    tax_usd = Decimal(str(data.tax.tax_usd)) if data.tax else Decimal("0")
    tax_lbp = Decimal(str(data.tax.tax_lbp)) if data.tax else Decimal("0")
    tax_usd, tax_lbp = _normalize_dual_amounts(tax_usd, tax_lbp, exchange_rate)
    total_usd = base_usd + tax_usd
    total_lbp = base_lbp + tax_lbp

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                invoice_no = data.invoice_no or _next_doc_no(cur, company_id, "PI")
                cur.execute(
                    """
                    INSERT INTO supplier_invoices
                      (id, company_id, invoice_no, supplier_id, status, total_usd, total_lbp, exchange_rate, source_event_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, 'posted', %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, invoice_no, data.supplier_id, total_usd, total_lbp, exchange_rate, None),
                )
                invoice_id = cur.fetchone()["id"]

                for l in data.lines:
                    cur.execute(
                        """
                        INSERT INTO supplier_invoice_lines
                          (id, company_id, supplier_invoice_id, item_id, qty,
                           unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            invoice_id,
                            l.item_id,
                            l.qty,
                            l.unit_cost_usd,
                            l.unit_cost_lbp,
                            l.line_total_usd,
                            l.line_total_lbp,
                        ),
                    )

                if data.tax:
                    cur.execute(
                        """
                        INSERT INTO tax_lines
                          (id, company_id, source_type, source_id, tax_code_id,
                           base_usd, base_lbp, tax_usd, tax_lbp, tax_date)
                        VALUES
                          (gen_random_uuid(), %s, 'supplier_invoice', %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            invoice_id,
                            data.tax.tax_code_id,
                            Decimal(str(data.tax.base_usd or base_usd)),
                            Decimal(str(data.tax.base_lbp or base_lbp)),
                            tax_usd,
                            tax_lbp,
                            data.tax.tax_date,
                        ),
                    )

                defaults = _fetch_account_defaults(cur, company_id)
                ap = defaults.get("AP")
                grni = defaults.get("GRNI")
                vat_rec = defaults.get("VAT_RECOVERABLE")
                if not (ap and grni):
                    raise HTTPException(status_code=400, detail="Missing AP/GRNI account defaults")

                cur.execute(
                    """
                    INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice', %s, CURRENT_DATE, 'market')
                    RETURNING id
                    """,
                    (company_id, f"GL-{invoice_no}", invoice_id),
                )
                journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'GRNI clearing')
                    """,
                    (journal_id, grni, base_usd, base_lbp),
                )

                if data.tax and (tax_usd != 0 or tax_lbp != 0) and not vat_rec:
                    raise HTTPException(status_code=400, detail="Missing VAT_RECOVERABLE account default")
                if data.tax and (tax_usd != 0 or tax_lbp != 0):
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'VAT recoverable')
                        """,
                        (journal_id, vat_rec, tax_usd, tax_lbp),
                    )

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Accounts payable')
                    """,
                    (journal_id, ap, total_usd, total_lbp),
                )

                # Optional immediate payments (posts separate payment journals like /purchases/payments).
                payment_accounts = _fetch_payment_method_accounts(cur, company_id)
                for p in data.payments or []:
                    method = (p.method or "bank").strip().lower()
                    amount_usd = Decimal(str(p.amount_usd or 0))
                    amount_lbp = Decimal(str(p.amount_lbp or 0))
                    amount_usd, amount_lbp = _normalize_dual_amounts(amount_usd, amount_lbp, exchange_rate)
                    if amount_usd == 0 and amount_lbp == 0:
                        continue
                    cur.execute(
                        """
                        INSERT INTO supplier_payments (id, supplier_invoice_id, method, amount_usd, amount_lbp)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s)
                        RETURNING id
                        """,
                        (invoice_id, method, amount_usd, amount_lbp),
                    )
                    pay_id = cur.fetchone()["id"]
                    pay_account = payment_accounts.get(method)
                    if not pay_account:
                        raise HTTPException(status_code=400, detail=f"Missing payment method mapping for {method}")
                    cur.execute(
                        """
                        INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
                        VALUES (gen_random_uuid(), %s, %s, 'supplier_payment', %s, CURRENT_DATE, 'market')
                        RETURNING id
                        """,
                        (company_id, f"SP-{str(pay_id)[:8]}", pay_id),
                    )
                    pay_journal = cur.fetchone()["id"]
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Supplier payment')
                        """,
                        (pay_journal, ap, amount_usd, amount_lbp),
                    )
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Cash/Bank out')
                        """,
                        (pay_journal, pay_account, amount_usd, amount_lbp),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps({"invoice_no": invoice_no})),
                )

                cur.execute(
                    """
                    INSERT INTO events (id, company_id, event_type, source_type, source_id, payload_json)
                    VALUES (gen_random_uuid(), %s, 'purchase.invoiced', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, invoice_id, json.dumps({"supplier_invoice_id": str(invoice_id), "invoice_no": invoice_no}, default=str)),
                )

                return {"id": invoice_id, "invoice_no": invoice_no}


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
                defaults = _fetch_account_defaults(cur, company_id)
                ap = defaults.get("AP")
                if not ap:
                    raise HTTPException(status_code=400, detail="Missing AP default")

                payment_accounts = _fetch_payment_method_accounts(cur, company_id)
                pay_account = payment_accounts.get(method)
                if not pay_account:
                    raise HTTPException(status_code=400, detail=f"Missing payment method mapping for {method}")

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
