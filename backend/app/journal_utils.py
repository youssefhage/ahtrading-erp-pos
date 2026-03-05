from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from .account_defaults import ensure_company_account_defaults

USD_Q = Decimal("0.0001")
LBP_Q = Decimal("0.01")


def q_usd(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(USD_Q, rounding=ROUND_HALF_UP)


def q_lbp(v: Decimal) -> Decimal:
    return (v or Decimal("0")).quantize(LBP_Q, rounding=ROUND_HALF_UP)


def normalize_dual_amounts(usd: Decimal, lbp: Decimal, exchange_rate: Decimal) -> tuple[Decimal, Decimal]:
    """Back-fill missing USD or LBP from the exchange rate."""
    if exchange_rate and exchange_rate > 0:
        if usd == 0 and lbp != 0:
            usd = q_usd(lbp / exchange_rate)
        elif lbp == 0 and usd != 0:
            lbp = q_lbp(usd * exchange_rate)
    return usd, lbp


def assert_journal_balanced(cur, journal_id: str, *, tolerance_usd: Decimal = Decimal("0.01"), tolerance_lbp: Decimal = Decimal("1")) -> None:
    """Hard assertion that a journal is balanced after all entries (including rounding) are inserted."""
    cur.execute(
        """
        SELECT
          COALESCE(SUM(debit_usd), 0) - COALESCE(SUM(credit_usd), 0) AS diff_usd,
          COALESCE(SUM(debit_lbp), 0) - COALESCE(SUM(credit_lbp), 0) AS diff_lbp
        FROM gl_entries WHERE journal_id = %s
        """,
        (journal_id,),
    )
    row = cur.fetchone() or {}
    diff_usd = Decimal(str(row.get("diff_usd") or 0))
    diff_lbp = Decimal(str(row.get("diff_lbp") or 0))
    if abs(diff_usd) > tolerance_usd or abs(diff_lbp) > tolerance_lbp:
        raise ValueError(f"GL journal {journal_id} imbalanced after auto-balance: diff_usd={diff_usd}, diff_lbp={diff_lbp}")


STALE_RATE_DAYS = 7  # warn if exchange rate is older than this


def fetch_exchange_rate(cur, company_id: str, rate_date, rate_type: str = "market") -> tuple[Optional[Decimal], bool]:
    """
    Fetch exchange rate for (company, date, type).
    Returns (rate, is_stale). rate is None if nothing found.
    """
    from datetime import date as _date, timedelta as _td

    cur.execute(
        """
        SELECT usd_to_lbp, rate_date
        FROM exchange_rates
        WHERE company_id = %s AND rate_date = %s AND rate_type = %s
        ORDER BY created_at DESC LIMIT 1
        """,
        (company_id, rate_date, rate_type),
    )
    row = cur.fetchone()
    if row and row["usd_to_lbp"]:
        return Decimal(str(row["usd_to_lbp"])), False

    # Fallback: latest known rate for this rate_type.
    cur.execute(
        """
        SELECT usd_to_lbp, rate_date
        FROM exchange_rates
        WHERE company_id = %s AND rate_type = %s
        ORDER BY rate_date DESC, created_at DESC LIMIT 1
        """,
        (company_id, rate_type),
    )
    row = cur.fetchone()
    if row and row["usd_to_lbp"]:
        actual_date = row["rate_date"]
        if isinstance(rate_date, str):
            rate_date = _date.fromisoformat(rate_date)
        is_stale = (rate_date - actual_date).days > STALE_RATE_DAYS if isinstance(actual_date, _date) else False
        return Decimal(str(row["usd_to_lbp"])), is_stale

    return None, False


def _get_rounding_account(cur, company_id: str) -> Optional[str]:
    defaults = ensure_company_account_defaults(cur, company_id, roles=("ROUNDING", "INV_ADJ"))
    return defaults.get("ROUNDING")


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

    # Handle USD and LBP independently — they can have opposite signs.
    debit_usd = Decimal("0")
    credit_usd = Decimal("0")
    debit_lbp = Decimal("0")
    credit_lbp = Decimal("0")
    if diff_usd > 0:
        credit_usd = diff_usd
    else:
        debit_usd = abs(diff_usd)
    if diff_lbp > 0:
        credit_lbp = diff_lbp
    else:
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

    # Verify the journal is actually balanced after the rounding entry.
    assert_journal_balanced(cur, journal_id)
