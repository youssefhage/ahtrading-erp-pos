#!/usr/bin/env python3.11
"""
Safe data-enhancement pass for AP import quality.

What it does (apply mode):
1) Enriches supplier master data from extracted packet JSON files.
2) Seeds supplier-item aliases from high-confidence mapping CSV rows.
3) Optionally normalizes draft import exchange rates to 89,500.
4) Optionally deletes duplicate supplier-invoice attachments (same hash+size+invoice).

Default is dry-run (no DB writes).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.importers.supplier_invoice_import import _find_supplier_id_by_name, _norm_code, _norm_name


def clean_value(v: Any) -> str:
    s = str(v or "").strip()
    if not s:
        return ""
    if s.lower() in {"null", "none", "n/a", "na", "-"}:
        return ""
    return s


def normalize_vat(v: str) -> str:
    s = clean_value(v).upper()
    if not s:
        return ""
    # Keep alphanumerics only for robust matching (e.g. "3170-601" vs "3170 / 601")
    return re.sub(r"[^A-Z0-9]+", "", s)


def pick_counter_value(counter: Counter[str]) -> str:
    if not counter:
        return ""
    return counter.most_common(1)[0][0]


def load_supplier_profiles(json_dir: Path) -> list[dict[str, Any]]:
    profiles: dict[str, dict[str, Any]] = {}
    for p in sorted(json_dir.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        sup = (data.get("supplier") or {}) if isinstance(data, dict) else {}
        name = clean_value(sup.get("name"))
        if not name:
            continue
        nname = _norm_name(name)
        if not nname:
            continue
        rec = profiles.setdefault(
            nname,
            {
                "name": Counter(),
                "vat_no": Counter(),
                "phone": Counter(),
                "email": Counter(),
                "address": Counter(),
                "count": 0,
            },
        )
        rec["count"] += 1
        rec["name"][name] += 1
        for fld in ("vat_no", "phone", "email", "address"):
            v = clean_value(sup.get(fld))
            if v:
                rec[fld][v] += 1

    out: list[dict[str, Any]] = []
    for nname, rec in profiles.items():
        out.append(
            {
                "normalized_name": nname,
                "name": pick_counter_value(rec["name"]),
                "vat_no": pick_counter_value(rec["vat_no"]),
                "phone": pick_counter_value(rec["phone"]),
                "email": pick_counter_value(rec["email"]),
                "address": pick_counter_value(rec["address"]),
                "count": int(rec["count"]),
            }
        )
    out.sort(key=lambda r: int(r["count"]), reverse=True)
    return out


def load_packet_supplier_map(invoice_header_summary_csv: Path) -> dict[str, str]:
    m: dict[str, str] = {}
    if not invoice_header_summary_csv.exists():
        return m
    with invoice_header_summary_csv.open(newline="", encoding="utf-8") as f:
        rdr = csv.DictReader(f)
        for row in rdr:
            pid = clean_value(row.get("packet_id"))
            sname = clean_value(row.get("supplier_name"))
            if pid and sname and pid not in m:
                m[pid] = sname
    return m


def ensure_supplier_address(
    *,
    cur,
    company_id: str,
    supplier_id: str,
    address: str,
    apply: bool,
) -> bool:
    addr = clean_value(address)
    if not addr:
        return False
    cur.execute(
        """
        SELECT id, line1
        FROM party_addresses
        WHERE company_id=%s AND party_kind='supplier' AND party_id=%s
        ORDER BY is_default DESC, created_at ASC
        LIMIT 1
        """,
        (company_id, supplier_id),
    )
    row = cur.fetchone()
    if not row:
        if apply:
            cur.execute(
                """
                INSERT INTO party_addresses
                  (id, company_id, party_kind, party_id, label, line1, is_default)
                VALUES
                  (gen_random_uuid(), %s, 'supplier', %s, 'Main', %s, true)
                """,
                (company_id, supplier_id, addr),
            )
        return True
    if clean_value(row.get("line1")):
        return False
    if apply:
        cur.execute(
            """
            UPDATE party_addresses
            SET line1=%s
            WHERE company_id=%s AND id=%s
            """,
            (addr, company_id, row["id"]),
        )
    return True


def upsert_supplier_alias(
    *,
    cur,
    company_id: str,
    supplier_id: str,
    item_id: str,
    supplier_item_code: str,
    supplier_item_name: str,
    apply: bool,
) -> bool:
    ncode = _norm_code(supplier_item_code)
    nname = _norm_name(supplier_item_name)
    if not ncode and not nname:
        return False
    if not apply:
        return True
    if ncode:
        cur.execute(
            """
            INSERT INTO supplier_item_aliases
              (id, company_id, supplier_id, item_id, supplier_item_code, supplier_item_name, normalized_code, normalized_name, last_seen_at)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (company_id, supplier_id, normalized_code)
              WHERE normalized_code IS NOT NULL AND normalized_code <> ''
            DO UPDATE SET item_id = EXCLUDED.item_id,
                          supplier_item_code = EXCLUDED.supplier_item_code,
                          supplier_item_name = EXCLUDED.supplier_item_name,
                          normalized_name = COALESCE(EXCLUDED.normalized_name, supplier_item_aliases.normalized_name),
                          last_seen_at = now()
            """,
            (company_id, supplier_id, item_id, clean_value(supplier_item_code) or None, clean_value(supplier_item_name) or None, ncode, nname),
        )
        return True
    # Name-only alias fallback (no unique index on normalized_name): update existing row first.
    cur.execute(
        """
        UPDATE supplier_item_aliases
        SET item_id=%s,
            supplier_item_name=%s,
            last_seen_at=now()
        WHERE company_id=%s
          AND supplier_id=%s
          AND item_id=%s
          AND normalized_name=%s
        """,
        (item_id, clean_value(supplier_item_name) or None, company_id, supplier_id, item_id, nname),
    )
    if cur.rowcount == 0:
        cur.execute(
            """
            INSERT INTO supplier_item_aliases
              (id, company_id, supplier_id, item_id, supplier_item_code, supplier_item_name, normalized_code, normalized_name, last_seen_at)
            VALUES
              (gen_random_uuid(), %s, %s, %s, %s, %s, NULL, %s, now())
            """,
            (company_id, supplier_id, item_id, clean_value(supplier_item_code) or None, clean_value(supplier_item_name) or None, nname),
        )
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Enhance AP import data quality from cached extracts.")
    ap.add_argument("--db-url", default="postgresql://ahtrading:ahtrading@localhost:5433/ahtrading")
    ap.add_argument("--company-id", default="00000000-0000-0000-0000-000000000001")
    ap.add_argument("--json-dir", default=".cache/ap_docs_packets_52_batch1_fixed/line_item_extract/json")
    ap.add_argument("--item-match-high-csv", default=".cache/ap_docs_packets_52_batch1_fixed/line_item_extract_final/matching/item_match_high_confidence.csv")
    ap.add_argument("--invoice-header-summary-csv", default=".cache/ap_docs_packets_52_batch1_fixed/line_item_extract_final/invoice_header_summary.csv")
    ap.add_argument("--create-missing-suppliers", action="store_true")
    ap.add_argument("--min-create-occurrences", type=int, default=5)
    ap.add_argument("--normalize-draft-rate", action="store_true")
    ap.add_argument("--delete-duplicate-attachments", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    json_dir = Path(args.json_dir)
    high_csv = Path(args.item_match_high_csv)
    hdr_csv = Path(args.invoice_header_summary_csv)

    supplier_profiles = load_supplier_profiles(json_dir) if json_dir.exists() else []
    packet_supplier_map = load_packet_supplier_map(hdr_csv)

    stats: dict[str, int] = defaultdict(int)
    stats["supplier_profiles"] = len(supplier_profiles)

    with psycopg.connect(args.db_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_company_id', %s::text, false)", (args.company_id,))

            # Build supplier VAT index.
            cur.execute("SELECT id, name, vat_no FROM suppliers WHERE company_id=%s ORDER BY created_at ASC", (args.company_id,))
            supplier_rows = cur.fetchall() or []
            vat_to_supplier_id: dict[str, str] = {}
            for s in supplier_rows:
                nv = normalize_vat(s.get("vat_no"))
                if nv and nv not in vat_to_supplier_id:
                    vat_to_supplier_id[nv] = str(s["id"])

            # Supplier enrichment pass.
            for prof in supplier_profiles:
                sid = None
                pvat = normalize_vat(prof.get("vat_no"))
                if pvat:
                    sid = vat_to_supplier_id.get(pvat)
                if not sid:
                    sid = _find_supplier_id_by_name(cur, args.company_id, prof.get("name"))
                if not sid and args.create_missing_suppliers and int(prof.get("count") or 0) >= args.min_create_occurrences:
                    stats["supplier_create_candidates"] += 1
                    if args.apply:
                        cur.execute(
                            """
                            INSERT INTO suppliers
                              (id, company_id, name, legal_name, vat_no, tax_id, phone, email, notes, payment_terms_days, is_active)
                            VALUES
                              (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, 0, true)
                            RETURNING id
                            """,
                            (
                                args.company_id,
                                clean_value(prof.get("name")),
                                clean_value(prof.get("name")) or None,
                                clean_value(prof.get("vat_no")) or None,
                                clean_value(prof.get("vat_no")) or None,
                                clean_value(prof.get("phone")) or None,
                                clean_value(prof.get("email")) or None,
                                (f"Imported address: {clean_value(prof.get('address'))}" if clean_value(prof.get("address")) else None),
                            ),
                        )
                        sid = str(cur.fetchone()["id"])
                        if pvat and sid:
                            vat_to_supplier_id[pvat] = sid
                        stats["suppliers_created"] += 1
                if not sid:
                    stats["supplier_unmatched"] += 1
                    continue

                cur.execute(
                    "SELECT name, legal_name, vat_no, tax_id, phone, email, notes FROM suppliers WHERE company_id=%s AND id=%s",
                    (args.company_id, sid),
                )
                row = cur.fetchone() or {}
                updates: dict[str, Any] = {}
                if clean_value(prof.get("name")) and not clean_value(row.get("legal_name")):
                    updates["legal_name"] = clean_value(prof.get("name"))
                if clean_value(prof.get("vat_no")) and not clean_value(row.get("vat_no")):
                    updates["vat_no"] = clean_value(prof.get("vat_no"))
                if clean_value(prof.get("vat_no")) and not clean_value(row.get("tax_id")):
                    updates["tax_id"] = clean_value(prof.get("vat_no"))
                if clean_value(prof.get("phone")) and not clean_value(row.get("phone")):
                    updates["phone"] = clean_value(prof.get("phone"))
                if clean_value(prof.get("email")) and not clean_value(row.get("email")):
                    updates["email"] = clean_value(prof.get("email"))
                if clean_value(prof.get("address")) and "Imported address:" not in clean_value(row.get("notes")):
                    if clean_value(row.get("notes")):
                        updates["notes"] = f"{clean_value(row.get('notes'))}\nImported address: {clean_value(prof.get('address'))}"
                    else:
                        updates["notes"] = f"Imported address: {clean_value(prof.get('address'))}"

                if updates:
                    stats["supplier_updates"] += 1
                    if args.apply:
                        set_sql = ", ".join([f"{k}=%s" for k in updates.keys()])
                        cur.execute(
                            f"UPDATE suppliers SET {set_sql} WHERE company_id=%s AND id=%s",
                            [*updates.values(), args.company_id, sid],
                        )

                if ensure_supplier_address(
                    cur=cur,
                    company_id=args.company_id,
                    supplier_id=sid,
                    address=clean_value(prof.get("address")),
                    apply=args.apply,
                ):
                    stats["supplier_address_updates"] += 1

            # Alias seeding from high-confidence mapping.
            if high_csv.exists():
                cur.execute("SELECT id FROM items WHERE company_id=%s", (args.company_id,))
                item_ids = {str(r["id"]) for r in (cur.fetchall() or [])}
                with high_csv.open(newline="", encoding="utf-8") as f:
                    rdr = csv.DictReader(f)
                    for row in rdr:
                        auto_accept = clean_value(row.get("auto_accept")).lower() == "true"
                        if not auto_accept:
                            continue
                        reason = clean_value(row.get("candidate_reason")).lower()
                        if reason not in {"barcode_exact", "name_exact", "sku_exact"}:
                            continue
                        item_id = clean_value(row.get("candidate_item_id"))
                        if not item_id or item_id not in item_ids:
                            continue
                        packet_id = clean_value(row.get("sample_packet_id"))
                        supplier_name = clean_value(packet_supplier_map.get(packet_id))
                        if not supplier_name:
                            continue
                        sid = _find_supplier_id_by_name(cur, args.company_id, supplier_name)
                        if not sid:
                            stats["alias_supplier_unmatched"] += 1
                            continue
                        ok = upsert_supplier_alias(
                            cur=cur,
                            company_id=args.company_id,
                            supplier_id=str(sid),
                            item_id=item_id,
                            supplier_item_code=clean_value(row.get("supplier_item_code")),
                            supplier_item_name=clean_value(row.get("supplier_item_name")),
                            apply=args.apply,
                        )
                        if ok:
                            stats["aliases_seeded"] += 1

            if args.normalize_draft_rate:
                stats["draft_rate_candidates"] = 0
                cur.execute(
                    """
                    SELECT count(*)::int AS n
                    FROM supplier_invoices
                    WHERE company_id=%s
                      AND status='draft'
                      AND import_status IN ('pending_review', 'pending', 'processing')
                      AND exchange_rate = 90000
                    """,
                    (args.company_id,),
                )
                row = cur.fetchone() or {}
                stats["draft_rate_candidates"] = int(row.get("n") or 0)
                if args.apply and stats["draft_rate_candidates"] > 0:
                    cur.execute(
                        """
                        UPDATE supplier_invoices
                        SET exchange_rate = 89500
                        WHERE company_id=%s
                          AND status='draft'
                          AND import_status IN ('pending_review', 'pending', 'processing')
                          AND exchange_rate = 90000
                        """,
                        (args.company_id,),
                    )
                    stats["draft_rates_updated"] = int(cur.rowcount or 0)

            if args.delete_duplicate_attachments:
                cur.execute(
                    """
                    WITH ranked AS (
                      SELECT id,
                             ROW_NUMBER() OVER (
                               PARTITION BY company_id, entity_type, entity_id, sha256, size_bytes
                               ORDER BY uploaded_at ASC, id ASC
                             ) AS rn
                      FROM document_attachments
                      WHERE company_id=%s
                        AND entity_type='supplier_invoice'
                        AND sha256 IS NOT NULL
                    )
                    SELECT count(*)::int AS n
                    FROM ranked
                    WHERE rn > 1
                    """,
                    (args.company_id,),
                )
                row = cur.fetchone() or {}
                dup_n = int(row.get("n") or 0)
                stats["duplicate_attachment_candidates"] = dup_n
                if args.apply and dup_n > 0:
                    cur.execute(
                        """
                        WITH ranked AS (
                          SELECT id,
                                 ROW_NUMBER() OVER (
                                   PARTITION BY company_id, entity_type, entity_id, sha256, size_bytes
                                   ORDER BY uploaded_at ASC, id ASC
                                 ) AS rn
                          FROM document_attachments
                          WHERE company_id=%s
                            AND entity_type='supplier_invoice'
                            AND sha256 IS NOT NULL
                        )
                        DELETE FROM document_attachments d
                        USING ranked r
                        WHERE d.id = r.id
                          AND r.rn > 1
                        """,
                        (args.company_id,),
                    )
                    stats["duplicate_attachments_deleted"] = int(cur.rowcount or 0)

        if args.apply:
            conn.commit()
        else:
            conn.rollback()

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] enhance_ap_import_quality summary")
    for k in sorted(stats.keys()):
        print(f"{k}: {stats[k]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
