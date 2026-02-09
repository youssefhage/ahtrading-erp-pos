#!/usr/bin/env python3
"""
Recurring journal scheduler (v1).

Creates GL journals from active `recurring_journal_rules` when `next_run_date` is due.
Uses `journal_templates` + `journal_template_lines` as the source of truth.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import calendar
import json

import psycopg
from psycopg.rows import dict_row

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


def _fetch_exchange_rate(cur, company_id: str, rate_date: date, rate_type: str) -> Decimal:
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
    if row and row.get("usd_to_lbp"):
        return Decimal(str(row["usd_to_lbp"]))

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
    if row and row.get("usd_to_lbp"):
        return Decimal(str(row["usd_to_lbp"]))
    raise RuntimeError("missing exchange rate")


def _next_doc_no(cur, company_id: str, doc_type: str) -> str:
    cur.execute("SELECT next_document_no(%s, %s) AS doc_no", (company_id, doc_type))
    return cur.fetchone()["doc_no"]


def _get_rounding_account(cur, company_id: str) -> str | None:
    cur.execute(
        """
        SELECT account_id
        FROM company_account_defaults
        WHERE company_id = %s AND role_code = 'ROUNDING'
        """,
        (company_id,),
    )
    row = cur.fetchone()
    return row["account_id"] if row else None


def _advance_next_run_date(cur_date: date, cadence: str, day_of_month: int | None = None) -> date:
    if cadence == "daily":
        return cur_date.fromordinal(cur_date.toordinal() + 1)
    if cadence == "weekly":
        return cur_date.fromordinal(cur_date.toordinal() + 7)
    # monthly
    year = cur_date.year
    month = cur_date.month + 1
    if month == 13:
        year += 1
        month = 1
    dom = int(day_of_month or cur_date.day)
    last = calendar.monthrange(year, month)[1]
    dom = max(1, min(dom, last))
    return date(year, month, dom)


def run_recurring_journal_scheduler(db_url: str, company_id: str, limit_rules: int = 25):
    today = date.today()
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT set_config('app.current_company_id', %s, true)", (company_id,))

                cur.execute(
                    """
                    SELECT r.id, r.journal_template_id, r.cadence, r.day_of_week, r.day_of_month, r.next_run_date,
                           t.name AS template_name, t.is_active AS template_active, t.memo AS template_memo, t.default_rate_type
                    FROM recurring_journal_rules r
                    JOIN journal_templates t ON t.id = r.journal_template_id
                    WHERE r.company_id=%s
                      AND r.is_active=true
                      AND r.next_run_date <= %s
                    ORDER BY r.next_run_date ASC, r.updated_at DESC
                    LIMIT %s
                    FOR UPDATE
                    """,
                    (company_id, today, limit_rules),
                )
                rules = cur.fetchall() or []
                if not rules:
                    return

                for r in rules:
                    rule_id = str(r["id"])
                    tpl_id = str(r["journal_template_id"])
                    run_date = r["next_run_date"]
                    cadence = str(r["cadence"])
                    dom = r.get("day_of_month")

                    # If the template is inactive, disable the rule to avoid silent no-ops.
                    if not r.get("template_active"):
                        cur.execute(
                            """
                            UPDATE recurring_journal_rules
                            SET is_active=false, updated_at=now()
                            WHERE company_id=%s AND id=%s
                            """,
                            (company_id, rule_id),
                        )
                        cur.execute(
                            """
                            INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                            VALUES (gen_random_uuid(), %s, NULL, 'accounting.recurring_journal_rule.disabled', 'recurring_journal_rule', %s, %s::jsonb)
                            """,
                            (company_id, rule_id, json.dumps({"reason": "template_inactive", "template_id": tpl_id})),
                        )
                        continue

                    # Respect period locks (DB trigger prevents insert too, but we prefer clearer audit).
                    try:
                        cur.execute(
                            """
                            SELECT 1
                            FROM accounting_period_locks
                            WHERE company_id=%s AND %s BETWEEN start_date AND end_date
                            LIMIT 1
                            """,
                            (company_id, run_date),
                        )
                        if cur.fetchone():
                            raise RuntimeError("period is locked")
                    except Exception as ex:
                        cur.execute(
                            """
                            INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                            VALUES (gen_random_uuid(), %s, NULL, 'accounting.recurring_journal.failed', 'recurring_journal_rule', %s, %s::jsonb)
                            """,
                            (company_id, rule_id, json.dumps({"error": str(ex), "run_date": str(run_date)})),
                        )
                        # Push the next attempt forward so we don't loop on the same locked date forever.
                        next_try = run_date.fromordinal(run_date.toordinal() + 1)
                        cur.execute(
                            """
                            UPDATE recurring_journal_rules
                            SET next_run_date=%s, updated_at=now()
                            WHERE company_id=%s AND id=%s
                            """,
                            (next_try, company_id, rule_id),
                        )
                        continue

                    try:
                        rate_type = (r.get("default_rate_type") or "market").strip()
                        rate = _fetch_exchange_rate(cur, company_id, run_date, rate_type)
                        if rate <= 0:
                            raise RuntimeError("exchange_rate must be > 0")

                        cur.execute(
                            """
                            SELECT account_id, side, amount_usd, amount_lbp, memo, cost_center_id, project_id
                            FROM journal_template_lines
                            WHERE company_id=%s AND journal_template_id=%s
                            ORDER BY line_no ASC
                            """,
                            (company_id, tpl_id),
                        )
                        lines = cur.fetchall() or []
                        if not lines:
                            raise RuntimeError("template has no lines")

                        resolved = []
                        total_debit_usd = Decimal("0")
                        total_credit_usd = Decimal("0")
                        total_debit_lbp = Decimal("0")
                        total_credit_lbp = Decimal("0")

                        for idx, line in enumerate(lines, start=1):
                            amount_usd = Decimal(str(line.get("amount_usd") or 0))
                            amount_lbp = Decimal(str(line.get("amount_lbp") or 0))
                            if amount_usd == 0 and amount_lbp == 0:
                                raise RuntimeError(f"template line {idx}: amount is zero")

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

                            resolved.append(
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
                                raise RuntimeError("journal is imbalanced (USD/LBP signs differ)")
                            if abs(diff_usd) > Decimal("0.05") or abs(diff_lbp) > Decimal("5000"):
                                raise RuntimeError("journal is imbalanced (too large to auto-balance)")
                            rounding_acc = _get_rounding_account(cur, company_id)
                            if not rounding_acc:
                                raise RuntimeError("journal is imbalanced; missing ROUNDING account default")
                            sign = sign_usd or sign_lbp
                            if sign > 0:
                                resolved.append(
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
                                resolved.append(
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
                        memo = (r.get("template_memo") or "").strip() or f"Recurring: {r.get('template_name')}"

                        cur.execute(
                            """
                            INSERT INTO gl_journals
                              (id, company_id, journal_no, source_type, source_id, journal_date, rate_type,
                               exchange_rate, memo, created_by_user_id)
                            VALUES
                              (gen_random_uuid(), %s, %s, 'recurring_journal', %s, %s, %s, %s, %s, %s, NULL)
                            RETURNING id
                            """,
                            (company_id, journal_no, rule_id, run_date, rate_type, rate, memo[:240] or None),
                        )
                        journal_id = cur.fetchone()["id"]

                        for l in resolved:
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
                            VALUES (gen_random_uuid(), %s, NULL, 'accounting.recurring_journal.run', 'gl_journal', %s, %s::jsonb)
                            """,
                            (
                                company_id,
                                journal_id,
                                json.dumps(
                                    {
                                        "journal_no": journal_no,
                                        "rule_id": rule_id,
                                        "template_id": tpl_id,
                                        "template_name": r.get("template_name"),
                                        "journal_date": str(run_date),
                                    }
                                ),
                            ),
                        )

                        next_run = _advance_next_run_date(run_date, cadence, int(dom) if dom is not None else None)
                        cur.execute(
                            """
                            UPDATE recurring_journal_rules
                            SET last_run_at=now(), next_run_date=%s, updated_at=now()
                            WHERE company_id=%s AND id=%s
                            """,
                            (next_run, company_id, rule_id),
                        )

                    except Exception as ex:
                        cur.execute(
                            """
                            INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                            VALUES (gen_random_uuid(), %s, NULL, 'accounting.recurring_journal.failed', 'recurring_journal_rule', %s, %s::jsonb)
                            """,
                            (company_id, rule_id, json.dumps({"error": str(ex), "run_date": str(run_date), "template_id": tpl_id})),
                        )
                        # Avoid retrying immediately on a broken rule (noise); schedule a day later.
                        next_try = run_date.fromordinal(run_date.toordinal() + 1)
                        cur.execute(
                            """
                            UPDATE recurring_journal_rules
                            SET next_run_date=%s, updated_at=now()
                            WHERE company_id=%s AND id=%s
                            """,
                            (next_try, company_id, rule_id),
                        )

