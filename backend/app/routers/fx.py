from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional
import json

from ..db import get_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission
from ..validation import RateType

router = APIRouter(prefix="/fx", tags=["fx"])


def _company_default_rate_type(cur, company_id: str) -> str:
    cur.execute("SELECT default_rate_type FROM companies WHERE id=%s", (company_id,))
    row = cur.fetchone()
    return str(row["default_rate_type"] if row and row.get("default_rate_type") else "market")


def _pick_rate(cur, *, company_id: str, rate_type: str, rate_date: Optional[date]) -> dict:
    # 1) Exact match for the requested day (if provided).
    if rate_date is not None:
        cur.execute(
            """
            SELECT rate_date, rate_type, usd_to_lbp
            FROM exchange_rates
            WHERE company_id=%s AND rate_type=%s AND rate_date=%s
            LIMIT 1
            """,
            (company_id, rate_type, rate_date),
        )
        row = cur.fetchone()
        if row and row.get("usd_to_lbp") is not None:
            return {**row, "source": "exact"}

    # 2) Latest for the type.
    cur.execute(
        """
        SELECT rate_date, rate_type, usd_to_lbp
        FROM exchange_rates
        WHERE company_id=%s AND rate_type=%s
        ORDER BY rate_date DESC, created_at DESC
        LIMIT 1
        """,
        (company_id, rate_type),
    )
    row = cur.fetchone()
    if row and row.get("usd_to_lbp") is not None:
        return {**row, "source": "latest"}

    # 3) Safe fallback (matches seed + Admin UI default).
    return {"rate_date": None, "rate_type": rate_type, "usd_to_lbp": Decimal("90000"), "source": "fallback"}


@router.get("/rate", dependencies=[Depends(get_current_user)])
def get_exchange_rate(
    rate_date: Optional[date] = Query(default=None),
    rate_type: Optional[RateType] = Query(default=None),
    company_id: str = Depends(get_company_id),
):
    """
    Fetch the best exchange rate for the company.
    - If `rate_date` is given, returns the exact rate for that date+type if present.
    - Otherwise falls back to the latest rate for the type.
    - If no rate exists, returns a safe fallback (90000).

    This endpoint is intentionally readable for any authenticated company member,
    so operational screens can default exchange_rate without requiring `config:read`.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            rt = str(rate_type or _company_default_rate_type(cur, company_id) or "market")
            rate = _pick_rate(cur, company_id=company_id, rate_type=rt, rate_date=rate_date)
            return {"rate": rate, "default_rate_type": rt}


class FxRateUpsertIn(BaseModel):
    usd_to_lbp: Decimal
    rate_date: Optional[date] = None
    rate_type: Optional[RateType] = None


@router.post("/rate", dependencies=[Depends(require_permission("config:write"))])
def upsert_exchange_rate(
    data: FxRateUpsertIn,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    if data.usd_to_lbp <= 0:
        raise HTTPException(status_code=400, detail="usd_to_lbp must be > 0")

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                rt = str(data.rate_type or _company_default_rate_type(cur, company_id) or "market")
                rd = data.rate_date or date.today()

                cur.execute(
                    """
                    INSERT INTO exchange_rates (id, company_id, rate_date, rate_type, usd_to_lbp)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s)
                    ON CONFLICT (company_id, rate_date, rate_type) DO UPDATE
                    SET usd_to_lbp = EXCLUDED.usd_to_lbp
                    RETURNING id
                    """,
                    (company_id, rd, rt, data.usd_to_lbp),
                )
                rid = cur.fetchone()["id"]

                cur.execute(
                    """
                    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                    VALUES (gen_random_uuid(), %s, %s, 'fx.rate.upsert', 'exchange_rate', %s, %s::jsonb)
                    """,
                    (
                        company_id,
                        user["user_id"],
                        rid,
                        json.dumps({"rate_date": str(rd), "rate_type": rt, "usd_to_lbp": str(data.usd_to_lbp)}),
                    ),
                )

                rate = _pick_rate(cur, company_id=company_id, rate_type=rt, rate_date=rd)
                return {"ok": True, "rate": rate, "default_rate_type": rt}

