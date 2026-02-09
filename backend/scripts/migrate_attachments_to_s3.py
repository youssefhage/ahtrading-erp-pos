#!/usr/bin/env python3
"""
One-time helper: migrate Postgres bytea attachments to S3/MinIO.

Safe behavior:
- Only migrates rows where storage_backend='db' AND bytes IS NOT NULL.
- Leaves metadata untouched; sets storage_backend='s3', object_key, object_etag; sets bytes=NULL.
- Requires S3 env vars (same as API).
"""

import os
import sys
from typing import Optional

import psycopg

from backend.app.storage.s3 import s3_enabled, put_bytes


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def main() -> int:
    db_url = env("DATABASE_URL", "postgresql://localhost/ahtrading")
    company_id = env("COMPANY_ID")
    limit = int(env("LIMIT", "200"))
    dry_run = env("DRY_RUN", "0").lower() in {"1", "true", "yes"}

    if not s3_enabled():
        print("S3 not configured. Set S3_ENDPOINT_URL/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_BUCKET.", file=sys.stderr)
        return 2
    if not company_id:
        print("COMPANY_ID is required.", file=sys.stderr)
        return 2

    moved = 0
    with psycopg.connect(db_url) as conn:
        conn.row_factory = psycopg.rows.dict_row
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_company_id', %s, true)", (company_id,))
            cur.execute(
                """
                SELECT id, filename, content_type, bytes
                FROM document_attachments
                WHERE company_id=%s
                  AND (storage_backend='db' OR storage_backend IS NULL)
                  AND bytes IS NOT NULL
                ORDER BY uploaded_at ASC
                LIMIT %s
                """,
                (company_id, limit),
            )
            rows = cur.fetchall() or []

            for r in rows:
                key = f"attachments/{company_id}/{r['id']}"
                if dry_run:
                    print(f"[dry-run] would move {r['id']} -> {key}")
                    continue
                etag = put_bytes(key=key, data=r["bytes"] or b"", content_type=r["content_type"] or "application/octet-stream")
                cur.execute(
                    """
                    UPDATE document_attachments
                    SET storage_backend='s3',
                        object_key=%s,
                        object_etag=%s,
                        bytes=NULL
                    WHERE company_id=%s AND id=%s
                    """,
                    (key, etag, company_id, r["id"]),
                )
                moved += 1

        if not dry_run:
            conn.commit()

    print(f"migrated {moved} attachment(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

