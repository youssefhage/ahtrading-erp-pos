#!/usr/bin/env python3
import argparse
import json
from datetime import datetime
from decimal import Decimal
import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = 'postgresql://localhost/ahtrading'
MAX_ATTEMPTS_DEFAULT = 5


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SET app.current_company_id = %s", (company_id,))


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

    lines = payload.get("lines", [])
    if not lines:
        raise ValueError("sale event has no lines")

    base_usd = Decimal("0")
    base_lbp = Decimal("0")
    total_cost_usd = Decimal("0")
    total_cost_lbp = Decimal("0")

    for l in lines:
        base_usd += Decimal(str(l.get("line_total_usd", 0)))
        base_lbp += Decimal(str(l.get("line_total_lbp", 0)))
        qty = Decimal(str(l.get("qty", 0)))
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

    cur.execute(
        """
        INSERT INTO sales_invoices
          (id, company_id, invoice_no, customer_id, status, total_usd, total_lbp,
           exchange_rate, pricing_currency, settlement_currency, source_event_id, device_id, shift_id)
        VALUES
          (gen_random_uuid(), %s, %s, %s, 'posted', %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            company_id,
            invoice_no,
            payload.get("customer_id"),
            total_usd,
            total_lbp,
            exchange_rate,
            pricing_currency,
            settlement_currency,
            event_id,
            device_id,
            shift_id,
        ),
    )
    invoice_id = cur.fetchone()["id"]

    for l in lines:
        cur.execute(
            """
            INSERT INTO sales_invoice_lines
              (id, invoice_id, item_id, qty, unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                invoice_id,
                l.get("item_id"),
                Decimal(str(l.get("qty", 0))),
                Decimal(str(l.get("unit_price_usd", 0))),
                Decimal(str(l.get("unit_price_lbp", 0))),
                Decimal(str(l.get("line_total_usd", 0))),
                Decimal(str(l.get("line_total_lbp", 0))),
            ),
        )

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

    # Payments (normalize to dual-ledger amounts so GL always balances per currency).
    raw_payments = payload.get("payments", []) or []
    payments = []
    for p in raw_payments:
        method = (p.get("method") or "cash").strip().lower()
        amount_usd = Decimal(str(p.get("amount_usd", 0)))
        amount_lbp = Decimal(str(p.get("amount_lbp", 0)))
        amount_usd, amount_lbp = normalize_dual_amounts(amount_usd, amount_lbp, exchange_rate)
        payments.append({"method": method, "amount_usd": amount_usd, "amount_lbp": amount_lbp})
        cur.execute(
            """
            INSERT INTO sales_payments (id, invoice_id, method, amount_usd, amount_lbp)
            VALUES (gen_random_uuid(), %s, %s, %s, %s)
            """,
            (
                invoice_id,
                method,
                amount_usd,
                amount_lbp,
            ),
        )

    # Credit sale validation
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
            SELECT credit_limit_usd, credit_limit_lbp, credit_balance_usd, credit_balance_lbp
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

    # Stock moves
    warehouse_id = payload.get("warehouse_id")
    for l in lines:
        if not l.get("item_id") or not warehouse_id:
            continue
        unit_cost_usd = Decimal(str(l.get("_resolved_unit_cost_usd", 0) or 0))
        unit_cost_lbp = Decimal(str(l.get("_resolved_unit_cost_lbp", 0) or 0))
        cur.execute(
            """
            INSERT INTO stock_moves
              (id, company_id, item_id, warehouse_id, qty_out, unit_cost_usd, unit_cost_lbp,
               source_type, source_id)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'sales_invoice', %s)
            """,
            (
                company_id,
                l.get("item_id"),
                warehouse_id,
                Decimal(str(l.get("qty", 0))),
                unit_cost_usd,
                unit_cost_lbp,
                invoice_id,
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
        INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
        VALUES (gen_random_uuid(), %s, %s, 'sales_invoice', %s, CURRENT_DATE, 'market')
        RETURNING id
        """,
        (company_id, journal_no, invoice_id),
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
                INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Sales receipt')
                """,
                (journal_id, account_id, amount_usd, amount_lbp),
            )

    if credit_sale:
        if not ar:
            raise ValueError("Missing account defaults for AR posting")
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Sales receivable')
            """,
            (journal_id, ar, credit_usd, credit_lbp),
        )

    # Credit sales
    cur.execute(
        """
        INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
        VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Sales revenue')
        """,
        (journal_id, sales, base_usd, base_lbp),
    )

    # Credit VAT payable if present
    if tax and vat_payable:
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'VAT payable')
            """,
            (journal_id, vat_payable, tax_usd, tax_lbp),
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

    loyalty_points = payload.get("loyalty_points")
    if customer_id and loyalty_points:
        cur.execute(
            """
            UPDATE customers
            SET loyalty_points = loyalty_points + %s
            WHERE company_id = %s AND id = %s
            """,
            (Decimal(str(loyalty_points)), company_id, customer_id),
        )
        cur.execute(
            """
            INSERT INTO customer_loyalty_ledger
              (id, company_id, customer_id, source_type, source_id, points)
            VALUES
              (gen_random_uuid(), %s, %s, 'sales_invoice', %s, %s)
            """,
            (company_id, customer_id, invoice_id, Decimal(str(loyalty_points))),
        )

    # COGS / Inventory posting
    if total_cost_usd > 0 or total_cost_lbp > 0:
        if not (inventory and cogs):
            raise ValueError("Missing account defaults for inventory/COGS posting")
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'COGS')
            """,
            (journal_id, cogs, total_cost_usd, total_cost_lbp),
        )
        cur.execute(
            """
            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Inventory reduction')
            """,
            (journal_id, inventory, total_cost_usd, total_cost_lbp),
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

    cur.execute(
        """
        INSERT INTO sales_returns
          (id, company_id, return_no, invoice_id, status, total_usd, total_lbp, exchange_rate,
           warehouse_id, device_id, shift_id, refund_method, source_event_id)
        VALUES
          (gen_random_uuid(), %s, %s, %s, 'posted', %s, %s, %s, %s, %s, %s, %s, %s)
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
        unit_cost_usd = Decimal(str(l.get("unit_cost_usd", 0) or 0))
        unit_cost_lbp = Decimal(str(l.get("unit_cost_lbp", 0) or 0))
        if unit_cost_usd == 0 and unit_cost_lbp == 0:
            mapped = cost_map.get(str(l.get("item_id")))
            if mapped:
                unit_cost_usd, unit_cost_lbp = mapped
            else:
                unit_cost_usd, unit_cost_lbp = get_avg_cost(cur, company_id, l.get("item_id"), warehouse_id)
        cur.execute(
            """
            INSERT INTO stock_moves
              (id, company_id, item_id, warehouse_id, qty_in, unit_cost_usd, unit_cost_lbp,
               source_type, source_id)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'sales_return', %s)
            """,
            (
                company_id,
                l.get("item_id"),
                warehouse_id,
                Decimal(str(l.get("qty", 0))),
                unit_cost_usd,
                unit_cost_lbp,
                return_id,
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
        cur.execute(
            """
            INSERT INTO sales_return_lines
              (id, company_id, sales_return_id, item_id, qty,
               unit_price_usd, unit_price_lbp, line_total_usd, line_total_lbp,
               unit_cost_usd, unit_cost_lbp)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
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
    cur.execute(
        """
        INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
        VALUES (gen_random_uuid(), %s, %s, 'sales_return', %s, CURRENT_DATE, 'market')
        RETURNING id
        """,
        (company_id, journal_no, return_id),
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

    emit_event(
        cur,
        company_id,
        "sales.returned",
        "sales_return",
        return_id,
        {"return_id": str(return_id), "return_no": str(return_no), "total_usd": str(total_usd), "total_lbp": str(total_lbp)},
    )

    return "processed"


def process_goods_receipt(cur, company_id: str, event_id: str, payload: dict):
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

    total_usd = Decimal("0")
    total_lbp = Decimal("0")

    for l in lines:
        total_usd += Decimal(str(l.get("line_total_usd", 0)))
        total_lbp += Decimal(str(l.get("line_total_lbp", 0)))

    cur.execute(
        """
        INSERT INTO goods_receipts
          (id, company_id, receipt_no, supplier_id, status, total_usd, total_lbp, exchange_rate, warehouse_id, source_event_id)
        VALUES
          (gen_random_uuid(), %s, %s, %s, 'posted', %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            company_id,
            receipt_no,
            payload.get("supplier_id"),
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
                gr_id,
                l.get("item_id"),
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
              (id, company_id, item_id, warehouse_id, qty_in, unit_cost_usd, unit_cost_lbp,
               source_type, source_id)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'goods_receipt', %s)
            """,
            (
                company_id,
                l.get("item_id"),
                warehouse_id,
                Decimal(str(l.get("qty", 0))),
                Decimal(str(l.get("unit_cost_usd", 0))),
                Decimal(str(l.get("unit_cost_lbp", 0))),
                gr_id,
            ),
        )

    # GL posting: Dr Inventory, Cr GRNI
    account_defaults = fetch_account_defaults(cur, company_id)
    inventory = account_defaults.get("INVENTORY")
    grni = account_defaults.get("GRNI")
    if inventory and grni:
        journal_no = f"GR-{str(gr_id)[:8]}"
        cur.execute(
            """
            INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
            VALUES (gen_random_uuid(), %s, %s, 'goods_receipt', %s, CURRENT_DATE, 'market')
            RETURNING id
            """,
            (company_id, journal_no, gr_id),
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

    emit_event(
        cur,
        company_id,
        "purchase.received",
        "goods_receipt",
        gr_id,
        {"goods_receipt_id": str(gr_id), "receipt_no": str(receipt_no), "total_usd": str(total_usd), "total_lbp": str(total_lbp)},
    )

    return "processed"


def process_purchase_invoice(cur, company_id: str, event_id: str, payload: dict):
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
    tax_usd, tax_lbp = normalize_dual_amounts(tax_usd, tax_lbp, Decimal(str(payload.get("exchange_rate", 0))))

    total_usd = base_usd + tax_usd
    total_lbp = base_lbp + tax_lbp

    invoice_no = payload.get("invoice_no")
    if not invoice_no:
        invoice_no = next_doc_no(cur, company_id, "PI")

    cur.execute(
        """
        INSERT INTO supplier_invoices
          (id, company_id, invoice_no, supplier_id, status, total_usd, total_lbp, exchange_rate, source_event_id)
        VALUES
          (gen_random_uuid(), %s, %s, %s, 'posted', %s, %s, %s, %s)
        RETURNING id
        """,
        (
            company_id,
            invoice_no,
            payload.get("supplier_id"),
            total_usd,
            total_lbp,
            Decimal(str(payload.get("exchange_rate", 0))),
            event_id,
        ),
    )
    inv_id = cur.fetchone()["id"]

    for l in lines:
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
                inv_id,
                l.get("item_id"),
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
        INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type)
        VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice', %s, CURRENT_DATE, 'market')
        RETURNING id
        """,
        (company_id, journal_no, inv_id),
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
    if tax and vat_rec:
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
                elif event_type == "purchase.received":
                    process_goods_receipt(cur, company_id, event_id, payload)
                elif event_type == "purchase.invoice":
                    process_purchase_invoice(cur, company_id, event_id, payload)
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
