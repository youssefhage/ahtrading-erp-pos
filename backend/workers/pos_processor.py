#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, date, timedelta
from typing import Optional
from decimal import Decimal
import uuid
import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = 'postgresql://localhost/ahtrading'
MAX_ATTEMPTS_DEFAULT = 5


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    # `SET ... = %s` is not valid when using the extended query protocol (psycopg sends $1).
    # Use set_config() to safely parameterize the value.
    # set_config(name text, value text, is_local boolean)
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def assert_period_open(cur, company_id: str, posting_date: date):
    cur.execute(
        """
        SELECT 1
        FROM accounting_period_locks
        WHERE company_id = %s
          AND locked = true
          AND %s BETWEEN start_date AND end_date
        LIMIT 1
        """,
        (company_id, posting_date),
    )
    if cur.fetchone():
        raise ValueError(f"accounting period is locked for date {posting_date.isoformat()}")


def fetch_account_defaults(cur, company_id: str):
    set_company_context(cur, company_id)
    cur.execute(
        """
        SELECT role_code, account_id
        FROM company_account_defaults
        WHERE company_id = %s
        """,
        (company_id,),
    )
    return {r["role_code"]: r["account_id"] for r in cur.fetchall()}


def fetch_payment_method_accounts(cur, company_id: str):
    set_company_context(cur, company_id)
    cur.execute(
        """
        SELECT m.method, m.role_code, d.account_id
        FROM payment_method_mappings m
        JOIN company_account_defaults d
          ON d.company_id = m.company_id AND d.role_code = m.role_code
        WHERE m.company_id = %s
        """,
        (company_id,),
    )
    rows = cur.fetchall()
    return {r["method"]: r["account_id"] for r in rows}

def q_points(v: Decimal) -> Decimal:
    # customer_loyalty_ledger.points is numeric(18,4)
    return v.quantize(Decimal("0.0001"))


def fetch_loyalty_policy(cur, company_id: str) -> tuple[Decimal, Decimal]:
    """
    Returns (points_per_usd, points_per_lbp) from company_settings key='loyalty'.
    Stored as value_json: {"points_per_usd": 1, "points_per_lbp": 0}
    """
    set_company_context(cur, company_id)
    cur.execute(
        """
        SELECT value_json
        FROM company_settings
        WHERE company_id=%s AND key='loyalty'
        """,
        (company_id,),
    )
    row = cur.fetchone()
    if not row:
        return Decimal("0"), Decimal("0")
    v = row.get("value_json") or {}
    try:
        p_usd = Decimal(str((v or {}).get("points_per_usd") or 0))
    except Exception:
        p_usd = Decimal("0")
    try:
        p_lbp = Decimal(str((v or {}).get("points_per_lbp") or 0))
    except Exception:
        p_lbp = Decimal("0")
    if p_usd < 0:
        p_usd = Decimal("0")
    if p_lbp < 0:
        p_lbp = Decimal("0")
    return p_usd, p_lbp


def fetch_inventory_policy(cur, company_id: str) -> dict:
    """
    Returns inventory policy JSON from company_settings key='inventory'.
    Supported keys:
    - allow_negative_stock: bool (default true for backward compatibility)
    """
    set_company_context(cur, company_id)
    cur.execute(
        """
        SELECT value_json
        FROM company_settings
        WHERE company_id=%s AND key='inventory'
        """,
        (company_id,),
    )
    row = cur.fetchone()
    v = (row or {}).get("value_json") or {}
    allow = v.get("allow_negative_stock")
    # Default to True to preserve existing behavior unless explicitly disabled.
    allow_negative_stock = True if allow is None else bool(allow)
    return {"allow_negative_stock": allow_negative_stock}


def resolve_allow_negative_stock(cur, company_id: str, item_id: str, warehouse_id: Optional[str]) -> bool:
    """
    Resolve the effective negative stock policy for an outbound allocation.

    Precedence:
    1) warehouses.allow_negative_stock (when not NULL)
    2) items.allow_negative_stock (when not NULL)
    3) company_settings key='inventory'.allow_negative_stock (default True for backward compatibility)
    """
    inv_policy = fetch_inventory_policy(cur, company_id)
    default_allow = bool(inv_policy.get("allow_negative_stock"))

    if not item_id:
        return default_allow

    if warehouse_id:
        cur.execute(
            """
            SELECT i.allow_negative_stock AS item_allow,
                   w.allow_negative_stock AS wh_allow
            FROM items i
            LEFT JOIN warehouses w
              ON w.company_id = i.company_id AND w.id = %s
            WHERE i.company_id = %s AND i.id = %s
            """,
            (warehouse_id, company_id, item_id),
        )
    else:
        cur.execute(
            """
            SELECT i.allow_negative_stock AS item_allow,
                   NULL::boolean AS wh_allow
            FROM items i
            WHERE i.company_id = %s AND i.id = %s
            """,
            (company_id, item_id),
        )
    row = cur.fetchone() or {}
    wh_allow = row.get("wh_allow")
    if wh_allow is not None:
        return bool(wh_allow)
    item_allow = row.get("item_allow")
    if item_allow is not None:
        return bool(item_allow)
    return default_allow


def apply_loyalty_points(
    cur,
    company_id: str,
    customer_id: Optional[str],
    source_type: str,
    source_id: str,
    points: Decimal,
):
    if not customer_id:
        return
    points = q_points(points)
    if points == 0:
        return
    cur.execute(
        """
        INSERT INTO customer_loyalty_ledger
          (id, company_id, customer_id, source_type, source_id, points)
        VALUES
          (gen_random_uuid(), %s, %s, %s, %s, %s)
        ON CONFLICT (company_id, source_type, source_id) DO NOTHING
        RETURNING id
        """,
        (company_id, customer_id, source_type, source_id, points),
    )
    if cur.fetchone():
        cur.execute(
            """
            UPDATE customers
            SET loyalty_points = GREATEST(loyalty_points + %s, 0),
                updated_at = now()
            WHERE company_id=%s AND id=%s
            """,
            (points, company_id, customer_id),
        )

def emit_event(cur, company_id: str, event_type: str, source_type: str, source_id: str, payload: dict):
    cur.execute(
        """
        INSERT INTO events (id, company_id, event_type, source_type, source_id, payload_json)
        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s::jsonb)
        """,
        (company_id, event_type, source_type, source_id, json.dumps(payload)),
    )

def next_doc_no(cur, company_id: str, doc_type: str) -> str:
    cur.execute("SELECT next_document_no(%s, %s) AS doc_no", (company_id, doc_type))
    row = cur.fetchone()
    return row["doc_no"]


def get_avg_cost(cur, company_id: str, item_id: str, warehouse_id: str):
    cur.execute(
        """
        SELECT avg_cost_usd, avg_cost_lbp
        FROM item_warehouse_costs
        WHERE company_id = %s AND item_id = %s AND warehouse_id = %s
        """,
        (company_id, item_id, warehouse_id),
    )
    row = cur.fetchone()
    if not row:
        return Decimal("0"), Decimal("0")
    return Decimal(str(row["avg_cost_usd"] or 0)), Decimal(str(row["avg_cost_lbp"] or 0))

def normalize_dual_amounts(usd: Decimal, lbp: Decimal, exchange_rate: Decimal) -> tuple[Decimal, Decimal]:
    """
    Best-effort backward compatibility for clients that only send one currency.
    For v1 we treat USD/LBP columns as dual-ledger amounts for the same value.
    """
    if exchange_rate and exchange_rate != 0:
        if usd == 0 and lbp != 0:
            usd = lbp / exchange_rate
        elif lbp == 0 and usd != 0:
            lbp = usd * exchange_rate
    return usd, lbp


def get_or_create_batch(cur, company_id: str, item_id: str, batch_no, expiry_date_raw):
    batch_no_norm = batch_no.strip() if isinstance(batch_no, str) else None
    expiry_date = None
    if expiry_date_raw:
        try:
            expiry_date = date.fromisoformat(str(expiry_date_raw)[:10])
        except Exception:
            expiry_date = None
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


def touch_batch_received_metadata(
    cur,
    company_id: str,
    batch_id: Optional[str],
    received_source_type: Optional[str],
    received_source_id: Optional[str],
    received_supplier_id: Optional[str],
    received_at: Optional[datetime] = None,
):
    """
    Best-effort enrichment: only fills fields that are currently NULL so we don't overwrite historical attribution.
    """
    if not batch_id:
        return
    if not received_source_type and not received_source_id and not received_supplier_id and not received_at:
        return
    cur.execute(
        """
        UPDATE batches
        SET received_at = COALESCE(received_at, %s),
            received_source_type = COALESCE(received_source_type, %s),
            received_source_id = COALESCE(received_source_id, %s::uuid),
            received_supplier_id = COALESCE(received_supplier_id, %s::uuid)
        WHERE company_id = %s AND id = %s
        """,
        (
            received_at or datetime.utcnow(),
            received_source_type,
            received_source_id,
            received_supplier_id,
            company_id,
            batch_id,
        ),
    )

def find_batch_id(cur, company_id: str, item_id: str, batch_no, expiry_date_raw):
    """
    Find an existing batch by (batch_no, expiry_date). Returns batch_id or None.
    Sales allocation should *not* auto-create batches; that would allow selling from non-existent stock.
    """
    batch_no_norm = batch_no.strip() if isinstance(batch_no, str) else None
    expiry_date = None
    if expiry_date_raw:
        try:
            expiry_date = date.fromisoformat(str(expiry_date_raw)[:10])
        except Exception:
            expiry_date = None
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
          AND status = 'available'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (company_id, item_id, batch_no_norm, expiry_date),
    )
    row = cur.fetchone()
    return row["id"] if row else None


def fetch_batch_expiry(cur, company_id: str, batch_id: str) -> Optional[date]:
    cur.execute("SELECT expiry_date FROM batches WHERE company_id=%s AND id=%s", (company_id, batch_id))
    row = cur.fetchone()
    if not row:
        return None
    return row["expiry_date"]


def fetch_batch_on_hand(cur, company_id: str, item_id: str, warehouse_id: str, batch_id: str) -> Decimal:
    cur.execute(
        """
        SELECT (COALESCE(SUM(qty_in), 0) - COALESCE(SUM(qty_out), 0)) AS on_hand
        FROM stock_moves
        WHERE company_id=%s
          AND item_id=%s
          AND warehouse_id=%s
          AND batch_id = %s
        """,
        (company_id, item_id, warehouse_id, batch_id),
    )
    row = cur.fetchone()
    return Decimal(str((row or {}).get("on_hand") or 0))


def allocate_fefo_batches(
    cur,
    company_id: str,
    item_id: str,
    warehouse_id: str,
    qty_out: Decimal,
    min_expiry_date: Optional[date] = None,
    allow_unbatched_remainder: bool = True,
    allow_negative_stock: bool = True,
):
    """
    Allocates outbound quantity across batches in FEFO order (earliest expiry first).
    Returns list of (batch_id, qty) allocations. batch_id may be None for unbatched remainder.
    """
    if qty_out <= 0:
        return []

    if min_expiry_date:
        cur.execute(
            """
            SELECT sm.batch_id,
                   b.expiry_date,
                   (SUM(sm.qty_in) - SUM(sm.qty_out)) AS on_hand
            FROM stock_moves sm
            LEFT JOIN batches b ON b.id = sm.batch_id
            WHERE sm.company_id = %s
              AND sm.item_id = %s
              AND sm.warehouse_id = %s
              AND (sm.batch_id IS NULL OR b.status = 'available')
              AND (b.expiry_date IS NULL OR b.expiry_date >= %s)
            GROUP BY sm.batch_id, b.expiry_date
            HAVING (SUM(sm.qty_in) - SUM(sm.qty_out)) > 0
            ORDER BY b.expiry_date NULLS LAST, sm.batch_id
            """,
            (company_id, item_id, warehouse_id, min_expiry_date),
        )
    else:
        cur.execute(
            """
            SELECT sm.batch_id,
                   b.expiry_date,
                   (SUM(sm.qty_in) - SUM(sm.qty_out)) AS on_hand
            FROM stock_moves sm
            LEFT JOIN batches b ON b.id = sm.batch_id
            WHERE sm.company_id = %s
              AND sm.item_id = %s
              AND sm.warehouse_id = %s
              AND (sm.batch_id IS NULL OR b.status = 'available')
            GROUP BY sm.batch_id, b.expiry_date
            HAVING (SUM(sm.qty_in) - SUM(sm.qty_out)) > 0
            ORDER BY b.expiry_date NULLS LAST, sm.batch_id
            """,
            (company_id, item_id, warehouse_id),
        )
    rows = cur.fetchall()

    remaining = qty_out
    out = []
    for r in rows:
        if remaining <= 0:
            break
        available = Decimal(str(r["on_hand"] or 0))
        if available <= 0:
            continue
        take = available if available <= remaining else remaining
        out.append((r["batch_id"], take))
        remaining -= take

    if remaining > 0:
        if not allow_negative_stock:
            raise ValueError("insufficient stock for allocation (negative stock disabled)")
        if allow_unbatched_remainder:
            # Backward compatibility: if we don't have enough known batch stock,
            # keep the remainder unbatched.
            out.append((None, remaining))
        else:
            raise ValueError("insufficient eligible batch stock for FEFO allocation")

    return out


def process_sale(cur, company_id: str, event_id: str, payload: dict, device_id: str):
    # Idempotency: skip if invoice already created for this event
    cur.execute(
        """
        SELECT id FROM sales_invoices
        WHERE company_id = %s AND source_event_id = %s
        """,
        (company_id, event_id),
    )
    if cur.fetchone():
        return "duplicate"

    invoice_no = payload.get("invoice_no")
    if not invoice_no:
        invoice_no = next_doc_no(cur, company_id, "SI")

    exchange_rate = Decimal(str(payload.get("exchange_rate", 0)))
    pricing_currency = payload.get("pricing_currency", "USD")
    settlement_currency = payload.get("settlement_currency", "USD")
    invoice_date = None
    raw_invoice_date = payload.get("invoice_date") or payload.get("created_at") or None
    if raw_invoice_date:
        try:
            invoice_date = date.fromisoformat(str(raw_invoice_date)[:10])
        except Exception:
            invoice_date = None
    if not invoice_date:
        invoice_date = date.today()
    due_date = invoice_date

    assert_period_open(cur, company_id, invoice_date)

    lines = payload.get("lines", [])
    if not lines:
        raise ValueError("sale event has no lines")

    base_usd = Decimal("0")
    base_lbp = Decimal("0")
    discount_total_usd = Decimal("0")
    discount_total_lbp = Decimal("0")
    total_cost_usd = Decimal("0")
    total_cost_lbp = Decimal("0")

    for l in lines:
        line_total_usd = Decimal(str(l.get("line_total_usd", 0)))
        line_total_lbp = Decimal(str(l.get("line_total_lbp", 0)))
        base_usd += line_total_usd
        base_lbp += line_total_lbp
        qty = Decimal(str(l.get("qty", 0)))

        # Optional commercial metadata (backward compatible).
        pre_unit_usd = Decimal(str(l.get("pre_discount_unit_price_usd", 0) or 0))
        pre_unit_lbp = Decimal(str(l.get("pre_discount_unit_price_lbp", 0) or 0))
        unit_usd = Decimal(str(l.get("unit_price_usd", 0) or 0))
        unit_lbp = Decimal(str(l.get("unit_price_lbp", 0) or 0))
        disc_pct = Decimal(str(l.get("discount_pct", 0) or 0))
        disc_usd = Decimal(str(l.get("discount_amount_usd", 0) or 0))
        disc_lbp = Decimal(str(l.get("discount_amount_lbp", 0) or 0))

        if disc_usd == 0 and disc_lbp == 0:
            if pre_unit_usd or pre_unit_lbp:
                disc_usd = max(Decimal("0"), (pre_unit_usd - unit_usd) * qty)
                disc_lbp = max(Decimal("0"), (pre_unit_lbp - unit_lbp) * qty)
            elif disc_pct:
                disc_usd = max(Decimal("0"), (unit_usd * qty) * disc_pct)
                disc_lbp = max(Decimal("0"), (unit_lbp * qty) * disc_pct)

        discount_total_usd += disc_usd
        discount_total_lbp += disc_lbp
        l["_resolved_discount_amount_usd"] = str(disc_usd)
        l["_resolved_discount_amount_lbp"] = str(disc_lbp)
        l["_resolved_discount_pct"] = str(disc_pct)
        l["_resolved_pre_discount_unit_price_usd"] = str(pre_unit_usd)
        l["_resolved_pre_discount_unit_price_lbp"] = str(pre_unit_lbp)
        unit_cost_usd = Decimal(str(l.get("unit_cost_usd", 0) or 0))
        unit_cost_lbp = Decimal(str(l.get("unit_cost_lbp", 0) or 0))

        # Prefer POS-provided cost if present; otherwise use current moving-average cost.
        warehouse_id = payload.get("warehouse_id")
        if warehouse_id and (unit_cost_usd == 0 and unit_cost_lbp == 0):
            unit_cost_usd, unit_cost_lbp = get_avg_cost(cur, company_id, l.get("item_id"), warehouse_id)
        l["_resolved_unit_cost_usd"] = str(unit_cost_usd)
        l["_resolved_unit_cost_lbp"] = str(unit_cost_lbp)
        total_cost_usd += qty * unit_cost_usd
        total_cost_lbp += qty * unit_cost_lbp

    tax = payload.get("tax") or None
    tax_usd = Decimal(str(tax.get("tax_usd", 0))) if tax else Decimal("0")
    tax_lbp = Decimal(str(tax.get("tax_lbp", 0))) if tax else Decimal("0")
    tax_usd, tax_lbp = normalize_dual_amounts(tax_usd, tax_lbp, exchange_rate)

    total_usd = base_usd + tax_usd
    total_lbp = base_lbp + tax_lbp

    # Payments (normalize to dual-ledger amounts so GL always balances per currency).
    raw_payments = payload.get("payments", []) or []
    payments = []
    for p in raw_payments:
        method = (p.get("method") or "cash").strip().lower()
        amount_usd = Decimal(str(p.get("amount_usd", 0)))
        amount_lbp = Decimal(str(p.get("amount_lbp", 0)))
        amount_usd, amount_lbp = normalize_dual_amounts(amount_usd, amount_lbp, exchange_rate)
        payments.append({"method": method, "amount_usd": amount_usd, "amount_lbp": amount_lbp})

    # Credit sale validation (compute outstanding before creating the invoice).
    customer_id = payload.get("customer_id")
    total_paid_usd = Decimal("0")
    total_paid_lbp = Decimal("0")
    for p in payments:
        method = (p.get("method") or "").lower()
        if method == "credit":
            continue
        total_paid_usd += Decimal(str(p.get("amount_usd", 0)))
        total_paid_lbp += Decimal(str(p.get("amount_lbp", 0)))
    credit_usd = total_usd - total_paid_usd
    credit_lbp = total_lbp - total_paid_lbp
    if credit_usd < 0 or credit_lbp < 0:
        raise ValueError("Payments exceed invoice total")

    credit_sale = credit_usd > 0 or credit_lbp > 0
    if credit_sale:
        if not customer_id:
            raise ValueError("Credit sale requires customer_id")
        cur.execute(
            """
            SELECT credit_limit_usd, credit_limit_lbp, credit_balance_usd, credit_balance_lbp, payment_terms_days
            FROM customers
            WHERE company_id = %s AND id = %s
            """,
            (company_id, customer_id),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError("Customer not found for credit sale")
        if row["credit_limit_usd"] and (row["credit_balance_usd"] + credit_usd) > row["credit_limit_usd"]:
            raise ValueError("Credit limit exceeded (USD)")
        if row["credit_limit_lbp"] and (row["credit_balance_lbp"] + credit_lbp) > row["credit_limit_lbp"]:
            raise ValueError("Credit limit exceeded (LBP)")

        terms = int(row.get("payment_terms_days") or 0)
        if terms > 0:
            due_date = invoice_date + timedelta(days=terms)

    shift_id = payload.get("shift_id")
    if not shift_id:
        cur.execute(
            """
            SELECT id FROM pos_shifts
            WHERE company_id = %s AND device_id = %s AND status = 'open'
            ORDER BY opened_at DESC
            LIMIT 1
            """,
            (company_id, device_id),
        )
        row = cur.fetchone()
        if row:
            shift_id = row["id"]

    cashier_id = payload.get("cashier_id") or None

    # Branch attribution (useful for reporting). For non-POS flows this may be NULL.
    branch_id = None
    cur.execute("SELECT branch_id FROM pos_devices WHERE id=%s", (device_id,))
    drow = cur.fetchone()
    if drow:
        branch_id = drow.get("branch_id")

    # Receipt printing metadata (optional; provided by POS/printer).
    receipt_no = (payload.get("receipt_no") or None)
    receipt_seq = payload.get("receipt_seq")
    try:
        receipt_seq = int(receipt_seq) if receipt_seq is not None and str(receipt_seq).strip() != "" else None
    except Exception:
        receipt_seq = None
    receipt_printer = (payload.get("receipt_printer") or None)
    receipt_printed_at = payload.get("receipt_printed_at") or None
    if receipt_printed_at:
        try:
            receipt_printed_at = datetime.fromisoformat(str(receipt_printed_at).replace("Z", "+00:00"))
        except Exception:
            receipt_printed_at = None
    receipt_meta = payload.get("receipt_meta") or None

    cur.execute(
        """
        INSERT INTO sales_invoices
          (id, company_id, invoice_no, customer_id, status, total_usd, total_lbp, subtotal_usd, subtotal_lbp,
           discount_total_usd, discount_total_lbp, warehouse_id,
           exchange_rate, pricing_currency, settlement_currency, source_event_id, device_id, shift_id,
           invoice_date, due_date, cashier_id,
           branch_id,
           receipt_no, receipt_seq, receipt_printer, receipt_printed_at, receipt_meta)
        VALUES
          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
           %s,
           %s, %s, %s, %s, %s::jsonb)
        RETURNING id
        """,
        (
            company_id,
            invoice_no,
            customer_id,
            "posted",
            total_usd,
            total_lbp,
            base_usd,
            base_lbp,
            discount_total_usd,
            discount_total_lbp,
            payload.get("warehouse_id"),
            exchange_rate,
            pricing_currency,
            settlement_currency,
            event_id,
            device_id,
            shift_id,
            invoice_date,
            due_date,
            cashier_id,
            branch_id,
            receipt_no,
            receipt_seq,
            receipt_printer,
            receipt_printed_at,
            json.dumps(receipt_meta) if isinstance(receipt_meta, (dict, list)) else (json.dumps({"value": receipt_meta}) if receipt_meta is not None else None),
        ),
    )
    invoice_id = cur.fetchone()["id"]

    for l in lines:
        # Generate stable ids so downstream artifacts (stock moves, etc.) can link to document lines.
        line_id = str(uuid.uuid4())
        l["_invoice_line_id"] = line_id
        cur.execute(
            """
            INSERT INTO sales_invoice_lines
              (id, invoice_id, item_id, qty, unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp,
               uom, qty_factor,
               pre_discount_unit_price_usd, pre_discount_unit_price_lbp,
               discount_pct, discount_amount_usd, discount_amount_lbp,
               applied_promotion_id, applied_promotion_item_id, applied_price_list_id)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s,
               %s, %s,
               %s, %s,
               %s, %s, %s,
               %s, %s, %s)
            """,
            (
                line_id,
                invoice_id,
                l.get("item_id"),
                Decimal(str(l.get("qty", 0))),
                Decimal(str(l.get("unit_price_usd", 0))),
                Decimal(str(l.get("unit_price_lbp", 0))),
                Decimal(str(l.get("line_total_usd", 0))),
                Decimal(str(l.get("line_total_lbp", 0))),
                l.get("uom"),
                Decimal(str(l.get("qty_factor", 1) or 1)),
                Decimal(str(l.get("_resolved_pre_discount_unit_price_usd", 0) or 0)),
                Decimal(str(l.get("_resolved_pre_discount_unit_price_lbp", 0) or 0)),
                Decimal(str(l.get("_resolved_discount_pct", 0) or 0)),
                Decimal(str(l.get("_resolved_discount_amount_usd", 0) or 0)),
                Decimal(str(l.get("_resolved_discount_amount_lbp", 0) or 0)),
                l.get("applied_promotion_id"),
                l.get("applied_promotion_item_id"),
                l.get("applied_price_list_id"),
            ),
        )

    # Loyalty points:
    # - If the POS payload includes `loyalty_points`, treat it as an explicit override (backward compatible).
    # - Otherwise compute from company_settings key='loyalty'.
    if customer_id:
        if "loyalty_points" in payload:
            pts = Decimal(str(payload.get("loyalty_points") or 0))
        else:
            p_usd, p_lbp = fetch_loyalty_policy(cur, company_id)
            pts = (total_usd * p_usd) + (total_lbp * p_lbp)
        apply_loyalty_points(cur, company_id, customer_id, "sales_invoice", str(invoice_id), pts)

    # Tax line (VAT)
    if tax:
        cur.execute(
            """
            INSERT INTO tax_lines
              (id, company_id, source_type, source_id, tax_code_id,
               base_usd, base_lbp, tax_usd, tax_lbp, tax_date)
            VALUES
              (gen_random_uuid(), %s, 'sales_invoice', %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                company_id,
                invoice_id,
                tax.get("tax_code_id"),
                Decimal(str(tax.get("base_usd", base_usd))),
                Decimal(str(tax.get("base_lbp", base_lbp))),
                tax_usd,
                tax_lbp,
                tax.get("tax_date"),
            ),
        )

    # Persist payments.
    for p in raw_payments:
        method = (p.get("method") or "cash").strip().lower()
        amount_usd = Decimal(str(p.get("amount_usd", 0)))
        amount_lbp = Decimal(str(p.get("amount_lbp", 0)))
        amount_usd, amount_lbp = normalize_dual_amounts(amount_usd, amount_lbp, exchange_rate)
        cur.execute(
            """
            INSERT INTO sales_payments (id, invoice_id, method, amount_usd, amount_lbp, reference, auth_code, provider, settlement_currency, captured_at)
            VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, now())
            """,
            (
                invoice_id,
                method,
                amount_usd,
                amount_lbp,
                (p.get("reference") or None),
                (p.get("auth_code") or None),
                (p.get("provider") or None),
                (p.get("settlement_currency") or settlement_currency or None),
            ),
        )

    # Stock moves (FEFO batch allocation). If items are configured to require batch/expiry,
    # do not allow unbatched remainder.
    warehouse_id = payload.get("warehouse_id")
    inv_policy = fetch_inventory_policy(cur, company_id)
    allow_negative_stock_default = bool(inv_policy.get("allow_negative_stock"))
    warehouse_min_days_default = 0
    warehouse_allow_negative = None
    if warehouse_id:
        cur.execute(
            """
            SELECT min_shelf_life_days_for_sale_default, allow_negative_stock
            FROM warehouses
            WHERE company_id=%s AND id=%s
            """,
            (company_id, warehouse_id),
        )
        wrow = cur.fetchone()
        if wrow:
            warehouse_min_days_default = int(wrow.get("min_shelf_life_days_for_sale_default") or 0)
            warehouse_allow_negative = wrow.get("allow_negative_stock")
    item_ids = sorted({str(l.get("item_id")) for l in (lines or []) if l.get("item_id")})
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
        item_id = l.get("item_id")
        if not item_id or not warehouse_id:
            continue
        pol = item_policy.get(str(item_id)) or {}
        min_days = max(int(pol.get("min_shelf_life_days_for_sale") or 0), warehouse_min_days_default)
        min_exp = (invoice_date + timedelta(days=min_days)) if min_days > 0 else None
        # If an item is expiry-tracked, never allocate from already-expired batches.
        if bool(pol.get("track_expiry")) and not min_exp:
            min_exp = invoice_date
        allow_unbatched = not (bool(pol.get("track_batches")) or bool(pol.get("track_expiry")) or min_days > 0)
        item_allow_negative = pol.get("allow_negative_stock")
        if warehouse_allow_negative is not None:
            allow_negative_stock = bool(warehouse_allow_negative)
        elif item_allow_negative is not None:
            allow_negative_stock = bool(item_allow_negative)
        else:
            allow_negative_stock = allow_negative_stock_default

        unit_cost_usd = Decimal(str(l.get("_resolved_unit_cost_usd", 0) or 0))
        unit_cost_lbp = Decimal(str(l.get("_resolved_unit_cost_lbp", 0) or 0))
        qty_out = Decimal(str(l.get("qty", 0)))
        req_batch_no = l.get("batch_no") or None
        req_expiry = l.get("expiry_date") or None
        if req_batch_no or req_expiry:
            batch_id = find_batch_id(cur, company_id, item_id, req_batch_no, req_expiry)
            if not batch_id:
                raise ValueError("specified batch/expiry not found for item (cannot allocate)")
            if min_exp:
                exp = fetch_batch_expiry(cur, company_id, batch_id)
                if exp and exp < min_exp:
                    raise ValueError("specified batch does not meet min shelf-life requirement")
            on_hand = fetch_batch_on_hand(cur, company_id, item_id, warehouse_id, batch_id)
            if on_hand < qty_out:
                raise ValueError("insufficient stock for specified batch allocation")
            allocations = [(batch_id, qty_out)]
        else:
            allocations = allocate_fefo_batches(
                cur,
                company_id,
                item_id,
                warehouse_id,
                qty_out,
                min_expiry_date=min_exp,
                allow_unbatched_remainder=allow_unbatched,
                allow_negative_stock=allow_negative_stock,
            )
        for batch_id, q in allocations:
            cur.execute(
                """
                INSERT INTO stock_moves
                  (id, company_id, item_id, warehouse_id, batch_id, qty_out, unit_cost_usd, unit_cost_lbp, move_date,
                   source_type, source_id,
                   created_by_device_id, created_by_cashier_id, reason, source_line_type, source_line_id)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, 'sales_invoice', %s,
                   %s, %s, %s, %s, %s)
                """,
                (
                    company_id,
                    l.get("item_id"),
                    warehouse_id,
                    batch_id,
                    q,
                    unit_cost_usd,
                    unit_cost_lbp,
                    invoice_date,
                    invoice_id,
                    device_id,
                    cashier_id,
                    "POS sale",
                    "sales_invoice_line",
                    l.get("_invoice_line_id"),
                ),
            )

    # GL posting
    account_defaults = fetch_account_defaults(cur, company_id)
    ar = account_defaults.get("AR")
    cash = account_defaults.get("CASH")
    sales = account_defaults.get("SALES")
    vat_payable = account_defaults.get("VAT_PAYABLE")
    inventory = account_defaults.get("INVENTORY")
    cogs = account_defaults.get("COGS")

    if not sales:
        raise ValueError("Missing account defaults for sales posting")

    journal_no = f"GL-{invoice_no}"
    cur.execute(
        """
        INSERT INTO gl_journals
          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_device_id, created_by_cashier_id)
        VALUES
          (gen_random_uuid(), %s, %s, 'sales_invoice', %s, %s, 'market', %s, %s, %s, %s)
        RETURNING id
        """,
        (company_id, journal_no, invoice_id, invoice_date, exchange_rate, f"POS sale {invoice_no}", device_id, cashier_id),
    )
    journal_id = cur.fetchone()["id"]

    payment_accounts = fetch_payment_method_accounts(cur, company_id)
    if payments:
        for p in payments:
            method = (p.get("method") or "").lower()
            if method == "credit":
                continue
            account_id = payment_accounts.get(method)
            if not account_id:
                raise ValueError(f"Missing payment method mapping for {method}")
            amount_usd = Decimal(str(p.get("amount_usd", 0)))
            amount_lbp = Decimal(str(p.get("amount_lbp", 0)))
            if amount_usd == 0 and amount_lbp == 0:
                continue
            cur.execute(
                """
                INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
                VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Sales receipt', %s)
                """,
                (journal_id, account_id, amount_usd, amount_lbp, warehouse_id),
            )

    if credit_sale:
        if not ar:
            raise ValueError("Missing account defaults for AR posting")
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Sales receivable', %s)
            """,
            (journal_id, ar, credit_usd, credit_lbp, warehouse_id),
        )

    # Credit sales
    cur.execute(
        """
        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Sales revenue', %s)
        """,
        (journal_id, sales, base_usd, base_lbp, warehouse_id),
    )

    # Credit VAT payable if present
    if tax and vat_payable:
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'VAT payable', %s)
            """,
            (journal_id, vat_payable, tax_usd, tax_lbp, warehouse_id),
        )

    # Customer credit + loyalty
    customer_id = payload.get("customer_id")
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

    # (Legacy) loyalty_points payload is handled above through apply_loyalty_points().

    # COGS / Inventory posting
    if total_cost_usd > 0 or total_cost_lbp > 0:
        if not (inventory and cogs):
            raise ValueError("Missing account defaults for inventory/COGS posting")
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'COGS', %s)
            """,
            (journal_id, cogs, total_cost_usd, total_cost_lbp, warehouse_id),
        )
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory reduction', %s)
            """,
            (journal_id, inventory, total_cost_usd, total_cost_lbp, warehouse_id),
        )

    emit_event(
        cur,
        company_id,
        "sales.created",
        "sales_invoice",
        invoice_id,
        {"invoice_id": str(invoice_id), "total_usd": str(total_usd), "total_lbp": str(total_lbp)},
    )

    return "processed"


def process_sale_return(cur, company_id: str, event_id: str, payload: dict, device_id: str):
    cur.execute(
        """
        SELECT id FROM sales_returns
        WHERE company_id = %s AND source_event_id = %s
        """,
        (company_id, event_id),
    )
    if cur.fetchone():
        return "duplicate"

    exchange_rate = Decimal(str(payload.get("exchange_rate", 0)))
    lines = payload.get("lines", [])
    if not lines:
        raise ValueError("sales return has no lines")

    return_no = payload.get("return_no")
    if not return_no:
        return_no = next_doc_no(cur, company_id, "SR")

    assert_period_open(cur, company_id, date.today())

    base_usd = Decimal("0")
    base_lbp = Decimal("0")
    total_cost_usd = Decimal("0")
    total_cost_lbp = Decimal("0")

    for l in lines:
        base_usd += Decimal(str(l.get("line_total_usd", 0)))
        base_lbp += Decimal(str(l.get("line_total_lbp", 0)))

    tax = payload.get("tax") or None
    tax_usd = Decimal(str(tax.get("tax_usd", 0))) if tax else Decimal("0")
    tax_lbp = Decimal(str(tax.get("tax_lbp", 0))) if tax else Decimal("0")
    tax_usd, tax_lbp = normalize_dual_amounts(tax_usd, tax_lbp, exchange_rate)

    total_usd = base_usd + tax_usd
    total_lbp = base_lbp + tax_lbp

    shift_id = payload.get("shift_id") or None
    refund_method = (payload.get("refund_method") or "").strip().lower() or None
    cashier_id = payload.get("cashier_id") or None

    branch_id = None
    cur.execute("SELECT branch_id FROM pos_devices WHERE id=%s", (device_id,))
    drow = cur.fetchone()
    if drow:
        branch_id = drow.get("branch_id")

    reason_id = payload.get("reason_id") or None
    try:
        if reason_id:
            uuid.UUID(str(reason_id))
    except Exception:
        reason_id = None
    reason_text = (payload.get("reason") or payload.get("return_reason") or None)
    if isinstance(reason_text, str):
        reason_text = reason_text.strip() or None
    return_condition = (payload.get("return_condition") or None)
    if isinstance(return_condition, str):
        return_condition = return_condition.strip() or None

    cur.execute(
        """
        INSERT INTO sales_returns
          (id, company_id, return_no, invoice_id, status, total_usd, total_lbp, exchange_rate,
           warehouse_id, device_id, shift_id, refund_method, source_event_id, cashier_id,
           branch_id, reason_id, reason, return_condition)
        VALUES
          (gen_random_uuid(), %s, %s, %s, 'posted', %s, %s, %s, %s, %s, %s, %s, %s, %s,
           %s, %s, %s, %s)
        RETURNING id
        """,
        (
            company_id,
            return_no,
            payload.get("invoice_id"),
            total_usd,
            total_lbp,
            exchange_rate,
            payload.get("warehouse_id"),
            device_id,
            shift_id,
            refund_method,
            event_id,
            cashier_id,
            branch_id,
            reason_id,
            reason_text,
            return_condition,
        ),
    )
    return_id = cur.fetchone()["id"]

    # Resolve costs for inventory reversal when missing.
    invoice_id = payload.get("invoice_id")
    cost_map = {}
    if invoice_id:
        cur.execute(
            """
            SELECT item_id, unit_cost_usd, unit_cost_lbp
            FROM stock_moves
            WHERE company_id = %s AND source_type = 'sales_invoice' AND source_id = %s
            """,
            (company_id, invoice_id),
        )
        for r in cur.fetchall():
            cost_map[str(r["item_id"])] = (
                Decimal(str(r["unit_cost_usd"] or 0)),
                Decimal(str(r["unit_cost_lbp"] or 0)),
            )

    total_cost_usd = Decimal("0")
    total_cost_lbp = Decimal("0")

    # Stock moves (qty_in)
    warehouse_id = payload.get("warehouse_id")
    for l in lines:
        if not l.get("item_id") or not warehouse_id:
            continue
        batch_id = None
        if l.get("batch_no") or l.get("expiry_date"):
            # Returns may come from older invoices where batches were not recorded; best-effort create to preserve tracking.
            batch_id = get_or_create_batch(cur, company_id, l.get("item_id"), l.get("batch_no"), l.get("expiry_date"))
        unit_cost_usd = Decimal(str(l.get("unit_cost_usd", 0) or 0))
        unit_cost_lbp = Decimal(str(l.get("unit_cost_lbp", 0) or 0))
        if unit_cost_usd == 0 and unit_cost_lbp == 0:
            mapped = cost_map.get(str(l.get("item_id")))
            if mapped:
                unit_cost_usd, unit_cost_lbp = mapped
            else:
                unit_cost_usd, unit_cost_lbp = get_avg_cost(cur, company_id, l.get("item_id"), warehouse_id)

        # Generate a stable return line id so stock moves can link to the specific line.
        return_line_id = str(uuid.uuid4())
        l["_return_line_id"] = return_line_id
        cur.execute(
            """
            INSERT INTO stock_moves
              (id, company_id, item_id, warehouse_id, batch_id, qty_in, unit_cost_usd, unit_cost_lbp, move_date,
               source_type, source_id,
               created_by_device_id, created_by_cashier_id, reason, source_line_type, source_line_id)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, 'sales_return', %s,
               %s, %s, %s, %s, %s)
            """,
            (
                company_id,
                l.get("item_id"),
                warehouse_id,
                batch_id,
                Decimal(str(l.get("qty", 0))),
                unit_cost_usd,
                unit_cost_lbp,
                date.today(),
                return_id,
                device_id,
                payload.get("cashier_id") or None,
                "POS return",
                "sales_return_line",
                return_line_id,
            ),
        )

        qty = Decimal(str(l.get("qty", 0)))
        total_cost_usd += qty * unit_cost_usd
        total_cost_lbp += qty * unit_cost_lbp

        # Persist return line items for operational UI.
        qty = Decimal(str(l.get("qty", 0)))
        unit_price_usd = Decimal("0")
        unit_price_lbp = Decimal("0")
        if qty:
            unit_price_usd = Decimal(str(l.get("line_total_usd", 0))) / qty
            unit_price_lbp = Decimal(str(l.get("line_total_lbp", 0))) / qty
        line_reason_id = l.get("reason_id") or None
        try:
            if line_reason_id:
                uuid.UUID(str(line_reason_id))
        except Exception:
            line_reason_id = None
        line_condition = (l.get("line_condition") or None) if l.get("line_condition") is not None else None
        if isinstance(line_condition, str):
            line_condition = line_condition.strip() or None
        cur.execute(
            """
            INSERT INTO sales_return_lines
              (id, company_id, sales_return_id, item_id, qty,
               unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp,
               unit_cost_usd, unit_cost_lbp,
               reason_id, line_condition)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                return_line_id,
                company_id,
                return_id,
                l.get("item_id"),
                qty,
                unit_price_usd,
                unit_price_lbp,
                Decimal(str(l.get("line_total_usd", 0))),
                Decimal(str(l.get("line_total_lbp", 0))),
                unit_cost_usd,
                unit_cost_lbp,
                line_reason_id,
                line_condition,
            ),
        )

    # Tax line for reporting (negative amounts reduce VAT)
    if tax:
        cur.execute(
            """
            INSERT INTO tax_lines
              (id, company_id, source_type, source_id, tax_code_id,
               base_usd, base_lbp, tax_usd, tax_lbp, tax_date)
            VALUES
              (gen_random_uuid(), %s, 'sales_return', %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                company_id,
                return_id,
                tax.get("tax_code_id"),
                -Decimal(str(tax.get("base_usd", base_usd))),
                -Decimal(str(tax.get("base_lbp", base_lbp))),
                -tax_usd,
                -tax_lbp,
                tax.get("tax_date"),
            ),
        )

    # GL posting
    account_defaults = fetch_account_defaults(cur, company_id)
    ar = account_defaults.get("AR")
    cash = account_defaults.get("CASH")
    sales_returns = account_defaults.get("SALES_RETURNS")
    vat_payable = account_defaults.get("VAT_PAYABLE")
    inventory = account_defaults.get("INVENTORY")
    cogs = account_defaults.get("COGS")

    if not (sales_returns and (ar or cash)):
        raise ValueError("Missing account defaults for sales return posting")

    journal_no = f"SR-{str(return_id)[:8]}"
    return_date = None
    raw_return_date = payload.get("return_date") or payload.get("created_at") or None
    if raw_return_date:
        try:
            return_date = date.fromisoformat(str(raw_return_date)[:10])
        except Exception:
            return_date = None
    if not return_date:
        return_date = date.today()

    cur.execute(
        """
        INSERT INTO gl_journals
          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_device_id, created_by_cashier_id)
        VALUES
          (gen_random_uuid(), %s, %s, 'sales_return', %s, %s, 'market', %s, %s, %s, %s)
        RETURNING id
        """,
        (company_id, journal_no, return_id, return_date, exchange_rate, f"POS return {str(return_id)[:8]}", device_id, payload.get("cashier_id")),
    )
    journal_id = cur.fetchone()["id"]

    # Refund account selection:
    # - If invoice is a credit sale (unpaid), default to AR (credit note).
    # - Otherwise use refund_method mapping (cash/card/transfer/etc).
    invoice_id = payload.get("invoice_id")
    invoice_customer_id = None
    is_credit_sale = False
    primary_method = None
    if invoice_id:
        cur.execute(
            """
            SELECT customer_id, total_usd, total_lbp
            FROM sales_invoices
            WHERE company_id = %s AND id = %s
            """,
            (company_id, invoice_id),
        )
        inv = cur.fetchone()
        if inv:
            invoice_customer_id = inv["customer_id"]
            cur.execute(
                """
                SELECT method,
                       COALESCE(SUM(amount_usd), 0) AS usd,
                       COALESCE(SUM(amount_lbp), 0) AS lbp
                FROM sales_payments
                WHERE invoice_id = %s
                GROUP BY method
                """,
                (invoice_id,),
            )
            rows = cur.fetchall()
            total_paid_usd = Decimal("0")
            total_paid_lbp = Decimal("0")
            best_method = None
            best_amount = Decimal("-1")
            for r in rows:
                m = (r["method"] or "").strip().lower()
                if m == "credit":
                    continue
                amt_usd = Decimal(str(r["usd"] or 0))
                amt_lbp = Decimal(str(r["lbp"] or 0))
                amt_usd, amt_lbp = normalize_dual_amounts(amt_usd, amt_lbp, exchange_rate)
                total_paid_usd += amt_usd
                total_paid_lbp += amt_lbp
                score = amt_usd + (amt_lbp / exchange_rate if exchange_rate else Decimal("0"))
                if score > best_amount:
                    best_amount = score
                    best_method = m
            primary_method = best_method
            inv_total_usd = Decimal(str(inv["total_usd"] or 0))
            inv_total_lbp = Decimal(str(inv["total_lbp"] or 0))
            is_credit_sale = total_paid_usd < inv_total_usd or total_paid_lbp < inv_total_lbp

    payment_accounts = fetch_payment_method_accounts(cur, company_id)

    receivable_account = None
    if refund_method:
        if refund_method == "credit":
            receivable_account = ar
        else:
            receivable_account = payment_accounts.get(refund_method)
            if not receivable_account:
                raise ValueError(f"Missing payment method mapping for {refund_method}")
        if is_credit_sale and refund_method != "credit":
            raise ValueError("Cannot refund cash/bank for an unpaid credit sale; use refund_method=credit")
    else:
        if is_credit_sale:
            receivable_account = ar
        elif primary_method:
            receivable_account = payment_accounts.get(primary_method)
            if not receivable_account:
                raise ValueError(f"Missing payment method mapping for {primary_method}")
        else:
            receivable_account = cash or ar

    if not receivable_account:
        raise ValueError("Missing refund account mapping (AR/CASH/BANK)")

    # Debit sales returns
    cur.execute(
        """
        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Sales return')
        """,
        (journal_id, sales_returns, base_usd, base_lbp),
    )

    # Credit receivable/cash
    cur.execute(
        """
        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Return refund')
        """,
        (journal_id, receivable_account, total_usd, total_lbp),
    )

    # VAT payable reduction (debit VAT payable)
    if tax and vat_payable:
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'VAT payable reduction')
            """,
            (journal_id, vat_payable, tax_usd, tax_lbp),
        )

    # Inventory / COGS reversal
    if (total_cost_usd > 0 or total_cost_lbp > 0) and inventory and cogs:
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Inventory return')
            """,
            (journal_id, inventory, total_cost_usd, total_cost_lbp),
        )
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'COGS reversal')
            """,
            (journal_id, cogs, total_cost_usd, total_cost_lbp),
        )

    # Reduce customer receivable balance when this return reduces AR.
    if invoice_customer_id and receivable_account == ar:
        cur.execute(
            """
            UPDATE customers
            SET credit_balance_usd = GREATEST(credit_balance_usd - %s, 0),
                credit_balance_lbp = GREATEST(credit_balance_lbp - %s, 0)
            WHERE company_id = %s AND id = %s
            """,
            (total_usd, total_lbp, company_id, invoice_customer_id),
        )

    # Loyalty points reversal:
    # - If payload includes `loyalty_points`, treat it as an explicit override.
    # - Otherwise compute from current policy, and apply as negative points.
    return_customer_id = payload.get("customer_id") or invoice_customer_id
    if return_customer_id:
        if "loyalty_points" in payload:
            pts = -Decimal(str(payload.get("loyalty_points") or 0))
        else:
            p_usd, p_lbp = fetch_loyalty_policy(cur, company_id)
            pts = -((total_usd * p_usd) + (total_lbp * p_lbp))
        apply_loyalty_points(cur, company_id, return_customer_id, "sales_return", str(return_id), pts)

    emit_event(
        cur,
        company_id,
        "sales.returned",
        "sales_return",
        return_id,
        {"return_id": str(return_id), "return_no": str(return_no), "total_usd": str(total_usd), "total_lbp": str(total_lbp)},
    )

    return "processed"


def process_goods_receipt(cur, company_id: str, event_id: str, payload: dict, device_id: str):
    cur.execute(
        """
        SELECT id FROM goods_receipts
        WHERE company_id = %s AND source_event_id = %s
        """,
        (company_id, event_id),
    )
    if cur.fetchone():
        return "duplicate"

    lines = payload.get("lines", [])
    if not lines:
        raise ValueError("goods receipt has no lines")

    receipt_no = payload.get("receipt_no")
    if not receipt_no:
        receipt_no = next_doc_no(cur, company_id, "GR")

    assert_period_open(cur, company_id, date.today())

    supplier_ref = payload.get("supplier_ref") or None
    if isinstance(supplier_ref, str):
        supplier_ref = supplier_ref.strip() or None

    total_usd = Decimal("0")
    total_lbp = Decimal("0")

    for l in lines:
        total_usd += Decimal(str(l.get("line_total_usd", 0)))
        total_lbp += Decimal(str(l.get("line_total_lbp", 0)))

    cur.execute(
        """
        INSERT INTO goods_receipts
          (id, company_id, receipt_no, supplier_id, supplier_ref, status,
           total_usd, total_lbp, exchange_rate, warehouse_id, source_event_id,
           received_at)
        VALUES
          (gen_random_uuid(), %s, %s, %s, %s, 'posted', %s, %s, %s, %s, %s, %s, now())
        RETURNING id
        """,
        (
            company_id,
            receipt_no,
            payload.get("supplier_id"),
            supplier_ref,
            total_usd,
            total_lbp,
            Decimal(str(payload.get("exchange_rate", 0))),
            payload.get("warehouse_id"),
            event_id,
        ),
    )
    gr_id = cur.fetchone()["id"]

    warehouse_id = payload.get("warehouse_id")
    for l in lines:
        if not l.get("item_id") or not warehouse_id:
            continue
        batch_id = get_or_create_batch(cur, company_id, l.get("item_id"), l.get("batch_no"), l.get("expiry_date"))
        touch_batch_received_metadata(
            cur,
            company_id,
            batch_id,
            "goods_receipt",
            str(gr_id),
            str(payload.get("supplier_id") or "") or None,
            received_at=datetime.utcnow(),
        )
        gr_line_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO goods_receipt_lines
              (id, company_id, goods_receipt_id, item_id, batch_id, qty,
               unit_cost_usd, unit_cost_lbp, line_total_usd, line_total_lbp)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                gr_line_id,
                company_id,
                gr_id,
                l.get("item_id"),
                batch_id,
                Decimal(str(l.get("qty", 0))),
                Decimal(str(l.get("unit_cost_usd", 0))),
                Decimal(str(l.get("unit_cost_lbp", 0))),
                Decimal(str(l.get("line_total_usd", 0))),
                Decimal(str(l.get("line_total_lbp", 0))),
            ),
        )
        cur.execute(
            """
            INSERT INTO stock_moves
              (id, company_id, item_id, warehouse_id, batch_id, qty_in, unit_cost_usd, unit_cost_lbp, move_date,
               source_type, source_id,
               created_by_device_id, created_by_cashier_id, reason, source_line_type, source_line_id)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, CURRENT_DATE, 'goods_receipt', %s,
               %s, %s, %s, %s, %s)
            """,
            (
                company_id,
                l.get("item_id"),
                warehouse_id,
                batch_id,
                Decimal(str(l.get("qty", 0))),
                Decimal(str(l.get("unit_cost_usd", 0))),
                Decimal(str(l.get("unit_cost_lbp", 0))),
                gr_id,
                device_id,
                payload.get("cashier_id") or None,
                "POS goods receipt",
                "goods_receipt_line",
                gr_line_id,
            ),
        )

    # GL posting: Dr Inventory, Cr GRNI
    account_defaults = fetch_account_defaults(cur, company_id)
    inventory = account_defaults.get("INVENTORY")
    grni = account_defaults.get("GRNI")
    if not (inventory and grni):
        raise ValueError("Missing account defaults for purchase receipt posting (INVENTORY/GRNI)")

    journal_no = f"GR-{str(gr_id)[:8]}"
    cur.execute(
        """
        INSERT INTO gl_journals
          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_device_id, created_by_cashier_id)
        VALUES
          (gen_random_uuid(), %s, %s, 'goods_receipt', %s, CURRENT_DATE, 'market', %s, %s, %s, %s)
        RETURNING id
        """,
        (
            company_id,
            journal_no,
            gr_id,
            Decimal(str(payload.get("exchange_rate", 0) or 0)),
            f"POS goods receipt {str(receipt_no)}",
            device_id,
            payload.get("cashier_id"),
        ),
    )
    journal_id = cur.fetchone()["id"]
    cur.execute(
        """
        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Inventory received', %s)
        """,
        (journal_id, inventory, total_usd, total_lbp, warehouse_id),
    )
    cur.execute(
        """
        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id)
        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'GRNI', %s)
        """,
        (journal_id, grni, total_usd, total_lbp, warehouse_id),
    )

    emit_event(
        cur,
        company_id,
        "purchase.received",
        "goods_receipt",
        gr_id,
        {"goods_receipt_id": str(gr_id), "receipt_no": str(receipt_no), "total_usd": str(total_usd), "total_lbp": str(total_lbp)},
    )

    return "processed"


def process_purchase_invoice(cur, company_id: str, event_id: str, payload: dict, device_id: str):
    cur.execute(
        """
        SELECT id FROM supplier_invoices
        WHERE company_id = %s AND source_event_id = %s
        """,
        (company_id, event_id),
    )
    if cur.fetchone():
        return "duplicate"

    lines = payload.get("lines", [])
    if not lines:
        raise ValueError("purchase invoice has no lines")

    base_usd = Decimal("0")
    base_lbp = Decimal("0")
    for l in lines:
        base_usd += Decimal(str(l.get("line_total_usd", 0)))
        base_lbp += Decimal(str(l.get("line_total_lbp", 0)))

    tax = payload.get("tax") or None
    tax_usd = Decimal(str(tax.get("tax_usd", 0))) if tax else Decimal("0")
    tax_lbp = Decimal(str(tax.get("tax_lbp", 0))) if tax else Decimal("0")
    exchange_rate = Decimal(str(payload.get("exchange_rate", 0)))
    tax_usd, tax_lbp = normalize_dual_amounts(tax_usd, tax_lbp, exchange_rate)

    total_usd = base_usd + tax_usd
    total_lbp = base_lbp + tax_lbp

    invoice_no = payload.get("invoice_no")
    if not invoice_no:
        invoice_no = next_doc_no(cur, company_id, "PI")

    invoice_date = None
    raw_invoice_date = payload.get("invoice_date") or payload.get("created_at") or None
    if raw_invoice_date:
        try:
            invoice_date = date.fromisoformat(str(raw_invoice_date)[:10])
        except Exception:
            invoice_date = None
    if not invoice_date:
        invoice_date = date.today()

    assert_period_open(cur, company_id, invoice_date)

    due_date = invoice_date
    supplier_id = payload.get("supplier_id")
    if supplier_id:
        cur.execute(
            """
            SELECT payment_terms_days
            FROM suppliers
            WHERE company_id = %s AND id = %s
            """,
            (company_id, supplier_id),
        )
        srow = cur.fetchone()
        if srow:
            terms = int(srow.get("payment_terms_days") or 0)
            if terms > 0:
                due_date = invoice_date + timedelta(days=terms)

    cur.execute(
        """
        INSERT INTO supplier_invoices
          (id, company_id, invoice_no, supplier_ref, supplier_id, status, total_usd, total_lbp, exchange_rate, source_event_id,
           invoice_date, due_date)
        VALUES
          (gen_random_uuid(), %s, %s, %s, %s, 'posted', %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            company_id,
            invoice_no,
            (payload.get("supplier_ref") or None),
            supplier_id,
            total_usd,
            total_lbp,
            exchange_rate,
            event_id,
            invoice_date,
            due_date,
        ),
    )
    inv_id = cur.fetchone()["id"]

    for l in lines:
        batch_id = get_or_create_batch(cur, company_id, l.get("item_id"), l.get("batch_no"), l.get("expiry_date"))
        touch_batch_received_metadata(
            cur,
            company_id,
            batch_id,
            "supplier_invoice",
            str(inv_id),
            str(supplier_id or "") or None,
            received_at=datetime.utcnow(),
        )
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
                inv_id,
                l.get("item_id"),
                batch_id,
                Decimal(str(l.get("qty", 0))),
                Decimal(str(l.get("unit_cost_usd", 0))),
                Decimal(str(l.get("unit_cost_lbp", 0))),
                Decimal(str(l.get("line_total_usd", 0))),
                Decimal(str(l.get("line_total_lbp", 0))),
            ),
        )

    # Tax line (VAT recoverable)
    if tax:
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
                inv_id,
                tax.get("tax_code_id"),
                Decimal(str(tax.get("base_usd", base_usd))),
                Decimal(str(tax.get("base_lbp", base_lbp))),
                tax_usd,
                tax_lbp,
                tax.get("tax_date"),
            ),
        )

    # Supplier payments
    for p in payload.get("payments", []):
        cur.execute(
            """
            INSERT INTO supplier_payments (id, supplier_invoice_id, method, amount_usd, amount_lbp)
            VALUES (gen_random_uuid(), %s, %s, %s, %s)
            """,
            (
                inv_id,
                p.get("method", "bank"),
                Decimal(str(p.get("amount_usd", 0))),
                Decimal(str(p.get("amount_lbp", 0))),
            ),
        )

    # GL posting
    account_defaults = fetch_account_defaults(cur, company_id)
    ap = account_defaults.get("AP")
    grni = account_defaults.get("GRNI")
    vat_rec = account_defaults.get("VAT_RECOVERABLE")

    if not (ap and grni):
        raise ValueError("Missing account defaults for purchase posting (AP/GRNI)")

    journal_no = f"GL-{invoice_no}"
    cur.execute(
        """
        INSERT INTO gl_journals
          (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_device_id, created_by_cashier_id)
        VALUES
          (gen_random_uuid(), %s, %s, 'supplier_invoice', %s, CURRENT_DATE, 'market', %s, %s, %s, %s)
        RETURNING id
        """,
        (company_id, journal_no, inv_id, exchange_rate, f"POS supplier invoice {invoice_no}", device_id, payload.get("cashier_id")),
    )
    journal_id = cur.fetchone()["id"]

    # Debit GRNI (net) to clear receipts; inventory is recognized at goods receipt.
    cur.execute(
        """
        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
        VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'GRNI clearing')
        """,
        (journal_id, grni, base_usd, base_lbp),
    )

    # Debit VAT recoverable
    if tax and (tax_usd != 0 or tax_lbp != 0) and not vat_rec:
        raise ValueError("Missing account default for purchase VAT posting (VAT_RECOVERABLE)")
    if tax and (tax_usd != 0 or tax_lbp != 0):
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'VAT recoverable')
            """,
            (journal_id, vat_rec, tax_usd, tax_lbp),
        )

    # Credit AP (gross)
    cur.execute(
        """
        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Accounts payable')
        """,
        (journal_id, ap, total_usd, total_lbp),
    )

    emit_event(
        cur,
        company_id,
        "purchase.invoiced",
        "supplier_invoice",
        inv_id,
        {"supplier_invoice_id": str(inv_id), "total_usd": str(total_usd), "total_lbp": str(total_lbp)},
    )

    return "processed"


def process_cash_movement(cur, company_id: str, event_id: str, payload: dict, device_id: str):
    movement_type = (payload.get("movement_type") or "").strip().lower()
    if movement_type not in {"cash_in", "cash_out", "paid_out", "safe_drop", "other"}:
        raise ValueError("invalid movement_type")

    amount_usd = Decimal(str(payload.get("amount_usd", 0) or 0))
    amount_lbp = Decimal(str(payload.get("amount_lbp", 0) or 0))
    if amount_usd < 0 or amount_lbp < 0:
        raise ValueError("amounts must be >= 0")
    if amount_usd == 0 and amount_lbp == 0:
        raise ValueError("amount is required")

    shift_id = payload.get("shift_id") or None
    if not shift_id:
        cur.execute(
            """
            SELECT id
            FROM pos_shifts
            WHERE company_id = %s AND device_id = %s AND status = 'open'
            ORDER BY opened_at DESC
            LIMIT 1
            """,
            (company_id, device_id),
        )
        row = cur.fetchone()
        if row:
            shift_id = row["id"]
    if not shift_id:
        raise ValueError("no open shift for cash movement")

    cashier_id = payload.get("cashier_id") or None
    notes = payload.get("notes") or None

    # Idempotency: use event UUID as movement id.
    cur.execute(
        """
        INSERT INTO pos_cash_movements
          (id, company_id, shift_id, device_id, movement_type, amount_usd, amount_lbp, notes, cashier_id)
        VALUES
          (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (event_id, company_id, shift_id, device_id, movement_type, amount_usd, amount_lbp, notes, cashier_id),
    )

    emit_event(
        cur,
        company_id,
        "pos.cash_movement",
        "pos_cash_movement",
        event_id,
        {
            "movement_type": movement_type,
            "amount_usd": str(amount_usd),
            "amount_lbp": str(amount_lbp),
            "shift_id": str(shift_id),
            "cashier_id": str(cashier_id) if cashier_id else None,
        },
    )

    return "processed"


def _fetch_next_event(cur, company_id: str, max_attempts: int):
    cur.execute(
        """
        SELECT o.id, o.device_id, o.event_type, o.payload_json, o.attempt_count
        FROM pos_events_outbox o
        JOIN pos_devices d ON d.id = o.device_id
        WHERE d.company_id = %s
          AND o.status IN ('pending', 'failed')
          AND o.attempt_count < %s
        ORDER BY o.created_at ASC
        LIMIT 1
        FOR UPDATE OF o SKIP LOCKED
        """,
        (company_id, max_attempts),
    )
    return cur.fetchone()


def _process_one(conn, company_id: str, max_attempts: int) -> bool:
    with conn.transaction():
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            e = _fetch_next_event(cur, company_id, max_attempts)
            if not e:
                return False

            try:
                payload = e["payload_json"]
                if isinstance(payload, str):
                    payload = json.loads(payload)

                event_type = e["event_type"]
                event_id = e["id"]

                if event_type == "sale.completed":
                    process_sale(cur, company_id, event_id, payload, e["device_id"])
                elif event_type == "sale.returned":
                    process_sale_return(cur, company_id, event_id, payload, e["device_id"])
                elif event_type == "pos.cash_movement":
                    process_cash_movement(cur, company_id, event_id, payload, e["device_id"])
                elif event_type == "purchase.received":
                    process_goods_receipt(cur, company_id, event_id, payload, e["device_id"])
                elif event_type == "purchase.invoice":
                    process_purchase_invoice(cur, company_id, event_id, payload, e["device_id"])
                else:
                    raise ValueError(f"Unsupported event type {event_type}")

                cur.execute(
                    """
                    UPDATE pos_events_outbox
                    SET status = 'processed',
                        processed_at = now(),
                        error_message = NULL
                    WHERE id = %s
                    """,
                    (e["id"],),
                )
            except Exception as ex:
                cur.execute(
                    """
                    UPDATE pos_events_outbox
                    SET status = CASE WHEN attempt_count + 1 >= %s THEN 'dead' ELSE 'failed' END,
                        attempt_count = attempt_count + 1,
                        error_message = %s
                    WHERE id = %s
                    """,
                    (max_attempts, str(ex), e["id"]),
                )
    return True


def process_events(db_url: str, company_id: str, limit: int, max_attempts: int = MAX_ATTEMPTS_DEFAULT) -> int:
    processed = 0
    with get_conn(db_url) as conn:
        while processed < limit:
            did_one = _process_one(conn, company_id, max_attempts)
            if not did_one:
                break
            processed += 1
    return processed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--max-attempts", type=int, default=MAX_ATTEMPTS_DEFAULT)
    parser.add_argument("--loop", action="store_true", help="Run continuously as a service")
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds to sleep between loops")
    args = parser.parse_args()
    if args.loop:
        while True:
            process_events(args.db, args.company_id, args.limit, max_attempts=args.max_attempts)
            import time
            time.sleep(args.sleep)
    else:
        process_events(args.db, args.company_id, args.limit, max_attempts=args.max_attempts)


if __name__ == "__main__":
    main()
