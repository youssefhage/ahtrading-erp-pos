from decimal import Decimal

import pytest
from fastapi import HTTPException

from backend.app.routers.pos import _assert_non_negative_shift_cash, _expected_cash


class _FakeCursor:
    def __init__(
        self,
        cash_methods=None,
        sales_row=None,
        refunds_row=None,
        movements_row=None,
    ):
        self.cash_methods = list(cash_methods or [])
        self.sales_row = dict(sales_row or {"usd": 0, "lbp": 0})
        self.refunds_row = dict(refunds_row or {"usd": 0, "lbp": 0})
        self.movements_row = dict(movements_row or {"usd": 0, "lbp": 0})
        self.rows = []
        self.sales_query_count = 0
        self.refunds_query_count = 0
        self.movements_query_count = 0

    def execute(self, sql, params=None):
        text = " ".join(str(sql or "").lower().split())
        if "from payment_method_mappings" in text:
            self.rows = [{"method": m} for m in self.cash_methods]
            return
        if "from sales_payments" in text:
            self.sales_query_count += 1
            self.rows = [self.sales_row]
            return
        if "from sales_refunds" in text:
            self.refunds_query_count += 1
            self.rows = [self.refunds_row]
            return
        if "from pos_cash_movements" in text:
            self.movements_query_count += 1
            self.rows = [self.movements_row]
            return
        raise AssertionError(f"unexpected SQL in test cursor: {text}")

    def fetchall(self):
        return list(self.rows)

    def fetchone(self):
        if not self.rows:
            return None
        return self.rows[0]


def test_expected_cash_applies_sales_refunds_and_movements_for_cash_methods():
    cur = _FakeCursor(
        cash_methods=[" Cash ", "CASH"],
        sales_row={"usd": Decimal("50"), "lbp": Decimal("500000")},
        refunds_row={"usd": Decimal("10"), "lbp": Decimal("100000")},
        movements_row={"usd": Decimal("5"), "lbp": Decimal("20000")},
    )
    expected_usd, expected_lbp = _expected_cash(
        cur=cur,
        company_id="company-1",
        device_id="device-1",
        shift_id="shift-1",
        opened_at=None,
        opening_cash_usd=Decimal("100"),
        opening_cash_lbp=Decimal("100000"),
    )

    assert expected_usd == Decimal("145")
    assert expected_lbp == Decimal("520000")
    assert cur.sales_query_count == 1
    assert cur.refunds_query_count == 1
    assert cur.movements_query_count == 1


def test_expected_cash_skips_sales_and_refunds_when_no_cash_mapping():
    cur = _FakeCursor(
        cash_methods=[],
        sales_row={"usd": Decimal("999"), "lbp": Decimal("999")},
        refunds_row={"usd": Decimal("888"), "lbp": Decimal("888")},
        movements_row={"usd": Decimal("7"), "lbp": Decimal("120000")},
    )
    expected_usd, expected_lbp = _expected_cash(
        cur=cur,
        company_id="company-1",
        device_id="device-1",
        shift_id="shift-1",
        opened_at=None,
        opening_cash_usd=Decimal("10"),
        opening_cash_lbp=Decimal("5000"),
    )

    assert expected_usd == Decimal("17")
    assert expected_lbp == Decimal("125000")
    assert cur.sales_query_count == 0
    assert cur.refunds_query_count == 0
    assert cur.movements_query_count == 1


def test_assert_non_negative_shift_cash_rejects_negative_values():
    with pytest.raises(HTTPException) as ex:
        _assert_non_negative_shift_cash(Decimal("-0.01"), Decimal("0"), "opening")
    assert ex.value.status_code == 400
    assert "opening cash must be >= 0" in str(ex.value.detail)

