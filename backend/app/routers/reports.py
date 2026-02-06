from fastapi import APIRouter, Depends, Response
from datetime import date
from typing import Optional
import csv
import io
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/vat", dependencies=[Depends(require_permission("reports:read"))])
def vat_report(period: Optional[date] = None, format: Optional[str] = None, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            if period:
                cur.execute(
                    """
                    SELECT tax_code_id, tax_name, period, base_lbp, tax_lbp
                    FROM vat_report_monthly
                    WHERE company_id = %s AND period = date_trunc('month', %s)::date
                    ORDER BY tax_name
                    """,
                    (company_id, period),
                )
            else:
                cur.execute(
                    """
                    SELECT tax_code_id, tax_name, period, base_lbp, tax_lbp
                    FROM vat_report_monthly
                    WHERE company_id = %s
                    ORDER BY period DESC, tax_name
                    """,
                    (company_id,),
                )
            rows = cur.fetchall()
            if format == "csv":
                output = io.StringIO()
                writer = csv.writer(output)
                writer.writerow(["tax_code_id", "tax_name", "period", "base_lbp", "tax_lbp"])
                for r in rows:
                    writer.writerow([r["tax_code_id"], r["tax_name"], r["period"], r["base_lbp"], r["tax_lbp"]])
                return Response(content=output.getvalue(), media_type="text/csv")
            return {"vat": rows}


@router.get("/trial-balance", dependencies=[Depends(require_permission("reports:read"))])
def trial_balance(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.account_code, a.name_en, t.debit_usd, t.credit_usd, t.debit_lbp, t.credit_lbp
                FROM gl_trial_balance t
                JOIN company_coa_accounts a ON a.id = t.account_id
                WHERE t.company_id = %s
                ORDER BY a.account_code
                """,
                (company_id,),
            )
            return {"trial_balance": cur.fetchall()}


@router.get("/gl", dependencies=[Depends(require_permission("reports:read"))])
def general_ledger(start_date: Optional[date] = None, end_date: Optional[date] = None, format: Optional[str] = None, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT j.journal_date, j.journal_no, a.account_code, a.name_en,
                       e.debit_usd, e.credit_usd, e.debit_lbp, e.credit_lbp, e.memo
                FROM gl_entries e
                JOIN gl_journals j ON j.id = e.journal_id
                JOIN company_coa_accounts a ON a.id = e.account_id
                WHERE j.company_id = %s
            """
            params = [company_id]
            if start_date:
                sql += " AND j.journal_date >= %s"
                params.append(start_date)
            if end_date:
                sql += " AND j.journal_date <= %s"
                params.append(end_date)
            sql += " ORDER BY j.journal_date, j.journal_no, a.account_code"
            cur.execute(sql, params)
            rows = cur.fetchall()
            if format == "csv":
                output = io.StringIO()
                writer = csv.writer(output)
                writer.writerow(["date", "journal_no", "account_code", "account_name", "debit_usd", "credit_usd", "debit_lbp", "credit_lbp", "memo"])
                for r in rows:
                    writer.writerow([r["journal_date"], r["journal_no"], r["account_code"], r["name_en"], r["debit_usd"], r["credit_usd"], r["debit_lbp"], r["credit_lbp"], r["memo"]])
                return Response(content=output.getvalue(), media_type="text/csv")
            return {"gl": rows}


@router.get("/inventory-valuation", dependencies=[Depends(require_permission("reports:read"))])
def inventory_valuation(format: Optional[str] = None, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.id, i.sku, i.name,
                       COALESCE(SUM(sm.qty_in) - SUM(sm.qty_out), 0) AS qty_on_hand,
                       COALESCE(SUM(sm.qty_in * sm.unit_cost_usd) - SUM(sm.qty_out * sm.unit_cost_usd), 0) AS value_usd,
                       COALESCE(SUM(sm.qty_in * sm.unit_cost_lbp) - SUM(sm.qty_out * sm.unit_cost_lbp), 0) AS value_lbp
                FROM items i
                LEFT JOIN stock_moves sm
                  ON sm.item_id = i.id AND sm.company_id = i.company_id
                WHERE i.company_id = %s
                GROUP BY i.id, i.sku, i.name
                ORDER BY i.sku
                """,
                (company_id,),
            )
            rows = cur.fetchall()
            if format == "csv":
                output = io.StringIO()
                writer = csv.writer(output)
                writer.writerow(["item_id", "sku", "name", "qty_on_hand", "value_usd", "value_lbp"])
                for r in rows:
                    writer.writerow([r["id"], r["sku"], r["name"], r["qty_on_hand"], r["value_usd"], r["value_lbp"]])
                return Response(content=output.getvalue(), media_type="text/csv")
            return {"inventory": rows}


@router.get("/metrics", dependencies=[Depends(require_permission("reports:read"))])
def metrics(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  (SELECT COALESCE(SUM(total_usd), 0)
                   FROM sales_invoices
                   WHERE company_id = %s AND status = 'posted' AND created_at::date = current_date) AS sales_today_usd,
                  (SELECT COALESCE(SUM(total_lbp), 0)
                   FROM sales_invoices
                   WHERE company_id = %s AND status = 'posted' AND created_at::date = current_date) AS sales_today_lbp,
                  (SELECT COALESCE(SUM(total_usd), 0)
                   FROM supplier_invoices
                   WHERE company_id = %s AND status = 'posted' AND created_at::date = current_date) AS purchases_today_usd,
                  (SELECT COALESCE(SUM(total_lbp), 0)
                   FROM supplier_invoices
                   WHERE company_id = %s AND status = 'posted' AND created_at::date = current_date) AS purchases_today_lbp,
                  ((SELECT COALESCE(SUM(total_usd), 0)
                    FROM sales_invoices
                    WHERE company_id = %s AND status = 'posted')
                   -
                   (SELECT COALESCE(SUM(sp.amount_usd), 0)
                    FROM sales_payments sp
                    JOIN sales_invoices si ON si.id = sp.invoice_id
                    WHERE si.company_id = %s AND si.status = 'posted')) AS ar_usd,
                  ((SELECT COALESCE(SUM(total_lbp), 0)
                    FROM sales_invoices
                    WHERE company_id = %s AND status = 'posted')
                   -
                   (SELECT COALESCE(SUM(sp.amount_lbp), 0)
                    FROM sales_payments sp
                    JOIN sales_invoices si ON si.id = sp.invoice_id
                    WHERE si.company_id = %s AND si.status = 'posted')) AS ar_lbp,
                  ((SELECT COALESCE(SUM(total_usd), 0)
                    FROM supplier_invoices
                    WHERE company_id = %s AND status = 'posted')
                   -
                   (SELECT COALESCE(SUM(sp.amount_usd), 0)
                    FROM supplier_payments sp
                    JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
                    WHERE si.company_id = %s AND si.status = 'posted')) AS ap_usd,
                  ((SELECT COALESCE(SUM(total_lbp), 0)
                    FROM supplier_invoices
                    WHERE company_id = %s AND status = 'posted')
                   -
                   (SELECT COALESCE(SUM(sp.amount_lbp), 0)
                    FROM supplier_payments sp
                    JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
                    WHERE si.company_id = %s AND si.status = 'posted')) AS ap_lbp,
                  (SELECT COALESCE(SUM(sm.qty_in * sm.unit_cost_usd) - SUM(sm.qty_out * sm.unit_cost_usd), 0)
                   FROM stock_moves sm
                   WHERE sm.company_id = %s) AS stock_value_usd,
                  (SELECT COALESCE(SUM(sm.qty_in * sm.unit_cost_lbp) - SUM(sm.qty_out * sm.unit_cost_lbp), 0)
                   FROM stock_moves sm
                   WHERE sm.company_id = %s) AS stock_value_lbp,
                  (SELECT COUNT(*) FROM items WHERE company_id = %s) AS items_count,
                  (SELECT COUNT(*) FROM customers WHERE company_id = %s) AS customers_count,
                  (SELECT COUNT(*) FROM suppliers WHERE company_id = %s) AS suppliers_count,
                  (SELECT COUNT(*) FROM (
                     SELECT i.id, i.reorder_point,
                            COALESCE(SUM(sm.qty_in) - SUM(sm.qty_out), 0) AS qty_on_hand
                     FROM items i
                     LEFT JOIN stock_moves sm
                       ON sm.item_id = i.id AND sm.company_id = i.company_id
                     WHERE i.company_id = %s
                     GROUP BY i.id, i.reorder_point
                   ) t WHERE t.reorder_point > 0 AND t.qty_on_hand <= t.reorder_point) AS low_stock_count
                """,
                (
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                    company_id,
                ),
            )
            row = cur.fetchone()
            return {"metrics": row}
