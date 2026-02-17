import pytest

pytest.importorskip("psycopg")

from backend.app.routers.ai import _recommendation_view


def _row(agent_code: str, recommendation_json):
    return {"agent_code": agent_code, "recommendation_json": recommendation_json}


def test_data_hygiene_view_has_item_context_and_details():
    view = _recommendation_view(
        _row(
            "AI_DATA_HYGIENE",
            {
                "kind": "data_hygiene",
                "item_id": "item-1",
                "name": "Sample Item",
                "issues": [
                    {"severity": "high", "message": "Item has no barcode."},
                    {"severity": "med", "message": "Item has no supplier mapping."},
                ],
            },
        )
    )
    assert view["title"] == "Item master-data issues"
    assert view["severity"] == "high"
    assert view["link_href"] == "/catalog/items/item-1"
    assert len(view["details"]) == 2


def test_ap_guard_due_soon_view_has_invoice_link():
    view = _recommendation_view(
        _row(
            "AI_AP_GUARD",
            {
                "kind": "supplier_invoice_due_soon",
                "invoice_id": "inv-99",
                "invoice_no": "SI-99",
                "due_date": "2026-02-20",
                "outstanding_usd": "120.50",
            },
        )
    )
    assert view["title"] == "Supplier invoice due soon"
    assert "SI-99" in view["summary"]
    assert view["link_href"] == "/purchasing/supplier-invoices/inv-99"


def test_pos_outbox_failure_links_to_pos_devices():
    view = _recommendation_view(
        _row(
            "AI_ANOMALY",
            {
                "type": "pos_outbox_failure",
                "outbox_id": "outbox-1",
                "device_code": "POS-1",
                "event_type": "sale.posted",
                "attempt_count": 3,
            },
        )
    )
    assert view["title"] == "POS sync failure"
    assert view["severity"] == "high"
    assert view["link_href"] == "/system/pos-devices"


def test_unknown_payload_falls_back_to_generic_view():
    view = _recommendation_view(_row("AI_CORE", {"event_type": "stock.adjusted"}))
    assert view["title"]
    assert view["summary"]
    assert view["next_step"]
