from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BeforeValidator, StringConstraints


def _to_upper_str(v):
    if v is None:
        return v
    return str(v).strip().upper()


def _to_lower_str(v):
    if v is None:
        return v
    return str(v).strip().lower()


# Canonical codes mirror Postgres enums in `backend/db/migrations/001_init.sql`.
CurrencyCode = Annotated[Literal["USD", "LBP"], BeforeValidator(_to_upper_str)]
RateType = Annotated[Literal["official", "market", "internal"], BeforeValidator(_to_lower_str)]
DocStatus = Annotated[Literal["draft", "posted", "canceled"], BeforeValidator(_to_lower_str)]


# Payment methods are company-configurable via `payment_method_mappings`.
# Keep a tight, safe character set so methods are stable identifiers.
PaymentMethod = Annotated[
    str,
    BeforeValidator(_to_lower_str),
    StringConstraints(min_length=1, max_length=32, pattern=r"^[a-z0-9][a-z0-9_-]*$"),
]


BankDirection = Annotated[Literal["inflow", "outflow"], BeforeValidator(_to_lower_str)]

