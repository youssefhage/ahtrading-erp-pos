from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, timedelta
from decimal import Decimal
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..period_locks import assert_period_open
import json
import uuid
from backend.workers import pos_processor
from ..journal_utils import auto_balance_journal
from ..validation import CurrencyCode, PaymentMethod, DocStatus

router = APIRouter(prefix="/sales", tags=["sales"])

def _safe_journal_no(prefix: str, base: str) -> str:
    base = (base or "").strip().replace(" ", "-")
    base = "".join([c for c in base if c.isalnum() or c in {"-", "_"}])[:40]
    return f"{prefix}-{base}-{uuid.uuid4().hex[:6]}"

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

    # Idempotency: if we already created a cancel journal, reuse it.
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
    new_journal_id = cur.fetchone()["id"]

    cur.execute(
        """
        SELECT account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo
        FROM gl_entries
        WHERE journal_id = %s
        ORDER BY id
        """,
        (orig["id"],),
    )
    for e in cur.fetchall():
        cur.execute(
            """
            INSERT INTO gl_entries
              (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                new_journal_id,
                e["account_id"],
                e["credit_usd"],
                e["debit_usd"],
                e["credit_lbp"],
                e["debit_lbp"],
                (e.get("memo") or "Reversal"),
            ),
        )

    return new_journal_id

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
    method: PaymentMethod
    amount_usd: Decimal
    amount_lbp: Decimal


class SalesInvoiceIn(BaseModel):
    device_id: str
    invoice_no: Optional[str] = None
    exchange_rate: Decimal
    pricing_currency: CurrencyCode = "USD"
    settlement_currency: CurrencyCode = "USD"
    customer_id: Optional[str] = None
    warehouse_id: Optional[str] = None
    shift_id: Optional[str] = None
    lines: List[SaleLine]
    tax: Optional[TaxBlock] = None
    payments: Optional[List[PaymentBlock]] = None
    invoice_date: Optional[date] = None


class SalesReturnIn(BaseModel):
    device_id: str
    invoice_id: Optional[str] = None
    exchange_rate: Decimal
    warehouse_id: Optional[str] = None
    shift_id: Optional[str] = None
    refund_method: Optional[str] = None
    lines: List[SaleLine]
    tax: Optional[TaxBlock] = None


class SalesPaymentIn(BaseModel):
    invoice_id: str
    method: PaymentMethod
    amount_usd: Decimal
    amount_lbp: Decimal
    payment_date: Optional[date] = None
    bank_account_id: Optional[str] = None

@router.get("/payments", dependencies=[Depends(require_permission("sales:read"))])
def list_sales_payments(
    invoice_id: Optional[str] = None,
    customer_id: Optional[str] = None,
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
                SELECT p.id, p.invoice_id, i.invoice_no, i.customer_id,
                       c.name AS customer_name,
                       p.method, p.amount_usd, p.amount_lbp, p.created_at
                FROM sales_payments p
                JOIN sales_invoices i ON i.id = p.invoice_id
                LEFT JOIN customers c ON c.id = i.customer_id
                WHERE i.company_id = %s
            """
            params: list = [company_id]
            if invoice_id:
                sql += " AND p.invoice_id = %s"
                params.append(invoice_id)
            if customer_id:
                sql += " AND i.customer_id = %s"
                params.append(customer_id)
            if date_from:
                sql += " AND p.created_at::date >= %s"
                params.append(date_from)
            if date_to:
                sql += " AND p.created_at::date <= %s"
                params.append(date_to)
            sql += " ORDER BY p.created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            return {"payments": cur.fetchall()}

@router.get("/invoices", dependencies=[Depends(require_permission("sales:read"))])
def list_sales_invoices(
    company_id: str = Depends(get_company_id),
    limit: Optional[int] = None,
    offset: int = 0,
    q: Optional[str] = None,
    status: Optional[DocStatus] = None,
    customer_id: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    sort: Optional[str] = None,
    dir: Optional[str] = None,
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            if limit is not None and (limit <= 0 or limit > 500):
                raise HTTPException(status_code=400, detail="limit must be between 1 and 500")
            if offset < 0:
                raise HTTPException(status_code=400, detail="offset must be >= 0")

            sort_allow = {
                "created_at": "i.created_at",
                "invoice_date": "i.invoice_date",
                "invoice_no": "i.invoice_no",
                "status": "i.status",
                "total_usd": "i.total_usd",
                "total_lbp": "i.total_lbp",
            }
            sort_sql = sort_allow.get((sort or "").strip() or "created_at", "i.created_at")
            dir_sql = "ASC" if (dir or "").lower() == "asc" else "DESC"

            base_sql = """
                FROM sales_invoices i
                LEFT JOIN customers c
                  ON c.company_id = i.company_id AND c.id = i.customer_id
                LEFT JOIN warehouses w
                  ON w.company_id = i.company_id AND w.id = i.warehouse_id
                WHERE i.company_id = %s
            """
            params: list = [company_id]

            if status:
                base_sql += " AND i.status = %s"
                params.append(status)
            if customer_id:
                base_sql += " AND i.customer_id = %s"
                params.append(customer_id)
            if warehouse_id:
                base_sql += " AND i.warehouse_id = %s"
                params.append(warehouse_id)
            if date_from:
                base_sql += " AND i.created_at::date >= %s"
                params.append(date_from)
            if date_to:
                base_sql += " AND i.created_at::date <= %s"
                params.append(date_to)
            if q:
                needle = f"%{q.strip()}%"
                base_sql += """
                  AND (
                    COALESCE(i.invoice_no, '') ILIKE %s
                    OR COALESCE(c.name, '') ILIKE %s
                    OR COALESCE(w.name, '') ILIKE %s
                    OR i.id::text ILIKE %s
                  )
                """
                params.extend([needle, needle, needle, needle])

            select_sql = f"""
                SELECT i.id, i.invoice_no, i.customer_id, c.name AS customer_name,
                       i.status, i.total_usd, i.total_lbp, i.warehouse_id, w.name AS warehouse_name,
                       i.invoice_date, i.due_date, i.created_at
                {base_sql}
                ORDER BY {sort_sql} {dir_sql}
            """

            # Backwards compatibility: if no pagination params are provided, return the full legacy list.
            if limit is None:
                cur.execute(select_sql, params)
                return {"invoices": cur.fetchall()}

            cur.execute(f"SELECT COUNT(*)::int AS total {base_sql}", params)
            total = cur.fetchone()["total"]

            cur.execute(select_sql + " LIMIT %s OFFSET %s", params + [limit, offset])
            return {"invoices": cur.fetchall(), "total": total, "limit": limit, "offset": offset}

@router.get("/invoices/{invoice_id}", dependencies=[Depends(require_permission("sales:read"))])
def get_sales_invoice(invoice_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.invoice_no, i.customer_id, c.name AS customer_name, i.status,
                       i.total_usd, i.total_lbp, i.exchange_rate, i.warehouse_id, w.name AS warehouse_name,
                       i.pricing_currency, i.settlement_currency,
                       i.invoice_date, i.due_date, i.created_at
                FROM sales_invoices i
                LEFT JOIN customers c
                  ON c.company_id = i.company_id AND c.id = i.customer_id
                LEFT JOIN warehouses w
                  ON w.company_id = i.company_id AND w.id = i.warehouse_id
                WHERE i.company_id = %s AND i.id = %s
                """,
                (company_id, invoice_id),
            )
            inv = cur.fetchone()
            if not inv:
                raise HTTPException(status_code=404, detail="invoice not found")

            cur.execute(
                """
                SELECT l.id, l.item_id, it.sku AS item_sku, it.name AS item_name, l.qty,
                       unit_price_usd, unit_price_lbp,
                       line_total_usd, line_total_lbp
                FROM sales_invoice_lines l
                LEFT JOIN items it
                  ON it.company_id = %s AND it.id = l.item_id
                WHERE l.invoice_id = %s
                ORDER BY l.id
                """,
                (company_id, invoice_id),
            )
            lines = cur.fetchall()

            cur.execute(
                """
                SELECT id, method, amount_usd, amount_lbp, created_at
                FROM sales_payments
                WHERE invoice_id = %s
                ORDER BY created_at ASC
                """,
                (invoice_id,),
            )
            payments = cur.fetchall()

            cur.execute(
                """
                SELECT id, tax_code_id, base_usd, base_lbp, tax_usd, tax_lbp, tax_date, created_at
                FROM tax_lines
                WHERE company_id = %s AND source_type = 'sales_invoice' AND source_id = %s
                ORDER BY created_at ASC
                """,
                (company_id, invoice_id),
            )
            tax_lines = cur.fetchall()

            return {"invoice": inv, "lines": lines, "payments": payments, "tax_lines": tax_lines}

class SalesInvoiceDraftLineIn(BaseModel):
    item_id: str
    qty: Decimal
    unit_price_usd: Decimal = Decimal("0")
    unit_price_lbp: Decimal = Decimal("0")

class SalesInvoiceDraftIn(BaseModel):
    customer_id: Optional[str] = None
    warehouse_id: str
    invoice_no: Optional[str] = None
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    exchange_rate: Decimal = Decimal("0")
    pricing_currency: CurrencyCode = "USD"
    settlement_currency: CurrencyCode = "USD"
    # Allow creating an empty draft (header-first); posting will require lines.
    lines: List[SalesInvoiceDraftLineIn] = []

class SalesInvoiceDraftUpdateIn(BaseModel):
    customer_id: Optional[str] = None
    warehouse_id: Optional[str] = None
    invoice_no: Optional[str] = None
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    exchange_rate: Optional[Decimal] = None
    pricing_currency: Optional[CurrencyCode] = None
    settlement_currency: Optional[CurrencyCode] = None
    # Replaces all lines if provided; drafts may be temporarily empty.
    lines: Optional[List[SalesInvoiceDraftLineIn]] = None

class SalesInvoicePostIn(BaseModel):
    apply_vat: bool = True
    payments: Optional[List[PaymentBlock]] = None


class CancelDraftIn(BaseModel):
    reason: Optional[str] = None

@router.get("/invoices/{invoice_id}/post-preview", dependencies=[Depends(require_permission("sales:read"))])
def preview_sales_invoice_post(invoice_id: str, apply_vat: bool = True, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, status, exchange_rate, warehouse_id
                FROM sales_invoices
                WHERE company_id = %s AND id = %s
                """,
                (company_id, invoice_id),
            )
            inv = cur.fetchone()
            if not inv:
                raise HTTPException(status_code=404, detail="invoice not found")

            cur.execute(
                """
                SELECT line_total_usd, line_total_lbp
                FROM sales_invoice_lines
                WHERE invoice_id = %s
                """,
                (invoice_id,),
            )
            lines = cur.fetchall()
            base_usd = sum([Decimal(str(l["line_total_usd"] or 0)) for l in lines])
            base_lbp = sum([Decimal(str(l["line_total_lbp"] or 0)) for l in lines])

            exchange_rate = Decimal(str(inv["exchange_rate"] or 0))
            tax_code_id = None
            vat_rate = Decimal("0")
            if apply_vat:
                cur.execute(
                    """
                    SELECT id, rate
                    FROM tax_codes
                    WHERE company_id = %s AND tax_type = 'vat'
                    ORDER BY name
                    LIMIT 1
                    """,
                    (company_id,),
                )
                vat = cur.fetchone()
                if vat:
                    tax_code_id = vat["id"]
                    vat_rate = Decimal(str(vat["rate"] or 0))

            tax_lbp = base_lbp * vat_rate if (tax_code_id and vat_rate) else Decimal("0")
            tax_usd = (tax_lbp / exchange_rate) if exchange_rate else Decimal("0")
            tax_usd, tax_lbp = _normalize_dual_amounts(tax_usd, tax_lbp, exchange_rate)

            total_usd = base_usd + tax_usd
            total_lbp = base_lbp + tax_lbp
            return {
                "base_usd": base_usd,
                "base_lbp": base_lbp,
                "tax_code_id": tax_code_id,
                "tax_usd": tax_usd,
                "tax_lbp": tax_lbp,
                "total_usd": total_usd,
                "total_lbp": total_lbp,
            }


@router.post("/invoices/drafts", dependencies=[Depends(require_permission("sales:write"))])
def create_sales_invoice_draft(data: SalesInvoiceDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.warehouse_id:
        raise HTTPException(status_code=400, detail="warehouse_id is required")

    inv_date = data.invoice_date or date.today()
    due_date = data.due_date or inv_date
    if due_date < inv_date:
        raise HTTPException(status_code=400, detail="due_date cannot be before invoice_date")
    # Drafts are allowed even if the period is locked; posting will enforce the lock.

    base_usd = Decimal("0")
    base_lbp = Decimal("0")
    lines_norm: list[dict] = []
    for l in (data.lines or []):
        if l.qty <= 0:
            raise HTTPException(status_code=400, detail="qty must be > 0")
        unit_usd = Decimal(str(l.unit_price_usd or 0))
        unit_lbp = Decimal(str(l.unit_price_lbp or 0))
        if unit_usd == 0 and unit_lbp == 0:
            raise HTTPException(status_code=400, detail="unit_price_usd or unit_price_lbp must be set")
        line_usd = unit_usd * l.qty
        line_lbp = unit_lbp * l.qty
        if line_lbp == 0 and data.exchange_rate:
            line_lbp = line_usd * data.exchange_rate
        if line_usd == 0 and data.exchange_rate:
            line_usd = line_lbp / data.exchange_rate
        base_usd += line_usd
        base_lbp += line_lbp
        lines_norm.append(
            {
                "item_id": l.item_id,
                "qty": l.qty,
                "unit_price_usd": unit_usd,
                "unit_price_lbp": unit_lbp,
                "line_total_usd": line_usd,
                "line_total_lbp": line_lbp,
            }
        )

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                if not data.due_date and data.customer_id:
                    cur.execute(
                        """
                        SELECT payment_terms_days
                        FROM customers
                        WHERE company_id=%s AND id=%s
                        """,
                        (company_id, data.customer_id),
                    )
                    row = cur.fetchone()
                    terms = int(row["payment_terms_days"] or 0) if row else 0
                    due_date = inv_date + timedelta(days=max(0, terms))

                invoice_no = (data.invoice_no or "").strip() or _next_doc_no(cur, company_id, "SI")
                cur.execute(
                    """
                    INSERT INTO sales_invoices
                      (id, company_id, invoice_no, customer_id, status, total_usd, total_lbp,
                       warehouse_id, exchange_rate, pricing_currency, settlement_currency, invoice_date, due_date)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        invoice_no,
                        data.customer_id,
                        base_usd,
                        base_lbp,
                        data.warehouse_id,
                        data.exchange_rate,
                        data.pricing_currency,
                        data.settlement_currency,
                        inv_date,
                        due_date,
                    ),
                )
                invoice_id = cur.fetchone()["id"]

                for l in lines_norm:
                    cur.execute(
                        """
                        INSERT INTO sales_invoice_lines
                          (id, invoice_id, item_id, qty, unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            invoice_id,
                            l["item_id"],
                            l["qty"],
                            l["unit_price_usd"],
                            l["unit_price_lbp"],
                            l["line_total_usd"],
                            l["line_total_lbp"],
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'sales_invoice_draft_create', 'sales_invoice', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        invoice_id,
                        json.dumps({"invoice_no": invoice_no, "lines": len(lines_norm)}, default=str),
                    ),
                )
                return {"id": invoice_id, "invoice_no": invoice_no}


@router.patch("/invoices/{invoice_id}", dependencies=[Depends(require_permission("sales:write"))])
def update_sales_invoice_draft(invoice_id: str, data: SalesInvoiceDraftUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, exchange_rate, invoice_date, due_date, customer_id
                    FROM sales_invoices
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="invoice not found")
                if inv["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft invoices can be edited")

                # If customer_id/invoice_date changes and due_date isn't explicitly set, keep the draft consistent by
                # recomputing due_date from payment terms. This avoids stale due dates.
                if ("customer_id" in patch or "invoice_date" in patch) and ("due_date" not in patch):
                    next_inv_date = patch.get("invoice_date") or inv["invoice_date"] or date.today()
                    next_customer_id = patch.get("customer_id") if "customer_id" in patch else inv["customer_id"]
                    next_due = next_inv_date
                    if next_customer_id:
                        cur.execute(
                            """
                            SELECT payment_terms_days
                            FROM customers
                            WHERE company_id=%s AND id=%s
                            """,
                            (company_id, next_customer_id),
                        )
                        row = cur.fetchone()
                        terms = int(row["payment_terms_days"] or 0) if row else 0
                        next_due = next_inv_date + timedelta(days=max(0, terms))
                    patch["due_date"] = next_due

                # Validate due_date if provided.
                if "due_date" in patch:
                    next_inv_date = patch.get("invoice_date") or inv["invoice_date"] or date.today()
                    if patch["due_date"] and patch["due_date"] < next_inv_date:
                        raise HTTPException(status_code=400, detail="due_date cannot be before invoice_date")

                if "lines" in patch:
                    lines_in = data.lines or []
                    # Replace lines.
                    cur.execute("DELETE FROM sales_invoice_lines WHERE invoice_id = %s", (invoice_id,))

                    base_usd = Decimal("0")
                    base_lbp = Decimal("0")
                    exchange_rate = Decimal(str(patch.get("exchange_rate") or inv["exchange_rate"] or 0))
                    for l in (lines_in or []):
                        if l.qty <= 0:
                            raise HTTPException(status_code=400, detail="qty must be > 0")
                        unit_usd = Decimal(str(l.unit_price_usd or 0))
                        unit_lbp = Decimal(str(l.unit_price_lbp or 0))
                        if unit_usd == 0 and unit_lbp == 0:
                            raise HTTPException(status_code=400, detail="unit_price_usd or unit_price_lbp must be set")
                        line_usd = unit_usd * l.qty
                        line_lbp = unit_lbp * l.qty
                        if line_lbp == 0 and exchange_rate:
                            line_lbp = line_usd * exchange_rate
                        if line_usd == 0 and exchange_rate:
                            line_usd = line_lbp / exchange_rate
                        base_usd += line_usd
                        base_lbp += line_lbp
                        cur.execute(
                            """
                            INSERT INTO sales_invoice_lines
                              (id, invoice_id, item_id, qty, unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (invoice_id, l.item_id, l.qty, unit_usd, unit_lbp, line_usd, line_lbp),
                        )
                    # Update totals alongside other fields.
                    patch["total_usd"] = base_usd
                    patch["total_lbp"] = base_lbp

                if "invoice_no" in patch:
                    patch["invoice_no"] = (patch["invoice_no"] or "").strip() or None
                    if not patch["invoice_no"]:
                        patch.pop("invoice_no", None)

                fields = []
                params = []
                for k, v in patch.items():
                    if k == "lines":
                        continue
                    fields.append(f"{k} = %s")
                    params.append(v)
                if fields:
                    params.extend([company_id, invoice_id])
                    cur.execute(
                        f"""
                        UPDATE sales_invoices
                        SET {', '.join(fields)}
                        WHERE company_id = %s AND id = %s
                        """,
                        params,
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'sales_invoice_draft_update', 'sales_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps(list(patch.keys()))),
                )
                return {"ok": True}


@router.post("/invoices/{invoice_id}/post", dependencies=[Depends(require_permission("sales:write"))])
def post_sales_invoice_draft(invoice_id: str, data: SalesInvoicePostIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Posts a draft invoice:
    - Creates stock moves (warehouse required)
    - Posts GL (sales, VAT, AR/cash, COGS/inventory)
    - Sets status = posted
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, invoice_no, customer_id, status, warehouse_id,
                           exchange_rate, pricing_currency, settlement_currency,
                           invoice_date, due_date, COALESCE(doc_subtype,'standard') AS doc_subtype
                    FROM sales_invoices
                    WHERE company_id = %s AND id = %s
                    FOR UPDATE
                    """,
                    (company_id, invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="invoice not found")
                if inv["status"] != "draft":
                    raise HTTPException(status_code=400, detail="invoice is not in draft status")
                if inv["doc_subtype"] != "opening_balance":
                    if not inv["warehouse_id"]:
                        raise HTTPException(status_code=400, detail="warehouse_id is required to post (inventory/COGS)")

                inv_date = inv["invoice_date"] or date.today()
                assert_period_open(cur, company_id, inv_date)

                # Safety: must not have prior posting artifacts.
                cur.execute("SELECT 1 FROM gl_journals WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s LIMIT 1", (company_id, invoice_id))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="invoice already has a GL journal")
                cur.execute("SELECT 1 FROM stock_moves WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s LIMIT 1", (company_id, invoice_id))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="invoice already has stock moves")
                cur.execute("SELECT 1 FROM tax_lines WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s LIMIT 1", (company_id, invoice_id))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="invoice already has tax lines")
                cur.execute("SELECT 1 FROM sales_payments WHERE invoice_id=%s LIMIT 1", (invoice_id,))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="invoice already has payments")

                # Load lines.
                cur.execute(
                    """
                    SELECT item_id, qty, unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp
                    FROM sales_invoice_lines
                    WHERE invoice_id = %s
                    ORDER BY id
                    """,
                    (invoice_id,),
                )
                lines = cur.fetchall()
                if not lines:
                    raise HTTPException(status_code=400, detail="invoice has no lines")

                exchange_rate = Decimal(str(inv["exchange_rate"] or 0))
                base_usd = sum([Decimal(str(l["line_total_usd"] or 0)) for l in lines])
                base_lbp = sum([Decimal(str(l["line_total_lbp"] or 0)) for l in lines])

                tax_code_id = None
                vat_rate = Decimal("0")
                if data.apply_vat:
                    if inv["doc_subtype"] == "opening_balance":
                        raise HTTPException(status_code=400, detail="opening balance invoices cannot apply VAT")
                    cur.execute(
                        """
                        SELECT id, rate
                        FROM tax_codes
                        WHERE company_id = %s AND tax_type = 'vat'
                        ORDER BY name
                        LIMIT 1
                        """,
                        (company_id,),
                    )
                    vat = cur.fetchone()
                    if vat:
                        tax_code_id = vat["id"]
                        vat_rate = Decimal(str(vat["rate"] or 0))

                tax_lbp = base_lbp * vat_rate if (tax_code_id and vat_rate) else Decimal("0")
                tax_usd = (tax_lbp / exchange_rate) if exchange_rate else Decimal("0")
                tax_usd, tax_lbp = _normalize_dual_amounts(tax_usd, tax_lbp, exchange_rate)

                total_usd = base_usd + tax_usd
                total_lbp = base_lbp + tax_lbp

                # Normalize payments; if no payments => credit sale.
                payments = []
                for p in (data.payments or []):
                    method = (p.method or "cash").strip().lower()
                    amount_usd = Decimal(str(p.amount_usd or 0))
                    amount_lbp = Decimal(str(p.amount_lbp or 0))
                    amount_usd, amount_lbp = _normalize_dual_amounts(amount_usd, amount_lbp, exchange_rate)
                    if amount_usd == 0 and amount_lbp == 0:
                        continue
                    payments.append({"method": method, "amount_usd": amount_usd, "amount_lbp": amount_lbp})

                total_paid_usd = sum([Decimal(str(p["amount_usd"])) for p in payments])
                total_paid_lbp = sum([Decimal(str(p["amount_lbp"])) for p in payments])
                credit_usd = total_usd - total_paid_usd
                credit_lbp = total_lbp - total_paid_lbp
                eps_usd = Decimal("0.01")
                eps_lbp = Decimal("100")
                # Allow tiny rounding drift (USD decimals / LBP conversion) without forcing a credit sale.
                if credit_usd < -eps_usd or credit_lbp < -eps_lbp:
                    raise HTTPException(status_code=400, detail="payments exceed invoice total")
                if abs(credit_usd) <= eps_usd:
                    credit_usd = Decimal("0")
                if abs(credit_lbp) <= eps_lbp:
                    credit_lbp = Decimal("0")

                credit_sale = credit_usd > eps_usd or credit_lbp > eps_lbp
                customer_id = inv["customer_id"]
                due_date = inv["due_date"] or inv_date
                if credit_sale:
                    if not customer_id:
                        raise HTTPException(status_code=400, detail="credit sale requires customer_id")
                    cur.execute(
                        """
                        SELECT credit_limit_usd, credit_limit_lbp, credit_balance_usd, credit_balance_lbp, payment_terms_days
                        FROM customers
                        WHERE company_id = %s AND id = %s
                        """,
                        (company_id, customer_id),
                    )
                    crow = cur.fetchone()
                    if not crow:
                        raise HTTPException(status_code=400, detail="customer not found")
                    if crow["credit_limit_usd"] and (crow["credit_balance_usd"] + credit_usd) > crow["credit_limit_usd"]:
                        raise HTTPException(status_code=400, detail="credit limit exceeded (USD)")
                    if crow["credit_limit_lbp"] and (crow["credit_balance_lbp"] + credit_lbp) > crow["credit_limit_lbp"]:
                        raise HTTPException(status_code=400, detail="credit limit exceeded (LBP)")
                    terms = int(crow.get("payment_terms_days") or 0)
                    if terms > 0:
                        due_date = inv_date + timedelta(days=terms)

                # Resolve costs + compute total COGS.
                total_cost_usd = Decimal("0")
                total_cost_lbp = Decimal("0")
                resolved_lines = []
                if inv["doc_subtype"] != "opening_balance":
                    # Inventory policy controls whether we allow overselling (negative stock) for untracked items.
                    inv_policy = pos_processor.fetch_inventory_policy(cur, company_id)
                    allow_negative_stock = bool(inv_policy.get("allow_negative_stock"))

                    # Fetch item tracking policy so FEFO allocation doesn't create "unbatched" remainder for tracked items.
                    item_ids = sorted({str(l["item_id"]) for l in (lines or []) if l.get("item_id")})
                    item_policy = {}
                    if item_ids:
                        cur.execute(
                            """
                            SELECT id, track_batches, track_expiry, min_shelf_life_days_for_sale
                            FROM items
                            WHERE company_id=%s AND id = ANY(%s::uuid[])
                            """,
                            (company_id, item_ids),
                        )
                        item_policy = {str(r["id"]): r for r in cur.fetchall()}

                    for l in lines:
                        qty = Decimal(str(l["qty"] or 0))
                        unit_cost_usd, unit_cost_lbp = pos_processor.get_avg_cost(cur, company_id, l["item_id"], inv["warehouse_id"])
                        total_cost_usd += qty * unit_cost_usd
                        total_cost_lbp += qty * unit_cost_lbp
                        resolved_lines.append({**l, "_unit_cost_usd": unit_cost_usd, "_unit_cost_lbp": unit_cost_lbp})

                    # Stock moves (FEFO allocation).
                    for l in resolved_lines:
                        pol = item_policy.get(str(l["item_id"])) or {}
                        min_days = int(pol.get("min_shelf_life_days_for_sale") or 0)
                        min_exp = (inv_date + timedelta(days=min_days)) if min_days > 0 else None
                        allow_unbatched = not (bool(pol.get("track_batches")) or bool(pol.get("track_expiry")) or min_days > 0)
                        allocations = pos_processor.allocate_fefo_batches(
                            cur,
                            company_id,
                            l["item_id"],
                            inv["warehouse_id"],
                            Decimal(str(l["qty"] or 0)),
                            min_expiry_date=min_exp,
                            allow_unbatched_remainder=allow_unbatched,
                            allow_negative_stock=allow_negative_stock,
                        )
                        for batch_id, q in allocations:
                            cur.execute(
                                """
                                INSERT INTO stock_moves
                                  (id, company_id, item_id, warehouse_id, batch_id, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                                   source_type, source_id)
                                VALUES
                                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, 'sales_invoice', %s)
                                """,
                                (company_id, l["item_id"], inv["warehouse_id"], batch_id, q, l["_unit_cost_usd"], l["_unit_cost_lbp"], inv_date, invoice_id),
                            )

                # Tax line.
                if tax_code_id and (tax_usd != 0 or tax_lbp != 0):
                    cur.execute(
                        """
                        INSERT INTO tax_lines
                          (id, company_id, source_type, source_id, tax_code_id,
                           base_usd, base_lbp, tax_usd, tax_lbp, tax_date)
                        VALUES
                          (gen_random_uuid(), %s, 'sales_invoice', %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (company_id, invoice_id, tax_code_id, base_usd, base_lbp, tax_usd, tax_lbp, inv_date),
                    )

                # Persist payments (for history) and GL cash/bank lines are posted in the same journal.
                for p in payments:
                    cur.execute(
                        """
                        INSERT INTO sales_payments (id, invoice_id, method, amount_usd, amount_lbp)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s)
                        """,
                        (invoice_id, p["method"], p["amount_usd"], p["amount_lbp"]),
                    )

                defaults = _fetch_account_defaults(cur, company_id)
                ar = defaults.get("AR")
                sales = defaults.get("SALES")
                vat_payable = defaults.get("VAT_PAYABLE")
                inventory = defaults.get("INVENTORY")
                cogs = defaults.get("COGS")
                opening_bal = defaults.get("OPENING_BALANCE") or defaults.get("OPENING_STOCK")
                if inv["doc_subtype"] == "opening_balance":
                    if not opening_bal:
                        raise HTTPException(status_code=400, detail="Missing OPENING_BALANCE (or OPENING_STOCK fallback) account default")
                else:
                    if not sales:
                        raise HTTPException(status_code=400, detail="Missing SALES account default")

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'sales_invoice', %s, %s, 'market', %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        f"GL-{inv['invoice_no']}",
                        invoice_id,
                        inv_date,
                        inv.get("exchange_rate") or 0,
                        f"Sales invoice {inv['invoice_no']}",
                        user["user_id"],
                    ),
                )
                journal_id = cur.fetchone()["id"]

                payment_accounts = _fetch_payment_method_accounts(cur, company_id)
                for p in payments:
                    acc = payment_accounts.get(p["method"])
                    if not acc:
                        raise HTTPException(status_code=400, detail=f"Missing payment method mapping for {p['method']}")
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Sales receipt', %s)
                        """,
                        (journal_id, acc, p["amount_usd"], p["amount_lbp"], inv.get("warehouse_id")),
                    )

                if credit_sale:
                    if not ar:
                        raise HTTPException(status_code=400, detail="Missing AR account default")
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Sales receivable', %s)
                        """,
                        (journal_id, ar, credit_usd, credit_lbp, inv.get("warehouse_id")),
                    )

                if inv["doc_subtype"] == "opening_balance":
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Opening balance offset', %s)
                        """,
                        (journal_id, opening_bal, base_usd, base_lbp, inv.get("warehouse_id")),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Sales revenue', %s)
                        """,
                        (journal_id, sales, base_usd, base_lbp, inv.get("warehouse_id")),
                    )

                if tax_code_id and (tax_usd != 0 or tax_lbp != 0):
                    if not vat_payable:
                        raise HTTPException(status_code=400, detail="Missing VAT_PAYABLE account default")
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'VAT payable', %s)
                        """,
                        (journal_id, vat_payable, tax_usd, tax_lbp, inv.get("warehouse_id")),
                    )

                if inv["doc_subtype"] != "opening_balance" and (total_cost_usd > 0 or total_cost_lbp > 0):
                    if not (inventory and cogs):
                        raise HTTPException(status_code=400, detail="Missing INVENTORY/COGS account defaults")
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'COGS', %s)
                        """,
                        (journal_id, cogs, total_cost_usd, total_cost_lbp, inv.get("warehouse_id")),
                    )
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory reduction', %s)
                        """,
                        (journal_id, inventory, total_cost_usd, total_cost_lbp, inv.get("warehouse_id")),
                    )

                if customer_id and credit_sale:
                    cur.execute(
                        """
                        UPDATE customers
                        SET credit_balance_usd = credit_balance_usd + %s,
                            credit_balance_lbp = credit_balance_lbp + %s
                        WHERE company_id = %s AND id = %s
                        """,
                        (credit_usd, credit_lbp, company_id, customer_id),
                    )

                # Loyalty points (optional; configured via company_settings key='loyalty').
                # Idempotent via unique index on (company_id, source_type, source_id).
                if customer_id:
                    p_usd, p_lbp = pos_processor.fetch_loyalty_policy(cur, company_id)
                    pts = (total_usd * p_usd) + (total_lbp * p_lbp)
                    pos_processor.apply_loyalty_points(cur, company_id, str(customer_id), "sales_invoice", str(invoice_id), pts)

                cur.execute(
                    """
                    UPDATE sales_invoices
                    SET status='posted', total_usd=%s, total_lbp=%s, due_date=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (total_usd, total_lbp, due_date, company_id, invoice_id),
                )

                # Ensure journal is balanced (handles tiny rounding drift).
                try:
                    auto_balance_journal(cur, company_id, journal_id, warehouse_id=inv.get("warehouse_id"))
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'sales_invoice_post', 'sales_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps({"journal_id": str(journal_id)})),
                )

                return {"ok": True, "journal_id": journal_id}

class SalesInvoiceCancelIn(BaseModel):
    cancel_date: Optional[date] = None
    reason: Optional[str] = None

@router.post("/invoices/{invoice_id}/cancel", dependencies=[Depends(require_permission("sales:write"))])
def cancel_sales_invoice(invoice_id: str, data: SalesInvoiceCancelIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Void a posted sales invoice by reversing its GL journal, tax lines, and stock moves.
    Guardrails:
    - Cannot cancel if payments exist.
    - Cannot cancel if posted returns exist against the invoice.
    """
    cancel_date = data.cancel_date or date.today()
    reason = (data.reason or "").strip() or None

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, cancel_date)

                cur.execute(
                    """
                    SELECT id, invoice_no, status, customer_id, total_usd, total_lbp, COALESCE(doc_subtype,'standard') AS doc_subtype
                    FROM sales_invoices
                    WHERE company_id = %s AND id = %s
                    FOR UPDATE
                    """,
                    (company_id, invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="invoice not found")
                if inv["status"] == "canceled":
                    return {"ok": True}
                if inv["status"] != "posted":
                    raise HTTPException(status_code=400, detail="only posted invoices can be canceled")

                cur.execute("SELECT 1 FROM sales_payments WHERE invoice_id=%s LIMIT 1", (invoice_id,))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="cannot cancel an invoice with payments; use a return/credit note flow")

                cur.execute(
                    """
                    SELECT 1
                    FROM sales_returns
                    WHERE company_id=%s AND invoice_id=%s AND status='posted'
                    LIMIT 1
                    """,
                    (company_id, invoice_id),
                )
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="cannot cancel an invoice with posted returns")

                # Reverse stock moves (sale reduces stock -> cancel restores stock).
                # Opening-balance invoices are financial-only and do not have stock moves.
                if inv["doc_subtype"] != "opening_balance":
                    cur.execute(
                        """
                        SELECT item_id, warehouse_id, batch_id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp
                        FROM stock_moves
                        WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
                        ORDER BY created_at ASC, id ASC
                        """,
                        (company_id, invoice_id),
                    )
                    moves = cur.fetchall()
                    if not moves:
                        raise HTTPException(status_code=400, detail="missing stock moves for invoice")

                    # Idempotency: don't insert duplicates.
                    cur.execute(
                        "SELECT 1 FROM stock_moves WHERE company_id=%s AND source_type='sales_invoice_cancel' AND source_id=%s LIMIT 1",
                        (company_id, invoice_id),
                    )
                    if not cur.fetchone():
                        for m in moves:
                            q_out = Decimal(str(m["qty_out"] or 0))
                            if q_out <= 0:
                                continue
                            cur.execute(
                                """
                                INSERT INTO stock_moves
                                  (id, company_id, item_id, warehouse_id, batch_id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                                   source_type, source_id)
                                VALUES
                                  (gen_random_uuid(), %s, %s, %s, %s, %s, 0, %s, %s, %s, 'sales_invoice_cancel', %s)
                                """,
                                (
                                    company_id,
                                    m["item_id"],
                                    m["warehouse_id"],
                                    m["batch_id"],
                                    q_out,
                                    m["unit_cost_usd"],
                                    m["unit_cost_lbp"],
                                    cancel_date,
                                    invoice_id,
                                ),
                            )

                # Reverse tax lines so VAT report nets to zero.
                cur.execute(
                    """
                    SELECT tax_code_id, base_usd, base_lbp, tax_usd, tax_lbp
                    FROM tax_lines
                    WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
                    ORDER BY created_at ASC, id ASC
                    """,
                    (company_id, invoice_id),
                )
                tax_lines = cur.fetchall()
                cur.execute(
                    "SELECT 1 FROM tax_lines WHERE company_id=%s AND source_type='sales_invoice_cancel' AND source_id=%s LIMIT 1",
                    (company_id, invoice_id),
                )
                if tax_lines and not cur.fetchone():
                    for t in tax_lines:
                        cur.execute(
                            """
                            INSERT INTO tax_lines
                              (id, company_id, source_type, source_id, tax_code_id,
                               base_usd, base_lbp, tax_usd, tax_lbp, tax_date)
                            VALUES
                              (gen_random_uuid(), %s, 'sales_invoice_cancel', %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                company_id,
                                invoice_id,
                                t["tax_code_id"],
                                -Decimal(str(t["base_usd"] or 0)),
                                -Decimal(str(t["base_lbp"] or 0)),
                                -Decimal(str(t["tax_usd"] or 0)),
                                -Decimal(str(t["tax_lbp"] or 0)),
                                cancel_date,
                            ),
                        )

                # Reverse GL journal.
                memo = f"Void sales invoice {inv['invoice_no']}" + (f" ({reason})" if reason else "")
                void_journal_id = _reverse_gl_journal(
                    cur,
                    company_id,
                    "sales_invoice",
                    invoice_id,
                    "sales_invoice_cancel",
                    cancel_date,
                    user["user_id"],
                    memo,
                )

                cur.execute(
                    """
                    UPDATE sales_invoices
                    SET status='canceled',
                        canceled_at=now(),
                        canceled_by_user_id=%s,
                        cancel_reason=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], reason, company_id, invoice_id),
                )

                # Reverse customer credit balance (credit invoices have no payments; cash/bank invoices can't be canceled).
                if inv.get("customer_id"):
                    cur.execute(
                        """
                        UPDATE customers
                        SET credit_balance_usd = GREATEST(credit_balance_usd - %s, 0),
                            credit_balance_lbp = GREATEST(credit_balance_lbp - %s, 0),
                            updated_at = now()
                        WHERE company_id=%s AND id=%s
                        """,
                        (
                            Decimal(str(inv.get("total_usd") or 0)),
                            Decimal(str(inv.get("total_lbp") or 0)),
                            company_id,
                            inv["customer_id"],
                        ),
                    )

                    # Reverse loyalty points using the original points for the invoice (policy may have changed).
                    cur.execute(
                        """
                        SELECT COALESCE(SUM(points), 0) AS points
                        FROM customer_loyalty_ledger
                        WHERE company_id=%s AND customer_id=%s AND source_type='sales_invoice' AND source_id=%s
                        """,
                        (company_id, inv["customer_id"], invoice_id),
                    )
                    pts_row = cur.fetchone() or {}
                    orig_pts = Decimal(str((pts_row.get("points") or 0)))
                    pos_processor.apply_loyalty_points(cur, company_id, str(inv["customer_id"]), "sales_invoice_cancel", str(invoice_id), -orig_pts)

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'sales_invoice_canceled', 'sales_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps({"invoice_no": inv["invoice_no"], "journal_id": str(void_journal_id), "reason": reason})),
                )
                return {"ok": True, "journal_id": void_journal_id}


@router.post("/invoices/{invoice_id}/cancel-draft", dependencies=[Depends(require_permission("sales:write"))])
def cancel_sales_invoice_draft(invoice_id: str, data: CancelDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Cancel a draft invoice (no stock/GL/tax reversals required).
    Posted invoices must be canceled via /cancel (void).
    """
    reason = (data.reason or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status
                    FROM sales_invoices
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="invoice not found")
                if inv["status"] == "canceled":
                    return {"ok": True}
                if inv["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft invoices can be canceled with this endpoint")

                cur.execute(
                    """
                    UPDATE sales_invoices
                    SET status='canceled',
                        canceled_at=now(),
                        canceled_by_user_id=%s,
                        cancel_reason=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], reason, company_id, invoice_id),
                )
                cur.execute("DELETE FROM sales_invoice_lines WHERE invoice_id=%s", (invoice_id,))
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'sales_invoice_draft_canceled', 'sales_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps({"reason": reason})),
                )
                return {"ok": True}


@router.get("/returns", dependencies=[Depends(require_permission("sales:read"))])
def list_sales_returns(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, return_no, invoice_id, warehouse_id, device_id, shift_id, refund_method,
                       status, total_usd, total_lbp, created_at
                FROM sales_returns
                WHERE company_id = %s
                ORDER BY created_at DESC
                """,
                (company_id,),
            )
            return {"returns": cur.fetchall()}


@router.get("/returns/{return_id}", dependencies=[Depends(require_permission("sales:read"))])
def get_sales_return(return_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, return_no, invoice_id, warehouse_id, device_id, shift_id, refund_method,
                       status, total_usd, total_lbp, exchange_rate, created_at
                FROM sales_returns
                WHERE company_id = %s AND id = %s
                """,
                (company_id, return_id),
            )
            ret = cur.fetchone()
            if not ret:
                raise HTTPException(status_code=404, detail="return not found")
            cur.execute(
                """
                SELECT id, item_id, qty,
                       unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp,
                       unit_cost_usd, unit_cost_lbp
                FROM sales_return_lines
                WHERE company_id = %s AND sales_return_id = %s
                ORDER BY id
                """,
                (company_id, return_id),
            )
            lines = cur.fetchall()
            cur.execute(
                """
                SELECT id, tax_code_id, base_usd, base_lbp, tax_usd, tax_lbp, tax_date, created_at
                FROM tax_lines
                WHERE company_id = %s AND source_type = 'sales_return' AND source_id = %s
                ORDER BY created_at ASC
                """,
                (company_id, return_id),
            )
            tax_lines = cur.fetchall()
            return {"return": ret, "lines": lines, "tax_lines": tax_lines}


@router.post("/payments", dependencies=[Depends(require_permission("sales:write"))])
def create_sales_payment(data: SalesPaymentIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if data.amount_usd < 0 or data.amount_lbp < 0:
        raise HTTPException(status_code=400, detail="amounts must be >= 0")
    if data.amount_usd == 0 and data.amount_lbp == 0:
        raise HTTPException(status_code=400, detail="amount is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                pay_date = data.payment_date or date.today()
                assert_period_open(cur, company_id, pay_date)
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

                method = data.method  # already normalized by validator
                # Always require a mapping so methods stay consistent identifiers across the system.
                cur.execute(
                    """
                    SELECT 1
                    FROM payment_method_mappings
                    WHERE company_id = %s AND method = %s
                    """,
                    (company_id, method),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail=f"Unknown payment method: {method}")

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
                        INSERT INTO gl_journals
                          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, 'sales_payment', %s, %s, 'market', 0, %s, %s)
                        RETURNING id
                        """,
                        (company_id, f"CP-{str(payment_id)[:8]}", payment_id, pay_date, "Customer payment", user["user_id"]),
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

                    # Optional banking: create a bank transaction matched to this journal (for reconciliation).
                    if data.bank_account_id:
                        cur.execute(
                            """
                            SELECT 1
                            FROM bank_accounts
                            WHERE company_id = %s AND id = %s AND is_active = true
                            """,
                            (company_id, data.bank_account_id),
                        )
                        if not cur.fetchone():
                            raise HTTPException(status_code=400, detail="invalid bank_account_id")
                        cur.execute(
                            """
                            INSERT INTO bank_transactions
                              (id, company_id, bank_account_id, txn_date, direction, amount_usd, amount_lbp,
                               description, reference, counterparty, matched_journal_id, matched_at)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, 'inflow', %s, %s, %s, %s, %s, %s, now())
                            """,
                            (
                                company_id,
                                data.bank_account_id,
                                pay_date,
                                data.amount_usd,
                                data.amount_lbp,
                                f"Customer payment {str(payment_id)[:8]}",
                                None,
                                None,
                                journal_id,
                            ),
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
