from decimal import Decimal

import pytest
from fastapi import HTTPException

from backend.app.uom import resolve_line_uom


def _ctx():
    return (
        {"item-1": "EA"},
        {"item-1": {"EA": Decimal("1"), "PC": Decimal("0.083333")}},
    )


def test_resolve_line_uom_accepts_legacy_4dp_factor_for_compat():
    base_uom_by_item, factors_by_item = _ctx()
    resolved = resolve_line_uom(
        line_label="sale line",
        item_id="item-1",
        qty_base=Decimal("0.0833"),
        qty_entered=Decimal("1"),
        uom="PC",
        qty_factor=Decimal("0.0833"),
        base_uom_by_item=base_uom_by_item,
        factors_by_item=factors_by_item,
        strict_factor=True,
    )

    # Stored factor is still canonical from item_uom_conversions (6dp).
    assert resolved["uom"] == "PC"
    assert resolved["qty_factor"] == Decimal("0.083333")
    assert resolved["qty"] == Decimal("0.0833")


def test_resolve_line_uom_rejects_real_factor_mismatch():
    base_uom_by_item, factors_by_item = _ctx()
    with pytest.raises(HTTPException) as ex:
        resolve_line_uom(
            line_label="sale line",
            item_id="item-1",
            qty_base=Decimal("0.08"),
            qty_entered=Decimal("1"),
            uom="PC",
            qty_factor=Decimal("0.08"),
            base_uom_by_item=base_uom_by_item,
            factors_by_item=factors_by_item,
            strict_factor=True,
        )

    assert "qty_factor mismatch" in str(ex.value.detail)
