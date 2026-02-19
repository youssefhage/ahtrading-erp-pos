import re
from pathlib import Path

from backend.app.routers.sales import _normalize_sales_invoice_channel


def test_normalize_sales_invoice_channel_accepts_supported_values():
    assert _normalize_sales_invoice_channel("pos") == "pos"
    assert _normalize_sales_invoice_channel("ADMIN") == "admin"
    assert _normalize_sales_invoice_channel(" import ") == "import"
    assert _normalize_sales_invoice_channel("Api") == "api"


def test_normalize_sales_invoice_channel_rejects_invalid_or_empty_values():
    assert _normalize_sales_invoice_channel("") is None
    assert _normalize_sales_invoice_channel("   ") is None
    assert _normalize_sales_invoice_channel(None) is None
    assert _normalize_sales_invoice_channel("manual") is None
    assert _normalize_sales_invoice_channel("pos-terminal") is None


def test_sales_invoice_inserts_explicitly_include_sales_channel():
    repo_root = Path(__file__).resolve().parents[2]
    files = [
        repo_root / "backend/app/routers/sales.py",
        repo_root / "backend/app/routers/edge_sync.py",
        repo_root / "backend/app/routers/accounting.py",
        repo_root / "backend/workers/pos_processor.py",
    ]

    insert_columns = re.compile(
        r"INSERT\s+INTO\s+sales_invoices\s*\((.*?)\)\s*VALUES",
        re.IGNORECASE | re.DOTALL,
    )

    for file_path in files:
        text = file_path.read_text(encoding="utf-8")
        matches = insert_columns.findall(text)
        assert matches, f"expected INSERT INTO sales_invoices in {file_path}"
        for raw_columns in matches:
            columns = {part.strip().strip('"').lower() for part in raw_columns.split(",")}
            assert "sales_channel" in columns, f"missing sales_channel in INSERT columns for {file_path}"
