from datetime import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException

from backend.app.routers import pos as pos_router
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


def test_close_shift_uses_cash_method_normalization(monkeypatch):
    captured = {"cash_methods_norm": None}

    class _FakeCursorForClose:
        def __init__(self):
            self._row = None

        def execute(self, sql, params=None):
            text = " ".join(str(sql or "").lower().split())
            if "from pos_shifts" in text and "status = 'open'" in text:
                self._row = {
                    "id": "shift-1",
                    "opened_at": datetime(2026, 1, 1, 8, 0, 0),
                    "opening_cash_usd": Decimal("10"),
                    "opening_cash_lbp": Decimal("100000"),
                }
                return
            if "update pos_shifts" in text and "returning id, status, closed_at" in text:
                self._row = {
                    "id": "shift-1",
                    "status": "closed",
                    "closed_at": datetime(2026, 1, 1, 9, 0, 0),
                    "expected_cash_usd": Decimal("40"),
                    "expected_cash_lbp": Decimal("400000"),
                    "variance_usd": Decimal("0"),
                    "variance_lbp": Decimal("0"),
                }
                return
            raise AssertionError(f"unexpected SQL in test cursor: {text}")

        def fetchone(self):
            return self._row

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class _FakeConnForClose:
        def __init__(self):
            self._cursor = _FakeCursorForClose()

        def cursor(self):
            return self._cursor

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def _fake_expected_cash(
        cur,
        company_id,
        device_id,
        shift_id,
        opened_at,
        opening_cash_usd,
        opening_cash_lbp,
        cash_methods_norm=None,
    ):
        captured["cash_methods_norm"] = list(cash_methods_norm or [])
        return Decimal("40"), Decimal("400000")

    monkeypatch.setattr(pos_router, "get_conn", lambda: _FakeConnForClose())
    monkeypatch.setattr(pos_router, "set_company_context", lambda conn, company_id: None)
    monkeypatch.setattr(pos_router, "_load_cash_methods", lambda cur, company_id: (["Cash"], ["cash"]))
    monkeypatch.setattr(pos_router, "_expected_cash", _fake_expected_cash)

    payload = pos_router.ShiftCloseIn(
        closing_cash_usd=Decimal("40"),
        closing_cash_lbp=Decimal("400000"),
        notes="close shift",
        cashier_id="cashier-1",
    )
    res = pos_router.close_shift(
        "shift-1",
        payload,
        device={"company_id": "company-1", "device_id": "device-1"},
    )

    assert captured["cash_methods_norm"] == ["cash"]
    assert (res.get("shift") or {}).get("status") == "closed"


def test_list_shifts_computes_live_expected_for_open_shifts(monkeypatch):
    captured = {"calls": []}

    class _FakeCursorForListShifts:
        def __init__(self):
            self._rows = []

        def execute(self, sql, params=None):
            text = " ".join(str(sql or "").lower().split())
            if "from payment_method_mappings" in text:
                self._rows = [{"method": "cash"}]
                return
            if "from pos_shifts" in text and "order by opened_at desc" in text:
                self._rows = [
                    {
                        "id": "open-shift",
                        "device_id": "device-1",
                        "status": "open",
                        "opened_at": datetime(2026, 2, 19, 19, 18, 0),
                        "closed_at": None,
                        "opening_cash_usd": Decimal("250"),
                        "opening_cash_lbp": Decimal("0"),
                        "closing_cash_usd": None,
                        "closing_cash_lbp": None,
                        "expected_cash_usd": None,
                        "expected_cash_lbp": None,
                        "variance_usd": None,
                        "variance_lbp": None,
                    },
                    {
                        "id": "closed-shift",
                        "device_id": "device-1",
                        "status": "closed",
                        "opened_at": datetime(2026, 2, 18, 10, 0, 0),
                        "closed_at": datetime(2026, 2, 18, 18, 0, 0),
                        "opening_cash_usd": Decimal("100"),
                        "opening_cash_lbp": Decimal("0"),
                        "closing_cash_usd": Decimal("120"),
                        "closing_cash_lbp": Decimal("0"),
                        "expected_cash_usd": Decimal("120"),
                        "expected_cash_lbp": Decimal("0"),
                        "variance_usd": Decimal("0"),
                        "variance_lbp": Decimal("0"),
                    },
                ]
                return
            raise AssertionError(f"unexpected SQL in test cursor: {text}")

        def fetchall(self):
            return list(self._rows)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class _FakeConnForListShifts:
        def __init__(self):
            self._cursor = _FakeCursorForListShifts()

        def cursor(self):
            return self._cursor

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def _fake_expected_cash(
        cur,
        company_id,
        device_id,
        shift_id,
        opened_at,
        opening_cash_usd,
        opening_cash_lbp,
        cash_methods_norm=None,
    ):
        captured["calls"].append(
            {
                "company_id": company_id,
                "device_id": device_id,
                "shift_id": shift_id,
                "cash_methods_norm": list(cash_methods_norm or []),
            }
        )
        return Decimal("506.1"), Decimal("0")

    monkeypatch.setattr(pos_router, "get_conn", lambda: _FakeConnForListShifts())
    monkeypatch.setattr(pos_router, "set_company_context", lambda conn, company_id: None)
    monkeypatch.setattr(pos_router, "_expected_cash", _fake_expected_cash)

    res = pos_router.list_shifts(company_id="company-1", _auth=None)
    rows = list(res.get("shifts") or [])

    open_shift = next((r for r in rows if r.get("id") == "open-shift"), None)
    closed_shift = next((r for r in rows if r.get("id") == "closed-shift"), None)

    assert open_shift is not None
    assert closed_shift is not None
    assert Decimal(str(open_shift.get("expected_cash_usd"))) == Decimal("506.1")
    assert Decimal(str(closed_shift.get("expected_cash_usd"))) == Decimal("120")
    assert len(captured["calls"]) == 1
    assert captured["calls"][0]["shift_id"] == "open-shift"
    assert captured["calls"][0]["cash_methods_norm"] == ["cash"]
