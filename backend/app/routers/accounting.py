from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Literal, Optional
import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission
from ..account_defaults import ensure_company_account_defaults
from ..period_locks import assert_period_open
from ..validation import RateType


router = APIRouter(prefix="/accounting", tags=["accounting"])

USD_Q = Decimal("0.0001")
LBP_Q = Decimal("0.01")


def q_usd(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(USD_Q, rounding=ROUND_HALF_UP)


def q_lbp(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(LBP_Q, rounding=ROUND_HALF_UP)


def _sign(v: Decimal) -> int:
    if v > 0:
        return 1
    if v < 0:
        return -1
    return 0


def _fetch_exchange_rate(cur, company_id: str, rate_date: date, rate_type: RateType) -> Decimal:
    cur.execute(
        """
        SELECT usd_to_lbp
        FROM exchange_rates
        WHERE company_id = %s AND rate_date = %s AND rate_type = %s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (company_id, rate_date, rate_type),
    )
    row = cur.fetchone()
    if row and row["usd_to_lbp"]:
        return Decimal(str(row["usd_to_lbp"]))

    # Fallback: latest known rate for this rate_type.
    cur.execute(
        """
        SELECT usd_to_lbp
        FROM exchange_rates
        WHERE company_id = %s AND rate_type = %s
        ORDER BY rate_date DESC, created_at DESC
        LIMIT 1
        """,
        (company_id, rate_type),
    )
    row = cur.fetchone()
    if row and row["usd_to_lbp"]:
        return Decimal(str(row["usd_to_lbp"]))
    raise HTTPException(status_code=400, detail="missing exchange rate")


def _next_doc_no(cur, company_id: str, doc_type: str) -> str:
    cur.execute("SELECT next_document_no(%s, %s) AS doc_no", (company_id, doc_type))
    row = cur.fetchone()
    return row["doc_no"]


def _get_rounding_account(cur, company_id: str) -> Optional[str]:
    defaults = ensure_company_account_defaults(cur, company_id, roles=("ROUNDING", "INV_ADJ"))
    return defaults.get("ROUNDING")


class JournalLineIn(BaseModel):
    account_id: Optional[str] = None
    account_code: Optional[str] = None
    side: Literal["debit", "credit"]
    amount_usd: Optional[Decimal] = None
    amount_lbp: Optional[Decimal] = None
    memo: Optional[str] = None
    cost_center_id: Optional[str] = None
    project_id: Optional[str] = None


class ManualJournalIn(BaseModel):
    journal_date: date
    rate_type: RateType = "market"
    exchange_rate: Optional[Decimal] = None
    memo: Optional[str] = None
    lines: List[JournalLineIn]


class JournalTemplateLineIn(BaseModel):
    account_id: Optional[str] = None
    account_code: Optional[str] = None
    side: Literal["debit", "credit"]
    amount_usd: Optional[Decimal] = None
    amount_lbp: Optional[Decimal] = None
    memo: Optional[str] = None
    cost_center_id: Optional[str] = None
    project_id: Optional[str] = None


class JournalTemplateIn(BaseModel):
    name: str
    is_active: bool = True
    memo: Optional[str] = None
    default_rate_type: RateType = "market"
    lines: List[JournalTemplateLineIn]


class JournalTemplateUpdateIn(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    memo: Optional[str] = None
    default_rate_type: Optional[RateType] = None
    lines: Optional[List[JournalTemplateLineIn]] = None


class CreateFromTemplateIn(BaseModel):
    journal_date: date
    rate_type: Optional[RateType] = None
    exchange_rate: Optional[Decimal] = None
    memo: Optional[str] = None


class RecurringJournalRuleIn(BaseModel):
    journal_template_id: str
    cadence: Literal["daily", "weekly", "monthly"]
    day_of_week: Optional[int] = None  # ISO: 1=Mon..7=Sun (weekly only)
    day_of_month: Optional[int] = None  # 1..31 (monthly only)
    next_run_date: date
    is_active: bool = True


class RecurringJournalRuleUpdateIn(BaseModel):
    next_run_date: Optional[date] = None
    is_active: Optional[bool] = None


def _month_range(as_of: date) -> tuple[date, date]:
    start = as_of.replace(day=1)
    # next month start
    if start.month == 12:
        nxt = start.replace(year=start.year + 1, month=1)
    else:
        nxt = start.replace(month=start.month + 1)
    end = nxt - timedelta(days=1)
    return start, end

def _fetch_account_defaults(cur, company_id: str) -> dict:
    return ensure_company_account_defaults(
        cur,
        company_id,
        roles=("AR", "AP", "OPENING_BALANCE", "OPENING_STOCK", "INV_ADJ", "ROUNDING"),
    )


def _ensure_opening_item(cur, company_id: str) -> str:
    """
    Ensure a non-barcode placeholder item exists to represent opening balance documents.
    We intentionally do NOT create stock moves for opening-balance invoices; this item is
    just to satisfy existing invoice line schemas.
    """
    cur.execute(
        """
        SELECT id
        FROM items
        WHERE company_id = %s AND sku = 'OPENBAL'
        LIMIT 1
        """,
        (company_id,),
    )
    row = cur.fetchone()
    if row:
        return row["id"]
    cur.execute(
        """
        INSERT INTO items (id, company_id, sku, barcode, name, unit_of_measure, tax_code_id, reorder_point, reorder_qty)
        VALUES (gen_random_uuid(), %s, 'OPENBAL', NULL, 'Opening Balance', 'EA', NULL, 0, 0)
        RETURNING id
        """,
        (company_id,),
    )
    return cur.fetchone()["id"]


def _normalize_dual_amounts(usd: Decimal, lbp: Decimal, exchange_rate: Decimal) -> tuple[Decimal, Decimal]:
    if exchange_rate and exchange_rate != 0:
        if usd == 0 and lbp != 0:
            usd = lbp / exchange_rate
        elif lbp == 0 and usd != 0:
            lbp = usd * exchange_rate
    return usd, lbp


class OpeningArRowIn(BaseModel):
    customer_id: Optional[str] = None
    customer_code: Optional[str] = None
    invoice_no: Optional[str] = None
    invoice_date: date
    due_date: Optional[date] = None
    amount_usd: Optional[Decimal] = None
    amount_lbp: Optional[Decimal] = None


class OpeningArImportIn(BaseModel):
    rate_type: RateType = "market"
    exchange_rate: Optional[Decimal] = None
    rows: List[OpeningArRowIn]


class OpeningApRowIn(BaseModel):
    supplier_id: Optional[str] = None
    supplier_code: Optional[str] = None
    invoice_no: Optional[str] = None
    invoice_date: date
    due_date: Optional[date] = None
    amount_usd: Optional[Decimal] = None
    amount_lbp: Optional[Decimal] = None


class OpeningApImportIn(BaseModel):
    rate_type: RateType = "market"
    exchange_rate: Optional[Decimal] = None
    rows: List[OpeningApRowIn]


@router.get("/journals", dependencies=[Depends(require_permission("accounting:read"))])
def list_journals(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    source_type: Optional[str] = None,
    q: Optional[str] = None,
    company_id: str = Depends(get_company_id),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT j.id, j.journal_no, j.source_type, j.source_id, j.journal_date,
                       j.rate_type, j.exchange_rate, j.memo, j.created_at,
                       j.created_by_user_id, u.email AS created_by_email
                FROM gl_journals j
                LEFT JOIN users u ON u.id = j.created_by_user_id
                WHERE j.company_id = %s
            """
            params: list = [company_id]
            if start_date:
                sql += " AND j.journal_date >= %s"
                params.append(start_date)
            if end_date:
                sql += " AND j.journal_date <= %s"
                params.append(end_date)
            if source_type:
                sql += " AND j.source_type = %s"
                params.append(source_type)
            if q:
                sql += " AND (j.journal_no ILIKE %s OR COALESCE(j.memo,'') ILIKE %s)"
                params.append(f"%{q}%")
                params.append(f"%{q}%")
            sql += " ORDER BY j.journal_date DESC, j.journal_no DESC LIMIT 500"
            cur.execute(sql, params)
            return {"journals": cur.fetchall()}


@router.get("/journals/{journal_id}", dependencies=[Depends(require_permission("accounting:read"))])
def get_journal(journal_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT j.id, j.journal_no, j.source_type, j.source_id, j.journal_date,
                       j.rate_type, j.exchange_rate, j.memo, j.created_at,
                       j.created_by_user_id, u.email AS created_by_email
                FROM gl_journals j
                LEFT JOIN users u ON u.id = j.created_by_user_id
                WHERE j.company_id = %s AND j.id = %s
                """,
                (company_id, journal_id),
            )
            journal = cur.fetchone()
            if not journal:
                raise HTTPException(status_code=404, detail="journal not found")

            cur.execute(
                """
                SELECT e.id, e.account_id, a.account_code, a.name_en,
                       e.debit_usd, e.credit_usd, e.debit_lbp, e.credit_lbp, e.memo,
                       e.cost_center_id, cc.code AS cost_center_code, cc.name AS cost_center_name,
                       e.project_id, pr.code AS project_code, pr.name AS project_name
                FROM gl_entries e
                JOIN company_coa_accounts a ON a.id = e.account_id
                LEFT JOIN cost_centers cc ON cc.id = e.cost_center_id
                LEFT JOIN projects pr ON pr.id = e.project_id
                WHERE e.journal_id = %s
                ORDER BY a.account_code, e.id
                """,
                (journal_id,),
            )
            entries = cur.fetchall()
            return {"journal": journal, "entries": entries}


@router.post("/manual-journals", dependencies=[Depends(require_permission("accounting:write"))])
def create_manual_journal(
    data: ManualJournalIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    if not data.lines:
        raise HTTPException(status_code=400, detail="at least one line is required")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, data.journal_date)
                rate = data.exchange_rate
                if rate is None or rate == 0:
                    rate = _fetch_exchange_rate(cur, company_id, data.journal_date, data.rate_type)
                rate = Decimal(str(rate))
                if rate <= 0:
                    raise HTTPException(status_code=400, detail="exchange_rate must be > 0")

                resolved_lines = []
                total_debit_usd = Decimal("0")
                total_credit_usd = Decimal("0")
                total_debit_lbp = Decimal("0")
                total_credit_lbp = Decimal("0")

                for idx, line in enumerate(data.lines):
                    account_id = line.account_id
                    if not account_id and line.account_code:
                        cur.execute(
                            """
                            SELECT id
                            FROM company_coa_accounts
                            WHERE company_id = %s AND account_code = %s
                            """,
                            (company_id, line.account_code),
                        )
                        row = cur.fetchone()
                        if not row:
                            raise HTTPException(status_code=400, detail=f"line {idx+1}: account_code not found")
                        account_id = row["id"]

                    if not account_id:
                        raise HTTPException(status_code=400, detail=f"line {idx+1}: account_id or account_code is required")
                    cur.execute(
                        """
                        SELECT 1
                        FROM company_coa_accounts
                        WHERE company_id = %s AND id = %s
                        """,
                        (company_id, account_id),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail=f"line {idx+1}: account_id not found")

                    cost_center_id = (line.cost_center_id or "").strip() or None
                    if cost_center_id:
                        cur.execute(
                            "SELECT 1 FROM cost_centers WHERE company_id=%s AND id=%s",
                            (company_id, cost_center_id),
                        )
                        if not cur.fetchone():
                            raise HTTPException(status_code=400, detail=f"line {idx+1}: cost_center_id not found")

                    project_id = (line.project_id or "").strip() or None
                    if project_id:
                        cur.execute(
                            "SELECT 1 FROM projects WHERE company_id=%s AND id=%s",
                            (company_id, project_id),
                        )
                        if not cur.fetchone():
                            raise HTTPException(status_code=400, detail=f"line {idx+1}: project_id not found")

                    amount_usd = Decimal(str(line.amount_usd or 0))
                    amount_lbp = Decimal(str(line.amount_lbp or 0))
                    if amount_usd < 0 or amount_lbp < 0:
                        raise HTTPException(status_code=400, detail=f"line {idx+1}: amounts must be >= 0")
                    if amount_usd == 0 and amount_lbp == 0:
                        raise HTTPException(status_code=400, detail=f"line {idx+1}: amount_usd or amount_lbp is required")

                    # Derive missing currency using the journal exchange rate.
                    if amount_usd == 0 and amount_lbp != 0:
                        amount_usd = amount_lbp / rate
                    elif amount_lbp == 0 and amount_usd != 0:
                        amount_lbp = amount_usd * rate

                    amount_usd = q_usd(amount_usd)
                    amount_lbp = q_lbp(amount_lbp)

                    debit_usd = Decimal("0")
                    credit_usd = Decimal("0")
                    debit_lbp = Decimal("0")
                    credit_lbp = Decimal("0")

                    if line.side == "debit":
                        debit_usd = amount_usd
                        debit_lbp = amount_lbp
                        total_debit_usd += debit_usd
                        total_debit_lbp += debit_lbp
                    else:
                        credit_usd = amount_usd
                        credit_lbp = amount_lbp
                        total_credit_usd += credit_usd
                        total_credit_lbp += credit_lbp

                    resolved_lines.append(
                        {
                            "account_id": account_id,
                            "debit_usd": debit_usd,
                            "credit_usd": credit_usd,
                            "debit_lbp": debit_lbp,
                            "credit_lbp": credit_lbp,
                            "memo": (line.memo or "").strip() or None,
                            "cost_center_id": cost_center_id,
                            "project_id": project_id,
                        }
                    )

                diff_usd = q_usd(total_debit_usd - total_credit_usd)
                diff_lbp = q_lbp(total_debit_lbp - total_credit_lbp)

                if diff_usd != 0 or diff_lbp != 0:
                    sign_usd = _sign(diff_usd)
                    sign_lbp = _sign(diff_lbp)
                    if sign_usd and sign_lbp and sign_usd != sign_lbp:
                        raise HTTPException(status_code=400, detail="journal is imbalanced (USD/LBP signs differ)")

                    # Auto-balance small rounding differences using the ROUNDING account default.
                    if abs(diff_usd) > Decimal("0.05") or abs(diff_lbp) > Decimal("5000"):
                        raise HTTPException(status_code=400, detail="journal is imbalanced (too large to auto-balance)")

                    rounding_acc = _get_rounding_account(cur, company_id)
                    if not rounding_acc:
                        raise HTTPException(status_code=400, detail="journal is imbalanced; missing ROUNDING account default")

                    sign = sign_usd or sign_lbp
                    if sign > 0:
                        # Need extra credit to match debits.
                        resolved_lines.append(
                            {
                                "account_id": rounding_acc,
                                "debit_usd": Decimal("0"),
                                "credit_usd": abs(diff_usd),
                                "debit_lbp": Decimal("0"),
                                "credit_lbp": abs(diff_lbp),
                                "memo": "Rounding (auto-balance)",
                            }
                        )
                    else:
                        resolved_lines.append(
                            {
                                "account_id": rounding_acc,
                                "debit_usd": abs(diff_usd),
                                "credit_usd": Decimal("0"),
                                "debit_lbp": abs(diff_lbp),
                                "credit_lbp": Decimal("0"),
                                "memo": "Rounding (auto-balance)",
                            }
                        )

                journal_no = _next_doc_no(cur, company_id, "MJ")
                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type,
                       exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'manual_journal', NULL, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        journal_no,
                        data.journal_date,
                        data.rate_type,
                        rate,
                        (data.memo or "").strip() or None,
                        user["user_id"],
                    ),
                )
                journal_id = cur.fetchone()["id"]

                for l in resolved_lines:
                    cur.execute(
                        """
                        INSERT INTO gl_entries
                          (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, cost_center_id, project_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            journal_id,
                            l["account_id"],
                            l["debit_usd"],
                            l["credit_usd"],
                            l["debit_lbp"],
                            l["credit_lbp"],
                            l["memo"],
                            l.get("cost_center_id"),
                            l.get("project_id"),
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'accounting.manual_journal.create', 'gl_journal', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        journal_id,
                        json.dumps({"journal_no": journal_no, "line_count": len(resolved_lines)}),
                    ),
                )

                return {"id": journal_id, "journal_no": journal_no}


@router.get("/journal-templates", dependencies=[Depends(require_permission("accounting:read"))])
def list_journal_templates(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.id, t.name, t.is_active, t.memo, t.default_rate_type,
                       t.created_at, t.updated_at,
                       u.email AS created_by_email,
                       COALESCE(cnt.line_count, 0) AS line_count
                FROM journal_templates t
                LEFT JOIN users u ON u.id = t.created_by_user_id
                LEFT JOIN (
                  SELECT journal_template_id, COUNT(*)::int AS line_count
                  FROM journal_template_lines
                  WHERE company_id=%s
                  GROUP BY journal_template_id
                ) cnt ON cnt.journal_template_id = t.id
                WHERE t.company_id=%s
                ORDER BY t.created_at DESC
                """,
                (company_id, company_id),
            )
            return {"templates": cur.fetchall()}


@router.get("/journal-templates/{template_id}", dependencies=[Depends(require_permission("accounting:read"))])
def get_journal_template(template_id: str, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.*
                FROM journal_templates t
                WHERE t.company_id=%s AND t.id=%s
                """,
                (company_id, template_id),
            )
            tpl = cur.fetchone()
            if not tpl:
                raise HTTPException(status_code=404, detail="template not found")
            cur.execute(
                """
                SELECT l.id, l.line_no, l.account_id, a.account_code, a.name_en,
                       l.side, l.amount_usd, l.amount_lbp, l.memo,
                       l.cost_center_id, cc.code AS cost_center_code, cc.name AS cost_center_name,
                       l.project_id, pr.code AS project_code, pr.name AS project_name
                FROM journal_template_lines l
                JOIN company_coa_accounts a ON a.id = l.account_id
                LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id
                LEFT JOIN projects pr ON pr.id = l.project_id
                WHERE l.company_id=%s AND l.journal_template_id=%s
                ORDER BY l.line_no ASC
                """,
                (company_id, template_id),
            )
            return {"template": tpl, "lines": cur.fetchall()}


@router.post("/journal-templates", dependencies=[Depends(require_permission("accounting:write"))])
def create_journal_template(data: JournalTemplateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not data.lines:
        raise HTTPException(status_code=400, detail="at least one line is required")
    if len(data.lines) > 200:
        raise HTTPException(status_code=400, detail="too many lines (max 200)")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO journal_templates
                      (id, company_id, name, is_active, memo, default_rate_type, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, name, bool(data.is_active), (data.memo or "").strip() or None, data.default_rate_type, user["user_id"]),
                )
                tid = cur.fetchone()["id"]

                total_debit_usd = Decimal("0")
                total_credit_usd = Decimal("0")
                total_debit_lbp = Decimal("0")
                total_credit_lbp = Decimal("0")

                for idx, line in enumerate(data.lines, start=1):
                    account_id = (line.account_id or "").strip() or None
                    if not account_id and (line.account_code or "").strip():
                        cur.execute(
                            "SELECT id FROM company_coa_accounts WHERE company_id=%s AND account_code=%s",
                            (company_id, (line.account_code or "").strip()),
                        )
                        row = cur.fetchone()
                        if not row:
                            raise HTTPException(status_code=400, detail=f"line {idx}: account_code not found")
                        account_id = row["id"]
                    if not account_id:
                        raise HTTPException(status_code=400, detail=f"line {idx}: account_id or account_code is required")
                    cur.execute(
                        "SELECT 1 FROM company_coa_accounts WHERE company_id=%s AND id=%s",
                        (company_id, account_id),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail=f"line {idx}: account_id not found")

                    amount_usd = Decimal(str(line.amount_usd or 0))
                    amount_lbp = Decimal(str(line.amount_lbp or 0))
                    if amount_usd < 0 or amount_lbp < 0:
                        raise HTTPException(status_code=400, detail=f"line {idx}: amounts must be >= 0")
                    if amount_usd == 0 and amount_lbp == 0:
                        raise HTTPException(status_code=400, detail=f"line {idx}: amount_usd or amount_lbp is required")

                    if line.side == "debit":
                        total_debit_usd += q_usd(amount_usd)
                        total_debit_lbp += q_lbp(amount_lbp)
                    else:
                        total_credit_usd += q_usd(amount_usd)
                        total_credit_lbp += q_lbp(amount_lbp)

                    cost_center_id = (line.cost_center_id or "").strip() or None
                    if cost_center_id:
                        cur.execute("SELECT 1 FROM cost_centers WHERE company_id=%s AND id=%s", (company_id, cost_center_id))
                        if not cur.fetchone():
                            raise HTTPException(status_code=400, detail=f"line {idx}: cost_center_id not found")
                    project_id = (line.project_id or "").strip() or None
                    if project_id:
                        cur.execute("SELECT 1 FROM projects WHERE company_id=%s AND id=%s", (company_id, project_id))
                        if not cur.fetchone():
                            raise HTTPException(status_code=400, detail=f"line {idx}: project_id not found")

                    cur.execute(
                        """
                        INSERT INTO journal_template_lines
                          (id, company_id, journal_template_id, line_no, account_id, side, amount_usd, amount_lbp, memo, cost_center_id, project_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            company_id,
                            tid,
                            idx,
                            account_id,
                            line.side,
                            q_usd(amount_usd),
                            q_lbp(amount_lbp),
                            (line.memo or "").strip() or None,
                            cost_center_id,
                            project_id,
                        ),
                    )

                # Guardrail: templates should be balanced so they can run without surprises.
                if q_usd(total_debit_usd - total_credit_usd) != 0 or q_lbp(total_debit_lbp - total_credit_lbp) != 0:
                    raise HTTPException(status_code=400, detail="template is imbalanced (debits != credits)")

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'accounting.journal_template.create', 'journal_template', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], tid, json.dumps({"name": name, "line_count": len(data.lines)})),
                )
                return {"id": tid}


@router.patch("/journal-templates/{template_id}", dependencies=[Depends(require_permission("accounting:write"))])
def update_journal_template(template_id: str, data: JournalTemplateUpdateIn, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM journal_templates WHERE company_id=%s AND id=%s FOR UPDATE",
                    (company_id, template_id),
                )
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="template not found")

                sets = []
                params = []
                for k in ["name", "is_active", "memo", "default_rate_type"]:
                    if k in patch:
                        val = patch.get(k)
                        if k == "name":
                            val = (val or "").strip()
                            if not val:
                                raise HTTPException(status_code=400, detail="name cannot be empty")
                        if k == "memo":
                            val = (val or "").strip() or None
                        sets.append(f"{k}=%s")
                        params.append(val)
                if sets:
                    params.extend([company_id, template_id])
                    cur.execute(
                        f"""
                        UPDATE journal_templates
                        SET {', '.join(sets)}, updated_at=now()
                        WHERE company_id=%s AND id=%s
                        """,
                        params,
                    )

                if "lines" in patch:
                    lines = patch.get("lines") or []
                    if not lines:
                        raise HTTPException(status_code=400, detail="lines cannot be empty")
                    if len(lines) > 200:
                        raise HTTPException(status_code=400, detail="too many lines (max 200)")
                    cur.execute("DELETE FROM journal_template_lines WHERE company_id=%s AND journal_template_id=%s", (company_id, template_id))

                    total_debit_usd = Decimal("0")
                    total_credit_usd = Decimal("0")
                    total_debit_lbp = Decimal("0")
                    total_credit_lbp = Decimal("0")

                    for idx, line in enumerate(lines, start=1):
                        account_id = (line.get("account_id") or "").strip() or None
                        if not account_id and (line.get("account_code") or "").strip():
                            cur.execute(
                                "SELECT id FROM company_coa_accounts WHERE company_id=%s AND account_code=%s",
                                (company_id, (line.get("account_code") or "").strip()),
                            )
                            row = cur.fetchone()
                            if not row:
                                raise HTTPException(status_code=400, detail=f"line {idx}: account_code not found")
                            account_id = row["id"]
                        if not account_id:
                            raise HTTPException(status_code=400, detail=f"line {idx}: account_id or account_code is required")
                        cur.execute(
                            "SELECT 1 FROM company_coa_accounts WHERE company_id=%s AND id=%s",
                            (company_id, account_id),
                        )
                        if not cur.fetchone():
                            raise HTTPException(status_code=400, detail=f"line {idx}: account_id not found")
                        amount_usd = Decimal(str(line.get("amount_usd") or 0))
                        amount_lbp = Decimal(str(line.get("amount_lbp") or 0))
                        if amount_usd < 0 or amount_lbp < 0:
                            raise HTTPException(status_code=400, detail=f"line {idx}: amounts must be >= 0")
                        if amount_usd == 0 and amount_lbp == 0:
                            raise HTTPException(status_code=400, detail=f"line {idx}: amount_usd or amount_lbp is required")

                        side = (line.get("side") or "").strip()
                        if side not in {"debit", "credit"}:
                            raise HTTPException(status_code=400, detail=f"line {idx}: side must be debit or credit")

                        if side == "debit":
                            total_debit_usd += q_usd(amount_usd)
                            total_debit_lbp += q_lbp(amount_lbp)
                        else:
                            total_credit_usd += q_usd(amount_usd)
                            total_credit_lbp += q_lbp(amount_lbp)

                        cost_center_id = (line.get("cost_center_id") or "").strip() or None
                        if cost_center_id:
                            cur.execute("SELECT 1 FROM cost_centers WHERE company_id=%s AND id=%s", (company_id, cost_center_id))
                            if not cur.fetchone():
                                raise HTTPException(status_code=400, detail=f"line {idx}: cost_center_id not found")
                        project_id = (line.get("project_id") or "").strip() or None
                        if project_id:
                            cur.execute("SELECT 1 FROM projects WHERE company_id=%s AND id=%s", (company_id, project_id))
                            if not cur.fetchone():
                                raise HTTPException(status_code=400, detail=f"line {idx}: project_id not found")

                        cur.execute(
                            """
                            INSERT INTO journal_template_lines
                              (id, company_id, journal_template_id, line_no, account_id, side, amount_usd, amount_lbp, memo, cost_center_id, project_id)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                company_id,
                                template_id,
                                idx,
                                account_id,
                                side,
                                q_usd(amount_usd),
                                q_lbp(amount_lbp),
                                (line.get("memo") or "").strip() or None,
                                cost_center_id,
                                project_id,
                            ),
                        )

                    if q_usd(total_debit_usd - total_credit_usd) != 0 or q_lbp(total_debit_lbp - total_credit_lbp) != 0:
                        raise HTTPException(status_code=400, detail="template is imbalanced (debits != credits)")

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'accounting.journal_template.update', 'journal_template', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], template_id, json.dumps({"updated": sorted(patch.keys())})),
                )
                return {"ok": True}


@router.post("/journal-templates/{template_id}/create-journal", dependencies=[Depends(require_permission("accounting:write"))])
def create_journal_from_template(
    template_id: str,
    data: CreateFromTemplateIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                assert_period_open(cur, company_id, data.journal_date)
                cur.execute(
                    "SELECT id, name, is_active, memo, default_rate_type FROM journal_templates WHERE company_id=%s AND id=%s",
                    (company_id, template_id),
                )
                tpl = cur.fetchone()
                if not tpl:
                    raise HTTPException(status_code=404, detail="template not found")
                if not tpl.get("is_active"):
                    raise HTTPException(status_code=400, detail="template is inactive")

                cur.execute(
                    """
                    SELECT account_id, side, amount_usd, amount_lbp, memo, cost_center_id, project_id
                    FROM journal_template_lines
                    WHERE company_id=%s AND journal_template_id=%s
                    ORDER BY line_no ASC
                    """,
                    (company_id, template_id),
                )
                lines = cur.fetchall() or []
                if not lines:
                    raise HTTPException(status_code=400, detail="template has no lines")

                rate_type = data.rate_type or tpl.get("default_rate_type") or "market"
                rate = data.exchange_rate
                if rate is None or rate == 0:
                    rate = _fetch_exchange_rate(cur, company_id, data.journal_date, rate_type)
                rate = Decimal(str(rate))
                if rate <= 0:
                    raise HTTPException(status_code=400, detail="exchange_rate must be > 0")

                resolved_lines = []
                total_debit_usd = Decimal("0")
                total_credit_usd = Decimal("0")
                total_debit_lbp = Decimal("0")
                total_credit_lbp = Decimal("0")

                for idx, line in enumerate(lines, start=1):
                    amount_usd = Decimal(str(line.get("amount_usd") or 0))
                    amount_lbp = Decimal(str(line.get("amount_lbp") or 0))
                    if amount_usd < 0 or amount_lbp < 0:
                        raise HTTPException(status_code=400, detail=f"template line {idx}: amounts must be >= 0")
                    if amount_usd == 0 and amount_lbp == 0:
                        raise HTTPException(status_code=400, detail=f"template line {idx}: amount is zero")

                    if amount_usd == 0 and amount_lbp != 0:
                        amount_usd = amount_lbp / rate
                    elif amount_lbp == 0 and amount_usd != 0:
                        amount_lbp = amount_usd * rate

                    amount_usd = q_usd(amount_usd)
                    amount_lbp = q_lbp(amount_lbp)

                    debit_usd = Decimal("0")
                    credit_usd = Decimal("0")
                    debit_lbp = Decimal("0")
                    credit_lbp = Decimal("0")
                    if line["side"] == "debit":
                        debit_usd = amount_usd
                        debit_lbp = amount_lbp
                        total_debit_usd += debit_usd
                        total_debit_lbp += debit_lbp
                    else:
                        credit_usd = amount_usd
                        credit_lbp = amount_lbp
                        total_credit_usd += credit_usd
                        total_credit_lbp += credit_lbp

                    resolved_lines.append(
                        {
                            "account_id": line["account_id"],
                            "debit_usd": debit_usd,
                            "credit_usd": credit_usd,
                            "debit_lbp": debit_lbp,
                            "credit_lbp": credit_lbp,
                            "memo": (line.get("memo") or "").strip() or None,
                            "cost_center_id": line.get("cost_center_id"),
                            "project_id": line.get("project_id"),
                        }
                    )

                diff_usd = q_usd(total_debit_usd - total_credit_usd)
                diff_lbp = q_lbp(total_debit_lbp - total_credit_lbp)
                if diff_usd != 0 or diff_lbp != 0:
                    sign_usd = _sign(diff_usd)
                    sign_lbp = _sign(diff_lbp)
                    if sign_usd and sign_lbp and sign_usd != sign_lbp:
                        raise HTTPException(status_code=400, detail="journal is imbalanced (USD/LBP signs differ)")
                    if abs(diff_usd) > Decimal("0.05") or abs(diff_lbp) > Decimal("5000"):
                        raise HTTPException(status_code=400, detail="journal is imbalanced (too large to auto-balance)")
                    rounding_acc = _get_rounding_account(cur, company_id)
                    if not rounding_acc:
                        raise HTTPException(status_code=400, detail="journal is imbalanced; missing ROUNDING account default")
                    sign = sign_usd or sign_lbp
                    if sign > 0:
                        resolved_lines.append(
                            {"account_id": rounding_acc, "debit_usd": Decimal("0"), "credit_usd": abs(diff_usd), "debit_lbp": Decimal("0"), "credit_lbp": abs(diff_lbp), "memo": "Rounding (auto-balance)"}
                        )
                    else:
                        resolved_lines.append(
                            {"account_id": rounding_acc, "debit_usd": abs(diff_usd), "credit_usd": Decimal("0"), "debit_lbp": abs(diff_lbp), "credit_lbp": Decimal("0"), "memo": "Rounding (auto-balance)"}
                        )

                journal_no = _next_doc_no(cur, company_id, "MJ")
                memo = (data.memo or "").strip() or (tpl.get("memo") or "").strip() or f"Template: {tpl.get('name')}"
                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type,
                       exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'journal_template', %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (company_id, journal_no, template_id, data.journal_date, rate_type, rate, memo[:240] or None, user["user_id"]),
                )
                journal_id = cur.fetchone()["id"]

                for l in resolved_lines:
                    cur.execute(
                        """
                        INSERT INTO gl_entries
                          (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, cost_center_id, project_id)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            journal_id,
                            l["account_id"],
                            l["debit_usd"],
                            l["credit_usd"],
                            l["debit_lbp"],
                            l["credit_lbp"],
                            l.get("memo"),
                            l.get("cost_center_id"),
                            l.get("project_id"),
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'accounting.journal_template.run', 'gl_journal', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], journal_id, json.dumps({"journal_no": journal_no, "template_id": str(template_id), "template_name": tpl.get("name")})),
                )
                return {"id": journal_id, "journal_no": journal_no}


@router.get("/recurring-journals", dependencies=[Depends(require_permission("accounting:read"))])
def list_recurring_journal_rules(
    limit: int = Query(200, ge=1, le=1000),
    company_id: str = Depends(get_company_id),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id, r.journal_template_id, t.name AS template_name, t.is_active AS template_active,
                       r.cadence, r.day_of_week, r.day_of_month,
                       r.next_run_date, r.is_active, r.last_run_at,
                       r.created_at, r.updated_at
                FROM recurring_journal_rules r
                JOIN journal_templates t ON t.id = r.journal_template_id
                WHERE r.company_id=%s
                ORDER BY r.is_active DESC, r.next_run_date ASC, r.updated_at DESC
                LIMIT %s
                """,
                (company_id, limit),
            )
            return {"rules": cur.fetchall()}


@router.post("/recurring-journals", dependencies=[Depends(require_permission("accounting:write"))])
def create_recurring_journal_rule(
    data: RecurringJournalRuleIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    cadence = (data.cadence or "").strip()
    if cadence not in {"daily", "weekly", "monthly"}:
        raise HTTPException(status_code=400, detail="invalid cadence")
    dow = int(data.day_of_week) if data.day_of_week is not None else None
    dom = int(data.day_of_month) if data.day_of_month is not None else None
    if cadence == "weekly":
        if dow is None or dow < 1 or dow > 7:
            raise HTTPException(status_code=400, detail="day_of_week is required for weekly cadence (1..7)")
        dom = None
    elif cadence == "monthly":
        if dom is None or dom < 1 or dom > 31:
            raise HTTPException(status_code=400, detail="day_of_month is required for monthly cadence (1..31)")
        dow = None
    else:
        dow = None
        dom = None

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, is_active FROM journal_templates WHERE company_id=%s AND id=%s",
                    (company_id, data.journal_template_id),
                )
                tpl = cur.fetchone()
                if not tpl:
                    raise HTTPException(status_code=404, detail="template not found")

                cur.execute(
                    """
                    INSERT INTO recurring_journal_rules
                      (id, company_id, journal_template_id, cadence, day_of_week, day_of_month, next_run_date, is_active)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (company_id, journal_template_id, cadence, COALESCE(day_of_week, 0), COALESCE(day_of_month, 0))
                    DO UPDATE SET next_run_date = EXCLUDED.next_run_date,
                                  is_active = EXCLUDED.is_active,
                                  updated_at = now()
                    RETURNING id
                    """,
                    (
                        company_id,
                        data.journal_template_id,
                        cadence,
                        dow,
                        dom,
                        data.next_run_date,
                        bool(data.is_active),
                    ),
                )
                rid = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'accounting.recurring_journal_rule.upsert', 'recurring_journal_rule', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        rid,
                        json.dumps(
                            {
                                "journal_template_id": str(data.journal_template_id),
                                "cadence": cadence,
                                "day_of_week": dow,
                                "day_of_month": dom,
                                "next_run_date": str(data.next_run_date),
                                "is_active": bool(data.is_active),
                            }
                        ),
                    ),
                )
                return {"id": rid}


@router.patch("/recurring-journals/{rule_id}", dependencies=[Depends(require_permission("accounting:write"))])
def update_recurring_journal_rule(
    rule_id: str,
    data: RecurringJournalRuleUpdateIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    patch = data.model_dump(exclude_none=True)
    if not patch:
        return {"ok": True}
    sets = []
    params = []
    if "next_run_date" in patch:
        sets.append("next_run_date=%s")
        params.append(patch["next_run_date"])
    if "is_active" in patch:
        sets.append("is_active=%s")
        params.append(bool(patch["is_active"]))
    params.extend([company_id, rule_id])

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE recurring_journal_rules
                    SET {', '.join(sets)}, updated_at=now()
                    WHERE company_id=%s AND id=%s
                    RETURNING id
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="rule not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'accounting.recurring_journal_rule.update', 'recurring_journal_rule', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], rule_id, json.dumps({"updated": sorted(patch.keys())})),
                )
                return {"ok": True}


@router.get("/close-checklist", dependencies=[Depends(require_permission("accounting:read"))])
def close_checklist(
    as_of: Optional[date] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    company_id: str = Depends(get_company_id),
):
    """
    Period-close checklist (v1): surfaces common blockers/risk signals before locking a period.
    """
    as_of = as_of or date.today()
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")
    if not start_date or not end_date:
        ms, me = _month_range(as_of)
        start_date = start_date or ms
        end_date = end_date or me

    checks: list[dict] = []
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # Draft docs within period window.
            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM sales_invoices
                WHERE company_id=%s AND status='draft'
                  AND invoice_date BETWEEN %s AND %s
                """,
                (company_id, start_date, end_date),
            )
            sales_drafts = int(cur.fetchone()["c"])
            checks.append(
                {
                    "code": "sales_drafts",
                    "title": "Sales invoices still in draft",
                    "level": "warn" if sales_drafts else "ok",
                    "count": sales_drafts,
                    "href": "/sales/invoices",
                }
            )

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM supplier_invoices
                WHERE company_id=%s AND status='draft'
                  AND invoice_date BETWEEN %s AND %s
                """,
                (company_id, start_date, end_date),
            )
            purchase_drafts = int(cur.fetchone()["c"])
            checks.append(
                {
                    "code": "supplier_invoice_drafts",
                    "title": "Supplier invoices still in draft",
                    "level": "warn" if purchase_drafts else "ok",
                    "count": purchase_drafts,
                    "href": "/purchasing/supplier-invoices",
                }
            )

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM supplier_invoices
                WHERE company_id=%s AND status='draft' AND is_on_hold=true
                """,
                (company_id,),
            )
            held = int(cur.fetchone()["c"])
            checks.append(
                {
                    "code": "supplier_invoices_on_hold",
                    "title": "Supplier invoices on hold",
                    "level": "warn" if held else "ok",
                    "count": held,
                    "href": "/purchasing/3-way-match",
                }
            )

            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM goods_receipts
                WHERE company_id=%s AND status='draft'
                  AND created_at::date BETWEEN %s AND %s
                """,
                (company_id, start_date, end_date),
            )
            gr_drafts = int(cur.fetchone()["c"])
            checks.append(
                {
                    "code": "goods_receipt_drafts",
                    "title": "Goods receipts still in draft",
                    "level": "warn" if gr_drafts else "ok",
                    "count": gr_drafts,
                    "href": "/purchasing/goods-receipts",
                }
            )

            # Bank reconciliation signal: unmatched statement lines in period.
            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM bank_transactions
                WHERE company_id=%s
                  AND txn_date BETWEEN %s AND %s
                  AND matched_journal_id IS NULL
                """,
                (company_id, start_date, end_date),
            )
            unmatched_bank = int(cur.fetchone()["c"])
            checks.append(
                {
                    "code": "bank_unmatched",
                    "title": "Bank statement lines not matched to journals",
                    "level": "warn" if unmatched_bank else "ok",
                    "count": unmatched_bank,
                    "href": "/accounting/banking/reconciliation",
                }
            )

            # Worker/outbox failures (ops correctness).
            cur.execute("SELECT COUNT(*)::int AS c FROM pos_events_outbox WHERE status IN ('failed','dead')", ())
            outbox_failed = int(cur.fetchone()["c"])
            checks.append(
                {
                    "code": "pos_outbox_failed",
                    "title": "POS outbox failures",
                    "level": "error" if outbox_failed else "ok",
                    "count": outbox_failed,
                    "href": "/system/outbox",
                }
            )

            # Open shifts can create surprises during close.
            cur.execute("SELECT COUNT(*)::int AS c FROM pos_shifts WHERE company_id=%s AND status='open'", (company_id,))
            open_shifts = int(cur.fetchone()["c"])
            checks.append(
                {
                    "code": "pos_open_shifts",
                    "title": "Open POS shifts",
                    "level": "warn" if open_shifts else "ok",
                    "count": open_shifts,
                    "href": "/system/pos-shifts",
                }
            )

            # Negative stock indicates posting/costing data problems.
            cur.execute(
                "SELECT COUNT(*)::int AS c FROM item_warehouse_costs WHERE company_id=%s AND on_hand_qty < 0",
                (company_id,),
            )
            neg = int(cur.fetchone()["c"])
            checks.append(
                {
                    "code": "negative_stock",
                    "title": "Negative stock positions",
                    "level": "warn" if neg else "ok",
                    "count": neg,
                    "href": "/inventory/stock",
                }
            )

            # Period lock presence (informational).
            cur.execute(
                """
                SELECT COUNT(*)::int AS c
                FROM accounting_period_locks
                WHERE company_id=%s AND locked=true
                  AND start_date <= %s AND end_date >= %s
                """,
                (company_id, end_date, start_date),
            )
            locked = int(cur.fetchone()["c"])
            checks.append(
                {
                    "code": "period_locked",
                    "title": "Period is locked (posting blocked)",
                    "level": "info" if locked else "ok",
                    "count": locked,
                    "href": "/accounting/period-locks",
                }
            )

    return {"start_date": str(start_date), "end_date": str(end_date), "checks": checks}


@router.post("/opening/ar/import", dependencies=[Depends(require_permission("accounting:write"))])
def import_opening_ar(
    data: OpeningArImportIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Go-live utility: import opening AR balances as posted, financial-only sales invoices.
    These invoices:
    - Are posted with doc_subtype='opening_balance'
    - Do NOT create stock moves / COGS
    - Post GL: Dr AR, Cr OPENING_BALANCE (equity)
    Payments can be entered later via Sales Payments.
    """
    rows = data.rows or []
    if not rows:
        raise HTTPException(status_code=400, detail="rows is required")
    if len(rows) > 5000:
        raise HTTPException(status_code=400, detail="too many rows (max 5000)")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                opening_item_id = _ensure_opening_item(cur, company_id)
                defaults = _fetch_account_defaults(cur, company_id)
                ar = defaults.get("AR")
                opening_bal = defaults.get("OPENING_BALANCE") or defaults.get("OPENING_STOCK")
                if not ar:
                    raise HTTPException(status_code=400, detail="Missing AR account default")
                if not opening_bal:
                    raise HTTPException(status_code=400, detail="Missing OPENING_BALANCE (or OPENING_STOCK fallback) account default")

                # Resolve customers by code for faster import.
                codes = sorted({(r.customer_code or "").strip() for r in rows if (r.customer_code or "").strip()})
                code_to_id: dict[str, str] = {}
                if codes:
                    cur.execute(
                        """
                        SELECT code, id
                        FROM customers
                        WHERE company_id=%s AND code = ANY(%s::text[])
                        """,
                        (company_id, codes),
                    )
                    for rr in cur.fetchall():
                        code_to_id[(rr["code"] or "").strip()] = str(rr["id"])

                created = 0
                skipped = 0
                for idx, r in enumerate(rows):
                    assert_period_open(cur, company_id, r.invoice_date)
                    rate = data.exchange_rate
                    if rate is None or rate == 0:
                        rate = _fetch_exchange_rate(cur, company_id, r.invoice_date, data.rate_type)
                    rate = Decimal(str(rate))
                    if rate <= 0:
                        raise HTTPException(status_code=400, detail=f"row {idx+1}: exchange_rate must be > 0")

                    customer_id = (r.customer_id or "").strip() or None
                    if not customer_id and (r.customer_code or "").strip():
                        customer_id = code_to_id.get((r.customer_code or "").strip())
                    if not customer_id:
                        raise HTTPException(status_code=400, detail=f"row {idx+1}: customer_id or customer_code is required")
                    cur.execute(
                        "SELECT 1 FROM customers WHERE company_id=%s AND id=%s",
                        (company_id, customer_id),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail=f"row {idx+1}: customer not found in company")

                    amount_usd = Decimal(str(r.amount_usd or 0))
                    amount_lbp = Decimal(str(r.amount_lbp or 0))
                    amount_usd, amount_lbp = _normalize_dual_amounts(amount_usd, amount_lbp, rate)
                    if amount_usd <= 0 and amount_lbp <= 0:
                        raise HTTPException(status_code=400, detail=f"row {idx+1}: amount is required and must be > 0")

                    inv_no = (r.invoice_no or "").strip() or None
                    if not inv_no:
                        inv_no = _next_doc_no(cur, company_id, "SI")

                    due = r.due_date or r.invoice_date

                    # Idempotency by (company_id, invoice_no).
                    cur.execute(
                        """
                        SELECT id, status, COALESCE(doc_subtype,'standard') AS doc_subtype
                        FROM sales_invoices
                        WHERE company_id=%s AND invoice_no=%s
                        """,
                        (company_id, inv_no),
                    )
                    existing = cur.fetchone()
                    if existing:
                        if existing["doc_subtype"] != "opening_balance":
                            raise HTTPException(status_code=400, detail=f"row {idx+1}: invoice_no already exists as a standard invoice: {inv_no}")
                        if existing["status"] == "posted":
                            skipped += 1
                            continue
                        invoice_id = existing["id"]
                        cur.execute(
                            """
                            UPDATE sales_invoices
                            SET customer_id=%s,
                                status='posted',
                                warehouse_id=NULL,
                                exchange_rate=%s,
                                pricing_currency='USD',
                                settlement_currency='USD',
                                invoice_date=%s,
                                due_date=%s,
                                sales_channel='import',
                                total_usd=%s,
                                total_lbp=%s
                            WHERE company_id=%s AND id=%s
                            """,
                            (customer_id, rate, r.invoice_date, due, amount_usd, amount_lbp, company_id, invoice_id),
                        )
                        cur.execute("DELETE FROM sales_invoice_lines WHERE invoice_id=%s", (invoice_id,))
                    else:
                        cur.execute(
                            """
                            INSERT INTO sales_invoices
                              (id, company_id, invoice_no, customer_id, status, total_usd, total_lbp,
                               warehouse_id, exchange_rate, pricing_currency, settlement_currency, invoice_date, due_date, doc_subtype, sales_channel)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, 'posted', %s, %s, NULL, %s, 'USD', 'USD', %s, %s, 'opening_balance', 'import')
                            RETURNING id
                            """,
                            (company_id, inv_no, customer_id, amount_usd, amount_lbp, rate, r.invoice_date, due),
                        )
                        invoice_id = cur.fetchone()["id"]

                    # One placeholder line for reporting/UI.
                    cur.execute(
                        "SELECT unit_of_measure FROM items WHERE company_id=%s AND id=%s",
                        (company_id, opening_item_id),
                    )
                    urow = cur.fetchone() or {}
                    opening_uom = (urow.get("unit_of_measure") or "EA")
                    cur.execute(
                        """
                        INSERT INTO sales_invoice_lines
                          (id, invoice_id, item_id, qty,
                           uom, qty_factor, qty_entered,
                           unit_price_usd, unit_price_lbp, unit_price_entered_usd, unit_price_entered_lbp,
                           line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, 1,
                           %s, 1, 1,
                           %s, %s, %s, %s,
                           %s, %s)
                        """,
                        (invoice_id, opening_item_id, opening_uom, amount_usd, amount_lbp, amount_usd, amount_lbp, amount_usd, amount_lbp),
                    )

                    # Idempotency: only post GL if missing.
                    cur.execute(
                        """
                        SELECT 1
                        FROM gl_journals
                        WHERE company_id=%s AND source_type='sales_invoice' AND source_id=%s
                        LIMIT 1
                        """,
                        (company_id, invoice_id),
                    )
                    if not cur.fetchone():
                        cur.execute(
                            """
                            INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                            VALUES (gen_random_uuid(), %s, %s, 'sales_invoice', %s, %s, %s, %s, %s, %s)
                            RETURNING id
                            """,
                            (
                                company_id,
                                f"GL-{inv_no}",
                                invoice_id,
                                r.invoice_date,
                                data.rate_type,
                                rate,
                                f"Opening AR: {inv_no}",
                                user["user_id"],
                            ),
                        )
                        journal_id = cur.fetchone()["id"]
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Opening AR')
                            """,
                            (journal_id, ar, amount_usd, amount_lbp),
                        )
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Opening balance offset')
                            """,
                            (journal_id, opening_bal, amount_usd, amount_lbp),
                        )

                    # Keep customer credit balance consistent for credit-limit enforcement.
                    cur.execute(
                        """
                        UPDATE customers
                        SET credit_balance_usd = credit_balance_usd + %s,
                            credit_balance_lbp = credit_balance_lbp + %s
                        WHERE company_id=%s AND id=%s
                        """,
                        (amount_usd, amount_lbp, company_id, customer_id),
                    )

                    created += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'opening_ar_import', 'sales_invoice', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"created": created, "skipped": skipped})),
                )
                return {"ok": True, "created": created, "skipped": skipped}


@router.post("/opening/ap/import", dependencies=[Depends(require_permission("accounting:write"))])
def import_opening_ap(
    data: OpeningApImportIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Go-live utility: import opening AP balances as posted supplier invoices with doc_subtype='opening_balance'.
    GL: Dr OPENING_BALANCE (equity), Cr AP.
    """
    rows = data.rows or []
    if not rows:
        raise HTTPException(status_code=400, detail="rows is required")
    if len(rows) > 5000:
        raise HTTPException(status_code=400, detail="too many rows (max 5000)")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                opening_item_id = _ensure_opening_item(cur, company_id)
                defaults = _fetch_account_defaults(cur, company_id)
                ap = defaults.get("AP")
                opening_bal = defaults.get("OPENING_BALANCE") or defaults.get("OPENING_STOCK")
                if not ap:
                    raise HTTPException(status_code=400, detail="Missing AP account default")
                if not opening_bal:
                    raise HTTPException(status_code=400, detail="Missing OPENING_BALANCE (or OPENING_STOCK fallback) account default")

                codes = sorted({(r.supplier_code or "").strip() for r in rows if (r.supplier_code or "").strip()})
                code_to_id: dict[str, str] = {}
                if codes:
                    cur.execute(
                        """
                        SELECT code, id
                        FROM suppliers
                        WHERE company_id=%s AND code = ANY(%s::text[])
                        """,
                        (company_id, codes),
                    )
                    for rr in cur.fetchall():
                        code_to_id[(rr["code"] or "").strip()] = str(rr["id"])

                created = 0
                skipped = 0
                for idx, r in enumerate(rows):
                    assert_period_open(cur, company_id, r.invoice_date)
                    rate = data.exchange_rate
                    if rate is None or rate == 0:
                        rate = _fetch_exchange_rate(cur, company_id, r.invoice_date, data.rate_type)
                    rate = Decimal(str(rate))
                    if rate <= 0:
                        raise HTTPException(status_code=400, detail=f"row {idx+1}: exchange_rate must be > 0")

                    supplier_id = (r.supplier_id or "").strip() or None
                    if not supplier_id and (r.supplier_code or "").strip():
                        supplier_id = code_to_id.get((r.supplier_code or "").strip())
                    if not supplier_id:
                        raise HTTPException(status_code=400, detail=f"row {idx+1}: supplier_id or supplier_code is required")
                    cur.execute(
                        "SELECT 1 FROM suppliers WHERE company_id=%s AND id=%s",
                        (company_id, supplier_id),
                    )
                    if not cur.fetchone():
                        raise HTTPException(status_code=400, detail=f"row {idx+1}: supplier not found in company")

                    amount_usd = Decimal(str(r.amount_usd or 0))
                    amount_lbp = Decimal(str(r.amount_lbp or 0))
                    amount_usd, amount_lbp = _normalize_dual_amounts(amount_usd, amount_lbp, rate)
                    if amount_usd <= 0 and amount_lbp <= 0:
                        raise HTTPException(status_code=400, detail=f"row {idx+1}: amount is required and must be > 0")

                    inv_no = (r.invoice_no or "").strip() or None
                    if not inv_no:
                        inv_no = _next_doc_no(cur, company_id, "PI")

                    due = r.due_date or r.invoice_date

                    cur.execute(
                        """
                        SELECT id, status, COALESCE(doc_subtype,'standard') AS doc_subtype
                        FROM supplier_invoices
                        WHERE company_id=%s AND invoice_no=%s
                        """,
                        (company_id, inv_no),
                    )
                    existing = cur.fetchone()
                    if existing:
                        if existing["doc_subtype"] != "opening_balance":
                            raise HTTPException(status_code=400, detail=f"row {idx+1}: invoice_no already exists as a standard invoice: {inv_no}")
                        if existing["status"] == "posted":
                            skipped += 1
                            continue
                        invoice_id = existing["id"]
                        cur.execute(
                            """
                            UPDATE supplier_invoices
                            SET supplier_id=%s,
                                status='posted',
                                exchange_rate=%s,
                                invoice_date=%s,
                                due_date=%s,
                                total_usd=%s,
                                total_lbp=%s,
                                tax_code_id=NULL,
                                goods_receipt_id=NULL
                            WHERE company_id=%s AND id=%s
                            """,
                            (supplier_id, rate, r.invoice_date, due, amount_usd, amount_lbp, company_id, invoice_id),
                        )
                        cur.execute("DELETE FROM supplier_invoice_lines WHERE company_id=%s AND supplier_invoice_id=%s", (company_id, invoice_id))
                    else:
                        cur.execute(
                            """
                            INSERT INTO supplier_invoices
                              (id, company_id, invoice_no, supplier_id, goods_receipt_id, status,
                               total_usd, total_lbp, exchange_rate, source_event_id, invoice_date, due_date, tax_code_id, doc_subtype)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, NULL, 'posted', %s, %s, %s, NULL, %s, %s, NULL, 'opening_balance')
                            RETURNING id
                            """,
                            (company_id, inv_no, supplier_id, amount_usd, amount_lbp, rate, r.invoice_date, due),
                        )
                        invoice_id = cur.fetchone()["id"]

                    cur.execute(
                        "SELECT unit_of_measure FROM items WHERE company_id=%s AND id=%s",
                        (company_id, opening_item_id),
                    )
                    urow = cur.fetchone() or {}
                    opening_uom = (urow.get("unit_of_measure") or "EA")

                    cur.execute(
                        """
                        INSERT INTO supplier_invoice_lines
                          (id, company_id, supplier_invoice_id, goods_receipt_line_id, item_id, batch_id, qty,
                           uom, qty_factor, qty_entered,
                           unit_cost_usd, unit_cost_lbp, unit_cost_entered_usd, unit_cost_entered_lbp,
                           line_total_usd, line_total_lbp)
                        VALUES
                          (gen_random_uuid(), %s, %s, NULL, %s, NULL, 1,
                           %s, 1, 1,
                           %s, %s, %s, %s,
                           %s, %s)
                        """,
                        (company_id, invoice_id, opening_item_id, opening_uom, amount_usd, amount_lbp, amount_usd, amount_lbp, amount_usd, amount_lbp),
                    )

                    cur.execute(
                        """
                        SELECT 1
                        FROM gl_journals
                        WHERE company_id=%s AND source_type='supplier_invoice' AND source_id=%s
                        LIMIT 1
                        """,
                        (company_id, invoice_id),
                    )
                    if not cur.fetchone():
                        cur.execute(
                            """
                            INSERT INTO gl_journals (id, company_id, journal_no, source_type, source_id, journal_date, rate_type, exchange_rate, memo, created_by_user_id)
                            VALUES (gen_random_uuid(), %s, %s, 'supplier_invoice', %s, %s, %s, %s, %s, %s)
                            RETURNING id
                            """,
                            (
                                company_id,
                                f"GL-{inv_no}",
                                invoice_id,
                                r.invoice_date,
                                data.rate_type,
                                rate,
                                f"Opening AP: {inv_no}",
                                user["user_id"],
                            ),
                        )
                        journal_id = cur.fetchone()["id"]
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, %s, 0, %s, 0, 'Opening balance offset')
                            """,
                            (journal_id, opening_bal, amount_usd, amount_lbp),
                        )
                        cur.execute(
                            """
                            INSERT INTO gl_entries (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                            VALUES (gen_random_uuid(), %s, %s, 0, %s, 0, %s, 'Opening AP')
                            """,
                            (journal_id, ap, amount_usd, amount_lbp),
                        )

                    created += 1

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'opening_ap_import', 'supplier_invoice', NULL, %s::jsonb)
                    """,
                    (company_id, user["user_id"], json.dumps({"created": created, "skipped": skipped})),
                )
                return {"ok": True, "created": created, "skipped": skipped}


class ReverseJournalIn(BaseModel):
    journal_date: Optional[date] = None
    memo: Optional[str] = None


@router.post("/journals/{journal_id}/reverse", dependencies=[Depends(require_permission("accounting:write"))])
def reverse_journal(
    journal_id: str,
    data: ReverseJournalIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, journal_no, journal_date, rate_type, exchange_rate
                    FROM gl_journals
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, journal_id),
                )
                original = cur.fetchone()
                if not original:
                    raise HTTPException(status_code=404, detail="journal not found")

                cur.execute(
                    """
                    SELECT id
                    FROM gl_journals
                    WHERE company_id = %s AND source_type = 'journal_reversal' AND source_id = %s
                    LIMIT 1
                    """,
                    (company_id, journal_id),
                )
                existing = cur.fetchone()
                if existing:
                    return {"id": existing["id"], "reused": True}

                cur.execute(
                    """
                    SELECT account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo
                    FROM gl_entries
                    WHERE journal_id = %s
                    ORDER BY id
                    """,
                    (journal_id,),
                )
                entries = cur.fetchall()
                if not entries:
                    raise HTTPException(status_code=400, detail="journal has no entries")

                new_journal_no = _next_doc_no(cur, company_id, "MJ")
                new_date = data.journal_date or date.today()
                assert_period_open(cur, company_id, new_date)
                memo = (data.memo or "").strip() or None
                base_memo = f"Reversal of {original['journal_no']}"
                full_memo = base_memo if not memo else f"{base_memo} - {memo}"

                cur.execute(
                    """
                    INSERT INTO gl_journals
                      (id, company_id, journal_no, source_type, source_id, journal_date, rate_type,
                       exchange_rate, memo, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, 'journal_reversal', %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        new_journal_no,
                        journal_id,
                        new_date,
                        original["rate_type"],
                        original["exchange_rate"] or 0,
                        full_memo,
                        user["user_id"],
                    ),
                )
                new_id = cur.fetchone()["id"]

                for e in entries:
                    cur.execute(
                        """
                        INSERT INTO gl_entries
                          (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo)
                        VALUES
                          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            new_id,
                            e["account_id"],
                            e["credit_usd"],
                            e["debit_usd"],
                            e["credit_lbp"],
                            e["debit_lbp"],
                            f"Reversal: {e['memo']}" if e.get("memo") else "Reversal",
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'accounting.journal.reverse', 'gl_journal', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        new_id,
                        json.dumps({"reversed_journal_id": journal_id, "reversal_journal_no": new_journal_no}),
                    ),
                )

                return {"id": new_id, "journal_no": new_journal_no}


class PeriodLockIn(BaseModel):
    start_date: date
    end_date: date
    reason: Optional[str] = None
    locked: bool = True


@router.get("/period-locks", dependencies=[Depends(require_permission("accounting:read"))])
def list_period_locks(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT l.id, l.start_date, l.end_date, l.locked, l.reason, l.created_at,
                       l.created_by_user_id, u.email AS created_by_email
                FROM accounting_period_locks l
                LEFT JOIN users u ON u.id = l.created_by_user_id
                WHERE l.company_id = %s
                ORDER BY l.end_date DESC, l.start_date DESC
                """,
                (company_id,),
            )
            return {"locks": cur.fetchall()}


@router.post("/period-locks", dependencies=[Depends(require_permission("accounting:write"))])
def create_period_lock(
    data: PeriodLockIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    if data.end_date < data.start_date:
        raise HTTPException(status_code=400, detail="end_date must be >= start_date")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO accounting_period_locks
                      (id, company_id, start_date, end_date, reason, locked, created_by_user_id)
                    VALUES
                      (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        company_id,
                        data.start_date,
                        data.end_date,
                        (data.reason or "").strip() or None,
                        data.locked,
                        user["user_id"],
                    ),
                )
                lock_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'accounting.period_lock.create', 'accounting_period_lock', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        lock_id,
                        json.dumps({"start_date": str(data.start_date), "end_date": str(data.end_date), "locked": data.locked}),
                    ),
                )
                return {"id": lock_id}


@router.post("/period-locks/{lock_id}/set", dependencies=[Depends(require_permission("accounting:write"))])
def set_period_lock(
    lock_id: str,
    locked: bool,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE accounting_period_locks
                    SET locked = %s
                    WHERE company_id = %s AND id = %s
                    """,
                    (locked, company_id, lock_id),
                )
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="period lock not found")
                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'accounting.period_lock.set', 'accounting_period_lock', %s, %s::jsonb)
                    """,
                    (company_id, user["user_id"], lock_id, json.dumps({"locked": locked})),
                )
                return {"ok": True}
