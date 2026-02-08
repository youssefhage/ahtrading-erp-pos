from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from datetime import date, timedelta
import uuid
import os
import re
import tempfile
import subprocess
import hashlib
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..period_locks import assert_period_open
import json
from ..journal_utils import auto_balance_journal
from ..validation import DocStatus, PaymentMethod, CurrencyCode
from ..ai.purchase_invoice_import import (
    openai_extract_purchase_invoice_from_image,
    openai_extract_purchase_invoice_from_text,
)

router = APIRouter(prefix="/purchases", tags=["purchases"])

def _norm_code(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = (s or "").strip().upper()
    t = re.sub(r"\s+", "", t)
    t = re.sub(r"[^A-Z0-9._\\-/]", "", t)
    return t or None


def _norm_name(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = (s or "").strip().lower()
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def _default_exchange_rate(cur, company_id: str) -> Decimal:
    cur.execute(
        """
        SELECT rate
        FROM exchange_rates
        WHERE company_id = %s
        ORDER BY rate_date DESC
        LIMIT 1
        """,
        (company_id,),
    )
    r = cur.fetchone()
    if r and r.get("rate") is not None:
        try:
            ex = Decimal(str(r["rate"] or 0))
            if ex > 0:
                return ex
        except Exception:
            pass
    # Safe fallback (matches Admin UI default).
    return Decimal("90000")


def _clean_item_name(raw: str) -> str:
    t = (raw or "").strip()
    t = re.sub(r"\s+", " ", t)
    # Basic cleanup: don't aggressively title-case (brands/codes can be uppercase).
    return t[:200] if t else "New Item"

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
    # Backward compatibility for clients sending only one currency.
    if exchange_rate and exchange_rate != 0:
        if usd == 0 and lbp != 0:
            usd = lbp / exchange_rate
        elif lbp == 0 and usd != 0:
            lbp = usd * exchange_rate
    return usd, lbp


def _compute_costed_lines(lines_in, exchange_rate: Decimal):
    # Normalize USD/LBP unit costs using exchange rate and compute line totals.
    exchange_rate = Decimal(str(exchange_rate or 0))
    out = []
    base_usd = Decimal('0')
    base_lbp = Decimal('0')
    for ln in lines_in or []:
        qty = Decimal(str(getattr(ln, 'qty', 0) or 0))
        unit_usd = Decimal(str(getattr(ln, 'unit_cost_usd', 0) or 0))
        unit_lbp = Decimal(str(getattr(ln, 'unit_cost_lbp', 0) or 0))
        unit_usd, unit_lbp = _normalize_dual_amounts(unit_usd, unit_lbp, exchange_rate)
        line_total_usd = qty * unit_usd
        line_total_lbp = qty * unit_lbp
        base_usd += line_total_usd
        base_lbp += line_total_lbp
        out.append(
            {
                'item_id': getattr(ln, 'item_id'),
                'qty': qty,
                'unit_cost_usd': unit_usd,
                'unit_cost_lbp': unit_lbp,
                'line_total_usd': line_total_usd,
                'line_total_lbp': line_total_lbp,
                'batch_no': getattr(ln, 'batch_no', None),
                'expiry_date': getattr(ln, 'expiry_date', None),
                'supplier_item_code': getattr(ln, 'supplier_item_code', None),
                'supplier_item_name': getattr(ln, 'supplier_item_name', None),
                # Optional upstream document link fields (3-way matching).
                'purchase_order_line_id': getattr(ln, 'purchase_order_line_id', None),
                'goods_receipt_line_id': getattr(ln, 'goods_receipt_line_id', None),
            }
        )
    return out, base_usd, base_lbp

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


def _get_or_create_batch(cur, company_id: str, item_id: str, batch_no: Optional[str], expiry_date: Optional[date]) -> Optional[str]:
    batch_no_norm = batch_no.strip() if isinstance(batch_no, str) else None
    if not batch_no_norm and not expiry_date:
        return None
    cur.execute(
        """
        SELECT id
        FROM batches
        WHERE company_id = %s
          AND item_id = %s
          AND batch_no IS NOT DISTINCT FROM %s
          AND expiry_date IS NOT DISTINCT FROM %s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (company_id, item_id, batch_no_norm, expiry_date),
    )
    row = cur.fetchone()
    if row:
        return row["id"]
    cur.execute(
        """
        INSERT INTO batches (id, company_id, item_id, batch_no, expiry_date)
        VALUES (gen_random_uuid(), %s, %s, %s, %s)
        RETURNING id
        """,
        (company_id, item_id, batch_no_norm, expiry_date),
    )
    return cur.fetchone()["id"]


def _touch_batch_received_metadata(
    cur,
    company_id: str,
    batch_id: Optional[str],
    received_source_type: Optional[str],
    received_source_id: Optional[str],
    received_supplier_id: Optional[str],
):
    if not batch_id:
        return
    cur.execute(
        """
        UPDATE batches
        SET received_at = COALESCE(received_at, now()),
            received_source_type = COALESCE(received_source_type, %s),
            received_source_id = COALESCE(received_source_id, %s::uuid),
            received_supplier_id = COALESCE(received_supplier_id, %s::uuid)
        WHERE company_id = %s AND id = %s
        """,
        (received_source_type, received_source_id, received_supplier_id, company_id, batch_id),
    )


def _enforce_item_tracking(cur, company_id: str, item_id: str, batch_no: Optional[str], expiry_date: Optional[date], doc_label: str):
    """
    Enforce batch/expiry capture for items flagged as tracked.
    - track_batches => batch_no required
    - track_expiry => expiry_date required
    """
    cur.execute(
        """
        SELECT track_batches, track_expiry, default_shelf_life_days
        FROM items
        WHERE company_id=%s AND id=%s
        """,
        (company_id, item_id),
    )
    it = cur.fetchone()
    if not it:
        raise HTTPException(status_code=404, detail="item not found")

    track_batches = bool(it.get("track_batches"))
    track_expiry = bool(it.get("track_expiry"))
    shelf = it.get("default_shelf_life_days")

    bno = (batch_no or "").strip()
    if track_batches and not bno:
        raise HTTPException(status_code=400, detail=f"{doc_label}: batch_no is required for this item")

    if track_expiry and not expiry_date:
        if shelf is not None:
            try:
                return date.today() + timedelta(days=int(shelf))
            except Exception:
                pass
        raise HTTPException(status_code=400, detail=f"{doc_label}: expiry_date is required for this item")
    return expiry_date


class PurchaseLine(BaseModel):
    item_id: str
    qty: Decimal
    unit_cost_usd: Decimal
    unit_cost_lbp: Decimal
    line_total_usd: Decimal
    line_total_lbp: Decimal
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None


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


class GoodsReceiptIn(BaseModel):
    device_id: str
    supplier_id: str
    supplier_ref: Optional[str] = None
    exchange_rate: Decimal
    warehouse_id: str
    lines: List[PurchaseLine]

class GoodsReceiptDirectIn(BaseModel):
    supplier_id: str
    receipt_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    exchange_rate: Decimal
    warehouse_id: str
    lines: List[PurchaseLine]

class SupplierInvoiceIn(BaseModel):
    device_id: str
    supplier_id: str
    invoice_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    exchange_rate: Decimal
    lines: List[PurchaseLine]
    tax: Optional[TaxBlock] = None
    payments: Optional[List[PaymentBlock]] = None

class SupplierInvoiceDirectIn(BaseModel):
    supplier_id: str
    invoice_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    exchange_rate: Decimal
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
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
    warehouse_id: str
    order_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    expected_delivery_date: Optional[date] = None
    exchange_rate: Decimal
    lines: List[PurchaseOrderLine]

class PurchaseOrderStatusUpdate(BaseModel):
    status: DocStatus  # draft|posted|canceled


class PurchaseOrderDraftLineIn(BaseModel):
    item_id: str
    qty: Decimal
    unit_cost_usd: Decimal = Decimal("0")
    unit_cost_lbp: Decimal = Decimal("0")


class PurchaseOrderDraftIn(BaseModel):
    supplier_id: str
    warehouse_id: str
    order_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    expected_delivery_date: Optional[date] = None
    exchange_rate: Decimal
    # Allow creating an empty draft (header-first); posting will require lines.
    lines: List[PurchaseOrderDraftLineIn] = []


class PurchaseOrderDraftUpdateIn(BaseModel):
    supplier_id: Optional[str] = None
    warehouse_id: Optional[str] = None
    order_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    expected_delivery_date: Optional[date] = None
    exchange_rate: Optional[Decimal] = None
    lines: Optional[List[PurchaseOrderDraftLineIn]] = None


class GoodsReceiptDraftLineIn(BaseModel):
    item_id: str
    purchase_order_line_id: Optional[str] = None
    qty: Decimal
    unit_cost_usd: Decimal = Decimal("0")
    unit_cost_lbp: Decimal = Decimal("0")
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None


class GoodsReceiptDraftIn(BaseModel):
    supplier_id: str
    receipt_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    exchange_rate: Decimal
    warehouse_id: str
    purchase_order_id: Optional[str] = None
    # Allow creating an empty draft (header-first); posting will require lines.
    lines: List[GoodsReceiptDraftLineIn] = []


class GoodsReceiptDraftUpdateIn(BaseModel):
    supplier_id: Optional[str] = None
    receipt_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    exchange_rate: Optional[Decimal] = None
    warehouse_id: Optional[str] = None
    purchase_order_id: Optional[str] = None
    lines: Optional[List[GoodsReceiptDraftLineIn]] = None


class GoodsReceiptPostIn(BaseModel):
    posting_date: Optional[date] = None


class GoodsReceiptDraftFromOrderIn(BaseModel):
    warehouse_id: str
    receipt_no: Optional[str] = None
    exchange_rate: Optional[Decimal] = None


class SupplierInvoiceDraftLineIn(BaseModel):
    item_id: str
    goods_receipt_line_id: Optional[str] = None
    qty: Decimal
    unit_cost_usd: Decimal = Decimal("0")
    unit_cost_lbp: Decimal = Decimal("0")
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None
    # Preserve supplier-side identifiers/names when known (used by AI import + matching).
    supplier_item_code: Optional[str] = None
    supplier_item_name: Optional[str] = None


class SupplierInvoiceDraftIn(BaseModel):
    supplier_id: str
    invoice_no: Optional[str] = None
    supplier_ref: Optional[str] = None  # vendor invoice reference (optional)
    exchange_rate: Decimal
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    tax_code_id: Optional[str] = None
    goods_receipt_id: Optional[str] = None
    # Allow creating an empty draft (header-first); posting will require lines.
    lines: List[SupplierInvoiceDraftLineIn] = []


class SupplierInvoiceDraftUpdateIn(BaseModel):
    supplier_id: Optional[str] = None
    invoice_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    exchange_rate: Optional[Decimal] = None
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    tax_code_id: Optional[str] = None
    goods_receipt_id: Optional[str] = None
    lines: Optional[List[SupplierInvoiceDraftLineIn]] = None


class SupplierInvoicePostIn(BaseModel):
    posting_date: Optional[date] = None
    payments: Optional[List[PaymentBlock]] = None

class InvoiceHoldIn(BaseModel):
    reason: Optional[str] = None
    details: Optional[dict] = None


class SupplierInvoiceDraftFromReceiptIn(BaseModel):
    invoice_no: Optional[str] = None
    supplier_ref: Optional[str] = None
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    tax_code_id: Optional[str] = None


class SupplierPaymentIn(BaseModel):
    supplier_invoice_id: str
    method: PaymentMethod = "bank"
    amount_usd: Decimal = Decimal("0")
    amount_lbp: Decimal = Decimal("0")
    payment_date: Optional[date] = None
    bank_account_id: Optional[str] = None
    reference: Optional[str] = None
    auth_code: Optional[str] = None
    provider: Optional[str] = None
    settlement_currency: Optional[CurrencyCode] = None


@router.post("/invoices/drafts/import-file", dependencies=[Depends(require_permission("purchases:write"))])
def import_supplier_invoice_draft_from_file(
    file: UploadFile = File(...),
    exchange_rate: Optional[Decimal] = Form(None),
    tax_code_id: Optional[str] = Form(None),
    auto_create_supplier: bool = Form(True),
    auto_create_items: bool = Form(True),
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Create a draft Supplier Invoice from an uploaded image/PDF.
    - Always stores the file as a document attachment on the created draft invoice.
    - Best-effort AI extraction when OPENAI_API_KEY is configured.
    - Preserves supplier-provided item names/codes on invoice lines for future matching.
    """
    raw = file.file.read() or b""
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="attachment too large (max 5MB in v1)")

    filename = (file.filename or "purchase-invoice").strip() or "purchase-invoice"
    content_type = (file.content_type or "application/octet-stream").strip() or "application/octet-stream"
    tax_code_id = (tax_code_id or "").strip() or None

    warnings: list[str] = []
    extracted: dict | None = None
    attachment_id = None

    with get_conn() as conn:
        set_company_context(conn, company_id)

        # Phase 1: create the draft invoice + attach the file (always).
        with conn.transaction():
            with conn.cursor() as cur:
                ex = Decimal(str(exchange_rate or 0)) if exchange_rate is not None else _default_exchange_rate(cur, company_id)
                if ex <= 0:
                    ex = _default_exchange_rate(cur, company_id)

                invoice_no = _next_doc_no(cur, company_id, "PI")
                inv_date = date.today()
                due_date = inv_date

                cur.execute(
                    """
                    INSERT INTO supplier_invoices
                      (id, company_id, invoice_no, supplier_ref, supplier_id, goods_receipt_id, status,
                       total_usd, total_lbp, exchange_rate, source_event_id,
                       invoice_date, due_date, tax_code_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, NULL, NULL, NULL, 'draft',
                       0, 0, %s, NULL,
                       %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, invoice_no, ex, inv_date, due_date, tax_code_id),
                )
                invoice_id = cur.fetchone()["id"]

                sha = hashlib.sha256(raw).hexdigest() if raw else None
                cur.execute(
                    """
                    INSERT INTO document_attachments
                      (id, company_id, entity_type, entity_id, filename, content_type, size_bytes, sha256, bytes, uploaded_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, 'supplier_invoice', %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, invoice_id, filename, content_type, len(raw), sha, raw, user["user_id"]),
                )
                attachment_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_import_file_uploaded', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        invoice_id,
                        json.dumps({"invoice_no": invoice_no, "attachment_id": str(attachment_id), "filename": filename, "content_type": content_type}),
                    ),
                )

        # Phase 2: best-effort extraction + draft filling.
        try:
            if os.environ.get("OPENAI_API_KEY"):
                if content_type.lower().startswith("image/"):
                    extracted = openai_extract_purchase_invoice_from_image(raw=raw, content_type=content_type, filename=filename)
                elif content_type.lower() == "application/pdf":
                    # Best-effort PDF text extraction (works for text-based PDFs).
                    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as f:
                        f.write(raw)
                        f.flush()
                        try:
                            proc = subprocess.run(
                                ["pdftotext", "-layout", f.name, "-"],
                                capture_output=True,
                                timeout=12,
                                check=False,
                            )
                            pdf_text = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
                            if proc.returncode != 0:
                                warnings.append("pdftotext failed (PDF may be image-only).")
                            elif not pdf_text:
                                warnings.append("PDF text extraction returned empty text (PDF may be image-only).")
                            else:
                                extracted = openai_extract_purchase_invoice_from_text(text=pdf_text, filename=filename)
                        except FileNotFoundError:
                            warnings.append("pdftotext is not installed; PDF import needs poppler-utils.")
                else:
                    warnings.append("Unsupported content type for AI extraction (use image/* or application/pdf).")
            else:
                warnings.append("OPENAI_API_KEY is not configured; created draft + attached file only.")
        except Exception as ex:
            warnings.append(f"AI extraction failed: {ex}")
            extracted = None

        if extracted:
            with conn.transaction():
                with conn.cursor() as cur:
                    # Exchange rate: user-provided > extracted > default.
                    ex = Decimal(str(exchange_rate or 0)) if exchange_rate is not None else Decimal("0")
                    try:
                        ex2 = extracted.get("invoice", {}).get("exchange_rate")
                        if ex <= 0 and ex2 is not None:
                            ex = Decimal(str(ex2 or 0))
                    except Exception:
                        pass
                    if ex <= 0:
                        ex = _default_exchange_rate(cur, company_id)

                    supplier_id = None
                    supplier_created = False
                    supplier_name = (extracted.get("supplier", {}) or {}).get("name")
                    supplier_name = (supplier_name or "").strip() or None

                    if supplier_name:
                        # Match supplier by exact name, then ILIKE.
                        cur.execute(
                            "SELECT id FROM suppliers WHERE company_id=%s AND lower(name)=lower(%s) ORDER BY created_at ASC LIMIT 1",
                            (company_id, supplier_name),
                        )
                        r = cur.fetchone()
                        if r:
                            supplier_id = r["id"]
                        else:
                            cur.execute(
                                "SELECT id FROM suppliers WHERE company_id=%s AND name ILIKE %s ORDER BY created_at ASC LIMIT 1",
                                (company_id, f"%{supplier_name}%"),
                            )
                            r = cur.fetchone()
                            supplier_id = r["id"] if r else None

                    if not supplier_id and supplier_name and auto_create_supplier:
                        # Require suppliers:write only when we need to create.
                        require_permission("suppliers:write")(company_id=company_id, user=user)
                        vat_no = ((extracted.get("supplier", {}) or {}).get("vat_no") or "").strip() or None
                        phone = ((extracted.get("supplier", {}) or {}).get("phone") or "").strip() or None
                        email = ((extracted.get("supplier", {}) or {}).get("email") or "").strip() or None
                        cur.execute(
                            """
                            INSERT INTO suppliers
                              (id, company_id, name, phone, email, payment_terms_days, party_type, vat_no, is_active)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, 0, 'business', %s, true)
                            RETURNING id
                            """,
                            (company_id, supplier_name, phone, email, vat_no),
                        )
                        supplier_id = cur.fetchone()["id"]
                        supplier_created = True
                        cur.execute(
                            """
                            INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                            VALUES (gen_random_uuid(), %s, %s, 'supplier_create_ai', 'supplier', %s, %s::jsonb)
                            """,
                            (company_id, user["user_id"], supplier_id, json.dumps({"name": supplier_name, "source": "purchase_invoice_import"})),
                        )

                    inv = extracted.get("invoice", {}) or {}
                    supplier_ref = (inv.get("supplier_ref") or inv.get("invoice_no") or "").strip() or None
                    inv_date = None
                    due_date = None
                    try:
                        if inv.get("invoice_date"):
                            inv_date = date.fromisoformat(str(inv.get("invoice_date"))[:10])
                    except Exception:
                        warnings.append("invoice_date could not be parsed; kept today.")
                    try:
                        if inv.get("due_date"):
                            due_date = date.fromisoformat(str(inv.get("due_date"))[:10])
                    except Exception:
                        warnings.append("due_date could not be parsed; will compute from terms.")

                    if not inv_date:
                        inv_date = date.today()

                    if not due_date and supplier_id:
                        cur.execute(
                            "SELECT payment_terms_days FROM suppliers WHERE company_id=%s AND id=%s",
                            (company_id, supplier_id),
                        )
                        srow = cur.fetchone()
                        terms = int(srow.get("payment_terms_days") or 0) if srow else 0
                        due_date = inv_date + timedelta(days=terms) if terms > 0 else inv_date
                    if not due_date:
                        due_date = inv_date

                    # Fill header.
                    cur.execute(
                        """
                        UPDATE supplier_invoices
                        SET supplier_id = %s,
                            supplier_ref = %s,
                            exchange_rate = %s,
                            invoice_date = %s,
                            due_date = %s
                        WHERE company_id = %s AND id = %s
                        """,
                        (supplier_id, supplier_ref, ex, inv_date, due_date, company_id, invoice_id),
                    )

                    # Insert lines (delete any existing just in case).
                    cur.execute("DELETE FROM supplier_invoice_lines WHERE company_id=%s AND supplier_invoice_id=%s", (company_id, invoice_id))

                    created_items = 0
                    price_changes: list[dict] = []
                    for idx, ln in enumerate(extracted.get("lines") or []):
                        qty = Decimal(str(ln.get("qty") or 0))
                        unit_price = Decimal(str(ln.get("unit_price") or 0))
                        if qty <= 0 or unit_price <= 0:
                            continue

                        line_currency = (ln.get("currency") or inv.get("currency") or (extracted.get("totals", {}) or {}).get("currency") or "").strip().upper()
                        if line_currency not in {"USD", "LBP"}:
                            line_currency = "USD"  # safe default (we keep the raw supplier name/code anyway)

                        unit_usd = unit_price if line_currency == "USD" else (unit_price / ex if ex else Decimal("0"))
                        unit_lbp = unit_price if line_currency == "LBP" else (unit_price * ex)
                        unit_usd, unit_lbp = _normalize_dual_amounts(unit_usd, unit_lbp, ex)
                        line_total_usd = qty * unit_usd
                        line_total_lbp = qty * unit_lbp

                        supplier_item_code = (ln.get("supplier_item_code") or "").strip() or None
                        supplier_item_name = (ln.get("supplier_item_name") or "").strip() or None
                        ncode = _norm_code(supplier_item_code)
                        nname = _norm_name(supplier_item_name)

                        item_id = None
                        if supplier_id and ncode:
                            cur.execute(
                                """
                                SELECT item_id
                                FROM supplier_item_aliases
                                WHERE company_id=%s AND supplier_id=%s AND normalized_code=%s
                                ORDER BY last_seen_at DESC
                                LIMIT 1
                                """,
                                (company_id, supplier_id, ncode),
                            )
                            r = cur.fetchone()
                            item_id = r["item_id"] if r else None

                        if not item_id and ncode:
                            cur.execute("SELECT id FROM items WHERE company_id=%s AND upper(sku)=upper(%s) LIMIT 1", (company_id, ncode))
                            r = cur.fetchone()
                            item_id = r["id"] if r else None
                            if not item_id:
                                cur.execute(
                                    "SELECT item_id FROM item_barcodes WHERE company_id=%s AND barcode=%s ORDER BY is_primary DESC LIMIT 1",
                                    (company_id, ncode),
                                )
                                r = cur.fetchone()
                                item_id = r["item_id"] if r else None

                        if not item_id and nname:
                            # Very lightweight matching: direct substring on name.
                            cur.execute(
                                "SELECT id FROM items WHERE company_id=%s AND lower(name) LIKE %s ORDER BY updated_at DESC, created_at DESC LIMIT 1",
                                (company_id, f"%{nname}%"),
                            )
                            r = cur.fetchone()
                            item_id = r["id"] if r else None

                        if not item_id and auto_create_items:
                            require_permission("items:write")(company_id=company_id, user=user)
                            # SKU: prefer supplier code if it looks usable; otherwise generate.
                            sku = None
                            if ncode:
                                sku = ncode[:64]
                                cur.execute("SELECT 1 FROM items WHERE company_id=%s AND upper(sku)=upper(%s) LIMIT 1", (company_id, sku))
                                if cur.fetchone():
                                    sku = None
                            if not sku:
                                sku = f"AUTO-{uuid.uuid4().hex[:8].upper()}"
                            name = _clean_item_name(supplier_item_name or supplier_item_code or "New Item")
                            cur.execute(
                                """
                                INSERT INTO items (id, company_id, sku, barcode, name, item_type, tags, unit_of_measure, tax_code_id, reorder_point, reorder_qty, is_active)
                                VALUES (gen_random_uuid(), %s, %s, NULL, %s, 'stocked', NULL, 'EA', NULL, 0, 0, true)
                                RETURNING id
                                """,
                                (company_id, sku, name),
                            )
                            item_id = cur.fetchone()["id"]
                            created_items += 1
                            cur.execute(
                                """
                                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                                VALUES (gen_random_uuid(), %s, %s, 'item_create_ai', 'item', %s, %s::jsonb)
                                """,
                                (company_id, user["user_id"], item_id, json.dumps({"sku": sku, "name": name, "source": "purchase_invoice_import"})),
                            )

                        if not item_id:
                            warnings.append(f"line {idx+1}: could not match/create item (missing items:write?)")
                            continue

                        # Persist supplier->item mapping and last cost when possible.
                        if supplier_id:
                            # Capture price deltas before updating last_cost.
                            try:
                                cur.execute(
                                    """
                                    SELECT last_cost_usd, last_cost_lbp
                                    FROM item_suppliers
                                    WHERE company_id=%s AND item_id=%s AND supplier_id=%s
                                    """,
                                    (company_id, item_id, supplier_id),
                                )
                                prev = cur.fetchone()
                                prev_usd = Decimal(str(prev.get("last_cost_usd") or 0)) if prev else Decimal("0")
                                prev_lbp = Decimal(str(prev.get("last_cost_lbp") or 0)) if prev else Decimal("0")
                                if prev_usd > 0 and unit_usd > prev_usd * Decimal("1.05"):
                                    pct = (unit_usd - prev_usd) / prev_usd
                                    # Best-effort selling price lookup (for margin impact).
                                    cur.execute(
                                        """
                                        SELECT price_usd, price_lbp
                                        FROM item_prices
                                        WHERE item_id = %s
                                          AND effective_from <= CURRENT_DATE
                                          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
                                        ORDER BY effective_from DESC
                                        LIMIT 1
                                        """,
                                        (item_id,),
                                    )
                                    pr = cur.fetchone() or {}
                                    sell_usd = Decimal(str(pr.get("price_usd") or 0))
                                    margin_before = ((sell_usd - prev_usd) / sell_usd) if sell_usd > 0 else None
                                    margin_after = ((sell_usd - unit_usd) / sell_usd) if sell_usd > 0 else None
                                    price_changes.append(
                                        {
                                            "item_id": str(item_id),
                                            "supplier_item_code": supplier_item_code,
                                            "supplier_item_name": supplier_item_name,
                                            "prev_unit_cost_usd": str(prev_usd),
                                            "new_unit_cost_usd": str(unit_usd),
                                            "pct_increase": float(pct),
                                            "sell_price_usd": str(sell_usd) if sell_usd > 0 else None,
                                            "margin_before": (float(margin_before) if margin_before is not None else None),
                                            "margin_after": (float(margin_after) if margin_after is not None else None),
                                        }
                                    )
                                elif prev_lbp > 0 and unit_lbp > prev_lbp * Decimal("1.05"):
                                    pct = (unit_lbp - prev_lbp) / prev_lbp
                                    price_changes.append(
                                        {
                                            "item_id": str(item_id),
                                            "supplier_item_code": supplier_item_code,
                                            "supplier_item_name": supplier_item_name,
                                            "prev_unit_cost_lbp": str(prev_lbp),
                                            "new_unit_cost_lbp": str(unit_lbp),
                                            "pct_increase": float(pct),
                                        }
                                    )
                            except Exception:
                                pass

                            cur.execute(
                                """
                                INSERT INTO item_suppliers (id, company_id, item_id, supplier_id, is_primary, lead_time_days, min_order_qty, last_cost_usd, last_cost_lbp)
                                VALUES (gen_random_uuid(), %s, %s, %s, false, 0, 0, %s, %s)
                                ON CONFLICT (company_id, item_id, supplier_id) DO UPDATE
                                SET last_cost_usd = EXCLUDED.last_cost_usd,
                                    last_cost_lbp = EXCLUDED.last_cost_lbp
                                """,
                                (company_id, item_id, supplier_id, unit_usd, unit_lbp),
                            )

                            if ncode or nname:
                                if ncode:
                                    cur.execute(
                                        """
                                        INSERT INTO supplier_item_aliases
                                          (id, company_id, supplier_id, item_id,
                                           supplier_item_code, supplier_item_name,
                                           normalized_code, normalized_name,
                                           last_unit_cost_usd, last_unit_cost_lbp, last_seen_at)
                                        VALUES
                                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                                        ON CONFLICT (company_id, supplier_id, normalized_code)
                                        WHERE normalized_code IS NOT NULL AND normalized_code <> ''
                                        DO UPDATE SET item_id = EXCLUDED.item_id,
                                                      supplier_item_name = COALESCE(EXCLUDED.supplier_item_name, supplier_item_aliases.supplier_item_name),
                                                      normalized_name = COALESCE(EXCLUDED.normalized_name, supplier_item_aliases.normalized_name),
                                                      last_unit_cost_usd = EXCLUDED.last_unit_cost_usd,
                                                      last_unit_cost_lbp = EXCLUDED.last_unit_cost_lbp,
                                                      last_seen_at = now()
                                        """,
                                        (company_id, supplier_id, item_id, supplier_item_code, supplier_item_name, ncode, nname, unit_usd, unit_lbp),
                                    )
                                else:
                                    # No stable code; keep a history row (name-only matching can evolve later).
                                    cur.execute(
                                        """
                                        INSERT INTO supplier_item_aliases
                                          (id, company_id, supplier_id, item_id,
                                           supplier_item_code, supplier_item_name,
                                           normalized_code, normalized_name,
                                           last_unit_cost_usd, last_unit_cost_lbp, last_seen_at)
                                        VALUES
                                          (gen_random_uuid(), %s, %s, %s, %s, %s, NULL, %s, %s, %s, now())
                                        """,
                                        (company_id, supplier_id, item_id, supplier_item_code, supplier_item_name, nname, unit_usd, unit_lbp),
                                    )

                        cur.execute(
                            """
                            INSERT INTO supplier_invoice_lines
                              (id, company_id, supplier_invoice_id, goods_receipt_line_id, item_id, batch_id, qty,
                               unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp,
                               supplier_item_code, supplier_item_name)
                            VALUES
                              (gen_random_uuid(), %s, %s, NULL, %s, NULL, %s,
                               %s, %s, %s, %s,
                               %s, %s)
                            """,
                            (
                                company_id,
                                invoice_id,
                                item_id,
                                qty,
                                unit_usd,
                                unit_lbp,
                                line_total_usd,
                                line_total_lbp,
                                supplier_item_code,
                                supplier_item_name,
                            ),
                        )

                    if price_changes:
                        key = f"pi:{invoice_id}"
                        cur.execute(
                            """
                            SELECT 1
                            FROM ai_recommendations
                            WHERE company_id=%s
                              AND agent_code='AI_PURCHASE_INVOICE_INSIGHTS'
                              AND status='pending'
                              AND recommendation_json->>'key'=%s
                            """,
                            (company_id, key),
                        )
                        if not cur.fetchone():
                            rec_payload = {
                                "kind": "purchase_invoice_insights",
                                "key": key,
                                "invoice_id": str(invoice_id),
                                "supplier_id": (str(supplier_id) if supplier_id else None),
                                "invoice_no": inv.get("invoice_no") or None,
                                "supplier_ref": supplier_ref,
                                "price_changes": price_changes,
                                "suggestions": [
                                    "Review selling prices for impacted items (margin may have changed).",
                                    "If you price-protect key wholesale clients, consider notifying them proactively.",
                                    "If the increase is temporary, consider alternative suppliers or negotiated terms.",
                                ],
                            }
                            cur.execute(
                                """
                                INSERT INTO ai_recommendations (id, company_id, agent_code, recommendation_json, status)
                                VALUES (gen_random_uuid(), %s, 'AI_PURCHASE_INVOICE_INSIGHTS', %s::jsonb, 'pending')
                                """,
                                (company_id, json.dumps(rec_payload)),
                            )

                    # Recompute totals + tax.
                    cur.execute(
                        """
                        SELECT COALESCE(SUM(line_total_usd),0) AS base_usd, COALESCE(SUM(line_total_lbp),0) AS base_lbp
                        FROM supplier_invoice_lines
                        WHERE company_id = %s AND supplier_invoice_id = %s
                        """,
                        (company_id, invoice_id),
                    )
                    sums = cur.fetchone() or {}
                    base_usd = Decimal(str(sums.get("base_usd") or 0))
                    base_lbp = Decimal(str(sums.get("base_lbp") or 0))

                    tax_rate = Decimal("0")
                    if tax_code_id:
                        cur.execute("SELECT rate FROM tax_codes WHERE company_id=%s AND id=%s", (company_id, tax_code_id))
                        r = cur.fetchone()
                        if r:
                            tax_rate = Decimal(str(r["rate"] or 0))
                    tax_lbp = base_lbp * tax_rate
                    tax_usd = (tax_lbp / ex) if ex else Decimal("0")
                    total_usd = base_usd + tax_usd
                    total_lbp = base_lbp + tax_lbp

                    cur.execute(
                        """
                        UPDATE supplier_invoices
                        SET total_usd=%s, total_lbp=%s, exchange_rate=%s
                        WHERE company_id=%s AND id=%s
                        """,
                        (total_usd, total_lbp, ex, company_id, invoice_id),
                    )

                    cur.execute(
                        """
                        INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                        VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_import_ai_filled', 'supplier_invoice', %s, %s::jsonb)
                        """,
                        (
                            company_id,
                            user["user_id"],
                            invoice_id,
                            json.dumps(
                                {
                                    "supplier_id": (str(supplier_id) if supplier_id else None),
                                    "supplier_created": supplier_created,
                                    "created_items": created_items,
                                    "warnings": warnings,
                                }
                            ),
                        ),
                    )

        return {
            "id": invoice_id,
            "invoice_no": invoice_no,
            "attachment_id": attachment_id,
            "ai_extracted": bool(extracted),
            "warnings": warnings,
        }

@router.get("/payments", dependencies=[Depends(require_permission("purchases:read"))])
def list_supplier_payments(
    supplier_invoice_id: Optional[str] = None,
    supplier_id: Optional[str] = None,
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
                SELECT p.id, p.supplier_invoice_id, i.invoice_no, i.supplier_id,
                       s.name AS supplier_name,
                       p.method, p.amount_usd, p.amount_lbp, p.created_at
                FROM supplier_payments p
                JOIN supplier_invoices i ON i.id = p.supplier_invoice_id
                LEFT JOIN suppliers s ON s.id = i.supplier_id
                WHERE i.company_id = %s
            """
            params: list = [company_id]
            if supplier_invoice_id:
                sql += " AND p.supplier_invoice_id = %s"
                params.append(supplier_invoice_id)
            if supplier_id:
                sql += " AND i.supplier_id = %s"
                params.append(supplier_id)
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


@router.get("/receipts", dependencies=[Depends(require_permission("purchases:read"))])
def list_goods_receipts(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id, r.receipt_no, r.supplier_id, r.supplier_ref, r.warehouse_id,
                       r.purchase_order_id, po.order_no AS purchase_order_no,
                       r.status, r.total_usd, r.total_lbp, r.received_at, r.created_at
                FROM goods_receipts r
                LEFT JOIN purchase_orders po
                  ON po.company_id = r.company_id AND po.id = r.purchase_order_id
                WHERE r.company_id = %s
                ORDER BY r.created_at DESC
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
                SELECT r.id, r.receipt_no, r.supplier_id, r.supplier_ref, r.warehouse_id,
                       r.purchase_order_id, po.order_no AS purchase_order_no,
                       r.status, r.total_usd, r.total_lbp, r.exchange_rate, r.received_at, r.created_at
                FROM goods_receipts r
                LEFT JOIN purchase_orders po
                  ON po.company_id = r.company_id AND po.id = r.purchase_order_id
                WHERE r.company_id = %s AND r.id = %s
                """,
                (company_id, receipt_id),
            )
            rec = cur.fetchone()
            if not rec:
                raise HTTPException(status_code=404, detail="receipt not found")
            cur.execute(
                """
                SELECT l.id, l.purchase_order_line_id, l.item_id, l.qty, l.unit_cost_usd, l.unit_cost_lbp, l.line_total_usd, l.line_total_lbp,
                       l.batch_id, b.batch_no, b.expiry_date
                FROM goods_receipt_lines l
                LEFT JOIN batches b ON b.id = l.batch_id
                WHERE l.company_id = %s AND l.goods_receipt_id = %s
                ORDER BY l.id
                """,
                (company_id, receipt_id),
            )
            return {"receipt": rec, "lines": cur.fetchall()}


@router.get("/invoices", dependencies=[Depends(require_permission("purchases:read"))])
def list_supplier_invoices(
    company_id: str = Depends(get_company_id),
    limit: Optional[int] = None,
    offset: int = 0,
    q: Optional[str] = None,
    status: Optional[DocStatus] = None,
    supplier_id: Optional[str] = None,
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
                FROM supplier_invoices i
                LEFT JOIN goods_receipts gr
                  ON gr.company_id = i.company_id AND gr.id = i.goods_receipt_id
                LEFT JOIN suppliers s
                  ON s.company_id = i.company_id AND s.id = i.supplier_id
                WHERE i.company_id = %s
            """
            params: list = [company_id]

            if status:
                base_sql += " AND i.status = %s"
                params.append(status)
            if supplier_id:
                base_sql += " AND i.supplier_id = %s"
                params.append(supplier_id)
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
                    OR COALESCE(i.supplier_ref, '') ILIKE %s
                    OR COALESCE(s.name, '') ILIKE %s
                    OR COALESCE(gr.receipt_no, '') ILIKE %s
                    OR i.id::text ILIKE %s
                  )
                """
                params.extend([needle, needle, needle, needle, needle])

            select_sql = f"""
                SELECT i.id, i.invoice_no, i.supplier_ref, i.supplier_id, s.name AS supplier_name,
                       i.goods_receipt_id, gr.receipt_no AS goods_receipt_no,
                       i.is_on_hold, i.hold_reason,
                       i.status, i.total_usd, i.total_lbp, i.tax_code_id, i.invoice_date, i.due_date, i.created_at
                {base_sql}
                ORDER BY {sort_sql} {dir_sql}
            """

            if limit is None:
                cur.execute(select_sql, params)
                return {"invoices": cur.fetchall()}

            cur.execute(f"SELECT COUNT(*)::int AS total {base_sql}", params)
            total = cur.fetchone()["total"]
            cur.execute(select_sql + " LIMIT %s OFFSET %s", params + [limit, offset])
            return {"invoices": cur.fetchall(), "total": total, "limit": limit, "offset": offset}

@router.get("/invoices/{invoice_id}", dependencies=[Depends(require_permission("purchases:read"))])
def get_supplier_invoice(invoice_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.invoice_no, i.supplier_ref, i.supplier_id, s.name AS supplier_name,
                       i.goods_receipt_id, gr.receipt_no AS goods_receipt_no,
                       i.is_on_hold, i.hold_reason, i.hold_details, i.held_at, i.released_at,
                       i.status, i.total_usd, i.total_lbp, i.exchange_rate, i.tax_code_id, i.invoice_date, i.due_date, i.created_at
                FROM supplier_invoices i
                LEFT JOIN goods_receipts gr
                  ON gr.company_id = i.company_id AND gr.id = i.goods_receipt_id
                LEFT JOIN suppliers s
                  ON s.company_id = i.company_id AND s.id = i.supplier_id
                WHERE i.company_id = %s AND i.id = %s
                """,
                (company_id, invoice_id),
            )
            inv = cur.fetchone()
            if not inv:
                raise HTTPException(status_code=404, detail="invoice not found")
            cur.execute(
                """
                SELECT l.id, l.goods_receipt_line_id, l.item_id, it.sku AS item_sku, it.name AS item_name,
                       l.qty, l.unit_cost_usd, l.unit_cost_lbp, l.line_total_usd, l.line_total_lbp,
                       l.batch_id, b.batch_no, b.expiry_date, b.status AS batch_status,
                       l.supplier_item_code, l.supplier_item_name
                FROM supplier_invoice_lines l
                LEFT JOIN batches b ON b.id = l.batch_id
                LEFT JOIN items it
                  ON it.company_id = l.company_id AND it.id = l.item_id
                WHERE l.company_id = %s AND l.supplier_invoice_id = %s
                ORDER BY l.id
                """,
                (company_id, invoice_id),
            )
            lines = cur.fetchall()
            cur.execute(
                """
                SELECT id, method, amount_usd, amount_lbp, reference, auth_code, provider, settlement_currency, captured_at, created_at
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
                    SELECT id, order_no, supplier_id, warehouse_id, supplier_ref, expected_delivery_date,
                           requested_by_user_id, requested_at, approved_by_user_id, approved_at,
                           status, total_usd, total_lbp, created_at
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
                SELECT id, order_no, supplier_id, warehouse_id, supplier_ref, expected_delivery_date,
                       requested_by_user_id, requested_at, approved_by_user_id, approved_at,
                       status, total_usd, total_lbp, exchange_rate, created_at
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
            lines = cur.fetchall()

            # 3-way match starter: ordered vs received vs invoiced (qty only, v1).
            cur.execute(
                """
                SELECT l.purchase_order_line_id, COALESCE(SUM(l.qty), 0) AS received_qty
                FROM goods_receipt_lines l
                JOIN goods_receipts r
                  ON r.company_id = l.company_id AND r.id = l.goods_receipt_id
                WHERE l.company_id = %s
                  AND r.status = 'posted'
                  AND r.purchase_order_id = %s
                  AND l.purchase_order_line_id IS NOT NULL
                GROUP BY l.purchase_order_line_id
                """,
                (company_id, order_id),
            )
            received_by_line = {str(r["purchase_order_line_id"]): Decimal(str(r["received_qty"] or 0)) for r in cur.fetchall()}

            cur.execute(
                """
                SELECT grl.purchase_order_line_id, COALESCE(SUM(sil.qty), 0) AS invoiced_qty
                FROM supplier_invoice_lines sil
                JOIN supplier_invoices si
                  ON si.company_id = sil.company_id AND si.id = sil.supplier_invoice_id
                JOIN goods_receipt_lines grl
                  ON grl.company_id = sil.company_id AND grl.id = sil.goods_receipt_line_id
                JOIN goods_receipts r
                  ON r.company_id = grl.company_id AND r.id = grl.goods_receipt_id
                WHERE sil.company_id = %s
                  AND si.status = 'posted'
                  AND r.purchase_order_id = %s
                  AND grl.purchase_order_line_id IS NOT NULL
                GROUP BY grl.purchase_order_line_id
                """,
                (company_id, order_id),
            )
            invoiced_by_line = {str(r["purchase_order_line_id"]): Decimal(str(r["invoiced_qty"] or 0)) for r in cur.fetchall()}

            for ln in lines:
                ordered = Decimal(str(ln.get("qty") or 0))
                received = received_by_line.get(str(ln["id"]), Decimal("0"))
                invoiced = invoiced_by_line.get(str(ln["id"]), Decimal("0"))
                ln["received_qty"] = received
                ln["invoiced_qty"] = invoiced
                ln["open_to_receive_qty"] = max(Decimal("0"), ordered - received)
                ln["open_to_invoice_qty"] = max(Decimal("0"), received - invoiced)

            return {"order": po, "lines": lines}


@router.post("/orders", dependencies=[Depends(require_permission("purchases:write"))])
def create_purchase_order(data: PurchaseOrderIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.warehouse_id:
        raise HTTPException(status_code=400, detail="warehouse_id is required")
    total_usd = sum([l.line_total_usd for l in data.lines])
    total_lbp = sum([l.line_total_lbp for l in data.lines])
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                order_no = (data.order_no or "").strip() or _next_doc_no(cur, company_id, "PO")
                cur.execute(
                    """
                    INSERT INTO purchase_orders
                      (id, company_id, order_no, supplier_id, warehouse_id, status, total_usd, total_lbp, exchange_rate,
                       supplier_ref, expected_delivery_date,
                       requested_by_user_id, requested_at, approved_by_user_id, approved_at)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, 'posted', %s, %s, %s,
                       %s, %s,
                       %s, now(), %s, now())
                    RETURNING id
                    """,
                    (
                        company_id,
                        order_no,
                        data.supplier_id,
                        data.warehouse_id,
                        total_usd,
                        total_lbp,
                        data.exchange_rate,
                        (data.supplier_ref or "").strip() or None,
                        data.expected_delivery_date,
                        user["user_id"],
                        user["user_id"],
                    ),
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

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'purchase_order_created', 'purchase_order', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], po_id, json.dumps({"order_no": order_no, "warehouse_id": data.warehouse_id}, default=str)),
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




@router.post("/orders/drafts", dependencies=[Depends(require_permission("purchases:write"))])
def create_purchase_order_draft(data: PurchaseOrderDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    if not data.warehouse_id:
        raise HTTPException(status_code=400, detail="warehouse_id is required")
    normalized, base_usd, base_lbp = _compute_costed_lines(data.lines, data.exchange_rate)

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO purchase_orders
                      (id, company_id, order_no, supplier_id, warehouse_id, status, total_usd, total_lbp, exchange_rate,
                       supplier_ref, expected_delivery_date,
                       requested_by_user_id, requested_at)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, 'draft', %s, %s, %s,
                       %s, %s,
                       %s, now())
                    RETURNING id
                    """,
                    (
                        company_id,
                        (data.order_no or None),
                        data.supplier_id,
                        data.warehouse_id,
                        base_usd,
                        base_lbp,
                        data.exchange_rate,
                        (data.supplier_ref or "").strip() or None,
                        data.expected_delivery_date,
                        user["user_id"],
                    ),
                )
                order_id = cur.fetchone()["id"]

                for ln in (normalized or []):
                    cur.execute(
                        """
                        INSERT INTO purchase_order_lines
                          (id, company_id, purchase_order_id, item_id, qty, unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            order_id,
                            ln["item_id"],
                            ln["qty"],
                            ln["unit_cost_usd"],
                            ln["unit_cost_lbp"],
                            ln["line_total_usd"],
                            ln["line_total_lbp"],
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'purchase_order_draft_created', 'purchase_order', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], order_id, json.dumps({"supplier_id": data.supplier_id})),
                )

                return {"id": order_id}


@router.patch("/orders/{order_id}/draft", dependencies=[Depends(require_permission("purchases:write"))])
def update_purchase_order_draft(order_id: str, data: PurchaseOrderDraftUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, supplier_id, warehouse_id, supplier_ref, expected_delivery_date, exchange_rate
                    FROM purchase_orders
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, order_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="order not found")
                if row["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft orders can be edited")

                supplier_id = patch.get("supplier_id") or row["supplier_id"]
                warehouse_id = patch.get("warehouse_id") or row.get("warehouse_id")
                if not warehouse_id:
                    raise HTTPException(status_code=400, detail="warehouse_id is required")
                supplier_ref = patch.get("supplier_ref") if patch.get("supplier_ref") is not None else row.get("supplier_ref")
                if isinstance(supplier_ref, str):
                    supplier_ref = supplier_ref.strip() or None
                expected_delivery_date = patch.get("expected_delivery_date") if patch.get("expected_delivery_date") is not None else row.get("expected_delivery_date")
                exchange_rate = patch.get("exchange_rate") if patch.get("exchange_rate") is not None else row["exchange_rate"]

                if "lines" in patch:
                    normalized, base_usd, base_lbp = _compute_costed_lines(data.lines or [], exchange_rate)

                    cur.execute(
                        """DELETE FROM purchase_order_lines WHERE company_id = %s AND purchase_order_id = %s""",
                        (company_id, order_id),
                    )
                    for ln in (normalized or []):
                        cur.execute(
                            """
                            INSERT INTO purchase_order_lines
                              (id, company_id, purchase_order_id, item_id, qty, unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                company_id,
                                order_id,
                                ln["item_id"],
                                ln["qty"],
                                ln["unit_cost_usd"],
                                ln["unit_cost_lbp"],
                                ln["line_total_usd"],
                                ln["line_total_lbp"],
                            ),
                        )
                else:
                    cur.execute(
                        """
                        SELECT COALESCE(SUM(line_total_usd),0) AS base_usd, COALESCE(SUM(line_total_lbp),0) AS base_lbp
                        FROM purchase_order_lines
                        WHERE company_id = %s AND purchase_order_id = %s
                        """,
                        (company_id, order_id),
                    )
                    sums = cur.fetchone()
                    base_usd = sums["base_usd"]
                    base_lbp = sums["base_lbp"]

                cur.execute(
                    """
                    UPDATE purchase_orders
                    SET supplier_id=%s,
                        warehouse_id=%s,
                        order_no=COALESCE(%s, order_no),
                        supplier_ref=%s,
                        expected_delivery_date=%s,
                        exchange_rate=%s,
                        total_usd=%s,
                        total_lbp=%s
                    WHERE company_id = %s AND id = %s
                    """,
                    (supplier_id, warehouse_id, patch.get("order_no"), supplier_ref, expected_delivery_date, exchange_rate, base_usd, base_lbp, company_id, order_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'purchase_order_draft_updated', 'purchase_order', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], order_id, json.dumps({"updated": sorted(patch.keys())})),
                )

                return {"ok": True}


@router.post("/orders/{order_id}/post", dependencies=[Depends(require_permission("purchases:write"))])
def post_purchase_order(order_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, order_no
                    FROM purchase_orders
                    WHERE company_id = %s AND id = %s
                    FOR UPDATE
                    """,
                    (company_id, order_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="order not found")
                if row["status"] == "posted":
                    return {"ok": True, "order_no": row.get("order_no")}
                if row["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft orders can be posted")

                # Prevent "empty posted POs" which break real-world workflows.
                cur.execute(
                    """
                    SELECT 1
                    FROM purchase_order_lines
                    WHERE company_id=%s AND purchase_order_id=%s
                    LIMIT 1
                    """,
                    (company_id, order_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail="order has no lines")
                order_no = (row["order_no"] or "").strip() or _next_doc_no(cur, company_id, "PO")

                cur.execute(
                    """
                    UPDATE purchase_orders
                    SET status='posted',
                        order_no=%s,
                        requested_by_user_id = COALESCE(requested_by_user_id, %s),
                        requested_at = COALESCE(requested_at, now()),
                        approved_by_user_id = COALESCE(approved_by_user_id, %s),
                        approved_at = COALESCE(approved_at, now())
                    WHERE company_id = %s AND id = %s
                    """,
                    (order_no, user["user_id"], user["user_id"], company_id, order_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'purchase_order_posted', 'purchase_order', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], order_id, json.dumps({"order_no": order_no})),
                )

                cur.execute(
                    """
                    INSERT INTO events (id, company_id, event_type, source_type, source_id, payload_json)
                    VALUES (gen_random_uuid(), %s, 'purchase.ordered', 'purchase_order', %s, %s::jsonb)
                    """,
                    (company_id, order_id, json.dumps({"purchase_order_id": str(order_id), "order_no": order_no})),
                )

                return {"ok": True, "order_no": order_no}


@router.post("/orders/{order_id}/cancel", dependencies=[Depends(require_permission("purchases:write"))])
def cancel_purchase_order(order_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE purchase_orders
                    SET status='canceled'
                    WHERE company_id = %s AND id = %s
                    RETURNING id
                    """,
                    (company_id, order_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="order not found")

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'purchase_order_canceled', 'purchase_order', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], order_id, json.dumps({})),
                )

                return {"ok": True}


@router.post("/receipts/drafts/from-order/{order_id}", dependencies=[Depends(require_permission("purchases:write"))])
def create_goods_receipt_draft_from_order(
    order_id: str,
    data: GoodsReceiptDraftFromOrderIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Create a draft Goods Receipt prefilled from a Purchase Order (3-way matching starter).
    Only remaining quantities (ordered - received) are copied.
    """
    if not data.warehouse_id:
        raise HTTPException(status_code=400, detail="warehouse_id is required")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, supplier_id, supplier_ref, exchange_rate, status, order_no
                    FROM purchase_orders
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, order_id),
                )
                order = cur.fetchone()
                if not order:
                    raise HTTPException(status_code=404, detail="order not found")
                if order["status"] == "canceled":
                    raise HTTPException(status_code=400, detail="cannot receive against a canceled order")
                if not order.get("supplier_id"):
                    raise HTTPException(status_code=400, detail="order has no supplier_id")

                ex = Decimal(str(data.exchange_rate or 0)) if data.exchange_rate is not None else Decimal(str(order["exchange_rate"] or 0))
                if not ex:
                    raise HTTPException(status_code=400, detail="exchange_rate is required")

                cur.execute(
                    """
                    SELECT id, item_id, qty, unit_cost_usd, unit_cost_lbp
                    FROM purchase_order_lines
                    WHERE company_id = %s AND purchase_order_id = %s
                    ORDER BY id
                    """,
                    (company_id, order_id),
                )
                po_lines = cur.fetchall()
                if not po_lines:
                    raise HTTPException(status_code=400, detail="order has no lines")

                # Remaining qty = ordered - already received (posted only).
                cur.execute(
                    """
                    SELECT l.purchase_order_line_id, COALESCE(SUM(l.qty), 0) AS received_qty
                    FROM goods_receipt_lines l
                    JOIN goods_receipts r
                      ON r.company_id = l.company_id AND r.id = l.goods_receipt_id
                    WHERE l.company_id = %s
                      AND r.status = 'posted'
                      AND r.purchase_order_id = %s
                      AND l.purchase_order_line_id IS NOT NULL
                    GROUP BY l.purchase_order_line_id
                    """,
                    (company_id, order_id),
                )
                received_by_line = {r["purchase_order_line_id"]: Decimal(str(r["received_qty"] or 0)) for r in cur.fetchall()}

                receipt_lines: list[dict] = []
                total_usd = Decimal("0")
                total_lbp = Decimal("0")
                for ln in po_lines:
                    ordered_qty = Decimal(str(ln["qty"] or 0))
                    received_qty = received_by_line.get(ln["id"], Decimal("0"))
                    remaining_qty = ordered_qty - received_qty
                    if remaining_qty <= 0:
                        continue
                    unit_usd = Decimal(str(ln["unit_cost_usd"] or 0))
                    unit_lbp = Decimal(str(ln["unit_cost_lbp"] or 0))
                    unit_usd, unit_lbp = _normalize_dual_amounts(unit_usd, unit_lbp, ex)
                    line_total_usd = remaining_qty * unit_usd
                    line_total_lbp = remaining_qty * unit_lbp
                    total_usd += line_total_usd
                    total_lbp += line_total_lbp
                    receipt_lines.append(
                        {
                            "purchase_order_line_id": ln["id"],
                            "item_id": ln["item_id"],
                            "qty": remaining_qty,
                            "unit_cost_usd": unit_usd,
                            "unit_cost_lbp": unit_lbp,
                            "line_total_usd": line_total_usd,
                            "line_total_lbp": line_total_lbp,
                        }
                    )

                if not receipt_lines:
                    raise HTTPException(status_code=400, detail="everything on this order is already received")

                cur.execute(
                    """
                    INSERT INTO goods_receipts
                      (id, company_id, receipt_no, supplier_id, supplier_ref, warehouse_id, purchase_order_id,
                       status, total_usd, total_lbp, exchange_rate, source_event_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        (data.receipt_no or None),
                        order["supplier_id"],
                        (order.get("supplier_ref") or None),
                        data.warehouse_id,
                        order_id,
                        total_usd,
                        total_lbp,
                        ex,
                        None,
                    ),
                )
                receipt_id = cur.fetchone()["id"]

                for ln in receipt_lines:
                    cur.execute(
                        """
                        INSERT INTO goods_receipt_lines
                          (id, company_id, goods_receipt_id, purchase_order_line_id, item_id, batch_id, qty,
                           unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            receipt_id,
                            ln["purchase_order_line_id"],
                            ln["item_id"],
                            ln["qty"],
                            ln["unit_cost_usd"],
                            ln["unit_cost_lbp"],
                            ln["line_total_usd"],
                            ln["line_total_lbp"],
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'goods_receipt_draft_created_from_order', 'goods_receipt', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        receipt_id,
                        json.dumps({"purchase_order_id": str(order_id), "order_no": order.get("order_no")}),
                    ),
                )

                return {"id": receipt_id}


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
                      (id, company_id, receipt_no, supplier_id, supplier_ref, warehouse_id, status,
                       total_usd, total_lbp, exchange_rate, source_event_id,
                       received_by_user_id, received_at)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, 'posted', %s, %s, %s, %s, %s, now())
                    RETURNING id
                    """,
                    (
                        company_id,
                        receipt_no,
                        data.supplier_id,
                        (data.supplier_ref or "").strip() or None,
                        data.warehouse_id,
                        total_usd,
                        total_lbp,
                        data.exchange_rate,
                        None,
                        user["user_id"],
                    ),
                )
                receipt_id = cur.fetchone()["id"]

                for idx, l in enumerate(data.lines):
                    exp = _enforce_item_tracking(cur, company_id, l.item_id, l.batch_no, l.expiry_date, f"line {idx+1}")
                    batch_id = _get_or_create_batch(cur, company_id, l.item_id, l.batch_no, exp)
                    _touch_batch_received_metadata(cur, company_id, batch_id, "goods_receipt", str(receipt_id), str(data.supplier_id))
                    line_id = str(uuid.uuid4())
                    cur.execute(
                        """
                        INSERT INTO goods_receipt_lines
                          (id, company_id, goods_receipt_id, item_id, batch_id, qty,
                           unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                        VALUES
                          (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            line_id,
                            company_id,
                            receipt_id,
                            l.item_id,
                            batch_id,
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
                          (id, company_id, item_id, warehouse_id, batch_id, qty_in, unit_cost_usd, unit_cost_lbp, move_date,
                           source_type, source_id,
                           created_by_user_id, reason, source_line_type, source_line_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, CURRENT_DATE, 'goods_receipt', %s,
                           %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            l.item_id,
                            data.warehouse_id,
                            batch_id,
                            l.qty,
                            l.unit_cost_usd,
                            l.unit_cost_lbp,
                            receipt_id,
                            user["user_id"],
                            f"Goods receipt {receipt_no}",
                            "goods_receipt_line",
                            line_id,
                        ),
                    )

                defaults = _fetch_account_defaults(cur, company_id)
                inventory = defaults.get("INVENTORY")
                grni = defaults.get("GRNI")
                if not (inventory and grni):
                    raise HTTPException(status_code=400, detail="Missing INVENTORY/GRNI account defaults")

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'goods_receipt', %s, CURRENT_DATE, 'market', %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, f"GR-{receipt_no}", receipt_id, data.exchange_rate, f"Goods receipt {receipt_no}", user["user_id"]),
                )
                journal_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Inventory received', %s)
                    """,
                    (journal_id, inventory, total_usd, total_lbp, data.warehouse_id),
                )
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'GRNI', %s)
                    """,
                    (journal_id, grni, total_usd, total_lbp, data.warehouse_id),
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


@router.post("/receipts/drafts", dependencies=[Depends(require_permission("purchases:write"))])
def create_goods_receipt_draft(data: GoodsReceiptDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    normalized, base_usd, base_lbp = _compute_costed_lines(data.lines, data.exchange_rate)

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO goods_receipts
                      (id, company_id, receipt_no, supplier_id, supplier_ref, warehouse_id, purchase_order_id, status,
                       total_usd, total_lbp, exchange_rate, source_event_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        (data.receipt_no or None),
                        data.supplier_id,
                        (data.supplier_ref or "").strip() or None,
                        data.warehouse_id,
                        data.purchase_order_id,
                        base_usd,
                        base_lbp,
                        data.exchange_rate,
                        None,
                    ),
                )
                receipt_id = cur.fetchone()["id"]

                for idx, ln in enumerate(normalized or []):
                    exp = _enforce_item_tracking(cur, company_id, ln["item_id"], ln.get("batch_no"), ln.get("expiry_date"), f"line {idx+1}")
                    batch_id = _get_or_create_batch(cur, company_id, ln["item_id"], ln.get("batch_no"), exp)
                    cur.execute(
                        """
                        INSERT INTO goods_receipt_lines
                          (id, company_id, goods_receipt_id, purchase_order_line_id, item_id, batch_id, qty,
                           unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            receipt_id,
                            ln.get("purchase_order_line_id"),
                            ln["item_id"],
                            batch_id,
                            ln["qty"],
                            ln["unit_cost_usd"],
                            ln["unit_cost_lbp"],
                            ln["line_total_usd"],
                            ln["line_total_lbp"],
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'goods_receipt_draft_created', 'goods_receipt', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], receipt_id, json.dumps({"supplier_id": data.supplier_id})),
                )

                return {"id": receipt_id}


@router.patch("/receipts/{receipt_id}/draft", dependencies=[Depends(require_permission("purchases:write"))])
def update_goods_receipt_draft(receipt_id: str, data: GoodsReceiptDraftUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, supplier_id, supplier_ref, warehouse_id, exchange_rate, purchase_order_id
                    FROM goods_receipts
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, receipt_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="receipt not found")
                if row["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft receipts can be edited")

                supplier_id = patch.get("supplier_id") or row["supplier_id"]
                supplier_ref = patch.get("supplier_ref") if patch.get("supplier_ref") is not None else row.get("supplier_ref")
                if isinstance(supplier_ref, str):
                    supplier_ref = supplier_ref.strip() or None
                warehouse_id = patch.get("warehouse_id") or row["warehouse_id"]
                purchase_order_id = patch.get("purchase_order_id") or row.get("purchase_order_id")
                exchange_rate = patch.get("exchange_rate") if patch.get("exchange_rate") is not None else row["exchange_rate"]

                if "lines" in patch:
                    normalized, base_usd, base_lbp = _compute_costed_lines(data.lines or [], exchange_rate)

                    cur.execute(
                        "DELETE FROM goods_receipt_lines WHERE company_id = %s AND goods_receipt_id = %s",
                        (company_id, receipt_id),
                    )
                    for idx, ln in enumerate(normalized):
                        exp = _enforce_item_tracking(cur, company_id, ln["item_id"], ln.get("batch_no"), ln.get("expiry_date"), f"line {idx+1}")
                        batch_id = _get_or_create_batch(cur, company_id, ln["item_id"], ln.get("batch_no"), exp)
                        cur.execute(
                            """
                            INSERT INTO goods_receipt_lines
                              (id, company_id, goods_receipt_id, purchase_order_line_id, item_id, batch_id, qty,
                               unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                company_id,
                                receipt_id,
                                ln.get("purchase_order_line_id"),
                                ln["item_id"],
                                batch_id,
                                ln["qty"],
                                ln["unit_cost_usd"],
                                ln["unit_cost_lbp"],
                                ln["line_total_usd"],
                                ln["line_total_lbp"],
                            ),
                        )
                else:
                    cur.execute(
                        """
                        SELECT COALESCE(SUM(line_total_usd),0) AS base_usd, COALESCE(SUM(line_total_lbp),0) AS base_lbp
                        FROM goods_receipt_lines
                        WHERE company_id = %s AND goods_receipt_id = %s
                        """,
                        (company_id, receipt_id),
                    )
                    sums = cur.fetchone()
                    base_usd = sums["base_usd"]
                    base_lbp = sums["base_lbp"]

                cur.execute(
                    """
                    UPDATE goods_receipts
                    SET supplier_id=%s,
                        supplier_ref=%s,
                        warehouse_id=%s,
                        purchase_order_id=COALESCE(%s, purchase_order_id),
                        receipt_no=COALESCE(%s, receipt_no),
                        exchange_rate=%s,
                        total_usd=%s,
                        total_lbp=%s
                    WHERE company_id = %s AND id = %s
                    """,
                    (
                        supplier_id,
                        supplier_ref,
                        warehouse_id,
                        purchase_order_id,
                        patch.get("receipt_no"),
                        exchange_rate,
                        base_usd,
                        base_lbp,
                        company_id,
                        receipt_id,
                    ),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'goods_receipt_draft_updated', 'goods_receipt', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], receipt_id, json.dumps({"updated": sorted(patch.keys())})),
                )

                return {"ok": True}


@router.post("/receipts/{receipt_id}/post", dependencies=[Depends(require_permission("purchases:write"))])
def post_goods_receipt(receipt_id: str, data: GoodsReceiptPostIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, receipt_no, supplier_id, supplier_ref, warehouse_id, exchange_rate
                    FROM goods_receipts
                    WHERE company_id = %s AND id = %s
                    FOR UPDATE
                    """,
                    (company_id, receipt_id),
                )
                rec = cur.fetchone()
                if not rec:
                    raise HTTPException(status_code=404, detail="receipt not found")
                if rec["status"] == "posted":
                    # Idempotency for client retries.
                    cur.execute(
                        "SELECT 1 FROM stock_moves WHERE company_id=%s AND source_type='goods_receipt' AND source_id=%s LIMIT 1",
                        (company_id, receipt_id),
                    )
                    has_moves = bool(cur.fetchone())
                    cur.execute(
                        """
                        SELECT id
                        FROM gl_journals
                        WHERE company_id=%s AND source_type='goods_receipt' AND source_id=%s
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                        (company_id, receipt_id),
                    )
                    j = cur.fetchone()
                    if not has_moves or not j:
                        raise HTTPException(status_code=409, detail="receipt is posted but missing stock moves or GL journal")
                    return {"ok": True, "receipt_no": rec.get("receipt_no"), "journal_id": (j["id"] if j else None)}
                if rec["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft receipts can be posted")

                posting_date = data.posting_date or date.today()
                assert_period_open(cur, company_id, posting_date)

                receipt_no = (rec["receipt_no"] or "").strip() or _next_doc_no(cur, company_id, "GR")

                # Safety: must not have prior posting artifacts.
                cur.execute(
                    "SELECT 1 FROM gl_journals WHERE company_id=%s AND source_type='goods_receipt' AND source_id=%s LIMIT 1",
                    (company_id, receipt_id),
                )
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="receipt already has a GL journal")
                cur.execute(
                    "SELECT 1 FROM stock_moves WHERE company_id=%s AND source_type='goods_receipt' AND source_id=%s LIMIT 1",
                    (company_id, receipt_id),
                )
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="receipt already has stock moves")

                cur.execute(
                    """
                    SELECT id, item_id, batch_id, qty, unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp
                    FROM goods_receipt_lines
                    WHERE company_id = %s AND goods_receipt_id = %s
                    ORDER BY id
                    """,
                    (company_id, receipt_id),
                )
                lines = cur.fetchall()
                if not lines:
                    raise HTTPException(status_code=400, detail="receipt has no lines")

                total_usd = sum([Decimal(str(l["line_total_usd"])) for l in lines])
                total_lbp = sum([Decimal(str(l["line_total_lbp"])) for l in lines])

                for l in lines:
                    _touch_batch_received_metadata(cur, company_id, l.get("batch_id"), "goods_receipt", str(receipt_id), str(rec.get("supplier_id") or "") or None)
                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, batch_id, qty_in, unit_cost_usd, unit_cost_lbp, move_date,
                           source_type, source_id,
                           created_by_user_id, reason, source_line_type, source_line_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, 'goods_receipt', %s,
                           %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            l["item_id"],
                            rec["warehouse_id"],
                            l["batch_id"],
                            l["qty"],
                            l["unit_cost_usd"],
                            l["unit_cost_lbp"],
                            posting_date,
                            receipt_id,
                            user["user_id"],
                            f"Goods receipt {receipt_no}",
                            "goods_receipt_line",
                            l["id"],
                        ),
                    )

                defaults = _fetch_account_defaults(cur, company_id)
                inventory = defaults.get("INVENTORY")
                grni = defaults.get("GRNI")
                if not (inventory and grni):
                    raise HTTPException(status_code=400, detail="Missing INVENTORY/GRNI account defaults")

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'goods_receipt', %s, %s, 'market', %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, f"GR-{receipt_no}", receipt_id, posting_date, rec.get("exchange_rate") or 0, f"Goods receipt {receipt_no}", user["user_id"]),
                )
                journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Inventory received', %s)
                    """,
                    (journal_id, inventory, total_usd, total_lbp, rec["warehouse_id"]),
                )
                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                    VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'GRNI', %s)
                    """,
                    (journal_id, grni, total_usd, total_lbp, rec["warehouse_id"]),
                )
                try:
                    auto_balance_journal(cur, company_id, journal_id, warehouse_id=rec["warehouse_id"])
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

                cur.execute(
                    """
                    UPDATE goods_receipts
                    SET status='posted',
                        receipt_no=%s,
                        total_usd=%s,
                        total_lbp=%s,
                        received_by_user_id = COALESCE(received_by_user_id, %s),
                        received_at = COALESCE(received_at, now())
                    WHERE company_id = %s AND id = %s
                    """,
                    (receipt_no, total_usd, total_lbp, user["user_id"], company_id, receipt_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'goods_receipt_posted', 'goods_receipt', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], receipt_id, json.dumps({"receipt_no": receipt_no})),
                )

                cur.execute(
                    """
                    INSERT INTO events (id, company_id, event_type, source_type, source_id, payload_json)
                    VALUES (gen_random_uuid(), %s, 'purchase.received', 'goods_receipt', %s, %s::jsonb)
                    """,
                    (company_id, receipt_id, json.dumps({"goods_receipt_id": str(receipt_id), "receipt_no": receipt_no})),
                )

                return {"ok": True, "receipt_no": receipt_no}

class GoodsReceiptCancelIn(BaseModel):
    cancel_date: Optional[date] = None
    reason: Optional[str] = None


class CancelDraftIn(BaseModel):
    reason: Optional[str] = None

@router.post("/receipts/{receipt_id}/cancel", dependencies=[Depends(require_permission("purchases:write"))])
def cancel_goods_receipt(receipt_id: str, data: GoodsReceiptCancelIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    cancel_date = data.cancel_date or date.today()
    reason = (data.reason or "").strip() or None

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, cancel_date)

                cur.execute(
                    """
                    SELECT id, receipt_no, status
                    FROM goods_receipts
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, receipt_id),
                )
                rec = cur.fetchone()
                if not rec:
                    raise HTTPException(status_code=404, detail="receipt not found")
                if rec["status"] == "canceled":
                    return {"ok": True}
                if rec["status"] != "posted":
                    raise HTTPException(status_code=400, detail="only posted receipts can be canceled")

                # Guardrail: if any supplier invoice references this receipt, block cancel.
                cur.execute(
                    """
                    SELECT 1
                    FROM supplier_invoices
                    WHERE company_id=%s AND goods_receipt_id=%s AND status <> 'canceled'
                    LIMIT 1
                    """,
                    (company_id, receipt_id),
                )
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="cannot cancel: supplier invoice exists for this receipt")

                # Reverse stock moves (receipt increases stock -> cancel reduces stock).
                cur.execute(
                    """
                    SELECT item_id, warehouse_id, batch_id, qty_in, unit_cost_usd, unit_cost_lbp
                    FROM stock_moves
                    WHERE company_id=%s AND source_type='goods_receipt' AND source_id=%s
                    ORDER BY created_at ASC, id ASC
                    """,
                    (company_id, receipt_id),
                )
                moves = cur.fetchall()
                if not moves:
                    raise HTTPException(status_code=400, detail="missing stock moves for receipt")

                cur.execute(
                    "SELECT 1 FROM stock_moves WHERE company_id=%s AND source_type='goods_receipt_cancel' AND source_id=%s LIMIT 1",
                    (company_id, receipt_id),
                )
                if not cur.fetchone():
                    for m in moves:
                        q_in = Decimal(str(m["qty_in"] or 0))
                        if q_in <= 0:
                            continue
                        cur.execute(
                            """
                            INSERT INTO stock_moves
                              (id, company_id, item_id, warehouse_id, batch_id, qty_in, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                               source_type, source_id, created_by_user_id, reason)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, 0, %s, %s, %s, %s, 'goods_receipt_cancel', %s, %s, %s)
                            """,
                            (
                                company_id,
                                m["item_id"],
                                m["warehouse_id"],
                                m["batch_id"],
                                q_in,
                                m["unit_cost_usd"],
                                m["unit_cost_lbp"],
                                cancel_date,
                                receipt_id,
                                user["user_id"],
                                (reason or f"Void goods receipt {rec.get('receipt_no') or str(receipt_id)[:8]}").strip() if reason is not None else None,
                            ),
                        )

                memo = f"Void goods receipt {rec.get('receipt_no') or str(receipt_id)[:8]}" + (f" ({reason})" if reason else "")
                void_journal_id = _reverse_gl_journal(
                    cur,
                    company_id,
                    "goods_receipt",
                    receipt_id,
                    "goods_receipt_cancel",
                    cancel_date,
                    user["user_id"],
                    memo,
                )

                cur.execute(
                    """
                    UPDATE goods_receipts
                    SET status='canceled',
                        canceled_at=now(),
                        canceled_by_user_id=%s,
                        cancel_reason=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], reason, company_id, receipt_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'goods_receipt_canceled', 'goods_receipt', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], receipt_id, json.dumps({"receipt_no": rec.get("receipt_no"), "journal_id": str(void_journal_id), "reason": reason})),
                )
                return {"ok": True, "journal_id": void_journal_id}


@router.post("/receipts/{receipt_id}/cancel-draft", dependencies=[Depends(require_permission("purchases:write"))])
def cancel_goods_receipt_draft(receipt_id: str, data: CancelDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Cancel a draft goods receipt (no stock/GL reversals required).
    Posted receipts must be canceled via /cancel (void) which reverses stock/GL.
    """
    reason = (data.reason or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status
                    FROM goods_receipts
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, receipt_id),
                )
                rec = cur.fetchone()
                if not rec:
                    raise HTTPException(status_code=404, detail="receipt not found")
                if rec["status"] == "canceled":
                    return {"ok": True}
                if rec["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft receipts can be canceled with this endpoint")

                cur.execute(
                    """
                    UPDATE goods_receipts
                    SET status='canceled',
                        canceled_at=now(),
                        canceled_by_user_id=%s,
                        cancel_reason=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], reason, company_id, receipt_id),
                )
                cur.execute("DELETE FROM goods_receipt_lines WHERE company_id=%s AND goods_receipt_id=%s", (company_id, receipt_id))
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'goods_receipt_draft_canceled', 'goods_receipt', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], receipt_id, json.dumps({"reason": reason})),
                )
                return {"ok": True}




@router.post("/invoices/drafts/from-receipt/{receipt_id}", dependencies=[Depends(require_permission("purchases:write"))])
def create_supplier_invoice_draft_from_receipt(
    receipt_id: str,
    data: SupplierInvoiceDraftFromReceiptIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Create a draft Supplier Invoice prefilled from a posted Goods Receipt (3-way matching).
    Only remaining quantities (received - invoiced) are copied.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, receipt_no, supplier_id, exchange_rate
                    FROM goods_receipts
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, receipt_id),
                )
                rec = cur.fetchone()
                if not rec:
                    raise HTTPException(status_code=404, detail="receipt not found")
                if rec["status"] != "posted":
                    raise HTTPException(status_code=400, detail="only posted receipts can be invoiced")
                if not rec.get("supplier_id"):
                    raise HTTPException(status_code=400, detail="receipt has no supplier_id")

                cur.execute(
                    """
                    SELECT id, item_id, batch_id, qty, unit_cost_usd, unit_cost_lbp
                    FROM goods_receipt_lines
                    WHERE company_id = %s AND goods_receipt_id = %s
                    ORDER BY id
                    """,
                    (company_id, receipt_id),
                )
                gr_lines = cur.fetchall()
                if not gr_lines:
                    raise HTTPException(status_code=400, detail="receipt has no lines")

                # Remaining qty = received - already invoiced (draft+posted, excluding canceled).
                cur.execute(
                    """
                    SELECT il.goods_receipt_line_id, COALESCE(SUM(il.qty), 0) AS invoiced_qty
                    FROM supplier_invoice_lines il
                    JOIN supplier_invoices i
                      ON i.company_id = il.company_id AND i.id = il.supplier_invoice_id
                    WHERE il.company_id = %s
                      AND i.status <> 'canceled'
                      AND i.goods_receipt_id = %s
                      AND il.goods_receipt_line_id IS NOT NULL
                    GROUP BY il.goods_receipt_line_id
                    """,
                    (company_id, receipt_id),
                )
                invoiced_by_line = {r["goods_receipt_line_id"]: Decimal(str(r["invoiced_qty"] or 0)) for r in cur.fetchall()}

                ex = Decimal(str(rec["exchange_rate"] or 0))
                if not ex:
                    raise HTTPException(status_code=400, detail="receipt exchange_rate is missing")

                inv_lines: list[dict] = []
                base_usd = Decimal("0")
                base_lbp = Decimal("0")
                for ln in gr_lines:
                    received_qty = Decimal(str(ln["qty"] or 0))
                    invoiced_qty = invoiced_by_line.get(ln["id"], Decimal("0"))
                    remaining_qty = received_qty - invoiced_qty
                    if remaining_qty <= 0:
                        continue
                    unit_usd = Decimal(str(ln["unit_cost_usd"] or 0))
                    unit_lbp = Decimal(str(ln["unit_cost_lbp"] or 0))
                    unit_usd, unit_lbp = _normalize_dual_amounts(unit_usd, unit_lbp, ex)
                    line_total_usd = remaining_qty * unit_usd
                    line_total_lbp = remaining_qty * unit_lbp
                    base_usd += line_total_usd
                    base_lbp += line_total_lbp
                    inv_lines.append(
                        {
                            "goods_receipt_line_id": ln["id"],
                            "item_id": ln["item_id"],
                            "batch_id": ln["batch_id"],
                            "qty": remaining_qty,
                            "unit_cost_usd": unit_usd,
                            "unit_cost_lbp": unit_lbp,
                            "line_total_usd": line_total_usd,
                            "line_total_lbp": line_total_lbp,
                        }
                    )

                if not inv_lines:
                    raise HTTPException(status_code=400, detail="everything on this receipt is already invoiced")

                tax_code_id = (data.tax_code_id or "").strip() or None
                tax_rate = Decimal("0")
                if tax_code_id:
                    cur.execute("SELECT rate FROM tax_codes WHERE company_id = %s AND id = %s", (company_id, tax_code_id))
                    r = cur.fetchone()
                    if not r:
                        raise HTTPException(status_code=400, detail="invalid tax_code_id")
                    tax_rate = Decimal(str(r["rate"] or 0))

                tax_lbp = base_lbp * tax_rate
                tax_usd = (tax_lbp / ex) if ex else Decimal("0")
                total_usd = base_usd + tax_usd
                total_lbp = base_lbp + tax_lbp

                # Drafts can be created even if the period is locked; posting enforces the lock.
                inv_date = data.invoice_date or date.today()

                invoice_no = (data.invoice_no or "").strip() or None
                if not invoice_no:
                    invoice_no = _next_doc_no(cur, company_id, "PI")

                due_date = data.due_date
                if not due_date:
                    cur.execute(
                        """SELECT payment_terms_days FROM suppliers WHERE company_id = %s AND id = %s""",
                        (company_id, rec["supplier_id"]),
                    )
                    srow = cur.fetchone()
                    terms = int(srow.get("payment_terms_days") or 0) if srow else 0
                    due_date = inv_date + timedelta(days=terms) if terms > 0 else inv_date

                cur.execute(
                    """
                    INSERT INTO supplier_invoices
                      (id, company_id, invoice_no, supplier_ref, supplier_id, goods_receipt_id, status,
                       total_usd, total_lbp, exchange_rate, source_event_id,
                       invoice_date, due_date, tax_code_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        invoice_no,
                        ((data.supplier_ref or "").strip() or None),
                        rec["supplier_id"],
                        receipt_id,
                        total_usd,
                        total_lbp,
                        ex,
                        None,
                        inv_date,
                        due_date,
                        tax_code_id,
                    ),
                )
                invoice_id = cur.fetchone()["id"]

                for ln in inv_lines:
                    cur.execute(
                        """
                        INSERT INTO supplier_invoice_lines
                          (id, company_id, supplier_invoice_id, goods_receipt_line_id, item_id, batch_id, qty,
                           unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            invoice_id,
                            ln["goods_receipt_line_id"],
                            ln["item_id"],
                            ln["batch_id"],
                            ln["qty"],
                            ln["unit_cost_usd"],
                            ln["unit_cost_lbp"],
                            ln["line_total_usd"],
                            ln["line_total_lbp"],
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_draft_created_from_receipt', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        invoice_id,
                        json.dumps({"goods_receipt_id": str(receipt_id), "receipt_no": rec.get("receipt_no"), "invoice_no": invoice_no}),
                    ),
                )

                return {"id": invoice_id, "invoice_no": invoice_no}


@router.post("/invoices/drafts", dependencies=[Depends(require_permission("purchases:write"))])
def create_supplier_invoice_draft(data: SupplierInvoiceDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    invoice_no = (data.invoice_no or "").strip() or None

    exchange_rate = Decimal(str(data.exchange_rate or 0))
    normalized, base_usd, base_lbp = _compute_costed_lines(data.lines, exchange_rate)

    tax_rate = Decimal('0')
    if data.tax_code_id:
        with get_conn() as conn2:
            set_company_context(conn2, company_id)
            with conn2.cursor() as cur2:
                cur2.execute(
                    """SELECT rate FROM tax_codes WHERE company_id = %s AND id = %s""",
                    (company_id, data.tax_code_id),
                )
                r = cur2.fetchone()
                if not r:
                    raise HTTPException(status_code=400, detail="invalid tax_code_id")
                tax_rate = Decimal(str(r['rate'] or 0))

    tax_lbp = base_lbp * tax_rate
    tax_usd = (tax_lbp / exchange_rate) if exchange_rate else Decimal('0')
    total_usd = base_usd + tax_usd
    total_lbp = base_lbp + tax_lbp

    inv_date = data.invoice_date or date.today()

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                # Drafts can be created even if the period is locked; posting enforces the lock.
                if not invoice_no:
                    # Drafts can be created without a vendor reference; invoice_no is our internal doc number.
                    invoice_no = _next_doc_no(cur, company_id, "PI")

                due_date = data.due_date
                if not due_date:
                    cur.execute(
                        """SELECT payment_terms_days FROM suppliers WHERE company_id = %s AND id = %s""",
                        (company_id, data.supplier_id),
                    )
                    srow = cur.fetchone()
                    terms = int(srow.get('payment_terms_days') or 0) if srow else 0
                    due_date = inv_date + timedelta(days=terms) if terms > 0 else inv_date

                cur.execute(
                    """
                    INSERT INTO supplier_invoices
                      (id, company_id, invoice_no, supplier_ref, supplier_id, goods_receipt_id, status, total_usd, total_lbp, exchange_rate, source_event_id,
                       invoice_date, due_date, tax_code_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        invoice_no,
                        ((data.supplier_ref or "").strip() or None),
                        data.supplier_id,
                        data.goods_receipt_id,
                        total_usd,
                        total_lbp,
                        exchange_rate,
                        None,
                        inv_date,
                        due_date,
                        data.tax_code_id,
                    ),
                )
                invoice_id = cur.fetchone()["id"]

                for idx, ln in enumerate(normalized or []):
                    exp = _enforce_item_tracking(cur, company_id, ln["item_id"], ln.get("batch_no"), ln.get("expiry_date"), f"line {idx+1}")
                    batch_id = _get_or_create_batch(cur, company_id, ln["item_id"], ln.get("batch_no"), exp)
                    _touch_batch_received_metadata(cur, company_id, batch_id, "supplier_invoice", str(invoice_id), str(data.supplier_id))
                    cur.execute(
                        """
                        INSERT INTO supplier_invoice_lines
                          (id, company_id, supplier_invoice_id, goods_receipt_line_id, item_id, batch_id, qty,
                           unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp,
                           supplier_item_code, supplier_item_name)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            invoice_id,
                            ln.get("goods_receipt_line_id"),
                            ln["item_id"],
                            batch_id,
                            ln["qty"],
                            ln["unit_cost_usd"],
                            ln["unit_cost_lbp"],
                            ln["line_total_usd"],
                            ln["line_total_lbp"],
                            ((ln.get("supplier_item_code") or "").strip() or None) if isinstance(ln.get("supplier_item_code"), str) else ln.get("supplier_item_code"),
                            ((ln.get("supplier_item_name") or "").strip() or None) if isinstance(ln.get("supplier_item_name"), str) else ln.get("supplier_item_name"),
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_draft_created', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps({"invoice_no": invoice_no})),
                )

                return {"id": invoice_id, "invoice_no": invoice_no}


@router.patch("/invoices/{invoice_id}/draft", dependencies=[Depends(require_permission("purchases:write"))])
def update_supplier_invoice_draft(invoice_id: str, data: SupplierInvoiceDraftUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, supplier_id, invoice_no, supplier_ref, exchange_rate, invoice_date, due_date, tax_code_id, goods_receipt_id
                    FROM supplier_invoices
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="invoice not found")
                if inv['status'] != 'draft':
                    raise HTTPException(status_code=400, detail="only draft invoices can be edited")

                supplier_id = patch.get('supplier_id') or inv['supplier_id']
                # Drafts use internal doc numbers; allow leaving invoice_no blank in the UI.
                # If a blank value is provided, keep the existing invoice_no.
                invoice_no = (inv.get('invoice_no') or '').strip()
                if 'invoice_no' in patch:
                    next_no = (patch.get('invoice_no') or '').strip()
                    if next_no:
                        invoice_no = next_no

                exchange_rate = patch.get('exchange_rate') if patch.get('exchange_rate') is not None else inv['exchange_rate']
                inv_date = patch.get('invoice_date') or inv['invoice_date']
                due_date = patch.get('due_date') or inv['due_date']
                tax_code_id = patch.get('tax_code_id') if 'tax_code_id' in patch else inv.get('tax_code_id')
                goods_receipt_id = patch.get("goods_receipt_id") if "goods_receipt_id" in patch else inv.get("goods_receipt_id")
                supplier_ref = (patch.get("supplier_ref") if "supplier_ref" in patch else inv.get("supplier_ref"))
                supplier_ref = (supplier_ref or "").strip() or None

                if 'lines' in patch:
                    normalized, base_usd, base_lbp = _compute_costed_lines(data.lines or [], exchange_rate)
                    cur.execute('DELETE FROM supplier_invoice_lines WHERE company_id=%s AND supplier_invoice_id=%s', (company_id, invoice_id))
                    for idx, ln in enumerate(normalized or []):
                        exp = _enforce_item_tracking(cur, company_id, ln["item_id"], ln.get("batch_no"), ln.get("expiry_date"), f"line {idx+1}")
                        batch_id = _get_or_create_batch(cur, company_id, ln['item_id'], ln.get('batch_no'), exp)
                        _touch_batch_received_metadata(cur, company_id, batch_id, "supplier_invoice", str(invoice_id), str(supplier_id or "") or None)
                        cur.execute(
                            """
                            INSERT INTO supplier_invoice_lines
                              (id, company_id, supplier_invoice_id, goods_receipt_line_id, item_id, batch_id, qty,
                               unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp,
                               supplier_item_code, supplier_item_name)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                company_id,
                                invoice_id,
                                ln.get("goods_receipt_line_id"),
                                ln['item_id'],
                                batch_id,
                                ln['qty'],
                                ln['unit_cost_usd'],
                                ln['unit_cost_lbp'],
                                ln['line_total_usd'],
                                ln['line_total_lbp'],
                                ((ln.get("supplier_item_code") or "").strip() or None) if isinstance(ln.get("supplier_item_code"), str) else ln.get("supplier_item_code"),
                                ((ln.get("supplier_item_name") or "").strip() or None) if isinstance(ln.get("supplier_item_name"), str) else ln.get("supplier_item_name"),
                            ),
                        )
                else:
                    cur.execute(
                        """
                        SELECT COALESCE(SUM(line_total_usd),0) AS base_usd, COALESCE(SUM(line_total_lbp),0) AS base_lbp
                        FROM supplier_invoice_lines
                        WHERE company_id = %s AND supplier_invoice_id = %s
                        """,
                        (company_id, invoice_id),
                    )
                    sums = cur.fetchone()
                    base_usd = Decimal(str(sums['base_usd'] or 0))
                    base_lbp = Decimal(str(sums['base_lbp'] or 0))

                tax_rate = Decimal('0')
                if tax_code_id:
                    cur.execute('SELECT rate FROM tax_codes WHERE company_id=%s AND id=%s', (company_id, tax_code_id))
                    r = cur.fetchone()
                    if not r:
                        raise HTTPException(status_code=400, detail='invalid tax_code_id')
                    tax_rate = Decimal(str(r['rate'] or 0))

                tax_lbp = base_lbp * tax_rate
                ex = Decimal(str(exchange_rate or 0))
                tax_usd = (tax_lbp / ex) if ex else Decimal('0')
                total_usd = base_usd + tax_usd
                total_lbp = base_lbp + tax_lbp

                cur.execute(
                    """
                    UPDATE supplier_invoices
                    SET supplier_id=%s,
                        invoice_no=%s,
                        supplier_ref=%s,
                        exchange_rate=%s,
                        invoice_date=%s,
                        due_date=%s,
                        tax_code_id=%s,
                        goods_receipt_id=COALESCE(%s, goods_receipt_id),
                        total_usd=%s,
                        total_lbp=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (supplier_id, invoice_no, supplier_ref, exchange_rate, inv_date, due_date, tax_code_id, goods_receipt_id, total_usd, total_lbp, company_id, invoice_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_draft_updated', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user['user_id'], invoice_id, json.dumps({'updated': sorted(patch.keys())})),
                )

                return {"ok": True}


@router.get("/invoices/{invoice_id}/post-preview", dependencies=[Depends(require_permission("purchases:read"))])
def supplier_invoice_post_preview(invoice_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, status, exchange_rate, tax_code_id
                FROM supplier_invoices
                WHERE company_id = %s AND id = %s
                """,
                (company_id, invoice_id),
            )
            inv = cur.fetchone()
            if not inv:
                raise HTTPException(status_code=404, detail='invoice not found')
            if inv['status'] != 'draft':
                raise HTTPException(status_code=400, detail='only draft invoices can be previewed')

            cur.execute(
                """
                SELECT COALESCE(SUM(line_total_usd),0) AS base_usd, COALESCE(SUM(line_total_lbp),0) AS base_lbp
                FROM supplier_invoice_lines
                WHERE company_id = %s AND supplier_invoice_id = %s
                """,
                (company_id, invoice_id),
            )
            sums = cur.fetchone()
            base_usd = Decimal(str(sums['base_usd'] or 0))
            base_lbp = Decimal(str(sums['base_lbp'] or 0))

            tax_rate = Decimal('0')
            if inv.get('tax_code_id'):
                cur.execute('SELECT rate FROM tax_codes WHERE company_id=%s AND id=%s', (company_id, inv['tax_code_id']))
                r = cur.fetchone()
                tax_rate = Decimal(str(r['rate'] or 0)) if r else Decimal('0')

            tax_lbp = base_lbp * tax_rate
            ex = Decimal(str(inv['exchange_rate'] or 0))
            tax_usd = (tax_lbp / ex) if ex else Decimal('0')
            total_usd = base_usd + tax_usd
            total_lbp = base_lbp + tax_lbp

            return {
                'base_usd': float(base_usd),
                'base_lbp': float(base_lbp),
                'tax_usd': float(tax_usd),
                'tax_lbp': float(tax_lbp),
                'total_usd': float(total_usd),
                'total_lbp': float(total_lbp),
            }


@router.post("/invoices/{invoice_id}/post", dependencies=[Depends(require_permission("purchases:write"))])
def post_supplier_invoice(invoice_id: str, data: SupplierInvoicePostIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, invoice_no, supplier_id, goods_receipt_id, status, is_on_hold, exchange_rate, invoice_date, due_date, tax_code_id,
                           COALESCE(doc_subtype,'standard') AS doc_subtype
                    FROM supplier_invoices
                    WHERE company_id = %s AND id = %s
                    FOR UPDATE
                    """,
                    (company_id, invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail='invoice not found')
                if inv["status"] == "posted":
                    cur.execute(
                        """
                        SELECT id
                        FROM gl_journals
                        WHERE company_id=%s AND source_type='supplier_invoice' AND source_id=%s
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                        (company_id, invoice_id),
                    )
                    j = cur.fetchone()
                    if not j:
                        raise HTTPException(status_code=409, detail="invoice is posted but missing GL journal")
                    return {"ok": True, "journal_id": j["id"]}
                if inv['status'] != 'draft':
                    raise HTTPException(status_code=400, detail='only draft invoices can be posted')

                # Manual/auto hold gate.
                if bool(inv.get("is_on_hold")):
                    raise HTTPException(status_code=409, detail="invoice is on hold (unhold to post)")

                inv_date = data.posting_date or inv['invoice_date'] or date.today()
                assert_period_open(cur, company_id, inv_date)

                # Safety: must not have prior posting artifacts.
                cur.execute(
                    "SELECT 1 FROM gl_journals WHERE company_id=%s AND source_type='supplier_invoice' AND source_id=%s LIMIT 1",
                    (company_id, invoice_id),
                )
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="invoice already has a GL journal")
                cur.execute(
                    "SELECT 1 FROM tax_lines WHERE company_id=%s AND source_type='supplier_invoice' AND source_id=%s LIMIT 1",
                    (company_id, invoice_id),
                )
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="invoice already has tax lines")
                cur.execute("SELECT 1 FROM supplier_payments WHERE supplier_invoice_id=%s LIMIT 1", (invoice_id,))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="invoice already has payments")

                cur.execute(
                    """
                    SELECT id, goods_receipt_line_id, item_id, batch_id, qty, unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp
                    FROM supplier_invoice_lines
                    WHERE company_id = %s AND supplier_invoice_id = %s
                    ORDER BY id
                    """,
                    (company_id, invoice_id),
                )
                lines = cur.fetchall()
                if not lines:
                    raise HTTPException(status_code=400, detail='invoice has no lines')

                if inv["doc_subtype"] == "opening_balance":
                    if inv.get("goods_receipt_id"):
                        raise HTTPException(status_code=400, detail="opening balance invoices cannot be linked to a goods receipt")
                    if inv.get("tax_code_id"):
                        raise HTTPException(status_code=400, detail="opening balance invoices cannot apply tax")

                # If linked to a Goods Receipt, enforce basic 3-way matching constraints.
                if inv.get("goods_receipt_id"):
                    cur.execute(
                        """
                        SELECT id, status, supplier_id
                        FROM goods_receipts
                        WHERE company_id = %s AND id = %s
                        """,
                        (company_id, inv["goods_receipt_id"]),
                    )
                    rec = cur.fetchone()
                    if not rec:
                        raise HTTPException(status_code=400, detail="linked goods_receipt_id not found")
                    if rec["status"] != "posted":
                        raise HTTPException(status_code=400, detail="linked goods receipt must be posted")
                    if rec.get("supplier_id") != inv.get("supplier_id"):
                        raise HTTPException(status_code=400, detail="invoice supplier_id must match receipt supplier_id")

                    qty_by_gr_line: dict[str, Decimal] = {}
                    for ln in lines:
                        gr_line_id = ln.get("goods_receipt_line_id")
                        if not gr_line_id:
                            continue
                        qty_by_gr_line[gr_line_id] = qty_by_gr_line.get(gr_line_id, Decimal("0")) + Decimal(str(ln["qty"] or 0))

                    if qty_by_gr_line:
                        gr_line_ids = list(qty_by_gr_line.keys())
                        cur.execute(
                            """
                            SELECT id, goods_receipt_id, qty
                            FROM goods_receipt_lines
                            WHERE company_id = %s AND id = ANY(%s::uuid[])
                            """,
                            (company_id, gr_line_ids),
                        )
                        gr_lines = cur.fetchall()
                        gr_by_id = {r["id"]: r for r in gr_lines}
                        for gr_line_id in gr_line_ids:
                            row = gr_by_id.get(gr_line_id)
                            if not row:
                                raise HTTPException(status_code=400, detail=f"invalid goods_receipt_line_id: {gr_line_id}")
                            if row["goods_receipt_id"] != inv["goods_receipt_id"]:
                                raise HTTPException(status_code=400, detail=f"goods_receipt_line_id not in receipt: {gr_line_id}")

                        cur.execute(
                            """
                            SELECT il.goods_receipt_line_id, COALESCE(SUM(il.qty), 0) AS invoiced_qty
                            FROM supplier_invoice_lines il
                            JOIN supplier_invoices i
                              ON i.company_id = il.company_id AND i.id = il.supplier_invoice_id
                            WHERE il.company_id = %s
                              AND i.status = 'posted'
                              AND i.goods_receipt_id = %s
                              AND i.id <> %s
                              AND il.goods_receipt_line_id = ANY(%s::uuid[])
                            GROUP BY il.goods_receipt_line_id
                            """,
                            (company_id, inv["goods_receipt_id"], invoice_id, gr_line_ids),
                        )
                        prev_by_id = {r["goods_receipt_line_id"]: Decimal(str(r["invoiced_qty"] or 0)) for r in cur.fetchall()}

                        for gr_line_id, qty in qty_by_gr_line.items():
                            prev = prev_by_id.get(gr_line_id, Decimal("0"))
                            received_qty = Decimal(str(gr_by_id[gr_line_id]["qty"] or 0))
                            if prev + qty > received_qty + Decimal("0.000001"):
                                raise HTTPException(
                                    status_code=400,
                                    detail=f"invoiced qty exceeds received qty for receipt line {gr_line_id}",
                                )

                    # Price variance detection (v1) against PO/GR costs. If we detect suspicious variance,
                    # we put the invoice on hold and return 409 so a human can review + unhold.
                    # We only run this when we have receipt-linked lines (goods_receipt_line_id).
                    gr_line_ids = sorted({ln.get("goods_receipt_line_id") for ln in lines if ln.get("goods_receipt_line_id")})
                    if gr_line_ids:
                        cur.execute(
                            """
                            SELECT grl.id AS goods_receipt_line_id,
                                   grl.qty AS received_qty,
                                   grl.unit_cost_usd AS gr_unit_cost_usd,
                                   grl.unit_cost_lbp AS gr_unit_cost_lbp,
                                   grl.purchase_order_line_id,
                                   pol.unit_cost_usd AS po_unit_cost_usd,
                                   pol.unit_cost_lbp AS po_unit_cost_lbp,
                                   it.sku AS item_sku,
                                   it.name AS item_name
                            FROM goods_receipt_lines grl
                            LEFT JOIN purchase_order_lines pol
                              ON pol.company_id = grl.company_id AND pol.id = grl.purchase_order_line_id
                            LEFT JOIN items it
                              ON it.company_id = grl.company_id AND it.id = grl.item_id
                            WHERE grl.company_id = %s
                              AND grl.id = ANY(%s::uuid[])
                            """,
                            (company_id, gr_line_ids),
                        )
                        grmeta = {str(r["goods_receipt_line_id"]): r for r in cur.fetchall()}

                        qty_by_gr_line: dict[str, Decimal] = {}
                        for ln in lines:
                            if not ln.get("goods_receipt_line_id"):
                                continue
                            gid = str(ln["goods_receipt_line_id"])
                            qty_by_gr_line[gid] = qty_by_gr_line.get(gid, Decimal("0")) + Decimal(str(ln["qty"] or 0))

                        flagged = []
                        # Thresholds: keep intentionally conservative to avoid noisy holds.
                        pct_threshold = Decimal("0.15")  # 15%
                        abs_usd_threshold = Decimal("25")  # $25 per unit difference
                        for ln in lines:
                            gid = ln.get("goods_receipt_line_id")
                            if not gid:
                                continue
                            meta = grmeta.get(str(gid)) or {}
                            exp_usd = Decimal(str(meta.get("po_unit_cost_usd") or meta.get("gr_unit_cost_usd") or 0))
                            exp_lbp = Decimal(str(meta.get("po_unit_cost_lbp") or meta.get("gr_unit_cost_lbp") or 0))
                            act_usd = Decimal(str(ln.get("unit_cost_usd") or 0))
                            act_lbp = Decimal(str(ln.get("unit_cost_lbp") or 0))
                            item_sku = meta.get("item_sku")
                            item_name = meta.get("item_name")

                            # Qty variance: invoices should not exceed the received qty for that receipt line
                            # (already enforced above), but we still capture it for hold details.
                            qty_inv = qty_by_gr_line.get(str(gid), Decimal("0"))
                            qty_recv = Decimal(str(meta.get("received_qty") or 0))
                            qty_var = qty_inv - qty_recv

                            usd_var = act_usd - exp_usd
                            lbp_var = act_lbp - exp_lbp
                            pct_var = None
                            if exp_usd:
                                try:
                                    pct_var = abs(usd_var) / abs(exp_usd)
                                except Exception:
                                    pct_var = None

                            noisy = False
                            if exp_usd and pct_var is not None and pct_var >= pct_threshold and abs(usd_var) >= abs_usd_threshold:
                                noisy = True
                            # Fallback: if only LBP is used, still flag large absolute differences.
                            if not noisy and exp_usd == 0 and exp_lbp and abs(lbp_var) >= Decimal("2500000"):
                                noisy = True
                            if qty_var > Decimal("0.000001"):
                                noisy = True

                            if noisy:
                                flagged.append(
                                    {
                                        "goods_receipt_line_id": str(gid),
                                        "item_id": str(ln.get("item_id")),
                                        "item_sku": item_sku,
                                        "item_name": item_name,
                                        "expected_unit_cost_usd": str(exp_usd),
                                        "expected_unit_cost_lbp": str(exp_lbp),
                                        "actual_unit_cost_usd": str(act_usd),
                                        "actual_unit_cost_lbp": str(act_lbp),
                                        "unit_variance_usd": str(usd_var),
                                        "unit_variance_lbp": str(lbp_var),
                                        "pct_variance_usd": (str(pct_var) if pct_var is not None else None),
                                        "received_qty": str(qty_recv),
                                        "invoiced_qty": str(qty_inv),
                                    }
                                )

                        if flagged:
                            details = {
                                "kind": "ap_variance",
                                "count": len(flagged),
                                "thresholds": {"pct": str(pct_threshold), "abs_usd": str(abs_usd_threshold)},
                                "lines": flagged[:50],
                            }
                            cur.execute(
                                """
                                UPDATE supplier_invoices
                                SET is_on_hold = true,
                                    hold_reason = %s,
                                    hold_details = %s::jsonb,
                                    held_by_user_id = %s,
                                    held_at = now()
                                WHERE company_id=%s AND id=%s
                                """,
                                ("AP variance detected (review required)", json.dumps(details), user["user_id"], company_id, invoice_id),
                            )
                            cur.execute(
                                """
                                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                                VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_hold_auto', 'supplier_invoice', %s, %s::jsonb)
                                """,
                                (company_id, user["user_id"], invoice_id, json.dumps(details)),
                            )
                            return JSONResponse(
                                status_code=409,
                                content={"error": "invoice placed on hold due to AP variance (review + unhold to post)", "details": details},
                            )

                base_usd = sum([Decimal(str(l['line_total_usd'])) for l in lines])
                base_lbp = sum([Decimal(str(l['line_total_lbp'])) for l in lines])

                tax_rate = Decimal('0')
                if inv.get('tax_code_id'):
                    cur.execute('SELECT rate FROM tax_codes WHERE company_id=%s AND id=%s', (company_id, inv['tax_code_id']))
                    r = cur.fetchone()
                    if r:
                        tax_rate = Decimal(str(r['rate'] or 0))

                exchange_rate = Decimal(str(inv['exchange_rate'] or 0))
                tax_lbp = base_lbp * tax_rate
                tax_usd = (tax_lbp / exchange_rate) if exchange_rate else Decimal('0')
                total_usd = base_usd + tax_usd
                total_lbp = base_lbp + tax_lbp

                if inv.get('tax_code_id') and (tax_usd != 0 or tax_lbp != 0):
                    cur.execute(
                        """
                        INSERT INTO tax_lines
                          (id, company_id, source_type, source_id, tax_code_id,
                           base_usd, base_lbp, tax_usd, tax_lbp, tax_date)
                        VALUES
                          (gen_random_uuid(), %s, 'supplier_invoice', %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (company_id, invoice_id, inv['tax_code_id'], base_usd, base_lbp, tax_usd, tax_lbp, inv_date),
                    )

                defaults = _fetch_account_defaults(cur, company_id)
                ap = defaults.get('AP')
                grni = defaults.get('GRNI')
                vat_rec = defaults.get('VAT_RECOVERABLE')
                opening_bal = defaults.get("OPENING_BALANCE") or defaults.get("OPENING_STOCK")
                if inv["doc_subtype"] == "opening_balance":
                    if not (ap and opening_bal):
                        raise HTTPException(status_code=400, detail="Missing AP/OPENING_BALANCE (or OPENING_STOCK fallback) account defaults")
                else:
                    if not (ap and grni):
                        raise HTTPException(status_code=400, detail='Missing AP/GRNI account defaults')
                    if (tax_usd != 0 or tax_lbp != 0) and not vat_rec:
                        raise HTTPException(status_code=400, detail='Missing VAT_RECOVERABLE account default')

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'supplier_invoice', %s, %s, 'market', %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, f"GL-{inv['invoice_no']}", invoice_id, inv_date, exchange_rate, f"Supplier invoice {inv['invoice_no']}", user["user_id"]),
                )
                journal_id = cur.fetchone()['id']

                if inv["doc_subtype"] == "opening_balance":
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Opening balance offset')
                        """,
                        (journal_id, opening_bal, total_usd, total_lbp),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'GRNI clearing')
                        """,
                        (journal_id, grni, base_usd, base_lbp),
                    )

                    if tax_usd != 0 or tax_lbp != 0:
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
                try:
                    auto_balance_journal(cur, company_id, journal_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

                payment_accounts = _fetch_payment_method_accounts(cur, company_id)
                for p in data.payments or []:
                    method = (p.method or 'bank').strip().lower()
                    amount_usd = Decimal(str(p.amount_usd or 0))
                    amount_lbp = Decimal(str(p.amount_lbp or 0))
                    amount_usd, amount_lbp = _normalize_dual_amounts(amount_usd, amount_lbp, exchange_rate)
                    if amount_usd == 0 and amount_lbp == 0:
                        continue
                    cur.execute(
                        """
                        INSERT INTO supplier_payments (id, supplier_invoice_id, method, amount_usd, amount_lbp, reference, auth_code, provider, settlement_currency, captured_at)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, NULL, NULL, NULL, NULL, now())
                        RETURNING id
                        """,
                        (invoice_id, method, amount_usd, amount_lbp),
                    )
                    pay_id = cur.fetchone()['id']
                    pay_account = payment_accounts.get(method)
                    if not pay_account:
                        raise HTTPException(status_code=400, detail=f'Missing payment method mapping for {method}')
                    cur.execute(
                        """
                        INSERT INTO gl_journals
                          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, 'supplier_payment', %s, %s, 'market', %s, %s, %s)
                        RETURNING id
                        """,
                        (company_id, f"SP-{str(pay_id)[:8]}", pay_id, inv_date, exchange_rate, "Supplier payment", user["user_id"]),
                    )
                    pay_journal = cur.fetchone()['id']
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
                    try:
                        auto_balance_journal(cur, company_id, pay_journal)
                    except ValueError as e:
                        raise HTTPException(status_code=400, detail=str(e))

                cur.execute(
                    """
                    UPDATE supplier_invoices
                    SET status='posted',
                        is_on_hold=false,
                        total_usd=%s,
                        total_lbp=%s,
                        invoice_date=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (total_usd, total_lbp, inv_date, company_id, invoice_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_posted', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user['user_id'], invoice_id, json.dumps({'invoice_no': inv['invoice_no']})),
                )

                cur.execute(
                    """
                    INSERT INTO events (id, company_id, event_type, source_type, source_id, payload_json)
                    VALUES (gen_random_uuid(), %s, 'purchase.invoiced', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, invoice_id, json.dumps({'supplier_invoice_id': str(invoice_id), 'invoice_no': inv['invoice_no']})),
                )

                return {"ok": True}

class SupplierInvoiceCancelIn(BaseModel):
    cancel_date: Optional[date] = None
    reason: Optional[str] = None

@router.post("/invoices/{invoice_id}/cancel", dependencies=[Depends(require_permission("purchases:write"))])
def cancel_supplier_invoice(invoice_id: str, data: SupplierInvoiceCancelIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    cancel_date = data.cancel_date or date.today()
    reason = (data.reason or "").strip() or None

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, cancel_date)

                cur.execute(
                    """
                    SELECT id, invoice_no, status
                    FROM supplier_invoices
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
                if inv["status"] != "posted":
                    raise HTTPException(status_code=400, detail="only posted invoices can be canceled")

                cur.execute("SELECT 1 FROM supplier_payments WHERE supplier_invoice_id=%s LIMIT 1", (invoice_id,))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="cannot cancel an invoice with payments; use a debit note/refund flow")

                # Reverse tax lines so VAT report nets to zero.
                cur.execute(
                    """
                    SELECT tax_code_id, base_usd, base_lbp, tax_usd, tax_lbp
                    FROM tax_lines
                    WHERE company_id=%s AND source_type='supplier_invoice' AND source_id=%s
                    ORDER BY created_at ASC, id ASC
                    """,
                    (company_id, invoice_id),
                )
                tax_lines = cur.fetchall()
                cur.execute(
                    "SELECT 1 FROM tax_lines WHERE company_id=%s AND source_type='supplier_invoice_cancel' AND source_id=%s LIMIT 1",
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
                              (gen_random_uuid(), %s, 'supplier_invoice_cancel', %s, %s, %s, %s, %s, %s, %s)
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

                memo = f"Void supplier invoice {inv['invoice_no']}" + (f" ({reason})" if reason else "")
                void_journal_id = _reverse_gl_journal(
                    cur,
                    company_id,
                    "supplier_invoice",
                    invoice_id,
                    "supplier_invoice_cancel",
                    cancel_date,
                    user["user_id"],
                    memo,
                )

                cur.execute(
                    """
                    UPDATE supplier_invoices
                    SET status='canceled',
                        canceled_at=now(),
                        canceled_by_user_id=%s,
                        cancel_reason=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], reason, company_id, invoice_id),
                )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_canceled', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps({"invoice_no": inv["invoice_no"], "journal_id": str(void_journal_id), "reason": reason})),
                )
                return {"ok": True, "journal_id": void_journal_id}


@router.post("/invoices/{invoice_id}/hold", dependencies=[Depends(require_permission("purchases:write"))])
def hold_supplier_invoice(invoice_id: str, data: InvoiceHoldIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    reason = (data.reason or "").strip() or "Manual hold"
    details = data.details or {}
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, is_on_hold
                    FROM supplier_invoices
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="invoice not found")
                if inv["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft invoices can be held")
                if inv.get("is_on_hold"):
                    return {"ok": True}
                cur.execute(
                    """
                    UPDATE supplier_invoices
                    SET is_on_hold=true,
                        hold_reason=%s,
                        hold_details=%s::jsonb,
                        held_by_user_id=%s,
                        held_at=now()
                    WHERE company_id=%s AND id=%s
                    """,
                    (reason, json.dumps(details), user["user_id"], company_id, invoice_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_hold', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps({"reason": reason, "details": details})),
                )
                return {"ok": True}


@router.post("/invoices/{invoice_id}/unhold", dependencies=[Depends(require_permission("purchases:write"))])
def unhold_supplier_invoice(invoice_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, is_on_hold
                    FROM supplier_invoices
                    WHERE company_id=%s AND id=%s
                    FOR UPDATE
                    """,
                    (company_id, invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="invoice not found")
                if inv["status"] != "draft":
                    raise HTTPException(status_code=400, detail="only draft invoices can be unheld")
                if not inv.get("is_on_hold"):
                    return {"ok": True}
                cur.execute(
                    """
                    UPDATE supplier_invoices
                    SET is_on_hold=false,
                        released_by_user_id=%s,
                        released_at=now()
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], company_id, invoice_id),
                )
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_unhold', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps({})),
                )
                return {"ok": True}


@router.post("/invoices/{invoice_id}/cancel-draft", dependencies=[Depends(require_permission("purchases:write"))])
def cancel_supplier_invoice_draft(invoice_id: str, data: CancelDraftIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    """
    Cancel a draft supplier invoice (no tax/GL reversals required).
    Posted invoices must be canceled via /cancel (void) which reverses tax/GL.
    """
    reason = (data.reason or "").strip() or None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status
                    FROM supplier_invoices
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
                    UPDATE supplier_invoices
                    SET status='canceled',
                        canceled_at=now(),
                        canceled_by_user_id=%s,
                        cancel_reason=%s
                    WHERE company_id=%s AND id=%s
                    """,
                    (user["user_id"], reason, company_id, invoice_id),
                )
                cur.execute("DELETE FROM supplier_invoice_lines WHERE company_id=%s AND supplier_invoice_id=%s", (company_id, invoice_id))
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice_draft_canceled', 'supplier_invoice', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], invoice_id, json.dumps({"reason": reason})),
                )
                return {"ok": True}
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
                inv_date = data.invoice_date or date.today()
                assert_period_open(cur, company_id, inv_date)
                due_date = data.due_date
                if not due_date:
                    cur.execute(
                        """
                        SELECT payment_terms_days
                        FROM suppliers
                        WHERE company_id = %s AND id = %s
                        """,
                        (company_id, data.supplier_id),
                    )
                    srow = cur.fetchone()
                    terms = int(srow.get("payment_terms_days") or 0) if srow else 0
                    due_date = inv_date + timedelta(days=terms) if terms > 0 else inv_date
                cur.execute(
                    """
                    INSERT INTO supplier_invoices
                      (id, company_id, invoice_no, supplier_ref, supplier_id, status, total_usd, total_lbp, exchange_rate, source_event_id,
                       invoice_date, due_date, tax_code_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, 'posted', %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        invoice_no,
                        ((data.supplier_ref or "").strip() or None),
                        data.supplier_id,
                        total_usd,
                        total_lbp,
                        exchange_rate,
                        None,
                        inv_date,
                        due_date,
                        (data.tax.tax_code_id if data.tax else None),
                    ),
                )
                invoice_id = cur.fetchone()["id"]

                for idx, l in enumerate(data.lines):
                    exp = _enforce_item_tracking(cur, company_id, l.item_id, l.batch_no, l.expiry_date, f"line {idx+1}")
                    batch_id = _get_or_create_batch(cur, company_id, l.item_id, l.batch_no, exp)
                    _touch_batch_received_metadata(cur, company_id, batch_id, "supplier_invoice", str(invoice_id), str(data.supplier_id))
                    cur.execute(
                        """
                        INSERT INTO supplier_invoice_lines
                          (id, company_id, supplier_invoice_id, item_id, batch_id, qty,
                           unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            invoice_id,
                            l.item_id,
                            batch_id,
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
                purchases_exp = defaults.get("PURCHASES_EXPENSE")
                vat_rec = defaults.get("VAT_RECOVERABLE")
                if not ap:
                    raise HTTPException(status_code=400, detail="Missing AP account default")
                if not purchases_exp:
                    raise HTTPException(status_code=400, detail="Missing PURCHASES_EXPENSE account default for direct supplier invoices")

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'supplier_invoice', %s, %s, 'market', %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, f"GL-{invoice_no}", invoice_id, inv_date, exchange_rate, f"Supplier invoice {invoice_no}", user["user_id"]),
                )
                journal_id = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                    VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Purchases expense')
                    """,
                    (journal_id, purchases_exp, base_usd, base_lbp),
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
                try:
                    auto_balance_journal(cur, company_id, journal_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

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
                        INSERT INTO supplier_payments (id, supplier_invoice_id, method, amount_usd, amount_lbp, reference, auth_code, provider, settlement_currency, captured_at)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, NULL, NULL, NULL, NULL, now())
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
                        INSERT INTO gl_journals
                          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, 'supplier_payment', %s, %s, 'market', %s, %s, %s)
                        RETURNING id
                        """,
                        (company_id, f"SP-{str(pay_id)[:8]}", pay_id, inv_date, exchange_rate, "Supplier payment", user["user_id"]),
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
                    try:
                        auto_balance_journal(cur, company_id, pay_journal)
                    except ValueError as e:
                        raise HTTPException(status_code=400, detail=str(e))

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
    if data.amount_usd < 0 or data.amount_lbp < 0:
        raise HTTPException(status_code=400, detail="amounts must be >= 0")
    if data.amount_usd == 0 and data.amount_lbp == 0:
        raise HTTPException(status_code=400, detail="amount is required")
    method = data.method  # already normalized by validator

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                pay_date = data.payment_date or date.today()
                assert_period_open(cur, company_id, pay_date)

                cur.execute(
                    """
                    SELECT id, supplier_id, status, is_on_hold
                    FROM supplier_invoices
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, data.supplier_invoice_id),
                )
                inv = cur.fetchone()
                if not inv:
                    raise HTTPException(status_code=404, detail="supplier invoice not found")
                if inv.get("status") != "posted":
                    raise HTTPException(status_code=400, detail="payments require a posted supplier invoice")
                if inv.get("is_on_hold"):
                    raise HTTPException(status_code=409, detail="invoice is on hold (unhold to pay)")

                # Require mapping so methods are consistent and GL accounts are resolvable.
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
                    INSERT INTO supplier_payments (id, supplier_invoice_id, method, amount_usd, amount_lbp, reference, auth_code, provider, settlement_currency, captured_at)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, now())
                    RETURNING id
                    """,
                    (
                        data.supplier_invoice_id,
                        method,
                        data.amount_usd,
                        data.amount_lbp,
                        (data.reference or None),
                        (data.auth_code or None),
                        (data.provider or None),
                        (data.settlement_currency or None),
                    ),
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
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'supplier_payment', %s, %s, 'market', %s, %s, %s)
                    RETURNING id
                    """,
                    # Payment journals don't require an FX rate; keep 0 for auditability consistency.
                    (company_id, f"SP-{str(payment_id)[:8]}", payment_id, pay_date, 0, "Supplier payment", user["user_id"]),
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
                          (gen_random_uuid(), %s, %s, %s, 'outflow', %s, %s, %s, %s, %s, %s, now(),
                           'supplier_payment', %s, %s, now())
                        """,
                        (
                            company_id,
                            data.bank_account_id,
                            pay_date,
                            data.amount_usd,
                            data.amount_lbp,
                            f"Supplier payment {str(payment_id)[:8]}",
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
                    VALUES (gen_random_uuid(), %s, %s, 'supplier_payment', 'supplier_payment', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], payment_id, json.dumps({"invoice_id": data.supplier_invoice_id, "method": method})),
                )

            return {"id": payment_id}
