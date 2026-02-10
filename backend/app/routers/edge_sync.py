import os
import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..db import get_admin_conn, set_company_context

router = APIRouter(prefix="/edge-sync", tags=["edge-sync"])


def _require_edge_key(x_edge_sync_key: Optional[str]) -> None:
    expected = (os.getenv("EDGE_SYNC_KEY") or "").strip()
    if not expected:
        # Fail closed: do not allow edge import unless explicitly configured.
        raise HTTPException(status_code=403, detail="edge sync not configured")
    if not x_edge_sync_key or x_edge_sync_key.strip() != expected:
        raise HTTPException(status_code=403, detail="forbidden")


class SalesInvoiceBundle(BaseModel):
    company_id: str
    invoice: dict[str, Any]
    lines: list[dict[str, Any]] = []
    payments: list[dict[str, Any]] = []
    tax_lines: list[dict[str, Any]] = []
    stock_moves: list[dict[str, Any]] = []
    gl_journals: list[dict[str, Any]] = []
    gl_entries: list[dict[str, Any]] = []
    customer_update: Optional[dict[str, Any]] = None
    source_node_id: Optional[str] = None


@router.post("/sales-invoices/import")
def import_sales_invoice_bundle(
    data: SalesInvoiceBundle,
    x_edge_sync_key: Optional[str] = Header(None, convert_underscores=False),
):
    """
    Cloud-side endpoint: import a fully-posted sales invoice bundle from an edge node.

    This is intentionally low-level and idempotent:
    - Inserts by primary keys (UUIDs) and uses ON CONFLICT DO NOTHING.
    - Assumes the edge is the operational source of truth for these documents.
    """
    _require_edge_key(x_edge_sync_key)

    company_id = (data.company_id or "").strip()
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id is required")

    inv = data.invoice or {}
    inv_id = str(inv.get("id") or "").strip()
    if not inv_id:
        raise HTTPException(status_code=400, detail="invoice.id is required")

    # Defensive: ensure the invoice belongs to the declared company.
    if str(inv.get("company_id") or "").strip() and str(inv.get("company_id")).strip() != company_id:
        raise HTTPException(status_code=400, detail="invoice.company_id mismatch")

    with get_admin_conn() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                set_company_context(conn, company_id)

                # Sales invoice header (include all known operational fields; rely on defaults for the rest).
                cur.execute(
                    """
                    INSERT INTO sales_invoices
                      (id, company_id, invoice_no, customer_id, status,
                       total_usd, total_lbp, subtotal_usd, subtotal_lbp, discount_total_usd, discount_total_lbp,
                       exchange_rate, pricing_currency, settlement_currency,
                       warehouse_id, doc_subtype, reserve_stock,
                       source_event_id, device_id, shift_id, cashier_id,
                       invoice_date, due_date,
                       branch_id,
                       receipt_no, receipt_seq, receipt_printer, receipt_printed_at, receipt_meta,
                       created_at,
                       canceled_at, canceled_by_user_id, cancel_reason)
                    VALUES
                      (%s::uuid, %s::uuid, %s, %s::uuid, %s,
                       %s, %s, %s, %s, %s, %s,
                       %s, %s, %s,
                       %s::uuid, %s, %s,
                       %s::uuid, %s::uuid, %s::uuid, %s::uuid,
                       %s, %s,
                       %s::uuid,
                       %s, %s, %s, %s, %s::jsonb,
                       %s,
                       %s, %s::uuid, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        inv_id,
                        company_id,
                        inv.get("invoice_no"),
                        inv.get("customer_id"),
                        inv.get("status") or "posted",
                        inv.get("total_usd") or 0,
                        inv.get("total_lbp") or 0,
                        inv.get("subtotal_usd") or 0,
                        inv.get("subtotal_lbp") or 0,
                        inv.get("discount_total_usd") or 0,
                        inv.get("discount_total_lbp") or 0,
                        inv.get("exchange_rate") or 0,
                        inv.get("pricing_currency") or "USD",
                        inv.get("settlement_currency") or (inv.get("pricing_currency") or "USD"),
                        inv.get("warehouse_id"),
                        inv.get("doc_subtype") or "standard",
                        bool(inv.get("reserve_stock") or False),
                        inv.get("source_event_id"),
                        inv.get("device_id"),
                        inv.get("shift_id"),
                        inv.get("cashier_id"),
                        str(inv.get("invoice_date") or str(inv.get("created_at") or "")[:10] or datetime.utcnow().date().isoformat()),
                        str(inv.get("due_date") or str(inv.get("invoice_date") or "")[:10] or datetime.utcnow().date().isoformat()),
                        inv.get("branch_id"),
                        inv.get("receipt_no"),
                        inv.get("receipt_seq"),
                        inv.get("receipt_printer"),
                        inv.get("receipt_printed_at"),
                        json.dumps(inv.get("receipt_meta") or {}) if inv.get("receipt_meta") is not None else None,
                        inv.get("created_at") or datetime.utcnow().isoformat(),
                        inv.get("canceled_at"),
                        inv.get("canceled_by_user_id"),
                        inv.get("cancel_reason"),
                    ),
                )

                # Lines
                for l in data.lines or []:
                    try:
                        factor = float(l.get("qty_factor") or 1)
                    except Exception:
                        factor = 1.0
                    if factor <= 0:
                        factor = 1.0
                    try:
                        qty = float(l.get("qty") or 0)
                    except Exception:
                        qty = 0.0
                    qty_entered = l.get("qty_entered")
                    try:
                        qty_entered = float(qty_entered) if qty_entered is not None else (qty / factor if factor else qty)
                    except Exception:
                        qty_entered = qty / factor if factor else qty

                    unit_price_entered_usd = l.get("unit_price_entered_usd")
                    unit_price_entered_lbp = l.get("unit_price_entered_lbp")
                    if unit_price_entered_usd is None:
                        try:
                            unit_price_entered_usd = float(l.get("unit_price_usd") or 0) * factor
                        except Exception:
                            unit_price_entered_usd = 0.0
                    if unit_price_entered_lbp is None:
                        try:
                            unit_price_entered_lbp = float(l.get("unit_price_lbp") or 0) * factor
                        except Exception:
                            unit_price_entered_lbp = 0.0

                    cur.execute(
                        """
                        INSERT INTO sales_invoice_lines
                          (id, invoice_id, item_id, qty,
                           unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp,
                           uom, qty_factor, qty_entered,
                           unit_price_entered_usd, unit_price_entered_lbp,
                           pre_discount_unit_price_usd, pre_discount_unit_price_lbp,
                           discount_pct, discount_amount_usd, discount_amount_lbp,
                           applied_promotion_id, applied_promotion_item_id, applied_price_list_id)
                        VALUES
                          (%s::uuid, %s::uuid, %s::uuid, %s,
                           %s, %s, %s, %s,
                           %s, %s, %s,
                           %s, %s,
                           %s, %s,
                           %s, %s, %s,
                           %s::uuid, %s::uuid, %s::uuid)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            l.get("id"),
                            inv_id,
                            l.get("item_id"),
                            qty,
                            l.get("unit_price_usd") or 0,
                            l.get("unit_price_lbp") or 0,
                            l.get("line_total_usd") or 0,
                            l.get("line_total_lbp") or 0,
                            l.get("uom"),
                            factor,
                            qty_entered,
                            unit_price_entered_usd,
                            unit_price_entered_lbp,
                            l.get("pre_discount_unit_price_usd") or 0,
                            l.get("pre_discount_unit_price_lbp") or 0,
                            l.get("discount_pct") or 0,
                            l.get("discount_amount_usd") or 0,
                            l.get("discount_amount_lbp") or 0,
                            l.get("applied_promotion_id"),
                            l.get("applied_promotion_item_id"),
                            l.get("applied_price_list_id"),
                        ),
                    )

                # Payments
                for p in data.payments or []:
                    cur.execute(
                        """
                        INSERT INTO sales_payments
                          (id, invoice_id, method, amount_usd, amount_lbp, tender_usd, tender_lbp,
                           reference, auth_code, provider, settlement_currency, captured_at, created_at)
                        VALUES
                          (%s::uuid, %s::uuid, %s, %s, %s, %s, %s,
                           %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            p.get("id"),
                            inv_id,
                            p.get("method"),
                            p.get("amount_usd") or 0,
                            p.get("amount_lbp") or 0,
                            p.get("tender_usd") or 0,
                            p.get("tender_lbp") or 0,
                            p.get("reference"),
                            p.get("auth_code"),
                            p.get("provider"),
                            p.get("settlement_currency"),
                            p.get("captured_at"),
                            p.get("created_at") or datetime.utcnow().isoformat(),
                        ),
                    )

                # Tax lines
                for t in data.tax_lines or []:
                    cur.execute(
                        """
                        INSERT INTO tax_lines
                          (id, company_id, source_type, source_id, tax_code_id,
                           base_usd, base_lbp, tax_usd, tax_lbp, tax_date, created_at)
                        VALUES
                          (%s::uuid, %s::uuid, %s, %s::uuid, %s::uuid,
                           %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            t.get("id"),
                            company_id,
                            t.get("source_type") or "sales_invoice",
                            t.get("source_id") or inv_id,
                            t.get("tax_code_id"),
                            t.get("base_usd") or 0,
                            t.get("base_lbp") or 0,
                            t.get("tax_usd") or 0,
                            t.get("tax_lbp") or 0,
                            t.get("tax_date"),
                            t.get("created_at") or datetime.utcnow().isoformat(),
                        ),
                    )

                # GL journals + entries
                for j in data.gl_journals or []:
                    cur.execute(
                        """
                        INSERT INTO gl_journals
                          (id, company_id, journal_no, source_type, source_id,
                           journal_date, rate_type, exchange_rate, memo,
                           created_by_user_id, created_by_device_id, created_by_cashier_id,
                           created_at)
                        VALUES
                          (%s::uuid, %s::uuid, %s, %s, %s::uuid,
                           %s, %s, %s, %s,
                           %s::uuid, %s::uuid, %s::uuid,
                           %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            j.get("id"),
                            company_id,
                            j.get("journal_no"),
                            j.get("source_type"),
                            j.get("source_id"),
                            j.get("journal_date"),
                            j.get("rate_type") or "market",
                            j.get("exchange_rate") or inv.get("exchange_rate") or 0,
                            j.get("memo"),
                            j.get("created_by_user_id"),
                            j.get("created_by_device_id"),
                            j.get("created_by_cashier_id"),
                            j.get("created_at") or datetime.utcnow().isoformat(),
                        ),
                    )

                for e in data.gl_entries or []:
                    cur.execute(
                        """
                        INSERT INTO gl_entries
                          (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo,
                           warehouse_id, customer_id, supplier_id, item_id, created_at)
                        VALUES
                          (%s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s, %s,
                           %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            e.get("id"),
                            e.get("journal_id"),
                            e.get("account_id"),
                            e.get("debit_usd") or 0,
                            e.get("credit_usd") or 0,
                            e.get("debit_lbp") or 0,
                            e.get("credit_lbp") or 0,
                            e.get("memo"),
                            e.get("warehouse_id"),
                            e.get("customer_id"),
                            e.get("supplier_id"),
                            e.get("item_id"),
                            e.get("created_at") or datetime.utcnow().isoformat(),
                        ),
                    )

                # Stock moves (insert last; triggers update summary tables).
                for m in data.stock_moves or []:
                    cur.execute(
                        """
                        INSERT INTO stock_moves
                          (id, company_id, item_id, warehouse_id, batch_id,
                           qty_in, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                           source_type, source_id,
                           created_by_user_id, created_by_device_id, created_by_cashier_id,
                           reason, source_line_type, source_line_id,
                           created_at)
                        VALUES
                          (%s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid,
                           %s, %s, %s, %s, %s,
                           %s, %s::uuid,
                           %s::uuid, %s::uuid, %s::uuid,
                           %s, %s, %s::uuid,
                           %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            m.get("id"),
                            company_id,
                            m.get("item_id"),
                            m.get("warehouse_id"),
                            m.get("batch_id"),
                            m.get("qty_in") or 0,
                            m.get("qty_out") or 0,
                            m.get("unit_cost_usd") or 0,
                            m.get("unit_cost_lbp") or 0,
                            m.get("move_date") or inv.get("invoice_date"),
                            m.get("source_type") or "sales_invoice",
                            m.get("source_id") or inv_id,
                            m.get("created_by_user_id"),
                            m.get("created_by_device_id"),
                            m.get("created_by_cashier_id"),
                            m.get("reason"),
                            m.get("source_line_type"),
                            m.get("source_line_id"),
                            m.get("created_at") or datetime.utcnow().isoformat(),
                        ),
                    )

                # Optional customer balance/loyalty update (best-effort; edge is authoritative).
                if data.customer_update:
                    cu = data.customer_update
                    cid = cu.get("id") or None
                    if cid:
                        cur.execute(
                            """
                            UPDATE customers
                            SET credit_balance_usd = %s,
                                credit_balance_lbp = %s,
                                loyalty_points = %s,
                                updated_at = now()
                            WHERE company_id = %s AND id = %s
                            """,
                            (
                                cu.get("credit_balance_usd") or 0,
                                cu.get("credit_balance_lbp") or 0,
                                cu.get("loyalty_points") or 0,
                                company_id,
                                cid,
                            ),
                        )

    return {"ok": True, "invoice_id": inv_id}
