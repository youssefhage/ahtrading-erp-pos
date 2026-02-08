from datetime import date

from fastapi import HTTPException


def is_period_locked(cur, company_id: str, posting_date: date) -> bool:
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
    return cur.fetchone() is not None


def assert_period_open(cur, company_id: str, posting_date: date):
    if is_period_locked(cur, company_id, posting_date):
        raise HTTPException(
            status_code=400,
            detail=f"accounting period is locked for date {posting_date.isoformat()}",
        )

