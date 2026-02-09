#!/usr/bin/env python3
import argparse
import json
from datetime import datetime

import psycopg
from psycopg.rows import dict_row

DB_URL_DEFAULT = "postgresql://localhost/ahtrading"


def get_conn(db_url):
    return psycopg.connect(db_url, row_factory=dict_row)


def set_company_context(cur, company_id: str):
    cur.execute("SELECT set_config('app.current_company_id', %s::text, true)", (company_id,))


def run_data_hygiene_agent(db_url: str, company_id: str, limit: int = 300):
    """
    Deterministic, SQL-driven checks that surface missing/master-data issues.
    Creates ai_recommendations with agent_code=AI_DATA_HYGIENE (no actions).
    """
    if limit <= 0:
        return
    with get_conn(db_url) as conn:
        with conn.cursor() as cur:
            set_company_context(cur, company_id)
            cur.execute(
                """
                SELECT i.id, i.sku, i.name, i.tax_code_id, i.track_expiry, i.default_shelf_life_days,
                       i.barcode AS legacy_barcode,
                       EXISTS (
                         SELECT 1
                         FROM item_barcodes b
                         WHERE b.company_id = i.company_id AND b.item_id = i.id
                         LIMIT 1
                       ) AS has_any_barcode,
                       EXISTS (
                         SELECT 1
                         FROM item_suppliers s
                         WHERE s.company_id = i.company_id AND s.item_id = i.id AND s.is_primary = true
                         LIMIT 1
                       ) AS has_primary_supplier
                FROM items i
                WHERE i.company_id = %s
                  AND COALESCE(i.is_active, true) = true
                  AND (
                    (COALESCE(i.barcode, '') = '' AND NOT EXISTS (
                      SELECT 1 FROM item_barcodes b WHERE b.company_id = i.company_id AND b.item_id = i.id LIMIT 1
                    ))
                    OR i.tax_code_id IS NULL
                    OR (COALESCE(i.track_expiry, false) = true AND COALESCE(i.default_shelf_life_days, 0) <= 0)
                    OR NOT EXISTS (
                      SELECT 1 FROM item_suppliers s WHERE s.company_id = i.company_id AND s.item_id = i.id AND s.is_primary = true LIMIT 1
                    )
                  )
                ORDER BY i.updated_at DESC, i.created_at DESC
                LIMIT %s
                """,
                (company_id, limit),
            )
            rows = cur.fetchall()

        for r in rows:
            issues = []
            if (r.get("legacy_barcode") or "").strip() == "" and not bool(r.get("has_any_barcode")):
                issues.append({"code": "missing_barcode", "severity": "high", "message": "Item has no barcode (legacy or item_barcodes)."})
            if not r.get("tax_code_id"):
                issues.append({"code": "missing_tax_code", "severity": "high", "message": "Item is missing tax_code_id."})
            if bool(r.get("track_expiry")) and int(r.get("default_shelf_life_days") or 0) <= 0:
                issues.append({"code": "missing_shelf_life", "severity": "med", "message": "Expiry-tracked item is missing default_shelf_life_days."})
            if not bool(r.get("has_primary_supplier")):
                issues.append({"code": "missing_primary_supplier", "severity": "med", "message": "Item has no primary supplier mapping."})
            if not issues:
                continue

            rec_payload = {
                "kind": "data_hygiene",
                "entity_type": "item",
                "entity_id": str(r["id"]),
                "sku": r.get("sku"),
                "name": r.get("name"),
                "issues": issues,
                "explain": {
                    "why": "This item is missing master-data that affects scanning, tax posting, expiry operations, or purchasing.",
                    "signals": [i.get("code") for i in issues],
                },
                "timestamp": datetime.utcnow().isoformat(),
            }

            with conn.transaction():
                with conn.cursor() as cur:
                    set_company_context(cur, company_id)
                    cur.execute(
                        """
                        SELECT 1
                        FROM ai_recommendations
                        WHERE company_id = %s
                          AND agent_code = 'AI_DATA_HYGIENE'
                          AND status = 'pending'
                          AND recommendation_json->>'entity_type' = 'item'
                          AND recommendation_json->>'entity_id' = %s
                        """,
                        (company_id, str(r["id"])),
                    )
                    if cur.fetchone():
                        continue
                    cur.execute(
                        """
                        INSERT INTO ai_recommendations
                          (id, company_id, agent_code, recommendation_json, status)
                        VALUES
                          (gen_random_uuid(), %s, 'AI_DATA_HYGIENE', %s::jsonb, 'pending')
                        """,
                        (company_id, json.dumps(rec_payload)),
                    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--company-id", required=True)
    parser.add_argument("--limit", type=int, default=300)
    args = parser.parse_args()
    run_data_hygiene_agent(args.db, args.company_id, limit=args.limit)


if __name__ == "__main__":
    main()
