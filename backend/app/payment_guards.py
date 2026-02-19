from decimal import Decimal

from fastapi import HTTPException


def assert_not_overpaid(
    total_usd: Decimal,
    total_lbp: Decimal,
    paid_usd: Decimal,
    paid_lbp: Decimal,
    detail: str = "payment exceeds invoice total",
):
    eps_usd = Decimal("0.01")
    eps_lbp = Decimal("100")
    if paid_usd > (total_usd + eps_usd) or paid_lbp > (total_lbp + eps_lbp):
        raise HTTPException(status_code=400, detail=detail)
