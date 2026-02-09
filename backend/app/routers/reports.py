from fastapi import APIRouter, Depends, Response, HTTPException
from datetime import date
from typing import Optional
from decimal import Decimal
import csv
import io
from ..db import get_conn, get_admin_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user

router = APIRouter(prefix="/reports", tags=["reports"])

def _parse_company_ids(company_ids: Optional[str], fallback: str) -> list[str]:
    if company_ids:
        parts = [p.strip() for p in company_ids.split(",")]
        ids = [p for p in parts if p]
        if not ids:
            raise HTTPException(status_code=400, detail="company_ids is empty")
        if len(ids) > 25:
            raise HTTPException(status_code=400, detail="too many companies (max 25)")
        return ids
    return [fallback]

def _assert_reports_access(user_id: str, company_ids: list[str]):
    # Cross-company access check: user must have reports:read in each requested company.
    with get_admin_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ur.company_id
                FROM user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE ur.user_id = %s
                  AND ur.company_id = ANY(%s::uuid[])
                  AND p.code = 'reports:read'
                GROUP BY ur.company_id
                """,
                (user_id, company_ids),
            )
            allowed = {str(r["company_id"]) for r in cur.fetchall()}
    missing = [cid for cid in company_ids if cid not in allowed]
    if missing:
        raise HTTPException(status_code=403, detail=f"missing reports:read for {len(missing)} companies")

@router.get("/attention", dependencies=[Depends(require_permission("reports:read"))])
def attention(company_id: str = Depends(get_company_id)):
    """
    Proactive ops dashboard (v1): "what needs attention today".
    Returns a list of actionable counters with suggested links.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM supplier_invoices
                WHERE company_id=%s AND status='draft' AND is_on_hold=true
                """,
                (company_id,),
            )
            invoices_on_hold = int(cur.fetchone()["c"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM supplier_invoices
                WHERE company_id=%s AND status='draft' AND import_status='pending_review'
                """,
                (company_id,),
            )
            invoices_pending_review = int(cur.fetchone()["c"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM supplier_invoices
                WHERE company_id=%s AND status='draft' AND import_status IN ('pending','processing')
                """,
                (company_id,),
            )
            invoices_import_inflight = int(cur.fetchone()["c"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM purchase_orders
                WHERE company_id=%s AND status='draft' AND created_at < now() - interval '14 days'
                """,
                (company_id,),
            )
            po_stale_drafts = int(cur.fetchone()["c"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM goods_receipts
                WHERE company_id=%s AND status='draft' AND created_at < now() - interval '7 days'
                """,
                (company_id,),
            )
            gr_stale_drafts = int(cur.fetchone()["c"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM item_warehouse_costs
                WHERE company_id=%s AND on_hand_qty < 0
                """,
                (company_id,),
            )
            negative_stock = int(cur.fetchone()["c"])

            cur.execute(
                """
                WITH on_hand AS (
                  SELECT batch_id, SUM(qty_in - qty_out) AS on_hand_qty
                  FROM stock_moves
                  WHERE company_id=%s AND batch_id IS NOT NULL
                  GROUP BY batch_id
                )
                SELECT COUNT(*)::int AS c
                FROM on_hand h
                JOIN batches b ON b.company_id=%s AND b.id=h.batch_id
                WHERE h.on_hand_qty > 0
                  AND b.expiry_date IS NOT NULL
                  AND b.expiry_date <= CURRENT_DATE + interval '30 days'
                  AND b.status IN ('available','quarantine')
                """,
                (company_id, company_id),
            )
            expiring_batches = int(cur.fetchone()["c"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM pos_events_outbox
                WHERE status='failed'
                """,
            )
            outbox_failed = int(cur.fetchone()["c"])

            # POS shift variance signals (last 7 days).
            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM pos_shifts
                WHERE company_id=%s
                  AND status='closed'
                  AND closed_at >= now() - interval '7 days'
                  AND (
                    abs(COALESCE(variance_usd, 0)) >= 20
                    OR abs(COALESCE(variance_lbp, 0)) >= 2000000
                  )
                """,
                (company_id,),
            )
            shift_variances = int(cur.fetchone()["c"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM pos_shifts
                WHERE company_id=%s AND status='open'
                """,
                (company_id,),
            )
            open_shifts = int(cur.fetchone()["c"])

            # Only surface jobs whose *latest* run (within 24h) is failing, to avoid
            # "sticky red" after a transient failure.
            cur.execute(
                """
                WITH fail_counts AS (
                  SELECT job_code, COUNT(*)::int AS count
                  FROM background_job_runs
                  WHERE company_id=%s
                    AND status='failed'
                    AND started_at >= now() - interval '1 day'
                  GROUP BY job_code
                ),
                latest AS (
                  SELECT DISTINCT ON (job_code) job_code, status
                  FROM background_job_runs
                  WHERE company_id=%s
                    AND started_at >= now() - interval '1 day'
                  ORDER BY job_code, started_at DESC
                )
                SELECT f.job_code, f.count
                FROM fail_counts f
                JOIN latest l ON l.job_code = f.job_code
                WHERE l.status = 'failed'
                ORDER BY f.count DESC, f.job_code
                """,
                (company_id, company_id),
            )
            failed_jobs = cur.fetchall() or []

            cur.execute(
                """
                SELECT EXTRACT(epoch FROM (now() - last_seen_at))::int AS age_seconds, details
                FROM worker_heartbeats
                WHERE company_id=%s AND worker_name='outbox-worker'
                """,
                (company_id,),
            )
            hb = cur.fetchone() or {}
            worker_age_seconds = hb.get("age_seconds")

    items = []
    if invoices_on_hold:
        items.append(
            {
                "key": "supplier_invoices_on_hold",
                "severity": "critical",
                "label": "Supplier invoices on hold",
                "count": invoices_on_hold,
                "href": "/purchasing/supplier-invoices",
            }
        )
    if invoices_pending_review:
        items.append(
            {
                "key": "supplier_invoices_pending_review",
                "severity": "warning",
                "label": "Supplier invoices awaiting import review",
                "count": invoices_pending_review,
                "href": "/purchasing/supplier-invoices",
            }
        )
    if invoices_import_inflight:
        items.append(
            {
                "key": "supplier_invoices_import_inflight",
                "severity": "info",
                "label": "Supplier invoice imports in progress",
                "count": invoices_import_inflight,
                "href": "/purchasing/supplier-invoices",
            }
        )
    if po_stale_drafts:
        items.append(
            {
                "key": "purchase_orders_stale_drafts",
                "severity": "warning",
                "label": "Purchase order drafts older than 14 days",
                "count": po_stale_drafts,
                "href": "/purchasing/purchase-orders",
            }
        )
    if gr_stale_drafts:
        items.append(
            {
                "key": "goods_receipts_stale_drafts",
                "severity": "warning",
                "label": "Goods receipt drafts older than 7 days",
                "count": gr_stale_drafts,
                "href": "/purchasing/goods-receipts",
            }
        )
    if negative_stock:
        items.append(
            {
                "key": "negative_stock",
                "severity": "critical",
                "label": "Negative stock positions",
                "count": negative_stock,
                "href": "/inventory/stock",
            }
        )
    if expiring_batches:
        items.append(
            {
                "key": "expiring_batches",
                "severity": "warning",
                "label": "Batches expiring in 30 days (with stock on hand)",
                "count": expiring_batches,
                "href": "/inventory/alerts",
            }
        )
    if outbox_failed:
        items.append(
            {
                "key": "pos_outbox_failed",
                "severity": "critical",
                "label": "POS outbox failed events",
                "count": outbox_failed,
                "href": "/system/outbox",
            }
        )

    if shift_variances:
        items.append(
            {
                "key": "pos_shift_variances",
                "severity": "warning",
                "label": "POS shifts with high cash variance (7 days)",
                "count": shift_variances,
                "href": "/system/pos-shifts",
            }
        )
    if open_shifts:
        items.append(
            {
                "key": "pos_open_shifts",
                "severity": "info",
                "label": "Open POS shifts",
                "count": open_shifts,
                "href": "/system/pos-shifts",
            }
        )

    return {
        "items": items,
        "failed_jobs": failed_jobs,
        "worker_age_seconds": worker_age_seconds,
    }


@router.get("/consolidated/trial-balance", dependencies=[Depends(require_permission("reports:read"))])
def consolidated_trial_balance(
    company_ids: Optional[str] = None,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    ids = _parse_company_ids(company_ids, company_id)
    _assert_reports_access(user["user_id"], ids)
    acc: dict[str, dict] = {}
    with get_conn() as conn:
        with conn.cursor() as cur:
            for cid in ids:
                set_company_context(conn, cid)
                cur.execute(
                    """
                    SELECT a.account_code, a.name_en, t.debit_usd, t.credit_usd, t.debit_lbp, t.credit_lbp
                    FROM gl_trial_balance t
                    JOIN company_coa_accounts a ON a.id = t.account_id
                    WHERE t.company_id = %s
                    """,
                    (cid,),
                )
                for r in cur.fetchall():
                    code = r["account_code"]
                    if code not in acc:
                        acc[code] = {
                            "account_code": code,
                            "name_en": r.get("name_en"),
                            "debit_usd": Decimal("0"),
                            "credit_usd": Decimal("0"),
                            "debit_lbp": Decimal("0"),
                            "credit_lbp": Decimal("0"),
                        }
                    if not acc[code]["name_en"] and r.get("name_en"):
                        acc[code]["name_en"] = r.get("name_en")
                    acc[code]["debit_usd"] += Decimal(str(r.get("debit_usd") or 0))
                    acc[code]["credit_usd"] += Decimal(str(r.get("credit_usd") or 0))
                    acc[code]["debit_lbp"] += Decimal(str(r.get("debit_lbp") or 0))
                    acc[code]["credit_lbp"] += Decimal(str(r.get("credit_lbp") or 0))
    rows = [acc[k] for k in sorted(acc.keys())]
    return {"company_ids": ids, "trial_balance": rows}


@router.get("/consolidated/profit-loss", dependencies=[Depends(require_permission("reports:read"))])
def consolidated_profit_and_loss(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    company_ids: Optional[str] = None,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    today = date.today()
    start_date = start_date or today.replace(day=1)
    end_date = end_date or today
    ids = _parse_company_ids(company_ids, company_id)
    _assert_reports_access(user["user_id"], ids)
    acc: dict[str, dict] = {}
    with get_conn() as conn:
        with conn.cursor() as cur:
            for cid in ids:
                set_company_context(conn, cid)
                cur.execute(
                    """
                    SELECT a.account_code, a.name_en,
                           CASE WHEN a.account_code LIKE '7%%' THEN 'revenue' ELSE 'expense' END AS kind,
                           COALESCE(SUM(
                             CASE
                               WHEN a.account_code LIKE '7%%' THEN (e.credit_usd - e.debit_usd)
                               ELSE (e.debit_usd - e.credit_usd)
                             END
                           ), 0) AS amount_usd,
                           COALESCE(SUM(
                             CASE
                               WHEN a.account_code LIKE '7%%' THEN (e.credit_lbp - e.debit_lbp)
                               ELSE (e.debit_lbp - e.credit_lbp)
                             END
                           ), 0) AS amount_lbp
                    FROM gl_entries e
                    JOIN gl_journals j ON j.id = e.journal_id
                    JOIN company_coa_accounts a ON a.id = e.account_id
                    WHERE j.company_id = %s
                      AND j.journal_date BETWEEN %s AND %s
                      AND (a.account_code LIKE '6%%' OR a.account_code LIKE '7%%')
                    GROUP BY a.account_code, a.name_en, kind
                    HAVING COALESCE(SUM(e.debit_usd) + SUM(e.credit_usd) + SUM(e.debit_lbp) + SUM(e.credit_lbp), 0) != 0
                    """,
                    (cid, start_date, end_date),
                )
                for r in cur.fetchall():
                    key = f"{r['kind']}:{r['account_code']}"
                    if key not in acc:
                        acc[key] = {
                            "account_code": r["account_code"],
                            "name_en": r.get("name_en"),
                            "kind": r["kind"],
                            "amount_usd": Decimal("0"),
                            "amount_lbp": Decimal("0"),
                        }
                    if not acc[key]["name_en"] and r.get("name_en"):
                        acc[key]["name_en"] = r.get("name_en")
                    acc[key]["amount_usd"] += Decimal(str(r.get("amount_usd") or 0))
                    acc[key]["amount_lbp"] += Decimal(str(r.get("amount_lbp") or 0))

    rows = [acc[k] for k in sorted(acc.keys(), key=lambda x: (x.split(":")[1], x.split(":")[0]))]
    revenue_usd = sum([r["amount_usd"] for r in rows if r["kind"] == "revenue"], Decimal("0"))
    revenue_lbp = sum([r["amount_lbp"] for r in rows if r["kind"] == "revenue"], Decimal("0"))
    expense_usd = sum([r["amount_usd"] for r in rows if r["kind"] == "expense"], Decimal("0"))
    expense_lbp = sum([r["amount_lbp"] for r in rows if r["kind"] == "expense"], Decimal("0"))
    return {
        "company_ids": ids,
        "start_date": str(start_date),
        "end_date": str(end_date),
        "revenue_usd": revenue_usd,
        "revenue_lbp": revenue_lbp,
        "expense_usd": expense_usd,
        "expense_lbp": expense_lbp,
        "net_profit_usd": revenue_usd - expense_usd,
        "net_profit_lbp": revenue_lbp - expense_lbp,
        "rows": rows,
    }


@router.get("/consolidated/balance-sheet", dependencies=[Depends(require_permission("reports:read"))])
def consolidated_balance_sheet(
    as_of: Optional[date] = None,
    company_ids: Optional[str] = None,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    as_of = as_of or date.today()
    ids = _parse_company_ids(company_ids, company_id)
    _assert_reports_access(user["user_id"], ids)
    acc: dict[str, dict] = {}
    with get_conn() as conn:
        with conn.cursor() as cur:
            for cid in ids:
                set_company_context(conn, cid)
                cur.execute(
                    """
                    SELECT a.account_code, a.name_en, a.normal_balance,
                           COALESCE(SUM(
                             CASE WHEN a.normal_balance = 'credit' THEN (e.credit_usd - e.debit_usd)
                                  ELSE (e.debit_usd - e.credit_usd)
                             END
                           ), 0) AS balance_usd,
                           COALESCE(SUM(
                             CASE WHEN a.normal_balance = 'credit' THEN (e.credit_lbp - e.debit_lbp)
                                  ELSE (e.debit_lbp - e.credit_lbp)
                             END
                           ), 0) AS balance_lbp
                    FROM gl_entries e
                    JOIN gl_journals j ON j.id = e.journal_id
                    JOIN company_coa_accounts a ON a.id = e.account_id
                    WHERE j.company_id = %s
                      AND j.journal_date <= %s
                      AND (a.account_code LIKE '1%%' OR a.account_code LIKE '2%%' OR a.account_code LIKE '3%%' OR a.account_code LIKE '4%%' OR a.account_code LIKE '5%%')
                    GROUP BY a.account_code, a.name_en, a.normal_balance
                    HAVING COALESCE(SUM(e.debit_usd) + SUM(e.credit_usd) + SUM(e.debit_lbp) + SUM(e.credit_lbp), 0) != 0
                    """,
                    (cid, as_of),
                )
                for r in cur.fetchall():
                    code = r["account_code"]
                    if code not in acc:
                        acc[code] = {
                            "account_code": code,
                            "name_en": r.get("name_en"),
                            "normal_balance": r.get("normal_balance"),
                            "balance_usd": Decimal("0"),
                            "balance_lbp": Decimal("0"),
                        }
                    if not acc[code]["name_en"] and r.get("name_en"):
                        acc[code]["name_en"] = r.get("name_en")
                    if not acc[code]["normal_balance"] and r.get("normal_balance"):
                        acc[code]["normal_balance"] = r.get("normal_balance")
                    acc[code]["balance_usd"] += Decimal(str(r.get("balance_usd") or 0))
                    acc[code]["balance_lbp"] += Decimal(str(r.get("balance_lbp") or 0))
    rows = [acc[k] for k in sorted(acc.keys())]
    return {"company_ids": ids, "as_of": str(as_of), "rows": rows}


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


@router.get("/audit-logs", dependencies=[Depends(require_permission("reports:read"))])
def list_audit_logs(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    action_prefix: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    company_id: str = Depends(get_company_id),
):
    """
    Read-only audit logs feed for ops/debugging and future per-document timelines.
    """
    if limit <= 0 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 500")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT l.id, l.user_id, u.email AS user_email,
                       l.action, l.entity_type, l.entity_id,
                       l.details, l.created_at
                FROM audit_logs l
                LEFT JOIN users u ON u.id = l.user_id
                WHERE l.company_id = %s
            """
            params: list = [company_id]

            if entity_type:
                sql += " AND l.entity_type = %s"
                params.append(entity_type)
            if entity_id:
                sql += " AND l.entity_id = %s::uuid"
                params.append(entity_id)
            if user_id:
                sql += " AND l.user_id = %s::uuid"
                params.append(user_id)
            if action_prefix:
                sql += " AND l.action LIKE %s"
                params.append(action_prefix.strip() + "%")

            sql += " ORDER BY l.created_at DESC, l.id DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])
            cur.execute(sql, params)
            return {"audit_logs": cur.fetchall()}


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


@router.get("/ar-aging", dependencies=[Depends(require_permission("reports:read"))])
def ar_aging(as_of: Optional[date] = None, company_id: str = Depends(get_company_id)):
    as_of = as_of or date.today()
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  si.id AS invoice_id,
                  si.invoice_no,
                  si.customer_id,
                  c.name AS customer_name,
                  si.invoice_date,
                  si.due_date,
                  si.total_usd,
                  si.total_lbp,
                  COALESCE(SUM(sp.amount_usd), 0) AS paid_usd,
                  COALESCE(SUM(sp.amount_lbp), 0) AS paid_lbp,
                  (si.total_usd - COALESCE(SUM(sp.amount_usd), 0)) AS balance_usd,
                  (si.total_lbp - COALESCE(SUM(sp.amount_lbp), 0)) AS balance_lbp,
                  GREATEST((%s::date - si.due_date), 0) AS days_past_due,
                  CASE
                    WHEN %s::date <= si.due_date THEN 0
                    WHEN (%s::date - si.due_date) <= 30 THEN 1
                    WHEN (%s::date - si.due_date) <= 60 THEN 2
                    WHEN (%s::date - si.due_date) <= 90 THEN 3
                    ELSE 4
                  END AS bucket_order,
                  CASE
                    WHEN %s::date <= si.due_date THEN 'current'
                    WHEN (%s::date - si.due_date) <= 30 THEN '1-30'
                    WHEN (%s::date - si.due_date) <= 60 THEN '31-60'
                    WHEN (%s::date - si.due_date) <= 90 THEN '61-90'
                    ELSE '90+'
                  END AS bucket
                FROM sales_invoices si
                LEFT JOIN customers c ON c.id = si.customer_id
                LEFT JOIN sales_payments sp ON sp.invoice_id = si.id
                WHERE si.company_id = %s AND si.status = 'posted'
                GROUP BY si.id, si.invoice_no, si.customer_id, c.name, si.invoice_date, si.due_date, si.total_usd, si.total_lbp
                HAVING (si.total_usd - COALESCE(SUM(sp.amount_usd), 0)) != 0
                    OR (si.total_lbp - COALESCE(SUM(sp.amount_lbp), 0)) != 0
                ORDER BY bucket_order, si.due_date, si.invoice_no
                """,
                (as_of, as_of, as_of, as_of, as_of, as_of, as_of, as_of, as_of, company_id),
            )
            return {"as_of": str(as_of), "rows": cur.fetchall()}


@router.get("/ap-aging", dependencies=[Depends(require_permission("reports:read"))])
def ap_aging(as_of: Optional[date] = None, company_id: str = Depends(get_company_id)):
    as_of = as_of or date.today()
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  si.id AS invoice_id,
                  si.invoice_no,
                  si.supplier_id,
                  s.name AS supplier_name,
                  si.invoice_date,
                  si.due_date,
                  si.total_usd,
                  si.total_lbp,
                  COALESCE(SUM(sp.amount_usd), 0) AS paid_usd,
                  COALESCE(SUM(sp.amount_lbp), 0) AS paid_lbp,
                  (si.total_usd - COALESCE(SUM(sp.amount_usd), 0)) AS balance_usd,
                  (si.total_lbp - COALESCE(SUM(sp.amount_lbp), 0)) AS balance_lbp,
                  GREATEST((%s::date - si.due_date), 0) AS days_past_due,
                  CASE
                    WHEN %s::date <= si.due_date THEN 0
                    WHEN (%s::date - si.due_date) <= 30 THEN 1
                    WHEN (%s::date - si.due_date) <= 60 THEN 2
                    WHEN (%s::date - si.due_date) <= 90 THEN 3
                    ELSE 4
                  END AS bucket_order,
                  CASE
                    WHEN %s::date <= si.due_date THEN 'current'
                    WHEN (%s::date - si.due_date) <= 30 THEN '1-30'
                    WHEN (%s::date - si.due_date) <= 60 THEN '31-60'
                    WHEN (%s::date - si.due_date) <= 90 THEN '61-90'
                    ELSE '90+'
                  END AS bucket
                FROM supplier_invoices si
                LEFT JOIN suppliers s ON s.id = si.supplier_id
                LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
                WHERE si.company_id = %s AND si.status = 'posted'
                GROUP BY si.id, si.invoice_no, si.supplier_id, s.name, si.invoice_date, si.due_date, si.total_usd, si.total_lbp
                HAVING (si.total_usd - COALESCE(SUM(sp.amount_usd), 0)) != 0
                    OR (si.total_lbp - COALESCE(SUM(sp.amount_lbp), 0)) != 0
                ORDER BY bucket_order, si.due_date, si.invoice_no
                """,
                (as_of, as_of, as_of, as_of, as_of, as_of, as_of, as_of, as_of, company_id),
            )
            return {"as_of": str(as_of), "rows": cur.fetchall()}


@router.get("/profit-loss", dependencies=[Depends(require_permission("reports:read"))])
def profit_and_loss(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    company_id: str = Depends(get_company_id),
):
    today = date.today()
    start_date = start_date or today.replace(day=1)
    end_date = end_date or today
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.account_code, a.name_en,
                       CASE WHEN a.account_code LIKE '7%%' THEN 'revenue' ELSE 'expense' END AS kind,
                       COALESCE(SUM(
                         CASE
                           WHEN a.account_code LIKE '7%%' THEN (e.credit_usd - e.debit_usd)
                           ELSE (e.debit_usd - e.credit_usd)
                         END
                       ), 0) AS amount_usd,
                       COALESCE(SUM(
                         CASE
                           WHEN a.account_code LIKE '7%%' THEN (e.credit_lbp - e.debit_lbp)
                           ELSE (e.debit_lbp - e.credit_lbp)
                         END
                       ), 0) AS amount_lbp
                FROM gl_entries e
                JOIN gl_journals j ON j.id = e.journal_id
                JOIN company_coa_accounts a ON a.id = e.account_id
                WHERE j.company_id = %s
                  AND j.journal_date BETWEEN %s AND %s
                  AND (a.account_code LIKE '6%%' OR a.account_code LIKE '7%%')
                GROUP BY a.account_code, a.name_en, kind
                HAVING COALESCE(SUM(e.debit_usd) + SUM(e.credit_usd) + SUM(e.debit_lbp) + SUM(e.credit_lbp), 0) != 0
                ORDER BY a.account_code
                """,
                (company_id, start_date, end_date),
            )
            rows = cur.fetchall()
            revenue_usd = sum([r["amount_usd"] for r in rows if r["kind"] == "revenue"])
            revenue_lbp = sum([r["amount_lbp"] for r in rows if r["kind"] == "revenue"])
            expense_usd = sum([r["amount_usd"] for r in rows if r["kind"] == "expense"])
            expense_lbp = sum([r["amount_lbp"] for r in rows if r["kind"] == "expense"])
    return {
                "start_date": str(start_date),
                "end_date": str(end_date),
                "revenue_usd": revenue_usd,
                "revenue_lbp": revenue_lbp,
                "expense_usd": expense_usd,
                "expense_lbp": expense_lbp,
                "net_profit_usd": revenue_usd - expense_usd,
                "net_profit_lbp": revenue_lbp - expense_lbp,
                "rows": rows,
    }


@router.get("/sales/margin-by-item", dependencies=[Depends(require_permission("reports:read"))])
def sales_margin_by_item(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    warehouse_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    limit: int = 500,
    company_id: str = Depends(get_company_id),
):
    """
    Margin report (by item) using:
    - Revenue from sales_invoice_lines (posted invoices)
    - COGS from stock_moves emitted for those invoices (source_type='sales_invoice')
    """
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")
    today = date.today()
    start_date = start_date or today.replace(day=1)
    end_date = end_date or today
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH rev AS (
                  SELECT l.item_id,
                         COALESCE(SUM(l.qty), 0) AS qty_sold,
                         COALESCE(SUM(l.line_total_usd), 0) AS revenue_usd,
                         COALESCE(SUM(l.line_total_lbp), 0) AS revenue_lbp
                  FROM sales_invoice_lines l
                  JOIN sales_invoices i ON i.id = l.invoice_id
                  WHERE i.company_id = %s
                    AND i.status = 'posted'
                    AND i.invoice_date BETWEEN %s AND %s
                    AND (%s::uuid IS NULL OR i.warehouse_id = %s::uuid)
                    AND (%s::uuid IS NULL OR i.branch_id = %s::uuid)
                  GROUP BY l.item_id
                ),
                cogs AS (
                  SELECT sm.item_id,
                         COALESCE(SUM(sm.qty_out), 0) AS qty_out,
                         COALESCE(SUM(sm.qty_out * sm.unit_cost_usd), 0) AS cogs_usd,
                         COALESCE(SUM(sm.qty_out * sm.unit_cost_lbp), 0) AS cogs_lbp
                  FROM stock_moves sm
                  JOIN sales_invoices i
                    ON i.company_id = sm.company_id AND i.id = sm.source_id
                  WHERE sm.company_id = %s
                    AND sm.source_type = 'sales_invoice'
                    AND i.status = 'posted'
                    AND i.invoice_date BETWEEN %s AND %s
                    AND (%s::uuid IS NULL OR i.warehouse_id = %s::uuid)
                    AND (%s::uuid IS NULL OR i.branch_id = %s::uuid)
                  GROUP BY sm.item_id
                )
                SELECT it.id AS item_id,
                       it.sku,
                       it.name,
                       COALESCE(rev.qty_sold, 0) AS qty_sold,
                       COALESCE(rev.revenue_usd, 0) AS revenue_usd,
                       COALESCE(rev.revenue_lbp, 0) AS revenue_lbp,
                       COALESCE(cogs.cogs_usd, 0) AS cogs_usd,
                       COALESCE(cogs.cogs_lbp, 0) AS cogs_lbp,
                       (COALESCE(rev.revenue_usd, 0) - COALESCE(cogs.cogs_usd, 0)) AS margin_usd,
                       (COALESCE(rev.revenue_lbp, 0) - COALESCE(cogs.cogs_lbp, 0)) AS margin_lbp
                FROM items it
                LEFT JOIN rev ON rev.item_id = it.id
                LEFT JOIN cogs ON cogs.item_id = it.id
                WHERE it.company_id = %s
                  AND (rev.item_id IS NOT NULL OR cogs.item_id IS NOT NULL)
                ORDER BY COALESCE(rev.revenue_usd, 0) DESC, it.sku ASC
                LIMIT %s
                """,
                (
                    company_id,
                    start_date,
                    end_date,
                    warehouse_id,
                    warehouse_id,
                    branch_id,
                    branch_id,
                    company_id,
                    start_date,
                    end_date,
                    warehouse_id,
                    warehouse_id,
                    branch_id,
                    branch_id,
                    company_id,
                    limit,
                ),
            )
            rows = cur.fetchall()
            # Derive margin % client-side to avoid division-by-zero edge cases in SQL.
            for r in rows:
                rev_usd = Decimal(str(r.get("revenue_usd") or 0))
                rev_lbp = Decimal(str(r.get("revenue_lbp") or 0))
                mar_usd = Decimal(str(r.get("margin_usd") or 0))
                mar_lbp = Decimal(str(r.get("margin_lbp") or 0))
                r["margin_pct_usd"] = (mar_usd / rev_usd) if rev_usd else None
                r["margin_pct_lbp"] = (mar_lbp / rev_lbp) if rev_lbp else None
            return {
                "start_date": str(start_date),
                "end_date": str(end_date),
                "warehouse_id": warehouse_id,
                "branch_id": branch_id,
                "rows": rows,
            }


@router.get("/balance-sheet", dependencies=[Depends(require_permission("reports:read"))])
def balance_sheet(as_of: Optional[date] = None, company_id: str = Depends(get_company_id)):
    as_of = as_of or date.today()
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.account_code, a.name_en, a.normal_balance,
                       COALESCE(SUM(e.debit_usd), 0) AS debit_usd,
                       COALESCE(SUM(e.credit_usd), 0) AS credit_usd,
                       COALESCE(SUM(e.debit_lbp), 0) AS debit_lbp,
                       COALESCE(SUM(e.credit_lbp), 0) AS credit_lbp,
                       CASE
                         WHEN a.normal_balance = 'credit' THEN COALESCE(SUM(e.credit_usd) - SUM(e.debit_usd), 0)
                         ELSE COALESCE(SUM(e.debit_usd) - SUM(e.credit_usd), 0)
                       END AS balance_usd,
                       CASE
                         WHEN a.normal_balance = 'credit' THEN COALESCE(SUM(e.credit_lbp) - SUM(e.debit_lbp), 0)
                         ELSE COALESCE(SUM(e.debit_lbp) - SUM(e.credit_lbp), 0)
                       END AS balance_lbp
                FROM gl_entries e
                JOIN gl_journals j ON j.id = e.journal_id
                JOIN company_coa_accounts a ON a.id = e.account_id
                WHERE j.company_id = %s
                  AND j.journal_date <= %s
                  AND (a.account_code LIKE '1%%' OR a.account_code LIKE '2%%' OR a.account_code LIKE '3%%' OR a.account_code LIKE '4%%' OR a.account_code LIKE '5%%')
                GROUP BY a.account_code, a.name_en, a.normal_balance
                ORDER BY a.account_code
                """,
                (company_id, as_of),
            )
            return {"as_of": str(as_of), "rows": cur.fetchall()}
