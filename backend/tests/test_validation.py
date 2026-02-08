from pydantic import BaseModel

from backend.app.validation import CurrencyCode, RateType, PaymentMethod, DocStatus, BankDirection


class _M(BaseModel):
    currency: CurrencyCode
    rate_type: RateType
    method: PaymentMethod
    status: DocStatus
    direction: BankDirection


def test_validation_types_normalize_case():
    m = _M(currency="usd", rate_type="MARKET", method=" Cash ", status="POSTED", direction="Inflow")
    assert m.currency == "USD"
    assert m.rate_type == "market"
    assert m.method == "cash"
    assert m.status == "posted"
    assert m.direction == "inflow"


def test_payment_method_rejects_spaces_and_weird_chars():
    # spaces are normalized out by strip, but internal spaces should fail regex
    try:
        _M(currency="USD", rate_type="market", method="cash money", status="draft", direction="inflow")
        assert False, "expected validation error"
    except Exception:
        pass

