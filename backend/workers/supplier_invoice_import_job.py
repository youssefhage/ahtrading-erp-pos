from __future__ import annotations

import json
import sys
import traceback
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row

try:
    from .pos_processor import set_company_context
except ImportError:  # pragma: no cover
    from pos_processor import set_company_context

from backend.app.importers.supplier_invoice_import import (
    apply_extracted_purchase_invoice_header_to_draft,
    apply_extracted_purchase_invoice_to_draft,
    build_supplier_invoice_import_review_lines,
    extract_purchase_invoice_best_effort,
)


def _json_log(level: str, event: str, **fields):
    rec = {"level": level, "event": event, **fields}
    print(json.dumps(rec, default=str), file=sys.stderr)

def _set_company_context_session(cur, company_id: str):
    """
    Important for this job: we run with `conn.autocommit = True` to avoid holding long transactions
    during external AI calls. `set_company_context()` uses `set_config(..., is_local=true)`, which
    only persists for the current transaction. With autocommit enabled, each statement is its own
    transaction, so the RLS context would be lost between statements.

    Use a session-level setting for this job only.
    """
    cur.execute("SELECT set_config('app.current_company_id', %s::text, false)", (company_id,))


def run_supplier_invoice_import_job(db_url: str, company_id: str, limit: int = 2) -> dict[str, Any]:
    """
    Worker job: fill supplier invoice drafts that were created by the upload endpoint.

    The API endpoint queues by setting:
      supplier_invoices.import_status = 'pending'
      supplier_invoices.import_attachment_id = <attachment uuid>
      supplier_invoices.import_options_json = {auto_create_supplier, auto_create_items, ...}
    """
    limit = int(limit or 0)
    if limit <= 0:
        limit = 1
    limit = min(limit, 10)

    filled = 0
    skipped = 0
    failed = 0

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        # Avoid holding long-running transactions during external AI calls.
        conn.autocommit = True

        for _ in range(limit):
            invoice_row = None
            with conn.transaction():
                with conn.cursor() as cur:
                    _set_company_context_session(cur, company_id)
                    cur.execute(
                        """
                        SELECT id, exchange_rate, tax_code_id, import_attachment_id, import_options_json
                        FROM supplier_invoices
                        WHERE company_id=%s
                          AND status='draft'
                          AND import_status='pending'
                        ORDER BY created_at ASC
                        FOR UPDATE SKIP LOCKED
                        LIMIT 1
                        """,
                        (company_id,),
                    )
                    invoice_row = cur.fetchone()
                    if not invoice_row:
                        break
                    cur.execute(
                        """
                        UPDATE supplier_invoices
                        SET import_status='processing', import_started_at=now(), import_error=NULL
                        WHERE company_id=%s AND id=%s
                        """,
                        (company_id, invoice_row["id"]),
                    )

            invoice_id = str(invoice_row["id"])
            attachment_id = str(invoice_row.get("import_attachment_id") or "")
            options = invoice_row.get("import_options_json") or {}
            if isinstance(options, str):
                try:
                    options = json.loads(options)
                except Exception:
                    options = {}
            auto_create_supplier = bool(options.get("auto_create_supplier", True))
            auto_create_items = bool(options.get("auto_create_items", True))
            auto_apply = bool(options.get("auto_apply", False))
            mock_extract = bool(options.get("mock_extract", False))

            warnings: list[str] = []
            try:
                with conn.cursor() as cur:
                    _set_company_context_session(cur, company_id)
                    cur.execute(
                        """
                        SELECT filename, content_type, bytes
                        FROM document_attachments
                        WHERE company_id=%s AND id=%s
                        """,
                        (company_id, attachment_id),
                    )
                    att = cur.fetchone()
                    if not att:
                        raise RuntimeError("import attachment not found")
                    filename = (att.get("filename") or "purchase-invoice").strip() or "purchase-invoice"
                    content_type = (att.get("content_type") or "application/octet-stream").strip() or "application/octet-stream"
                    raw = att.get("bytes") or b""

                    extracted = extract_purchase_invoice_best_effort(
                        raw=raw,
                        content_type=content_type,
                        filename=filename,
                        company_id=company_id,
                        cur=cur,
                        warnings=warnings,
                        force_mock=mock_extract,
                    )

                with conn.transaction():
                    with conn.cursor() as cur2:
                        _set_company_context_session(cur2, company_id)
                        if not extracted:
                            cur2.execute(
                                """
                                UPDATE supplier_invoices
                                SET import_status='skipped', import_finished_at=now(), import_error=%s
                                WHERE company_id=%s AND id=%s
                                """,
                                ("\n".join(warnings[:10]) if warnings else None, company_id, invoice_id),
                            )
                            cur2.execute(
                                """
                                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                                VALUES (gen_random_uuid(), %s, NULL, 'supplier_invoice_import_skipped', 'supplier_invoice', %s, %s::jsonb)
                                """,
                                (company_id, invoice_id, json.dumps({"warnings": warnings[:50]})),
                            )
                            skipped += 1
                            continue

                        # Default behavior: prepare review lines and require a human to map/confirm items.
                        # Optionally, callers can request `auto_apply=true` to preserve the legacy behavior.
                        if auto_apply:
                            apply_extracted_purchase_invoice_to_draft(
                                company_id=company_id,
                                invoice_id=invoice_id,
                                extracted=extracted,
                                exchange_rate_hint=Decimal(str(invoice_row.get("exchange_rate") or 0)),
                                tax_code_id_hint=invoice_row.get("tax_code_id"),
                                auto_create_supplier=auto_create_supplier,
                                auto_create_items=auto_create_items,
                                cur=cur2,
                                warnings=warnings,
                                user_id=None,
                            )
                            cur2.execute(
                                """
                                UPDATE supplier_invoices
                                SET import_status='filled', import_finished_at=now(), import_error=NULL
                                WHERE company_id=%s AND id=%s
                                """,
                                (company_id, invoice_id),
                            )
                            filled += 1
                            continue

                        # Header + review lines.
                        hdr = apply_extracted_purchase_invoice_header_to_draft(
                            company_id=company_id,
                            invoice_id=invoice_id,
                            extracted=extracted,
                            exchange_rate_hint=Decimal(str(invoice_row.get("exchange_rate") or 0)),
                            tax_code_id_hint=invoice_row.get("tax_code_id"),
                            auto_create_supplier=auto_create_supplier,
                            cur=cur2,
                            warnings=warnings,
                            user_id=None,
                        )
                        supplier_id = hdr.get("supplier_id")
                        review_lines = build_supplier_invoice_import_review_lines(
                            company_id=company_id,
                            supplier_id=str(supplier_id) if supplier_id else None,
                            extracted=extracted,
                            exchange_rate_hint=Decimal(str(invoice_row.get("exchange_rate") or 0)),
                            cur=cur2,
                            warnings=warnings,
                        )

                        # Replace any prior import review lines.
                        cur2.execute(
                            "DELETE FROM supplier_invoice_import_lines WHERE company_id=%s AND supplier_invoice_id=%s",
                            (company_id, invoice_id),
                        )
                        for ln in review_lines:
                            cur2.execute(
                                """
                                INSERT INTO supplier_invoice_import_lines
                                  (company_id, supplier_invoice_id, line_no, qty, unit_cost_usd, unit_cost_lbp,
                                   supplier_item_code, supplier_item_name, description,
                                   suggested_item_id, suggested_confidence, resolved_item_id, status, raw_json)
                                VALUES
                                  (%s, %s, %s, %s, %s, %s,
                                   %s, %s, %s,
                                   %s, %s, %s, %s, %s::jsonb)
                                """,
                                (
                                    company_id,
                                    invoice_id,
                                    int(ln["line_no"]),
                                    ln["qty"],
                                    ln["unit_cost_usd"],
                                    ln["unit_cost_lbp"],
                                    ln.get("supplier_item_code"),
                                    ln.get("supplier_item_name"),
                                    ln.get("description"),
                                    ln.get("suggested_item_id"),
                                    ln.get("suggested_confidence") or 0,
                                    None,
                                    "pending",
                                    json.dumps(ln.get("raw_json") or {}),
                                ),
                            )

                        cur2.execute(
                            """
                            UPDATE supplier_invoices
                            SET import_status='pending_review',
                                import_finished_at=now(),
                                import_error=%s
                            WHERE company_id=%s AND id=%s
                            """,
                            ("\n".join(warnings[:10]) if warnings else None, company_id, invoice_id),
                        )
                        cur2.execute(
                            """
                            INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                            VALUES (gen_random_uuid(), %s, NULL, 'supplier_invoice_import_ready_for_review', 'supplier_invoice', %s, %s::jsonb)
                            """,
                            (company_id, invoice_id, json.dumps({"lines": len(review_lines), "warnings": warnings[:50]})),
                        )
                        filled += 1
            except Exception as ex:
                _json_log("error", "supplier_invoice_import.failed", company_id=company_id, invoice_id=invoice_id, error=str(ex))
                traceback.print_exc(file=sys.stderr)
                try:
                    with conn.transaction():
                        with conn.cursor() as cur3:
                            _set_company_context_session(cur3, company_id)
                            cur3.execute(
                                """
                                UPDATE supplier_invoices
                                SET import_status='failed', import_finished_at=now(), import_error=%s
                                WHERE company_id=%s AND id=%s
                                """,
                                (str(ex)[:1000], company_id, invoice_id),
                            )
                            cur3.execute(
                                """
                                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                                VALUES (gen_random_uuid(), %s, NULL, 'supplier_invoice_import_failed', 'supplier_invoice', %s, %s::jsonb)
                                """,
                                (company_id, invoice_id, json.dumps({"error": str(ex), "warnings": warnings[:50]})),
                            )
                except Exception:
                    # Never crash the worker loop due to import status update errors.
                    traceback.print_exc(file=sys.stderr)
                failed += 1

    return {"ok": True, "filled": filled, "skipped": skipped, "failed": failed}
