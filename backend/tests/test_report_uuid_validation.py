import pytest
from fastapi import HTTPException

from backend.app.routers.audit import _parse_uuid_optional as parse_uuid_optional_audit
from backend.app.routers.reports import (
    _parse_company_ids,
    _parse_uuid_optional as parse_uuid_optional_reports,
    _parse_uuid_required as parse_uuid_required_reports,
)


@pytest.mark.parametrize(
    "parser",
    [parse_uuid_optional_reports, parse_uuid_optional_audit],
)
def test_parse_uuid_optional_accepts_blank(parser):
    assert parser(None, "entity_id") is None
    assert parser("", "entity_id") is None
    assert parser("   ", "entity_id") is None


@pytest.mark.parametrize(
    "parser",
    [parse_uuid_optional_reports, parse_uuid_optional_audit],
)
def test_parse_uuid_optional_normalizes_valid_uuid(parser):
    out = parser("A987FBC9-4BED-3078-CF07-9141BA07C9F3", "entity_id")
    assert out == "a987fbc9-4bed-3078-cf07-9141ba07c9f3"


@pytest.mark.parametrize(
    "parser",
    [parse_uuid_optional_reports, parse_uuid_optional_audit],
)
def test_parse_uuid_optional_rejects_invalid_uuid(parser):
    with pytest.raises(HTTPException) as exc_info:
        parser("not-a-uuid", "entity_id")
    exc = exc_info.value
    assert exc.status_code == 400
    assert "entity_id must be a valid UUID" in str(exc.detail)


def test_parse_company_ids_normalizes_and_deduplicates():
    ids = _parse_company_ids(
        "A987FBC9-4BED-3078-CF07-9141BA07C9F3,a987fbc9-4bed-3078-cf07-9141ba07c9f3",
        "11111111-1111-1111-1111-111111111111",
    )
    assert ids == ["a987fbc9-4bed-3078-cf07-9141ba07c9f3"]


def test_parse_company_ids_uses_validated_fallback():
    ids = _parse_company_ids(None, "A987FBC9-4BED-3078-CF07-9141BA07C9F3")
    assert ids == ["a987fbc9-4bed-3078-cf07-9141ba07c9f3"]


def test_parse_company_ids_rejects_invalid_uuid():
    with pytest.raises(HTTPException) as exc_info:
        _parse_company_ids("not-a-uuid", "11111111-1111-1111-1111-111111111111")
    exc = exc_info.value
    assert exc.status_code == 400
    assert "company_ids contains invalid UUID" in str(exc.detail)


def test_parse_uuid_required_reports_accepts_valid_uuid():
    out = parse_uuid_required_reports("A987FBC9-4BED-3078-CF07-9141BA07C9F3", "customer_id")
    assert out == "a987fbc9-4bed-3078-cf07-9141ba07c9f3"


def test_parse_uuid_required_reports_rejects_blank():
    with pytest.raises(HTTPException) as exc_info:
        parse_uuid_required_reports("   ", "customer_id")
    exc = exc_info.value
    assert exc.status_code == 400
    assert "customer_id is required" in str(exc.detail)


def test_parse_uuid_required_reports_rejects_invalid_uuid():
    with pytest.raises(HTTPException) as exc_info:
        parse_uuid_required_reports("bad-value", "supplier_id")
    exc = exc_info.value
    assert exc.status_code == 400
    assert "supplier_id must be a valid UUID" in str(exc.detail)
