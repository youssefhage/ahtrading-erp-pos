from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..period_locks import assert_period_open
import json
import uuid
from backend.workers import pos_processor
from ..journal_utils import auto_balance_journal
from ..account_defaults import ensure_company_account_defaults
from ..validation import CurrencyCode, PaymentMethod, DocStatus
from ..uom import load_item_uom_context, resolve_line_uom

router = APIRouter(prefix="/sales", tags=["sales"])

USD_Q = Decimal("0.0001")
LBP_Q = Decimal("0.01")
SALES_INVOICE_PDF_TEMPLATES = {"official_classic", "official_compact", "standard"}


def q_usd(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(USD_Q, rounding=ROUND_HALF_UP)


def q_lbp(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(LBP_Q, rounding=ROUND_HALF_UP)


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


def _normalize_sales_invoice_pdf_template(value) -> Optional[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    return raw if raw in SALES_INVOICE_PDF_TEMPLATES else None


def _load_print_policy(cur, company_id: str) -> dict:
    cur.execute(
        """
        SELECT value_json
        FROM company_settings
        WHERE company_id = %s AND key = 'print_policy'
        LIMIT 1
        """,
        (company_id,),
    )
    row = cur.fetchone()
    if not row:
        return {"sales_invoice_pdf_template": None}

    raw = row.get("value_json")
    obj = {}
    if isinstance(raw, dict):
        obj = raw
    elif isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                obj = parsed
        except Exception:
            obj = {}

    tpl = _normalize_sales_invoice_pdf_template(obj.get("sales_invoice_pdf_template"))
    return {"sales_invoice_pdf_template": tpl}

def _normalize_dual_amounts(usd: Decimal, lbp: Decimal, exchange_rate: Decimal) -> tuple[Decimal, Decimal]:
    if exchange_rate and exchange_rate != 0:
        if usd == 0 and lbp != 0:
            usd = lbp / exchange_rate
        elif lbp == 0 and usd != 0:
            lbp = usd * exchange_rate
    return q_usd(usd), q_lbp(lbp)


def _resolve_default_vat_tax_code_id(cur, company_id: str) -> Optional[str]:
    """
    Resolve the company default VAT tax code with compliance guardrails:
    - Prefer explicit company_settings.default_vat_tax_code_id when valid.
    - Otherwise auto-pick only when there is exactly one VAT tax code.
    - If multiple VAT codes exist and no explicit default is configured, return None.
    """
    cur.execute(
        """
        SELECT id
        FROM tax_codes
        WHERE company_id = %s AND tax_type = 'vat'
        ORDER BY name
        """,
        (company_id,),
    )
    vat_codes = [str(r.get("id")) for r in (cur.fetchall() or []) if r.get("id")]
    if not vat_codes:
        return None

    cur.execute(
        """
        SELECT value_json
        FROM company_settings
        WHERE company_id = %s
          AND key = 'default_vat_tax_code_id'
        LIMIT 1
        """,
        (company_id,),
    )
    vrow = cur.fetchone()
    configured = None
    if vrow and vrow.get("value_json") is not None:
        raw = vrow.get("value_json")
        if isinstance(raw, dict):
            configured = str(raw.get("id") or raw.get("tax_code_id") or "").strip() or None
        else:
            configured = str(raw or "").strip() or None
    if configured and configured in vat_codes:
        return configured
    if len(vat_codes) == 1:
        return vat_codes[0]
    return None

def _compute_applied_from_tender(*, tender_usd: Decimal, tender_lbp: Decimal, exchange_rate: Decimal, settle: str) -> tuple[Decimal, Decimal]:
    settle = (settle or "USD").upper()
    if settle not in {"USD", "LBP"}:
        raise HTTPException(status_code=400, detail="unsupported settlement_currency (expected USD or LBP)")
    if tender_usd < 0 or tender_lbp < 0:
        raise HTTPException(status_code=400, detail="amounts must be >= 0")
    if tender_usd == 0 and tender_lbp == 0:
        raise HTTPException(status_code=400, detail="amount is required")
    if settle == "USD" and tender_lbp != 0 and not exchange_rate:
        raise HTTPException(status_code=400, detail="exchange_rate is required for LBP tender on a USD invoice")
    if settle == "LBP" and tender_usd != 0 and not exchange_rate:
        raise HTTPException(status_code=400, detail="exchange_rate is required for USD tender on a LBP invoice")

    applied_usd = Decimal("0")
    applied_lbp = Decimal("0")
    if settle == "USD":
        applied_usd = tender_usd + ((tender_lbp / exchange_rate) if exchange_rate else Decimal("0"))
        applied_usd = q_usd(applied_usd)
        applied_usd, applied_lbp = _normalize_dual_amounts(applied_usd, Decimal("0"), exchange_rate)
        applied_lbp = q_lbp(applied_lbp)
    else:
        applied_lbp = tender_lbp + (tender_usd * exchange_rate)
        applied_lbp = q_lbp(applied_lbp)
        applied_usd, applied_lbp = _normalize_dual_amounts(Decimal("0"), applied_lbp, exchange_rate)
        applied_usd = q_usd(applied_usd)
    return applied_usd, applied_lbp

def _fetch_account_defaults(cur, company_id: str) -> dict:
    return ensure_company_account_defaults(
        cur,
        company_id,
        roles=(
            "AR",
            "SALES",
            "SALES_RETURNS",
            "VAT_PAYABLE",
            "INVENTORY",
            "COGS",
            "OPENING_BALANCE",
            "OPENING_STOCK",
            "INV_ADJ",
            "ROUNDING",
        ),
    )

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
    # Backward compatible: some clients send legacy amount_* fields. New clients should prefer tender_*.
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")
    tender_usd: Optional[Decimal] = None
    tender_lbp: Optional[Decimal] = None


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


class SalesReturnLineIn(BaseModel):
    item_id: str
    qty: Decimal
    unit_price_usd: Decimal
    unit_price_lbp: Decimal
    line_total_usd: Decimal
    line_total_lbp: Decimal
    unit_cost_usd: Optional[Decimal] = None
    unit_cost_lbp: Optional[Decimal] = None
    reason_id: Optional[str] = None
    line_condition: Optional[str] = None


class SalesReturnIn(BaseModel):
    device_id: str
    invoice_id: Optional[str] = None
    return_date: Optional[date] = None
    exchange_rate: Decimal
    warehouse_id: Optional[str] = None
    shift_id: Optional[str] = None
    refund_method: Optional[str] = None
    reason_id: Optional[str] = None
    reason: Optional[str] = None
    return_condition: Optional[str] = None
    lines: List[SalesReturnLineIn]
    tax: Optional[TaxBlock] = None


class SalesPaymentIn(BaseModel):
    invoice_id: str
    method: PaymentMethod
    # Legacy (applied amounts). New clients should prefer tender_*.
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")
    # Tender breakdown as received by cashier.
    tender_usd: Optional[Decimal] = None
    tender_lbp: Optional[Decimal] = None
    payment_date: Optional[date] = None
    bank_account_id: Optional[str] = None
    reference: Optional[str] = None
    auth_code: Optional[str] = None
    provider: Optional[str] = None
    settlement_currency: Optional[CurrencyCode] = None

@router.get("/payments", dependencies=[Depends(require_permission("sales:read"))])
def list_sales_payments(
    invoice_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    include_voided: bool = False,
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
                       p.method, p.amount_usd, p.amount_lbp,
                       p.tender_usd, p.tender_lbp,
                       p.created_at
                FROM sales_payments p
                JOIN sales_invoices i ON i.id = p.invoice_id
                LEFT JOIN customers c ON c.id = i.customer_id
                WHERE i.company_id = %s
            """
            params: list = [company_id]
            if not include_voided:
                sql += " AND p.voided_at IS NULL"
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
    flagged_for_adjustment: Optional[bool] = None,
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
                    OR COALESCE(i.receipt_no, '') ILIKE %s
                    OR COALESCE(c.name, '') ILIKE %s
                    OR COALESCE(w.name, '') ILIKE %s
                    OR i.id::text ILIKE %s
                  )
                """
                params.extend([needle, needle, needle, needle, needle])

            # Pilot adjustment queue: invoices created via unified POS can be flagged in receipt_meta.
            # Shape: receipt_meta = {"pilot": {"flagged_for_adjustment": true, ...}}
            if flagged_for_adjustment is not None:
                base_sql += """
                  AND COALESCE((i.receipt_meta->'pilot'->>'flagged_for_adjustment')::boolean, false) = %s
                """
                params.append(bool(flagged_for_adjustment))

            select_sql = f"""
                SELECT i.id, i.invoice_no, i.customer_id, c.name AS customer_name,
                       i.status, i.total_usd, i.total_lbp, i.warehouse_id, w.name AS warehouse_name,
                       i.reserve_stock,
                       i.branch_id,
                       i.receipt_no, i.receipt_seq, i.receipt_printer, i.receipt_printed_at,
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
                       i.subtotal_usd, i.subtotal_lbp, i.discount_total_usd, i.discount_total_lbp,
                       i.total_usd, i.total_lbp, i.exchange_rate, i.warehouse_id, w.name AS warehouse_name,
                       i.reserve_stock,
                       i.pricing_currency, i.settlement_currency,
                       i.branch_id,
                       i.receipt_no, i.receipt_seq, i.receipt_printer, i.receipt_printed_at, i.receipt_meta,
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
                SELECT l.id, l.item_id, it.sku AS item_sku, it.name AS item_name,
                       it.tax_code_id AS item_tax_code_id,
                       l.qty, l.uom, l.qty_factor, l.qty_entered,
                       l.unit_price_usd, l.unit_price_lbp,
                       l.unit_price_entered_usd, l.unit_price_entered_lbp,
                       l.pre_discount_unit_price_usd, l.pre_discount_unit_price_lbp,
                       l.discount_pct, l.discount_amount_usd, l.discount_amount_lbp,
                       l.applied_promotion_id, l.applied_promotion_item_id, l.applied_price_list_id,
                       l.line_total_usd, l.line_total_lbp
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
                SELECT id, method, amount_usd, amount_lbp,
                       tender_usd, tender_lbp,
                       reference, auth_code, provider, settlement_currency, captured_at,
                       voided_at, void_reason,
                       created_at
                FROM sales_payments
                WHERE invoice_id = %s AND voided_at IS NULL
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

            return {
                "invoice": inv,
                "lines": lines,
                "payments": payments,
                "tax_lines": tax_lines,
                "print_policy": _load_print_policy(cur, company_id),
            }

class SalesInvoiceDraftLineIn(BaseModel):
    item_id: str
    qty: Decimal
    # Entered UOM context (optional; qty remains base qty for inventory).
    uom: Optional[str] = None
    qty_factor: Decimal = Decimal("1")
    qty_entered: Optional[Decimal] = None
    unit_price_usd: Decimal = Decimal("0")
    unit_price_lbp: Decimal = Decimal("0")
    unit_price_entered_usd: Optional[Decimal] = None
    unit_price_entered_lbp: Optional[Decimal] = None
    # Commercial metadata (optional; defaults handled server-side).
    pre_discount_unit_price_usd: Optional[Decimal] = None
    pre_discount_unit_price_lbp: Optional[Decimal] = None
    discount_pct: Optional[Decimal] = None
    discount_amount_usd: Optional[Decimal] = None
    discount_amount_lbp: Optional[Decimal] = None
    applied_promotion_id: Optional[str] = None
    applied_promotion_item_id: Optional[str] = None
    applied_price_list_id: Optional[str] = None
    # Optional commercial metadata (discounts). Amounts are per-line totals.
    pre_discount_unit_price_usd: Optional[Decimal] = None
    pre_discount_unit_price_lbp: Optional[Decimal] = None
    # Discount percent as a fraction (0..1). Backward compatible: accept 0..100 and normalize.
    discount_pct: Decimal = Decimal("0")
    discount_amount_usd: Optional[Decimal] = None
    discount_amount_lbp: Optional[Decimal] = None

class SalesInvoiceDraftIn(BaseModel):
    customer_id: Optional[str] = None
    warehouse_id: str
    invoice_no: Optional[str] = None
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    reserve_stock: bool = False
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
    reserve_stock: Optional[bool] = None
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
                SELECT id, status, exchange_rate, warehouse_id, COALESCE(doc_subtype,'standard') AS doc_subtype
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
                SELECT item_id, line_total_usd, line_total_lbp
                FROM sales_invoice_lines
                WHERE invoice_id = %s
                """,
                (invoice_id,),
            )
            lines = cur.fetchall()
            base_usd = sum([q_usd(Decimal(str(l["line_total_usd"] or 0))) for l in lines])
            base_lbp = sum([q_lbp(Decimal(str(l["line_total_lbp"] or 0))) for l in lines])

            exchange_rate = Decimal(str(inv["exchange_rate"] or 0))
            tax_code_id = None  # default VAT code id (if any)
            tax_usd = Decimal("0")
            tax_lbp = Decimal("0")
            tax_rows: list[dict] = []
            apply_vat_effective = bool(apply_vat) and str(inv.get("doc_subtype") or "standard") != "opening_balance"
            if apply_vat_effective:
                tax_code_id = _resolve_default_vat_tax_code_id(cur, company_id)

                # VAT breakdown by tax_code_id (item tax_code overrides default VAT code).
                item_ids = sorted({str(l.get("item_id")) for l in (lines or []) if l.get("item_id")})
                item_tax: dict[str, Optional[str]] = {}
                if item_ids:
                    cur.execute(
                        """
                        SELECT id, tax_code_id
                        FROM items
                        WHERE company_id=%s AND id = ANY(%s::uuid[])
                        """,
                        (company_id, item_ids),
                    )
                    item_tax = {str(r["id"]): (str(r["tax_code_id"]) if r.get("tax_code_id") else None) for r in cur.fetchall()}

                base_by_tax: dict[str, dict[str, Decimal]] = {}
                for l in (lines or []):
                    itid = str(l.get("item_id") or "")
                    tcid = item_tax.get(itid) or (str(tax_code_id) if tax_code_id else None)
                    if not tcid:
                        continue
                    if tcid not in base_by_tax:
                        base_by_tax[tcid] = {"usd": Decimal("0"), "lbp": Decimal("0")}
                    base_by_tax[tcid]["usd"] += Decimal(str(l.get("line_total_usd") or 0))
                    base_by_tax[tcid]["lbp"] += Decimal(str(l.get("line_total_lbp") or 0))

                if base_by_tax:
                    tcids = list(base_by_tax.keys())
                    cur.execute(
                        """
                        SELECT id, rate
                        FROM tax_codes
                        WHERE company_id=%s AND tax_type='vat' AND id = ANY(%s::uuid[])
                        """,
                        (company_id, tcids),
                    )
                    rate_by = {str(r["id"]): Decimal(str(r.get("rate") or 0)) for r in cur.fetchall()}
                    for tcid, b in base_by_tax.items():
                        rate = rate_by.get(tcid, Decimal("0"))
                        if rate == 0:
                            continue
                        tlbp = b["lbp"] * rate
                        tusd = (tlbp / exchange_rate) if exchange_rate else Decimal("0")
                        tusd, tlbp = _normalize_dual_amounts(tusd, tlbp, exchange_rate)
                        tax_usd += tusd
                        tax_lbp += tlbp
                        tax_rows.append(
                            {
                                "tax_code_id": tcid,
                                "base_usd": b["usd"],
                                "base_lbp": b["lbp"],
                                "tax_usd": tusd,
                                "tax_lbp": tlbp,
                            }
                        )

            total_usd = q_usd(base_usd + tax_usd)
            total_lbp = q_lbp(base_lbp + tax_lbp)
            return {
                "base_usd": base_usd,
                "base_lbp": base_lbp,
                "apply_vat": apply_vat_effective,
                "tax_code_id": tax_code_id,
                "tax_usd": tax_usd,
                "tax_lbp": tax_lbp,
                "tax_rows": tax_rows,
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

    # Compute draft totals from base quantities. Persist entered UOM context alongside base qty.
    base_usd = Decimal("0")
    base_lbp = Decimal("0")
    subtotal_usd = Decimal("0")
    subtotal_lbp = Decimal("0")
    discount_total_usd = Decimal("0")
    discount_total_lbp = Decimal("0")
    lines_norm: list[dict] = []

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                item_ids = [str(l.item_id) for l in (data.lines or []) if l.item_id]
                base_uom_by_item, factors_by_item = load_item_uom_context(cur, company_id, item_ids)

                for idx, l in enumerate(data.lines or []):
                    resolved = resolve_line_uom(
                        line_label=f"line {idx+1}",
                        item_id=l.item_id,
                        qty_base=Decimal(str(l.qty or 0)),
                        qty_entered=(Decimal(str(l.qty_entered)) if l.qty_entered is not None else None),
                        uom=l.uom,
                        qty_factor=(Decimal(str(l.qty_factor)) if l.qty_factor is not None else None),
                        base_uom_by_item=base_uom_by_item,
                        factors_by_item=factors_by_item,
                        strict_factor=True,
                    )
                    qty_base = resolved["qty"]
                    uom = resolved["uom"]
                    qty_factor = resolved["qty_factor"]
                    qty_entered = resolved["qty_entered"]

                    unit_usd = Decimal(str(l.unit_price_usd or 0))
                    unit_lbp = Decimal(str(l.unit_price_lbp or 0))
                    if unit_usd == 0 and unit_lbp == 0:
                        # Allow clients to send entered-unit pricing instead of base-unit pricing.
                        if l.unit_price_entered_usd is not None:
                            unit_usd = Decimal(str(l.unit_price_entered_usd or 0)) / qty_factor
                        if l.unit_price_entered_lbp is not None:
                            unit_lbp = Decimal(str(l.unit_price_entered_lbp or 0)) / qty_factor
                    if unit_usd == 0 and unit_lbp == 0:
                        raise HTTPException(status_code=400, detail=f"line {idx+1}: unit price is required")

                    line_usd = unit_usd * qty_base
                    line_lbp = unit_lbp * qty_base
                    if line_lbp == 0 and data.exchange_rate:
                        line_lbp = line_usd * data.exchange_rate
                    if line_usd == 0 and data.exchange_rate:
                        line_usd = line_lbp / data.exchange_rate

                    unit_entered_usd = (Decimal(str(l.unit_price_entered_usd or 0)) if l.unit_price_entered_usd is not None else (unit_usd * qty_factor))
                    unit_entered_lbp = (Decimal(str(l.unit_price_entered_lbp or 0)) if l.unit_price_entered_lbp is not None else (unit_lbp * qty_factor))

                    pre_unit_usd = Decimal(str(l.pre_discount_unit_price_usd or 0))
                    pre_unit_lbp = Decimal(str(l.pre_discount_unit_price_lbp or 0))
                    if pre_unit_usd == 0:
                        pre_unit_usd = unit_usd
                    if pre_unit_lbp == 0:
                        pre_unit_lbp = unit_lbp
                    disc_pct = Decimal(str(l.discount_pct or 0))
                    # Accept 0..100 as a convenience and normalize to 0..1.
                    if disc_pct > 1 and disc_pct <= 100:
                        disc_pct = disc_pct / Decimal("100")
                    if disc_pct < 0:
                        disc_pct = Decimal("0")
                    if disc_pct > 1:
                        disc_pct = Decimal("1")
                    disc_usd = Decimal(str(l.discount_amount_usd or 0))
                    disc_lbp = Decimal(str(l.discount_amount_lbp or 0))
                    if disc_usd == 0 and disc_lbp == 0:
                        disc_usd = max(Decimal("0"), (pre_unit_usd - unit_usd) * qty_base)
                        disc_lbp = max(Decimal("0"), (pre_unit_lbp - unit_lbp) * qty_base)

                    base_usd += line_usd
                    base_lbp += line_lbp
                    subtotal_usd += pre_unit_usd * qty_base
                    subtotal_lbp += pre_unit_lbp * qty_base
                    discount_total_usd += disc_usd
                    discount_total_lbp += disc_lbp
                    lines_norm.append(
                        {
                            "item_id": l.item_id,
                            "qty": qty_base,
                            "uom": uom,
                            "qty_factor": qty_factor,
                            "qty_entered": qty_entered,
                            "unit_price_usd": unit_usd,
                            "unit_price_lbp": unit_lbp,
                            "unit_price_entered_usd": unit_entered_usd,
                            "unit_price_entered_lbp": unit_entered_lbp,
                            "pre_discount_unit_price_usd": pre_unit_usd,
                            "pre_discount_unit_price_lbp": pre_unit_lbp,
                            "discount_pct": disc_pct,
                            "discount_amount_usd": disc_usd,
                            "discount_amount_lbp": disc_lbp,
                            "line_total_usd": line_usd,
                            "line_total_lbp": line_lbp,
                        }
                    )

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
                      (id, company_id, invoice_no, customer_id, status,
                       subtotal_usd, subtotal_lbp, discount_total_usd, discount_total_lbp,
                       total_usd, total_lbp,
                       warehouse_id, reserve_stock, exchange_rate, pricing_currency, settlement_currency, invoice_date, due_date)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        invoice_no,
                        data.customer_id,
                        subtotal_usd,
                        subtotal_lbp,
                        discount_total_usd,
                        discount_total_lbp,
                        base_usd,
                        base_lbp,
                        data.warehouse_id,
                        bool(data.reserve_stock),
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
                          (id, invoice_id, item_id,
                           qty, qty_entered, uom, qty_factor,
                           unit_price_usd, unit_price_lbp, unit_price_entered_usd, unit_price_entered_lbp,
                           pre_discount_unit_price_usd, pre_discount_unit_price_lbp,
                           discount_pct, discount_amount_usd, discount_amount_lbp,
                           line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s,
                           %s, %s, %s, %s,
                           %s, %s, %s, %s,
                           %s, %s,
                           %s, %s, %s,
                           %s, %s)
                        """,
                        (
                            invoice_id,
                            l["item_id"],
                            l["qty"],
                            l["qty_entered"],
                            l["uom"],
                            l["qty_factor"],
                            l["unit_price_usd"],
                            l["unit_price_lbp"],
                            l["unit_price_entered_usd"],
                            l["unit_price_entered_lbp"],
                            l["pre_discount_unit_price_usd"],
                            l["pre_discount_unit_price_lbp"],
                            l["discount_pct"],
                            l["discount_amount_usd"],
                            l["discount_amount_lbp"],
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
                    subtotal_usd = Decimal("0")
                    subtotal_lbp = Decimal("0")
                    discount_total_usd = Decimal("0")
                    discount_total_lbp = Decimal("0")
                    exchange_rate = Decimal(str(patch.get("exchange_rate") or inv["exchange_rate"] or 0))
                    item_ids = [str(l.item_id) for l in (lines_in or []) if l.item_id]
                    base_uom_by_item, factors_by_item = load_item_uom_context(cur, company_id, item_ids)
                    for idx, l in enumerate(lines_in or []):
                        resolved = resolve_line_uom(
                            line_label=f"line {idx+1}",
                            item_id=l.item_id,
                            qty_base=Decimal(str(l.qty or 0)),
                            qty_entered=(Decimal(str(l.qty_entered)) if l.qty_entered is not None else None),
                            uom=l.uom,
                            qty_factor=(Decimal(str(l.qty_factor)) if l.qty_factor is not None else None),
                            base_uom_by_item=base_uom_by_item,
                            factors_by_item=factors_by_item,
                            strict_factor=True,
                        )
                        qty_base = resolved["qty"]
                        uom = resolved["uom"]
                        qty_factor = resolved["qty_factor"]
                        qty_entered = resolved["qty_entered"]

                        unit_usd = Decimal(str(l.unit_price_usd or 0))
                        unit_lbp = Decimal(str(l.unit_price_lbp or 0))
                        if unit_usd == 0 and unit_lbp == 0:
                            if l.unit_price_entered_usd is not None:
                                unit_usd = Decimal(str(l.unit_price_entered_usd or 0)) / qty_factor
                            if l.unit_price_entered_lbp is not None:
                                unit_lbp = Decimal(str(l.unit_price_entered_lbp or 0)) / qty_factor
                        if unit_usd == 0 and unit_lbp == 0:
                            raise HTTPException(status_code=400, detail="unit price is required")
                        line_usd = unit_usd * qty_base
                        line_lbp = unit_lbp * qty_base
                        if line_lbp == 0 and exchange_rate:
                            line_lbp = line_usd * exchange_rate
                        if line_usd == 0 and exchange_rate:
                            line_usd = line_lbp / exchange_rate
                        base_usd += line_usd
                        base_lbp += line_lbp

                        unit_entered_usd = (Decimal(str(l.unit_price_entered_usd or 0)) if l.unit_price_entered_usd is not None else (unit_usd * qty_factor))
                        unit_entered_lbp = (Decimal(str(l.unit_price_entered_lbp or 0)) if l.unit_price_entered_lbp is not None else (unit_lbp * qty_factor))

                        pre_unit_usd = Decimal(str(l.pre_discount_unit_price_usd or 0))
                        pre_unit_lbp = Decimal(str(l.pre_discount_unit_price_lbp or 0))
                        if pre_unit_usd == 0:
                            pre_unit_usd = unit_usd
                        if pre_unit_lbp == 0:
                            pre_unit_lbp = unit_lbp
                        disc_pct = Decimal(str(l.discount_pct or 0))
                        if disc_pct > 1 and disc_pct <= 100:
                            disc_pct = disc_pct / Decimal("100")
                        if disc_pct < 0:
                            disc_pct = Decimal("0")
                        if disc_pct > 1:
                            disc_pct = Decimal("1")
                        disc_usd = Decimal(str(l.discount_amount_usd or 0))
                        disc_lbp = Decimal(str(l.discount_amount_lbp or 0))
                        if disc_usd == 0 and disc_lbp == 0:
                            disc_usd = max(Decimal("0"), (pre_unit_usd - unit_usd) * qty_base)
                            disc_lbp = max(Decimal("0"), (pre_unit_lbp - unit_lbp) * qty_base)
                        subtotal_usd += pre_unit_usd * qty_base
                        subtotal_lbp += pre_unit_lbp * qty_base
                        discount_total_usd += disc_usd
                        discount_total_lbp += disc_lbp

                        cur.execute(
                            """
                            INSERT INTO sales_invoice_lines
                              (id, invoice_id, item_id,
                               qty, qty_entered, uom, qty_factor,
                               unit_price_usd, unit_price_lbp, unit_price_entered_usd, unit_price_entered_lbp,
                               pre_discount_unit_price_usd, pre_discount_unit_price_lbp,
                               discount_pct, discount_amount_usd, discount_amount_lbp,
                               line_total_usd, line_total_lbp)
                            VALUES
                              (gen_random_uuid(), %s, %s,
                               %s, %s, %s, %s,
                               %s, %s, %s, %s,
                               %s, %s,
                               %s, %s, %s,
                               %s, %s)
                            """,
                            (
                                invoice_id,
                                l.item_id,
                                qty_base,
                                qty_entered,
                                uom,
                                qty_factor,
                                unit_usd,
                                unit_lbp,
                                unit_entered_usd,
                                unit_entered_lbp,
                                pre_unit_usd,
                                pre_unit_lbp,
                                disc_pct,
                                disc_usd,
                                disc_lbp,
                                line_usd,
                                line_lbp,
                            ),
                        )
                    # Update totals alongside other fields.
                    patch["subtotal_usd"] = subtotal_usd
                    patch["subtotal_lbp"] = subtotal_lbp
                    patch["discount_total_usd"] = discount_total_usd
                    patch["discount_total_lbp"] = discount_total_lbp
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
                cur.execute("SELECT 1 FROM sales_payments WHERE invoice_id=%s AND voided_at IS NULL LIMIT 1", (invoice_id,))
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
                base_usd = sum([q_usd(Decimal(str(l["line_total_usd"] or 0))) for l in lines])
                base_lbp = sum([q_lbp(Decimal(str(l["line_total_lbp"] or 0))) for l in lines])

                # VAT breakdown: group base/tax by the effective VAT tax_code_id.
                # - Per-item items.tax_code_id overrides the default VAT code.
                # - Non-VAT tax codes are ignored for VAT computation/reporting.
                tax_code_id = None  # default VAT code id (if any)
                tax_usd = Decimal("0")
                tax_lbp = Decimal("0")
                tax_rows: list[dict] = []
                apply_vat_effective = bool(data.apply_vat) and inv["doc_subtype"] != "opening_balance"
                if apply_vat_effective:
                    tax_code_id = _resolve_default_vat_tax_code_id(cur, company_id)

                    item_ids = sorted({str(l.get("item_id")) for l in (lines or []) if l.get("item_id")})
                    item_tax: dict[str, Optional[str]] = {}
                    if item_ids:
                        cur.execute(
                            """
                            SELECT id, tax_code_id
                            FROM items
                            WHERE company_id=%s AND id = ANY(%s::uuid[])
                            """,
                            (company_id, item_ids),
                        )
                        item_tax = {str(r["id"]): (str(r["tax_code_id"]) if r.get("tax_code_id") else None) for r in cur.fetchall()}

                    base_by_tax: dict[str, dict[str, Decimal]] = {}
                    for l in (lines or []):
                        itid = str(l.get("item_id") or "")
                        tcid = item_tax.get(itid) or (str(tax_code_id) if tax_code_id else None)
                        if not tcid:
                            continue
                        if tcid not in base_by_tax:
                            base_by_tax[tcid] = {"usd": Decimal("0"), "lbp": Decimal("0")}
                        base_by_tax[tcid]["usd"] += Decimal(str(l.get("line_total_usd") or 0))
                        base_by_tax[tcid]["lbp"] += Decimal(str(l.get("line_total_lbp") or 0))

                    if base_by_tax:
                        tcids = list(base_by_tax.keys())
                        cur.execute(
                            """
                            SELECT id, rate
                            FROM tax_codes
                            WHERE company_id=%s AND tax_type='vat' AND id = ANY(%s::uuid[])
                            """,
                            (company_id, tcids),
                        )
                        rate_by = {str(r["id"]): Decimal(str(r.get("rate") or 0)) for r in cur.fetchall()}
                        for tcid, b in base_by_tax.items():
                            # Ignore non-VAT tax codes (not returned by the SELECT above).
                            if tcid not in rate_by:
                                continue
                            rate = rate_by.get(tcid, Decimal("0"))
                            tlbp = b["lbp"] * rate if rate else Decimal("0")
                            tusd = (tlbp / exchange_rate) if exchange_rate else Decimal("0")
                            tusd, tlbp = _normalize_dual_amounts(tusd, tlbp, exchange_rate)
                            tax_usd += tusd
                            tax_lbp += tlbp
                            tax_rows.append(
                                {
                                    "tax_code_id": tcid,
                                    "base_usd": b["usd"],
                                    "base_lbp": b["lbp"],
                                    "tax_usd": tusd,
                                    "tax_lbp": tlbp,
                                }
                            )

                total_usd = q_usd(base_usd + tax_usd)
                total_lbp = q_lbp(base_lbp + tax_lbp)

                # Payments:
                # - `tender_*` are what the cashier received.
                # - `amount_*` are the applied value that settles the invoice (consistent with settlement currency + exchange rate).
                settle = str(inv.get("settlement_currency") or "USD").upper()
                payments = []
                for p in (data.payments or []):
                    method = (p.method or "cash").strip().lower()
                    tender_usd = Decimal(str(p.tender_usd if p.tender_usd is not None else p.amount_usd or 0))
                    tender_lbp = Decimal(str(p.tender_lbp if p.tender_lbp is not None else p.amount_lbp or 0))
                    if tender_usd == 0 and tender_lbp == 0:
                        continue
                    applied_usd, applied_lbp = _compute_applied_from_tender(
                        tender_usd=tender_usd, tender_lbp=tender_lbp, exchange_rate=exchange_rate, settle=settle
                    )
                    payments.append(
                        {
                            "method": method,
                            "tender_usd": tender_usd,
                            "tender_lbp": tender_lbp,
                            "amount_usd": q_usd(applied_usd),
                            "amount_lbp": q_lbp(applied_lbp),
                        }
                    )

                total_paid_usd = q_usd(sum([Decimal(str(p["amount_usd"])) for p in payments]))
                total_paid_lbp = q_lbp(sum([Decimal(str(p["amount_lbp"])) for p in payments]))
                eps_usd = Decimal("0.01")
                eps_lbp = Decimal("100")
                # Single settlement balance: only one currency is the "debt". The other is derived via exchange_rate.
                if settle == "USD":
                    credit_usd = total_usd - total_paid_usd
                    if credit_usd < -eps_usd:
                        raise HTTPException(status_code=400, detail="payments exceed invoice total")
                    if abs(credit_usd) <= eps_usd:
                        credit_usd = Decimal("0")
                    credit_usd, credit_lbp = _normalize_dual_amounts(credit_usd, Decimal("0"), exchange_rate)
                else:
                    credit_lbp = total_lbp - total_paid_lbp
                    if credit_lbp < -eps_lbp:
                        raise HTTPException(status_code=400, detail="payments exceed invoice total")
                    if abs(credit_lbp) <= eps_lbp:
                        credit_lbp = Decimal("0")
                    credit_usd, credit_lbp = _normalize_dual_amounts(Decimal("0"), credit_lbp, exchange_rate)
                credit_usd = q_usd(credit_usd)
                credit_lbp = q_lbp(credit_lbp)

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
                    allow_negative_stock_default = bool(inv_policy.get("allow_negative_stock"))

                    # Warehouse-level expiry policy: enforce a default minimum shelf-life window for allocations.
                    warehouse_min_days_default = 0
                    warehouse_allow_negative = None
                    cur.execute(
                        """
                        SELECT min_shelf_life_days_for_sale_default, allow_negative_stock
                        FROM warehouses
                        WHERE company_id=%s AND id=%s
                        """,
                        (company_id, inv["warehouse_id"]),
                    )
                    wrow = cur.fetchone()
                    if wrow:
                        warehouse_min_days_default = int(wrow.get("min_shelf_life_days_for_sale_default") or 0)
                        warehouse_allow_negative = wrow.get("allow_negative_stock")

                    # Fetch item tracking policy so FEFO allocation doesn't create "unbatched" remainder for tracked items.
                    item_ids = sorted({str(l["item_id"]) for l in (lines or []) if l.get("item_id")})
                    item_policy = {}
                    if item_ids:
                        cur.execute(
                            """
                            SELECT id, track_batches, track_expiry, min_shelf_life_days_for_sale, allow_negative_stock
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
                        min_days = max(int(pol.get("min_shelf_life_days_for_sale") or 0), warehouse_min_days_default)
                        min_exp = (inv_date + timedelta(days=min_days)) if min_days > 0 else None
                        if bool(pol.get("track_expiry")) and not min_exp:
                            min_exp = inv_date
                        allow_unbatched = not (bool(pol.get("track_batches")) or bool(pol.get("track_expiry")) or min_days > 0)
                        item_allow_negative = pol.get("allow_negative_stock")
                        if warehouse_allow_negative is not None:
                            allow_negative_for_item = bool(warehouse_allow_negative)
                        elif item_allow_negative is not None:
                            allow_negative_for_item = bool(item_allow_negative)
                        else:
                            allow_negative_for_item = allow_negative_stock_default
                        allocations = pos_processor.allocate_fefo_batches(
                            cur,
                            company_id,
                            l["item_id"],
                            inv["warehouse_id"],
                            Decimal(str(l["qty"] or 0)),
                            min_expiry_date=min_exp,
                            allow_unbatched_remainder=allow_unbatched,
                            allow_negative_stock=allow_negative_for_item,
                        )
                        for batch_id, q in allocations:
                            cur.execute(
                                """
                                INSERT INTO stock_moves
                                  (id, company_id, item_id, warehouse_id, batch_id, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                                   source_type, source_id, created_by_user_id, reason)
                                VALUES
                                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, 'sales_invoice', %s, %s, %s)
                                """,
                                (
                                    company_id,
                                    l["item_id"],
                                    inv["warehouse_id"],
                                    batch_id,
                                    q,
                                    l["_unit_cost_usd"],
                                    l["_unit_cost_lbp"],
                                    inv_date,
                                    invoice_id,
                                    user["user_id"],
                                    f"Sales invoice {inv.get('invoice_no') or ''}".strip() or "Sales invoice",
                                ),
                            )

                total_cost_usd = q_usd(total_cost_usd)
                total_cost_lbp = q_lbp(total_cost_lbp)

                # Tax lines (VAT breakdown).
                for tr in (tax_rows or []):
                    base_usd_i = Decimal(str(tr.get("base_usd") or 0))
                    base_lbp_i = Decimal(str(tr.get("base_lbp") or 0))
                    tax_usd_i = Decimal(str(tr.get("tax_usd") or 0))
                    tax_lbp_i = Decimal(str(tr.get("tax_lbp") or 0))
                    if base_usd_i == 0 and base_lbp_i == 0:
                        continue
                    cur.execute(
                        """
                        INSERT INTO tax_lines
                          (id, company_id, source_type, source_id, tax_code_id,
                           base_usd, base_lbp, tax_usd, tax_lbp, tax_date)
                        VALUES
                          (gen_random_uuid(), %s, 'sales_invoice', %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (company_id, invoice_id, tr.get("tax_code_id"), base_usd_i, base_lbp_i, tax_usd_i, tax_lbp_i, inv_date),
                    )

                # Persist payments (for history) and GL cash/bank lines are posted in the same journal.
                for p in payments:
                    cur.execute(
                        """
                        INSERT INTO sales_payments (id, invoice_id, method, amount_usd, amount_lbp, tender_usd, tender_lbp)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                        """,
                        (invoice_id, p["method"], p["amount_usd"], p["amount_lbp"], p["tender_usd"], p["tender_lbp"]),
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

                if (tax_usd != 0 or tax_lbp != 0):
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

                cur.execute("SELECT 1 FROM sales_payments WHERE invoice_id=%s AND voided_at IS NULL LIMIT 1", (invoice_id,))
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
                                   source_type, source_id, created_by_user_id, reason)
                                VALUES
                                  (gen_random_uuid(), %s, %s, %s, %s, %s, 0, %s, %s, %s, 'sales_invoice_cancel', %s, %s, %s)
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
                                    user["user_id"],
                                    (reason or f"Void sales invoice {inv.get('invoice_no') or ''}").strip() if reason is not None else None,
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
                       branch_id, reason_id, reason, return_condition,
                       restocking_fee_usd, restocking_fee_lbp, restocking_fee_reason,
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
                       branch_id, reason_id, reason, return_condition,
                       restocking_fee_usd, restocking_fee_lbp, restocking_fee_reason,
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
                       unit_cost_usd, unit_cost_lbp,
                       reason_id, line_condition
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
            cur.execute(
                """
                SELECT id, method, amount_usd, amount_lbp, settlement_currency,
                       bank_account_id, reference, provider, auth_code, captured_at,
                       source_type, source_id, created_at
                FROM sales_refunds
                WHERE company_id = %s AND sales_return_id = %s
                ORDER BY created_at ASC, id ASC
                """,
                (company_id, return_id),
            )
            refunds = cur.fetchall()
            return {"return": ret, "lines": lines, "tax_lines": tax_lines, "refunds": refunds}


@router.post("/payments", dependencies=[Depends(require_permission("sales:write"))])
def create_sales_payment(data: SalesPaymentIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    # Allow mixed tender; store applied value amounts consistent with invoice exchange rate.
    tender_usd = Decimal(str(data.tender_usd if data.tender_usd is not None else data.amount_usd or 0))
    tender_lbp = Decimal(str(data.tender_lbp if data.tender_lbp is not None else data.amount_lbp or 0))

    if tender_usd < 0 or tender_lbp < 0:
        raise HTTPException(status_code=400, detail="amounts must be >= 0")
    if tender_usd == 0 and tender_lbp == 0:
        raise HTTPException(status_code=400, detail="amount is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                pay_date = data.payment_date or date.today()
                assert_period_open(cur, company_id, pay_date)
                cur.execute(
                    """
                    SELECT customer_id, exchange_rate, settlement_currency, total_usd, total_lbp, status
                    FROM sales_invoices
                    WHERE id = %s AND company_id = %s
                    FOR UPDATE
                    """,
                    (data.invoice_id, company_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="invoice not found")
                if str(row.get("status") or "").strip().lower() != "posted":
                    raise HTTPException(status_code=409, detail="payment is allowed only for posted invoices")
                if not row.get("customer_id"):
                    raise HTTPException(status_code=400, detail="invoice is not receivable-backed and cannot accept customer payment")

                exchange_rate = Decimal(str(row.get("exchange_rate") or 0))
                inv_settlement = str(row.get("settlement_currency") or "USD")
                settle = str(data.settlement_currency or inv_settlement or "USD").upper()

                # Applied value (for AR/GL): keep amount_usd and amount_lbp consistent (derived via exchange_rate).
                applied_usd, applied_lbp = _compute_applied_from_tender(
                    tender_usd=tender_usd, tender_lbp=tender_lbp, exchange_rate=exchange_rate, settle=settle
                )
                if applied_usd <= 0 and applied_lbp <= 0:
                    raise HTTPException(status_code=400, detail="payment amount resolves to zero")

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
                    SELECT
                      COALESCE(SUM(amount_usd), 0) AS paid_usd,
                      COALESCE(SUM(amount_lbp), 0) AS paid_lbp
                    FROM sales_payments
                    WHERE invoice_id = %s
                      AND voided_at IS NULL
                    """,
                    (data.invoice_id,),
                )
                paid = cur.fetchone() or {}
                paid_usd = Decimal(str(paid.get("paid_usd") or 0))
                paid_lbp = Decimal(str(paid.get("paid_lbp") or 0))

                # Credit-note returns reduce receivable outstanding for this invoice.
                cur.execute(
                    """
                    SELECT
                      COALESCE(SUM(rf.amount_usd), 0) AS credited_usd,
                      COALESCE(SUM(rf.amount_lbp), 0) AS credited_lbp
                    FROM sales_refunds rf
                    JOIN sales_returns sr ON sr.id = rf.sales_return_id
                    WHERE sr.company_id = %s
                      AND sr.invoice_id = %s
                      AND sr.status = 'posted'
                      AND lower(coalesce(rf.method, '')) = 'credit'
                    """,
                    (company_id, data.invoice_id),
                )
                credited = cur.fetchone() or {}
                credited_usd = Decimal(str(credited.get("credited_usd") or 0))
                credited_lbp = Decimal(str(credited.get("credited_lbp") or 0))

                total_usd = Decimal(str(row.get("total_usd") or 0))
                total_lbp = Decimal(str(row.get("total_lbp") or 0))
                outstanding_usd = total_usd - paid_usd - credited_usd
                outstanding_lbp = total_lbp - paid_lbp - credited_lbp
                eps_usd = USD_Q
                eps_lbp = LBP_Q
                if outstanding_usd < eps_usd:
                    outstanding_usd = Decimal("0")
                if outstanding_lbp < eps_lbp:
                    outstanding_lbp = Decimal("0")
                if outstanding_usd == 0 and outstanding_lbp == 0:
                    raise HTTPException(status_code=409, detail="invoice has no outstanding balance")
                if applied_usd > (outstanding_usd + eps_usd) or applied_lbp > (outstanding_lbp + eps_lbp):
                    raise HTTPException(status_code=409, detail="payment exceeds invoice outstanding balance")

                cur.execute(
                    """
                    INSERT INTO sales_payments (id, invoice_id, method, amount_usd, amount_lbp, tender_usd, tender_lbp,
                                               reference, auth_code, provider, settlement_currency, captured_at)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                    RETURNING id
                    """,
                    (
                        data.invoice_id,
                        method,
                        applied_usd,
                        applied_lbp,
                        tender_usd,
                        tender_lbp,
                        (data.reference or None),
                        (data.auth_code or None),
                        (data.provider or None),
                        (settle or None),
                    ),
                )
                payment_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    UPDATE customers
                    SET credit_balance_usd = GREATEST(credit_balance_usd - %s, 0),
                        credit_balance_lbp = GREATEST(credit_balance_lbp - %s, 0)
                    WHERE company_id = %s AND id = %s
                    """,
                    (applied_usd, applied_lbp, company_id, row["customer_id"]),
                )

                # GL posting: Dr Cash/Bank, Cr AR
                defaults = _fetch_account_defaults(cur, company_id)
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
                      (gen_random_uuid(), %s, %s, 'sales_payment', %s, %s, 'market', %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, f"CP-{str(payment_id)[:8]}", payment_id, pay_date, exchange_rate, "Customer payment", user["user_id"]),
                )
                journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Customer payment')
                    """,
                    (journal_id, pay_account, applied_usd, applied_lbp),
                )
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'AR settlement')
                    """,
                    (journal_id, ar, applied_usd, applied_lbp),
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
                           description, reference, counterparty, matched_journal_id, matched_at,
                           source_type, source_id, imported_by_user_id, imported_at)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, 'inflow', %s, %s, %s, %s, %s, %s, now(),
                           'sales_payment', %s, %s, now())
                        """,
                        (
                            company_id,
                            data.bank_account_id,
                            pay_date,
                            applied_usd,
                            applied_lbp,
                            f"Customer payment {str(payment_id)[:8]}",
                            None,
                            None,
                            journal_id,
                            payment_id,
                            user["user_id"],
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

class SalesPaymentRecomputeIn(BaseModel):
    tender_usd: Optional[Decimal] = None
    tender_lbp: Optional[Decimal] = None
    settlement_currency: Optional[CurrencyCode] = None

class SalesPaymentVoidIn(BaseModel):
    reason: Optional[str] = None

@router.post("/payments/{payment_id}/void", dependencies=[Depends(require_permission("sales:write"))])
def void_sales_payment(payment_id: str, data: SalesPaymentVoidIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Soft-void a sales payment:
    - Marks the payment as voided.
    - Creates a reversing GL journal for the payment.
    - Creates an optional reversing bank transaction (if the original was system-created).

    Safety:
    - Only supports invoices that were posted as credit sales (invoice journal has an AR debit),
      because otherwise removing a payment would require rewriting the original sales invoice journal.
    """
    reason = (data.reason or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT p.id, p.invoice_id, p.method,
                           p.amount_usd, p.amount_lbp,
                           p.tender_usd, p.tender_lbp,
                           p.voided_at,
                           si.customer_id, si.invoice_no, si.exchange_rate
                    FROM sales_payments p
                    JOIN sales_invoices si ON si.id = p.invoice_id AND si.company_id = %s
                    WHERE p.id = %s::uuid
                    FOR UPDATE
                    """,
                    (company_id, payment_id),
                )
                pay = cur.fetchone()
                if not pay:
                    raise HTTPException(status_code=404, detail="payment not found")
                if pay.get("voided_at"):
                    return {"ok": True}

                invoice_id = str(pay["invoice_id"])
                exchange_rate = Decimal(str(pay.get("exchange_rate") or 0))
                void_date = date.today()
                assert_period_open(cur, company_id, void_date)

                # Must be a credit-sale invoice: invoice journal must include AR debit.
                defaults = _fetch_account_defaults(cur, company_id)
                ar = defaults.get("AR")
                if not ar:
                    raise HTTPException(status_code=400, detail="Missing AR default")

                cur.execute(
                    """
                    SELECT id
                    FROM gl_journals
                    WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (company_id, invoice_id),
                )
                inv_j = cur.fetchone()
                if not inv_j:
                    raise HTTPException(status_code=400, detail="missing invoice GL journal")
                cur.execute(
                    """
                    SELECT 1
                    FROM gl_entries
                    WHERE journal_id=%s AND account_id=%s AND (debit_usd>0 OR debit_lbp>0)
                    LIMIT 1
                    """,
                    (inv_j["id"], ar),
                )
                if not cur.fetchone():
                    raise HTTPException(
                        status_code=400,
                        detail="cannot void payment for a cash-sale invoice; use a return/credit note flow",
                    )

                # Reverse the payment journal.
                memo = f"Void customer payment {str(payment_id)[:8]}" + (f" ({reason})" if reason else "")
                void_journal_id = _reverse_gl_journal(
                    cur,
                    company_id,
                    "sales_payment",
                    str(payment_id),
                    "sales_payment_void",
                    void_date,
                    user["user_id"],
                    memo,
                )

                # Reverse bank transaction if we had auto-created one for this payment.
                cur.execute(
                    """
                    SELECT id, bank_account_id, txn_date, amount_usd, amount_lbp, description, reference, counterparty
                    FROM bank_transactions
                    WHERE company_id=%s AND source_type='sales_payment' AND source_id=%s
                    ORDER BY imported_at DESC
                    LIMIT 1
                    """,
                    (company_id, str(payment_id)),
                )
                bt = cur.fetchone()
                if bt and bt.get("bank_account_id"):
                    cur.execute(
                        """
                        INSERT INTO bank_transactions
                          (id, company_id, bank_account_id, txn_date, direction, amount_usd, amount_lbp,
                           description, reference, counterparty, matched_journal_id, matched_at,
                           source_type, source_id, imported_by_user_id, imported_at)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, 'outflow', %s, %s,
                           %s, %s, %s, %s, now(),
                           'sales_payment_void', %s, %s, now())
                        """,
                        (
                            company_id,
                            bt["bank_account_id"],
                            bt.get("txn_date") or void_date,
                            Decimal(str(bt.get("amount_usd") or 0)),
                            Decimal(str(bt.get("amount_lbp") or 0)),
                            f"Void payment {str(payment_id)[:8]}",
                            bt.get("reference"),
                            bt.get("counterparty"),
                            void_journal_id,
                            str(payment_id),
                            user["user_id"],
                        ),
                    )

                cur.execute(
                    """
                    UPDATE sales_payments
                    SET voided_at=now(),
                        voided_by_user_id=%s,
                        void_reason=%s
                    WHERE id=%s::uuid
                    """,
                    (user["user_id"], reason, payment_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'sales_payment_void', 'sales_payment', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], payment_id, json.dumps({"invoice_id": invoice_id, "reason": reason, "void_journal_id": str(void_journal_id)})),
                )

                return {"ok": True, "void_journal_id": str(void_journal_id)}

@router.post("/payments/{payment_id}/recompute", dependencies=[Depends(require_permission("sales:write"))])
def recompute_sales_payment(payment_id: str, data: SalesPaymentRecomputeIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Fix legacy payments that were recorded before we introduced:
    - tender_usd/tender_lbp (what the cashier received)
    - applied amount_usd/amount_lbp (what settles the invoice in the settlement currency)

    If tender_* are both 0 on the row, we treat the existing amount_* as the entered tender.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT p.id, p.invoice_id, p.method,
                           p.amount_usd, p.amount_lbp,
                           p.tender_usd, p.tender_lbp,
                           p.voided_at,
                           p.settlement_currency AS payment_settlement_currency,
                           si.customer_id, si.exchange_rate, si.settlement_currency AS invoice_settlement_currency,
                           si.status AS invoice_status
                    FROM sales_payments p
                    JOIN sales_invoices si ON si.id = p.invoice_id AND si.company_id = %s
                    WHERE p.id = %s::uuid
                    FOR UPDATE
                    """,
                    (company_id, payment_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="payment not found")
                if row.get("voided_at"):
                    raise HTTPException(status_code=409, detail="cannot recompute a voided payment")
                if str(row.get("invoice_status") or "").strip().lower() != "posted":
                    raise HTTPException(status_code=409, detail="recompute is allowed only for posted invoices")

                adjust_date = date.today()
                assert_period_open(cur, company_id, adjust_date)

                exchange_rate = Decimal(str(row.get("exchange_rate") or 0))
                settle = str(
                    data.settlement_currency
                    or row.get("payment_settlement_currency")
                    or row.get("invoice_settlement_currency")
                    or "USD"
                ).upper()

                old_applied_usd = Decimal(str(row.get("amount_usd") or 0))
                old_applied_lbp = Decimal(str(row.get("amount_lbp") or 0))

                cur_tender_usd = Decimal(str(row.get("tender_usd") or 0))
                cur_tender_lbp = Decimal(str(row.get("tender_lbp") or 0))
                inferred_legacy = (cur_tender_usd == 0 and cur_tender_lbp == 0)

                tender_usd = Decimal(str(data.tender_usd)) if data.tender_usd is not None else (old_applied_usd if inferred_legacy else cur_tender_usd)
                tender_lbp = Decimal(str(data.tender_lbp)) if data.tender_lbp is not None else (old_applied_lbp if inferred_legacy else cur_tender_lbp)

                new_applied_usd, new_applied_lbp = _compute_applied_from_tender(
                    tender_usd=tender_usd, tender_lbp=tender_lbp, exchange_rate=exchange_rate, settle=settle
                )

                cur.execute(
                    """
                    UPDATE sales_payments
                    SET amount_usd=%s, amount_lbp=%s,
                        tender_usd=%s, tender_lbp=%s,
                        settlement_currency=%s
                    WHERE id=%s::uuid
                    """,
                    (new_applied_usd, new_applied_lbp, tender_usd, tender_lbp, settle, payment_id),
                )

                delta_usd = new_applied_usd - old_applied_usd
                delta_lbp = new_applied_lbp - old_applied_lbp

                if row.get("customer_id") and (delta_usd != 0 or delta_lbp != 0):
                    cur.execute(
                        """
                        UPDATE customers
                        SET credit_balance_usd = GREATEST(credit_balance_usd - %s, 0),
                            credit_balance_lbp = GREATEST(credit_balance_lbp - %s, 0),
                            updated_at = now()
                        WHERE company_id = %s AND id = %s
                        """,
                        (delta_usd, delta_lbp, company_id, row["customer_id"]),
                    )

                # GL is immutable. Post a delta adjustment journal instead of editing prior entries.
                if delta_usd != 0 or delta_lbp != 0:
                    defaults = _fetch_account_defaults(cur, company_id)
                    ar = defaults.get("AR")
                    if not ar:
                        raise HTTPException(status_code=400, detail="Missing AR default")
                    pay_accounts = _fetch_payment_method_accounts(cur, company_id)
                    pay_account = pay_accounts.get(row["method"])
                    if not pay_account:
                        raise HTTPException(status_code=400, detail=f"Missing payment method mapping for {row['method']}")

                    cur.execute(
                        """
                        INSERT INTO gl_journals
                          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, 'sales_payment_adjust', %s::uuid, %s, 'market', %s, %s, %s)
                        RETURNING id
                        """,
                        (
                            company_id,
                            f"CPA-{str(payment_id)[:8]}-{uuid.uuid4().hex[:4]}",
                            payment_id,
                            adjust_date,
                            exchange_rate,
                            "Customer payment recompute adjustment",
                            user["user_id"],
                        ),
                    )
                    adj_journal_id = cur.fetchone()["id"]

                    if delta_usd > 0 or delta_lbp > 0:
                        # Increased payment: Dr payment account, Cr AR.
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Customer payment recompute delta')
                            """,
                            (adj_journal_id, pay_account, delta_usd, delta_lbp),
                        )
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'AR settlement recompute delta')
                            """,
                            (adj_journal_id, ar, delta_usd, delta_lbp),
                        )
                    else:
                        # Decreased payment: Dr AR, Cr payment account.
                        abs_usd = abs(delta_usd)
                        abs_lbp = abs(delta_lbp)
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'AR settlement recompute reversal')
                            """,
                            (adj_journal_id, ar, abs_usd, abs_lbp),
                        )
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Customer payment recompute reversal')
                            """,
                            (adj_journal_id, pay_account, abs_usd, abs_lbp),
                        )

                # Bank txn (if present)
                cur.execute(
                    """
                    UPDATE bank_transactions
                    SET amount_usd=%s, amount_lbp=%s
                    WHERE company_id=%s AND source_type='sales_payment' AND source_id=%s
                    """,
                    (new_applied_usd, new_applied_lbp, company_id, payment_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'sales_payment_recompute', 'sales_payment', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        payment_id,
                        json.dumps(
                            {
                                "old_applied_usd": str(old_applied_usd),
                                "old_applied_lbp": str(old_applied_lbp),
                                "new_applied_usd": str(new_applied_usd),
                                "new_applied_lbp": str(new_applied_lbp),
                                "tender_usd": str(tender_usd),
                                "tender_lbp": str(tender_lbp),
                                "settlement_currency": settle,
                            }
                        ),
                    ),
                )

                return {
                    "ok": True,
                    "payment_id": str(payment_id),
                    "old": {"amount_usd": str(old_applied_usd), "amount_lbp": str(old_applied_lbp)},
                    "new": {"amount_usd": str(new_applied_usd), "amount_lbp": str(new_applied_lbp), "tender_usd": str(tender_usd), "tender_lbp": str(tender_lbp)},
                }


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
