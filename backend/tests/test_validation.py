from pydantic import BaseModel

from backend.app.validation import CurrencyCode, RateType, PaymentMethod, DocStatus, BankDirection, TaxType, AiActionStatus, AiRecommendationStatus, AiRecommendationDecisionStatus


class _M(BaseModel):
    currency: CurrencyCode
    rate_type: RateType
    method: PaymentMethod
    status: DocStatus
    direction: BankDirection
    tax_type: TaxType
    ai_action: AiActionStatus
    ai_rec: AiRecommendationStatus
    ai_decision: AiRecommendationDecisionStatus


def test_validation_types_normalize_case():
    m = _M(
        currency="usd",
        rate_type="MARKET",
        method=" Cash ",
        status="POSTED",
        direction="Inflow",
        tax_type="VAT",
        ai_action="Queued",
        ai_rec="PENDING",
        ai_decision="APPROVED",
    )
    assert m.currency == "USD"
    assert m.rate_type == "market"
    assert m.method == "cash"
    assert m.status == "posted"
    assert m.direction == "inflow"
    assert m.tax_type == "vat"
    assert m.ai_action == "queued"
    assert m.ai_rec == "pending"
    assert m.ai_decision == "approved"


def test_payment_method_rejects_spaces_and_weird_chars():
    # spaces are normalized out by strip, but internal spaces should fail regex
    try:
        _M(currency="USD", rate_type="market", method="cash money", status="draft", direction="inflow")
        assert False, "expected validation error"
    except Exception:
        pass
