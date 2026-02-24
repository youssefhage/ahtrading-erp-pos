#!/usr/bin/env python3.11
from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row

import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.importers.supplier_invoice_import import (  # noqa: E402
    apply_extracted_purchase_invoice_header_to_draft,
    build_supplier_invoice_import_review_lines,
    extract_purchase_invoice_best_effort_from_files,
)

EXACT_REASONS = {"alias_code_exact", "alias_name_exact", "sku_exact", "barcode_exact"}
ITEM_LINE_TYPES = {"item", "free_item"}
NON_ITEM_LINE_TYPES = {"discount", "tax", "freight", "other"}


@dataclass
class QueueRow:
    invoice_id: str
    invoice_no: str
    supplier_name: str
    supplier_ref: str
    attachments: int
    doc_type: str
    doc_conf: str
    item_lines: int
    pending_item: int
    low_conf_item: int
    avg_item_conf: str
    risk_score: int
    priority: str
    recommendation: str
    warnings: str


def _d(v: Any, default: str = "0") -> Decimal:
    try:
        return Decimal(str(v if v is not None else default))
    except Exception:
        return Decimal(default)


def _parse_doc_meta(extracted: dict[str, Any]) -> tuple[str, Decimal]:
    dt = str((extracted or {}).get("document_type") or "").strip().lower()
    conf = _d((extracted or {}).get("document_confidence"), "0")
    if conf < 0:
        conf = Decimal("0")
    if conf > 1:
        conf = Decimal("1")
    return dt or "unknown", conf


def _invoice_files(cur, company_id: str, invoice_id: str, packet_ids: list[str], warnings: list[str]) -> tuple[list[dict[str, Any]], int, int]:
    file_entries: list[dict[str, Any]] = []
    loaded: set[str] = set()
    missing = 0
    for aid in packet_ids:
        cur.execute(
            """
            SELECT id, filename, content_type, bytes
            FROM document_attachments
            WHERE company_id=%s AND id=%s
            """,
            (company_id, aid),
        )
        att = cur.fetchone()
        if not att:
            missing += 1
            warnings.append(f"missing attachment id: {aid}")
            continue
        raw = att.get("bytes") or b""
        if not raw:
            warnings.append(f"empty attachment id: {aid}")
            continue
        file_entries.append(
            {
                "raw": raw,
                "content_type": (att.get("content_type") or "application/octet-stream").strip() or "application/octet-stream",
                "filename": (att.get("filename") or "purchase-invoice").strip() or "purchase-invoice",
            }
        )
        loaded.add(str(att.get("id")))

    # Fallback to all invoice attachments when packet ids are stale/incomplete.
    if len(loaded) < max(1, len(packet_ids)):
        cur.execute(
            """
            SELECT id, filename, content_type, bytes
            FROM document_attachments
            WHERE company_id=%s AND entity_type='supplier_invoice' AND entity_id=%s
            ORDER BY id
            """,
            (company_id, invoice_id),
        )
        for att in (cur.fetchall() or []):
            aid = str(att.get("id") or "").strip()
            if not aid or aid in loaded:
                continue
            raw = att.get("bytes") or b""
            if not raw:
                continue
            file_entries.append(
                {
                    "raw": raw,
                    "content_type": (att.get("content_type") or "application/octet-stream").strip() or "application/octet-stream",
                    "filename": (att.get("filename") or "purchase-invoice").strip() or "purchase-invoice",
                }
            )
            loaded.add(aid)
        warnings.append("used attachment fallback")
    return file_entries, len(loaded), missing


def _compute_risk(
    *,
    doc_type: str,
    doc_conf: Decimal,
    missing_attachments: int,
    pending_item: int,
    low_conf_item: int,
    medium_conf_item: int,
    pending_non_item: int,
) -> tuple[int, str, str]:
    risk = 0
    if doc_type not in {"purchase_invoice", "supplier_invoice", "invoice"}:
        risk += 50
    if doc_type in {"purchase_invoice", "supplier_invoice", "invoice"} and doc_conf < Decimal("0.80"):
        risk += 20
    risk += missing_attachments * 40
    risk += pending_item * 25
    risk += low_conf_item * 20
    risk += medium_conf_item * 8
    risk += pending_non_item * 5

    if risk >= 90:
        return risk, "P0", "Full review required"
    if risk >= 45:
        return risk, "P1", "Review core fields before apply"
    return risk, "P2", "Quick review then apply"


def main() -> int:
    ap = argparse.ArgumentParser(description="Reprocess AP draft imports with AI and produce prioritized review queue.")
    ap.add_argument("--db-url", default="postgresql://ahtrading:ahtrading@localhost:5433/ahtrading")
    ap.add_argument("--company-id", default="00000000-0000-0000-0000-000000000001")
    ap.add_argument(
        "--statuses",
        default="pending_review,pending,processing",
        help="Comma-separated import statuses to reprocess.",
    )
    ap.add_argument("--limit", type=int, default=0, help="Max invoices to process (0 = all)")
    ap.add_argument(
        "--out-dir",
        default=".cache/ap_import_review_queue",
        help="Where to write queue files.",
    )
    ap.add_argument("--auto-accept-exact", action="store_true", help="Auto-resolve exact alias/sku/barcode matches.")
    args = ap.parse_args()

    statuses = [s.strip().lower() for s in str(args.statuses or "").split(",") if s.strip()]
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    queue_csv = out_dir / "review_queue.csv"
    summary_json = out_dir / "summary.json"

    rows: list[QueueRow] = []
    stats: dict[str, int] = {
        "processed": 0,
        "failed": 0,
        "total_item_lines": 0,
        "total_pending_item_lines": 0,
        "total_low_conf_item_lines": 0,
    }

    with psycopg.connect(args.db_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_company_id', %s::text, false)", (args.company_id,))
            cur.execute(
                """
                SELECT i.id, i.invoice_no, i.supplier_ref, i.supplier_id, s.name AS supplier_name,
                       i.exchange_rate, i.tax_code_id, i.import_status, i.import_attachment_id, i.import_options_json
                FROM supplier_invoices i
                LEFT JOIN suppliers s ON s.company_id=i.company_id AND s.id=i.supplier_id
                WHERE i.company_id=%s
                  AND i.status='draft'
                  AND lower(coalesce(i.import_status,'none')) = ANY(%s)
                ORDER BY i.created_at ASC
                """,
                (args.company_id, statuses),
            )
            invoices = cur.fetchall() or []

        if args.limit and args.limit > 0:
            invoices = invoices[: args.limit]

        for inv in invoices:
            warnings: list[str] = []
            invoice_id = str(inv["id"])
            try:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute("SELECT set_config('app.current_company_id', %s::text, false)", (args.company_id,))
                        opts = inv.get("import_options_json") or {}
                        if isinstance(opts, str):
                            try:
                                opts = json.loads(opts)
                            except Exception:
                                opts = {}
                        packet_ids = [str(x).strip() for x in (opts.get("import_attachment_ids") or []) if str(x).strip()]
                        if not packet_ids and inv.get("import_attachment_id"):
                            packet_ids = [str(inv["import_attachment_id"])]

                        files, attachment_count, missing_attachments = _invoice_files(
                            cur, args.company_id, invoice_id, packet_ids, warnings
                        )
                        if not files:
                            raise RuntimeError("no attachments available for extraction")

                        extracted = extract_purchase_invoice_best_effort_from_files(
                            files=files,
                            company_id=args.company_id,
                            cur=cur,
                            warnings=warnings,
                            force_mock=False,
                        )
                        if not extracted:
                            raise RuntimeError("AI extraction returned no payload")
                        doc_type, doc_conf = _parse_doc_meta(extracted)

                        hdr = apply_extracted_purchase_invoice_header_to_draft(
                            company_id=args.company_id,
                            invoice_id=invoice_id,
                            extracted=extracted,
                            exchange_rate_hint=_d(inv.get("exchange_rate"), "0"),
                            tax_code_id_hint=inv.get("tax_code_id"),
                            auto_create_supplier=False,
                            cur=cur,
                            warnings=warnings,
                            user_id=None,
                        )
                        supplier_id = str(hdr.get("supplier_id") or "").strip() or None
                        review_lines = build_supplier_invoice_import_review_lines(
                            company_id=args.company_id,
                            supplier_id=supplier_id,
                            extracted=extracted,
                            exchange_rate_hint=_d(inv.get("exchange_rate"), "0"),
                            cur=cur,
                            warnings=warnings,
                        )

                        cur.execute(
                            "DELETE FROM supplier_invoice_import_lines WHERE company_id=%s AND supplier_invoice_id=%s",
                            (args.company_id, invoice_id),
                        )

                        for ln in review_lines:
                            line_type = str(ln.get("line_type") or "item").strip().lower()
                            auto_resolve = bool(ln.get("auto_resolve")) and bool(ln.get("suggested_item_id"))
                            explicit_status = str(ln.get("status") or "").strip().lower()
                            if explicit_status in {"pending", "resolved", "skipped"}:
                                default_status = explicit_status
                            elif auto_resolve:
                                default_status = "resolved"
                            else:
                                default_status = "pending"
                            cur.execute(
                                """
                                INSERT INTO supplier_invoice_import_lines
                                  (company_id, supplier_invoice_id, line_no, qty, unit_cost_usd, unit_cost_lbp,
                                   line_type, entered_uom_code, entered_qty_factor, qty_entered,
                                   unit_cost_entered_usd, unit_cost_entered_lbp,
                                   supplier_item_code, supplier_item_name, description,
                                   suggested_item_id, suggested_confidence, suggested_match_reason,
                                   resolved_item_id, status, raw_json)
                                VALUES
                                  (%s, %s, %s, %s, %s, %s,
                                   %s, %s, %s, %s,
                                   %s, %s,
                                   %s, %s, %s,
                                   %s, %s, %s,
                                   %s, %s, %s::jsonb)
                                """,
                                (
                                    args.company_id,
                                    invoice_id,
                                    int(ln["line_no"]),
                                    ln["qty"],
                                    ln["unit_cost_usd"],
                                    ln["unit_cost_lbp"],
                                    line_type,
                                    ln.get("entered_uom_code"),
                                    ln.get("entered_qty_factor") or 1,
                                    ln.get("qty_entered") or ln["qty"],
                                    ln.get("unit_cost_entered_usd") or ln["unit_cost_usd"],
                                    ln.get("unit_cost_entered_lbp") or ln["unit_cost_lbp"],
                                    ln.get("supplier_item_code"),
                                    ln.get("supplier_item_name"),
                                    ln.get("description"),
                                    ln.get("suggested_item_id"),
                                    ln.get("suggested_confidence") or 0,
                                    ln.get("suggested_match_reason"),
                                    ln.get("suggested_item_id") if auto_resolve else None,
                                    default_status,
                                    json.dumps(ln.get("raw_json") or {}),
                                ),
                            )

                        if args.auto_accept_exact:
                            cur.execute(
                                """
                                UPDATE supplier_invoice_import_lines
                                SET resolved_item_id=COALESCE(resolved_item_id, suggested_item_id),
                                    status='resolved',
                                    updated_at=now()
                                WHERE company_id=%s
                                  AND supplier_invoice_id=%s
                                  AND status='pending'
                                  AND line_type IN ('item', 'free_item')
                                  AND suggested_item_id IS NOT NULL
                                  AND split_part(COALESCE(suggested_match_reason, ''), ':', 1) = ANY(%s)
                                """,
                                (args.company_id, invoice_id, list(EXACT_REASONS)),
                            )

                        cur.execute(
                            """
                            UPDATE supplier_invoices
                            SET import_status='pending_review',
                                import_finished_at=now(),
                                import_error=%s
                            WHERE company_id=%s AND id=%s
                            """,
                            ("\n".join(warnings[:20]) if warnings else None, args.company_id, invoice_id),
                        )

                        cur.execute(
                            """
                            SELECT line_type, status, suggested_confidence
                            FROM supplier_invoice_import_lines
                            WHERE company_id=%s AND supplier_invoice_id=%s
                            """,
                            (args.company_id, invoice_id),
                        )
                        line_rows = cur.fetchall() or []

                item_lines = [r for r in line_rows if str(r.get("line_type") or "").lower() in ITEM_LINE_TYPES]
                non_item_lines = [r for r in line_rows if str(r.get("line_type") or "").lower() in NON_ITEM_LINE_TYPES]
                pending_item = [r for r in item_lines if str(r.get("status") or "").lower() == "pending"]
                pending_non_item = [r for r in non_item_lines if str(r.get("status") or "").lower() == "pending"]
                low_conf = [r for r in item_lines if _d(r.get("suggested_confidence"), "0") < Decimal("0.75")]
                med_conf = [
                    r
                    for r in item_lines
                    if Decimal("0.75") <= _d(r.get("suggested_confidence"), "0") < Decimal("0.90")
                ]
                avg_conf = (
                    (sum([_d(r.get("suggested_confidence"), "0") for r in item_lines], Decimal("0")) / Decimal(str(len(item_lines))))
                    if item_lines
                    else Decimal("0")
                )
                doc_type = "unknown"
                doc_conf = Decimal("0")
                try:
                    doc_type, doc_conf = _parse_doc_meta(extracted)  # type: ignore[name-defined]
                except Exception:
                    pass
                risk, priority, reco = _compute_risk(
                    doc_type=doc_type,
                    doc_conf=doc_conf,
                    missing_attachments=missing_attachments,
                    pending_item=len(pending_item),
                    low_conf_item=len(low_conf),
                    medium_conf_item=len(med_conf),
                    pending_non_item=len(pending_non_item),
                )

                supplier_name = str(inv.get("supplier_name") or "")
                try:
                    with conn.cursor() as cur2:
                        cur2.execute("SELECT set_config('app.current_company_id', %s::text, false)", (args.company_id,))
                        sid = str(hdr.get("supplier_id") or "").strip() or None
                        if sid:
                            cur2.execute("SELECT name FROM suppliers WHERE company_id=%s AND id=%s", (args.company_id, sid))
                            sr = cur2.fetchone()
                            if sr and str(sr.get("name") or "").strip():
                                supplier_name = str(sr.get("name") or "").strip()
                except Exception:
                    pass

                rows.append(
                    QueueRow(
                        invoice_id=invoice_id,
                        invoice_no=str(inv.get("invoice_no") or ""),
                        supplier_name=supplier_name,
                        supplier_ref=str(inv.get("supplier_ref") or ""),
                        attachments=attachment_count,
                        doc_type=doc_type,
                        doc_conf=f"{doc_conf:.2f}",
                        item_lines=len(item_lines),
                        pending_item=len(pending_item),
                        low_conf_item=len(low_conf),
                        avg_item_conf=f"{avg_conf:.3f}",
                        risk_score=risk,
                        priority=priority,
                        recommendation=reco,
                        warnings=" | ".join(warnings[:6]),
                    )
                )
                stats["processed"] += 1
                stats["total_item_lines"] += len(item_lines)
                stats["total_pending_item_lines"] += len(pending_item)
                stats["total_low_conf_item_lines"] += len(low_conf)
            except Exception as ex:
                stats["failed"] += 1
                rows.append(
                    QueueRow(
                        invoice_id=invoice_id,
                        invoice_no=str(inv.get("invoice_no") or ""),
                        supplier_name=str(inv.get("supplier_name") or ""),
                        supplier_ref=str(inv.get("supplier_ref") or ""),
                        attachments=0,
                        doc_type="error",
                        doc_conf="0.00",
                        item_lines=0,
                        pending_item=0,
                        low_conf_item=0,
                        avg_item_conf="0.000",
                        risk_score=999,
                        priority="P0",
                        recommendation="Import error: investigate",
                        warnings=str(ex)[:500],
                    )
                )

    rows.sort(key=lambda r: (r.risk_score, r.pending_item, r.low_conf_item), reverse=True)

    with queue_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "priority",
                "risk_score",
                "invoice_no",
                "invoice_id",
                "supplier_name",
                "supplier_ref",
                "attachments",
                "doc_type",
                "doc_conf",
                "item_lines",
                "pending_item",
                "low_conf_item",
                "avg_item_conf",
                "recommendation",
                "warnings",
            ]
        )
        for r in rows:
            w.writerow(
                [
                    r.priority,
                    r.risk_score,
                    r.invoice_no,
                    r.invoice_id,
                    r.supplier_name,
                    r.supplier_ref,
                    r.attachments,
                    r.doc_type,
                    r.doc_conf,
                    r.item_lines,
                    r.pending_item,
                    r.low_conf_item,
                    r.avg_item_conf,
                    r.recommendation,
                    r.warnings,
                ]
            )

    summary = {
        "processed": stats["processed"],
        "failed": stats["failed"],
        "rows": len(rows),
        "total_item_lines": stats["total_item_lines"],
        "total_pending_item_lines": stats["total_pending_item_lines"],
        "total_low_conf_item_lines": stats["total_low_conf_item_lines"],
        "queue_csv": str(queue_csv),
    }
    summary_json.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
