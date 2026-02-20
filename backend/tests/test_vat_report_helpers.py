import pytest
from fastapi import HTTPException
from datetime import date

from backend.app.routers.reports import _resolve_vat_range, _vat_direction_from_source_type


def test_vat_direction_from_source_type_output_variants():
    assert _vat_direction_from_source_type("sales_invoice") == "output"
    assert _vat_direction_from_source_type("sales_return") == "output"
    assert _vat_direction_from_source_type("sales_custom_flow") == "output"
    assert _vat_direction_from_source_type("output") == "output"


def test_vat_direction_from_source_type_input_variants():
    assert _vat_direction_from_source_type("supplier_invoice") == "input"
    assert _vat_direction_from_source_type("supplier_invoice_cancel") == "input"
    assert _vat_direction_from_source_type("supplier_credit_x") == "input"
    assert _vat_direction_from_source_type("input") == "input"


def test_vat_direction_from_source_type_other():
    assert _vat_direction_from_source_type(None) == "other"
    assert _vat_direction_from_source_type("") == "other"
    assert _vat_direction_from_source_type("inventory_adjustment") == "other"
    assert _vat_direction_from_source_type("other") == "other"


def test_resolve_vat_range_with_period_wins():
    period, start_date, end_date = _resolve_vat_range(period=date(2026, 2, 20), start_date=None, end_date=None)
    assert str(period) == "2026-02-01"
    assert str(start_date) == "2026-02-01"
    assert str(end_date) == "2026-02-28"


def test_resolve_vat_range_supports_open_ended_ranges():
    period, start_date, end_date = _resolve_vat_range(period=None, start_date=date(2026, 2, 7), end_date=None)
    assert period is None
    assert str(start_date) == "2026-02-07"
    assert end_date is None

    period, start_date, end_date = _resolve_vat_range(period=None, start_date=None, end_date=date(2026, 2, 9))
    assert period is None
    assert start_date is None
    assert str(end_date) == "2026-02-09"


def test_resolve_vat_range_rejects_invalid_range():
    with pytest.raises(HTTPException) as exc_info:
        _resolve_vat_range(period=None, start_date=date(2026, 2, 20), end_date=date(2026, 2, 1))
    exc = exc_info.value
    assert exc.status_code == 400
    assert "end_date cannot be before start_date" in str(exc.detail)
