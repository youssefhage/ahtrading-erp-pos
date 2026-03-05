from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any, Dict
from psycopg import errors as pg_errors

from ..db import get_admin_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission


router = APIRouter(prefix="/maintenance", tags=["maintenance"])

PURGE_CONFIRM_PHRASE = "DELETE ALL SALES INVOICES POS SESSIONS SHIFTS"
SALES_SOURCE_TYPES = (
    "sales_invoice",
    "sales_invoice_cancel",
    "sales_return",
    "sales_payment",
    "sales_payment_void",
)


class PurgeSalesPosIn(BaseModel):
    confirm_text: str
    dry_run: bool = True
    include_gl: bool = True
    reset_doc_sequences: bool = True
    reset_customer_balances: bool = True


def _table_exists(cur, table_name: str) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL AS ok", (f"public.{table_name}",))
    row = cur.fetchone() or {}
    return bool(row.get("ok"))


def _column_exists(cur, table_name: str, column_name: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name=%s
          AND column_name=%s
        LIMIT 1
        """,
        (table_name, column_name),
    )
    return bool(cur.fetchone())


def _trigger_exists(cur, table_name: str, trigger_name: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = %s
          AND t.tgname = %s
          AND NOT t.tgisinternal
        LIMIT 1
        """,
        (table_name, trigger_name),
    )
    return bool(cur.fetchone())


def _safe_rowcount(cur) -> int:
    return int(cur.rowcount or 0) if (cur.rowcount or 0) > 0 else 0


def _is_owner_admin_user(cur, company_id: str, user_id: str) -> bool:
    try:
        cur.execute(
            """
            SELECT 1
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.company_id = %s
              AND ur.user_id = %s
              AND (
                COALESCE(r.template_code, '') = 'owner_admin'
                OR lower(trim(COALESCE(r.name, ''))) IN ('owner (admin)', 'owner', 'admin')
              )
            LIMIT 1
            """,
            (company_id, user_id),
        )
        return bool(cur.fetchone())
    except pg_errors.UndefinedColumn:
        cur.execute(
            """
            SELECT 1
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.company_id = %s
              AND ur.user_id = %s
              AND lower(trim(COALESCE(r.name, ''))) IN ('owner (admin)', 'owner', 'admin')
            LIMIT 1
            """,
            (company_id, user_id),
        )
        return bool(cur.fetchone())


def _require_owner_admin(cur, company_id: str, user_id: str) -> None:
    if not _is_owner_admin_user(cur, company_id, user_id):
        raise HTTPException(status_code=403, detail="purge requires Owner/Admin role")


def _count_sales_payments(cur, company_id: str) -> int:
    if not _table_exists(cur, "sales_payments") or not _table_exists(cur, "sales_invoices"):
        return 0
    cur.execute(
        """
        SELECT COUNT(*)::int AS n
        FROM sales_payments p
        JOIN sales_invoices i ON i.id = p.invoice_id
        WHERE i.company_id = %s
        """,
        (company_id,),
    )
    return int((cur.fetchone() or {}).get("n") or 0)


def _count_sales_invoice_lines(cur, company_id: str) -> int:
    if not _table_exists(cur, "sales_invoice_lines") or not _table_exists(cur, "sales_invoices"):
        return 0
    cur.execute(
        """
        SELECT COUNT(*)::int AS n
        FROM sales_invoice_lines l
        JOIN sales_invoices i ON i.id = l.invoice_id
        WHERE i.company_id = %s
        """,
        (company_id,),
    )
    return int((cur.fetchone() or {}).get("n") or 0)


_ALLOWED_POS_EVENT_TABLES = {"pos_events_outbox", "pos_events_inbox"}


def _count_pos_events(cur, company_id: str, table_name: str) -> int:
    if table_name not in _ALLOWED_POS_EVENT_TABLES:
        return 0
    if not _table_exists(cur, table_name) or not _table_exists(cur, "pos_devices"):
        return 0
    cur.execute(
        f"""
        SELECT COUNT(*)::int AS n
        FROM {table_name} e
        JOIN pos_devices d ON d.id = e.device_id
        WHERE d.company_id = %s
        """,
        (company_id,),
    )
    return int((cur.fetchone() or {}).get("n") or 0)


def _collect_counts(cur, company_id: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}

    if _table_exists(cur, "sales_invoices"):
        cur.execute("SELECT COUNT(*)::int AS n FROM sales_invoices WHERE company_id=%s", (company_id,))
        counts["sales_invoices"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["sales_invoices"] = 0

    if _table_exists(cur, "sales_returns"):
        cur.execute("SELECT COUNT(*)::int AS n FROM sales_returns WHERE company_id=%s", (company_id,))
        counts["sales_returns"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["sales_returns"] = 0

    if _table_exists(cur, "sales_return_lines"):
        cur.execute("SELECT COUNT(*)::int AS n FROM sales_return_lines WHERE company_id=%s", (company_id,))
        counts["sales_return_lines"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["sales_return_lines"] = 0

    if _table_exists(cur, "pos_shifts"):
        cur.execute("SELECT COUNT(*)::int AS n FROM pos_shifts WHERE company_id=%s", (company_id,))
        counts["pos_shifts"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["pos_shifts"] = 0

    if _table_exists(cur, "pos_cash_movements"):
        cur.execute("SELECT COUNT(*)::int AS n FROM pos_cash_movements WHERE company_id=%s", (company_id,))
        counts["pos_cash_movements"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["pos_cash_movements"] = 0

    if _table_exists(cur, "stock_moves"):
        cur.execute(
            """
            SELECT COUNT(*)::int AS n
            FROM stock_moves
            WHERE company_id=%s
              AND COALESCE(source_type, '') = ANY(%s::text[])
            """,
            (company_id, list(SALES_SOURCE_TYPES)),
        )
        counts["stock_moves_sales_sources"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["stock_moves_sales_sources"] = 0

    if _table_exists(cur, "tax_lines"):
        cur.execute(
            """
            SELECT COUNT(*)::int AS n
            FROM tax_lines
            WHERE company_id=%s
              AND COALESCE(source_type, '') = ANY(%s::text[])
            """,
            (company_id, list(SALES_SOURCE_TYPES)),
        )
        counts["tax_lines_sales_sources"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["tax_lines_sales_sources"] = 0

    if _table_exists(cur, "gl_journals"):
        cur.execute(
            """
            SELECT COUNT(*)::int AS n
            FROM gl_journals
            WHERE company_id=%s
              AND COALESCE(source_type, '') = ANY(%s::text[])
            """,
            (company_id, list(SALES_SOURCE_TYPES)),
        )
        counts["gl_journals_sales_sources"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["gl_journals_sales_sources"] = 0

    if _table_exists(cur, "ai_item_sales_daily"):
        cur.execute("SELECT COUNT(*)::int AS n FROM ai_item_sales_daily WHERE company_id=%s", (company_id,))
        counts["ai_item_sales_daily"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["ai_item_sales_daily"] = 0

    if _table_exists(cur, "ai_demand_forecasts"):
        cur.execute("SELECT COUNT(*)::int AS n FROM ai_demand_forecasts WHERE company_id=%s", (company_id,))
        counts["ai_demand_forecasts"] = int((cur.fetchone() or {}).get("n") or 0)
    else:
        counts["ai_demand_forecasts"] = 0

    counts["sales_payments"] = _count_sales_payments(cur, company_id)
    counts["sales_invoice_lines"] = _count_sales_invoice_lines(cur, company_id)
    counts["pos_events_outbox"] = _count_pos_events(cur, company_id, "pos_events_outbox")
    counts["pos_events_inbox"] = _count_pos_events(cur, company_id, "pos_events_inbox")
    return counts


@router.post("/purge-sales-pos", dependencies=[Depends(require_permission("config:write"))])
def purge_sales_pos(
    data: PurgeSalesPosIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    if (data.confirm_text or "").strip() != PURGE_CONFIRM_PHRASE:
        raise HTTPException(
            status_code=400,
            detail="confirm_text mismatch",
        )

    with get_admin_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                _require_owner_admin(cur, company_id, user["user_id"])
                before = _collect_counts(cur, company_id)
                if data.dry_run:
                    return {
                        "ok": True,
                        "dry_run": True,
                        "company_id": company_id,
                        "confirm_phrase": PURGE_CONFIRM_PHRASE,
                        "before": before,
                    }

                deleted: Dict[str, int] = {}

                if _table_exists(cur, "ai_item_sales_daily"):
                    cur.execute("DELETE FROM ai_item_sales_daily WHERE company_id=%s", (company_id,))
                    deleted["ai_item_sales_daily"] = _safe_rowcount(cur)
                else:
                    deleted["ai_item_sales_daily"] = 0

                if _table_exists(cur, "ai_demand_forecasts"):
                    cur.execute("DELETE FROM ai_demand_forecasts WHERE company_id=%s", (company_id,))
                    deleted["ai_demand_forecasts"] = _safe_rowcount(cur)
                else:
                    deleted["ai_demand_forecasts"] = 0

                if _table_exists(cur, "stock_moves"):
                    cur.execute(
                        """
                        DELETE FROM stock_moves
                        WHERE company_id=%s
                          AND COALESCE(source_type, '') = ANY(%s::text[])
                        """,
                        (company_id, list(SALES_SOURCE_TYPES)),
                    )
                    deleted["stock_moves_sales_sources"] = _safe_rowcount(cur)
                else:
                    deleted["stock_moves_sales_sources"] = 0

                if _table_exists(cur, "tax_lines"):
                    cur.execute(
                        """
                        DELETE FROM tax_lines
                        WHERE company_id=%s
                          AND COALESCE(source_type, '') = ANY(%s::text[])
                        """,
                        (company_id, list(SALES_SOURCE_TYPES)),
                    )
                    deleted["tax_lines_sales_sources"] = _safe_rowcount(cur)
                else:
                    deleted["tax_lines_sales_sources"] = 0

                if _table_exists(cur, "sales_return_lines"):
                    cur.execute("DELETE FROM sales_return_lines WHERE company_id=%s", (company_id,))
                    deleted["sales_return_lines"] = _safe_rowcount(cur)
                else:
                    deleted["sales_return_lines"] = 0

                if _table_exists(cur, "sales_returns"):
                    cur.execute("DELETE FROM sales_returns WHERE company_id=%s", (company_id,))
                    deleted["sales_returns"] = _safe_rowcount(cur)
                else:
                    deleted["sales_returns"] = 0

                if _table_exists(cur, "sales_payments") and _table_exists(cur, "sales_invoices"):
                    cur.execute(
                        """
                        DELETE FROM sales_payments p
                        USING sales_invoices i
                        WHERE p.invoice_id = i.id
                          AND i.company_id = %s
                        """,
                        (company_id,),
                    )
                    deleted["sales_payments"] = _safe_rowcount(cur)
                else:
                    deleted["sales_payments"] = 0

                if _table_exists(cur, "sales_invoice_lines") and _table_exists(cur, "sales_invoices"):
                    cur.execute(
                        """
                        DELETE FROM sales_invoice_lines l
                        USING sales_invoices i
                        WHERE l.invoice_id = i.id
                          AND i.company_id = %s
                        """,
                        (company_id,),
                    )
                    deleted["sales_invoice_lines"] = _safe_rowcount(cur)
                else:
                    deleted["sales_invoice_lines"] = 0

                if _table_exists(cur, "sales_invoices"):
                    cur.execute("DELETE FROM sales_invoices WHERE company_id=%s", (company_id,))
                    deleted["sales_invoices"] = _safe_rowcount(cur)
                else:
                    deleted["sales_invoices"] = 0

                if _table_exists(cur, "pos_cash_movements"):
                    cur.execute("DELETE FROM pos_cash_movements WHERE company_id=%s", (company_id,))
                    deleted["pos_cash_movements"] = _safe_rowcount(cur)
                else:
                    deleted["pos_cash_movements"] = 0

                if _table_exists(cur, "pos_shifts"):
                    cur.execute("DELETE FROM pos_shifts WHERE company_id=%s", (company_id,))
                    deleted["pos_shifts"] = _safe_rowcount(cur)
                else:
                    deleted["pos_shifts"] = 0

                if _table_exists(cur, "pos_events_outbox") and _table_exists(cur, "pos_devices"):
                    cur.execute(
                        """
                        DELETE FROM pos_events_outbox o
                        USING pos_devices d
                        WHERE o.device_id = d.id
                          AND d.company_id = %s
                        """,
                        (company_id,),
                    )
                    deleted["pos_events_outbox"] = _safe_rowcount(cur)
                else:
                    deleted["pos_events_outbox"] = 0

                if _table_exists(cur, "pos_events_inbox") and _table_exists(cur, "pos_devices"):
                    cur.execute(
                        """
                        DELETE FROM pos_events_inbox i
                        USING pos_devices d
                        WHERE i.device_id = d.id
                          AND d.company_id = %s
                        """,
                        (company_id,),
                    )
                    deleted["pos_events_inbox"] = _safe_rowcount(cur)
                else:
                    deleted["pos_events_inbox"] = 0

                if data.include_gl and _table_exists(cur, "gl_journals"):
                    gl_j_trigger = _trigger_exists(cur, "gl_journals", "trg_gl_journals_immutable")
                    gl_e_trigger = _trigger_exists(cur, "gl_entries", "trg_gl_entries_immutable") if _table_exists(cur, "gl_entries") else False
                    try:
                        if gl_j_trigger:
                            cur.execute("ALTER TABLE gl_journals DISABLE TRIGGER trg_gl_journals_immutable")
                        if gl_e_trigger:
                            cur.execute("ALTER TABLE gl_entries DISABLE TRIGGER trg_gl_entries_immutable")
                    except pg_errors.InsufficientPrivilege:
                        raise HTTPException(
                            status_code=403,
                            detail="insufficient privilege to disable GL immutability trigger (rerun with include_gl=false)",
                        )
                    try:
                        cur.execute(
                            """
                            DELETE FROM gl_journals
                            WHERE company_id=%s
                              AND COALESCE(source_type, '') = ANY(%s::text[])
                            """,
                            (company_id, list(SALES_SOURCE_TYPES)),
                        )
                        deleted["gl_journals_sales_sources"] = _safe_rowcount(cur)
                    finally:
                        if gl_j_trigger:
                            cur.execute("ALTER TABLE gl_journals ENABLE TRIGGER trg_gl_journals_immutable")
                        if gl_e_trigger:
                            cur.execute("ALTER TABLE gl_entries ENABLE TRIGGER trg_gl_entries_immutable")
                else:
                    deleted["gl_journals_sales_sources"] = 0

                if data.reset_customer_balances and _table_exists(cur, "customers"):
                    set_parts: list[str] = []
                    if _column_exists(cur, "customers", "credit_balance_usd"):
                        set_parts.append("credit_balance_usd = 0")
                    if _column_exists(cur, "customers", "credit_balance_lbp"):
                        set_parts.append("credit_balance_lbp = 0")
                    if _column_exists(cur, "customers", "loyalty_points"):
                        set_parts.append("loyalty_points = 0")
                    if set_parts:
                        cur.execute(
                            f"""
                            UPDATE customers
                            SET {", ".join(set_parts)}
                            WHERE company_id=%s
                            """,
                            (company_id,),
                        )
                        deleted["customers_balance_reset"] = _safe_rowcount(cur)
                    else:
                        deleted["customers_balance_reset"] = 0
                else:
                    deleted["customers_balance_reset"] = 0

                if data.reset_doc_sequences and _table_exists(cur, "document_sequences"):
                    cur.execute(
                        """
                        UPDATE document_sequences
                        SET next_no = 1,
                            updated_at = now()
                        WHERE company_id=%s
                          AND doc_type = ANY(%s::text[])
                        """,
                        (company_id, ["SI", "SR"]),
                    )
                    deleted["document_sequences_reset"] = _safe_rowcount(cur)
                else:
                    deleted["document_sequences_reset"] = 0

                after = _collect_counts(cur, company_id)
                return {
                    "ok": True,
                    "dry_run": False,
                    "company_id": company_id,
                    "confirm_phrase": PURGE_CONFIRM_PHRASE,
                    "before": before,
                    "deleted": deleted,
                    "after": after,
                }
