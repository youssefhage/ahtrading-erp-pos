from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

USD_Q = Decimal("0.0001")
LBP_Q = Decimal("0.01")


def q_usd(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(USD_Q, rounding=ROUND_HALF_UP)


def q_lbp(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(LBP_Q, rounding=ROUND_HALF_UP)


def _get_rounding_account(cur, company_id: str) -> Optional[str]:
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


def auto_balance_journal(
    cur,
    company_id: str,
    journal_id: str,
    *,
    warehouse_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    memo: str = "Rounding (auto-balance)",
) -> None:
    """
    Ensure a journal balances in both USD and LBP ledgers.
    If a small rounding difference exists, post it to the ROUNDING account.
    """
    cur.execute(
        """
        SELECT
          COALESCE(SUM(debit_usd - credit_usd), 0) AS diff_usd,
          COALESCE(SUM(debit_lbp - credit_lbp), 0) AS diff_lbp
        FROM gl_entries
        WHERE journal_id = %s
        """,
        (journal_id,),
    )
    row = cur.fetchone() or {}
    diff_usd = q_usd(Decimal(str(row.get("diff_usd") or 0)))
    diff_lbp = q_lbp(Decimal(str(row.get("diff_lbp") or 0)))
    if diff_usd == 0 and diff_lbp == 0:
        return

    # Too large to auto-balance: fail hard.
    if abs(diff_usd) > Decimal("0.05") or abs(diff_lbp) > Decimal("5000"):
        raise ValueError("journal is imbalanced (too large to auto-balance)")

    rounding_acc = _get_rounding_account(cur, company_id)
    if not rounding_acc:
        raise ValueError("journal is imbalanced; missing ROUNDING account default")

    # If diff is positive, debits exceed credits => add a credit rounding line.
    debit_usd = Decimal("0")
    credit_usd = Decimal("0")
    debit_lbp = Decimal("0")
    credit_lbp = Decimal("0")
    if diff_usd > 0 or diff_lbp > 0:
        credit_usd = abs(diff_usd)
        credit_lbp = abs(diff_lbp)
    else:
        debit_usd = abs(diff_usd)
        debit_lbp = abs(diff_lbp)

    cur.execute(
        """
        INSERT INTO gl_entries
          (id, journal_id, account_id, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id, branch_id)
        VALUES
          (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (journal_id, rounding_acc, debit_usd, credit_usd, debit_lbp, credit_lbp, memo, warehouse_id, branch_id),
    )

