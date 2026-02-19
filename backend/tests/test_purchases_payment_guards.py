from decimal import Decimal

import pytest
from fastapi import HTTPException

from backend.app.payment_guards import assert_not_overpaid


def test_assert_not_overpaid_allows_small_rounding_tolerance():
    assert_not_overpaid(
        total_usd=Decimal("100.00"),
        total_lbp=Decimal("9000000"),
        paid_usd=Decimal("100.009"),
        paid_lbp=Decimal("9000099"),
    )


def test_assert_not_overpaid_rejects_usd_overage():
    with pytest.raises(HTTPException) as exc_info:
        assert_not_overpaid(
            total_usd=Decimal("100.00"),
            total_lbp=Decimal("9000000"),
            paid_usd=Decimal("100.02"),
            paid_lbp=Decimal("9000000"),
            detail="payment exceeds invoice total",
        )
    exc = exc_info.value
    assert exc.status_code == 400
    assert "payment exceeds invoice total" in str(exc.detail)


def test_assert_not_overpaid_rejects_lbp_overage():
    with pytest.raises(HTTPException) as exc_info:
        assert_not_overpaid(
            total_usd=Decimal("100.00"),
            total_lbp=Decimal("9000000"),
            paid_usd=Decimal("100.00"),
            paid_lbp=Decimal("9000101"),
            detail="payments exceed invoice total",
        )
    exc = exc_info.value
    assert exc.status_code == 400
    assert "payments exceed invoice total" in str(exc.detail)
