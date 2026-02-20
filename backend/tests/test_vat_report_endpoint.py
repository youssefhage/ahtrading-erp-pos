from datetime import date
from decimal import Decimal

from fastapi import Response

from backend.app.routers import reports as reports_router


class _DummyCursor:
    def __init__(self, rows):
        self._rows = rows
        self.executed: list[tuple[str, tuple]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params):
        self.executed.append((sql, tuple(params)))

    def fetchall(self):
        return self._rows


class _DummyConn:
    def __init__(self, cursor: _DummyCursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return self._cursor


def _patch_db(monkeypatch, rows):
    cur = _DummyCursor(rows)
    conn = _DummyConn(cur)
    monkeypatch.setattr(reports_router, "get_conn", lambda: conn)
    monkeypatch.setattr(reports_router, "set_company_context", lambda *_args, **_kwargs: None)
    return cur


def test_vat_report_json_contract(monkeypatch):
    cur = _patch_db(
        monkeypatch,
        [
            {
                "tax_code_id": "11111111-1111-1111-1111-111111111111",
                "tax_name": "VAT 11%",
                "period": date(2026, 1, 1),
                "direction": "output",
                "source_types": ["sales_invoice"],
                "line_count": 2,
                "base_lbp": Decimal("100.00"),
                "tax_lbp": Decimal("11.00"),
            },
            {
                "tax_code_id": "11111111-1111-1111-1111-111111111111",
                "tax_name": "VAT 11%",
                "period": date(2026, 1, 1),
                "direction": "input",
                "source_types": ["supplier_invoice"],
                "line_count": 1,
                "base_lbp": Decimal("50.00"),
                "tax_lbp": Decimal("5.50"),
            },
            {
                "tax_code_id": "22222222-2222-2222-2222-222222222222",
                "tax_name": "Unknown VAT",
                "period": date(2026, 1, 1),
                "direction": "other",
                "source_types": ["inventory_adjustment"],
                "line_count": 1,
                "base_lbp": Decimal("10.00"),
                "tax_lbp": Decimal("1.00"),
            },
        ],
    )

    out = reports_router.vat_report(
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 31),
        company_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    )

    assert out["start_date"] == "2026-01-01"
    assert out["end_date"] == "2026-01-31"
    assert out["period"] is None
    assert out["summary"]["output_tax_lbp"] == Decimal("11.00")
    assert out["summary"]["input_tax_lbp"] == Decimal("5.50")
    assert out["summary"]["net_tax_lbp"] == Decimal("5.50")
    assert out["summary"]["other_tax_lbp"] == Decimal("1.00")
    assert out["summary"]["rows_count"] == 3
    assert out["vat"][0]["direction_label"] == "Output VAT"
    assert out["vat"][1]["direction_label"] == "Input VAT"
    assert out["vat"][2]["direction_label"] == "Other"

    assert cur.executed, "expected VAT query to be executed"
    _, params = cur.executed[0]
    assert params[0] == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    assert params[1] == date(2026, 1, 1)
    assert params[3] == date(2026, 1, 31)


def test_vat_report_open_ended_start_date(monkeypatch):
    cur = _patch_db(monkeypatch, [])

    out = reports_router.vat_report(
        start_date=date(2026, 1, 1),
        end_date=None,
        company_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    )

    assert out["start_date"] == "2026-01-01"
    assert out["end_date"] is None
    _, params = cur.executed[0]
    assert params[1] == date(2026, 1, 1)
    assert params[2] == date(2026, 1, 1)
    assert params[3] is None
    assert params[4] is None


def test_vat_report_csv_contract(monkeypatch):
    _patch_db(
        monkeypatch,
        [
            {
                "tax_code_id": "11111111-1111-1111-1111-111111111111",
                "tax_name": "VAT 11%",
                "period": date(2026, 1, 1),
                "direction": "output",
                "source_types": ["sales_invoice", "sales_return"],
                "line_count": 3,
                "base_lbp": Decimal("100.00"),
                "tax_lbp": Decimal("11.00"),
            }
        ],
    )

    out = reports_router.vat_report(
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 31),
        format="csv",
        company_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    )

    assert isinstance(out, Response)
    assert out.media_type == "text/csv"
    text = out.body.decode("utf-8")
    assert "direction,direction_label,base_lbp,tax_lbp,line_count,source_types" in text
    assert "Output VAT" in text
    assert "sales_invoice,sales_return" in text
