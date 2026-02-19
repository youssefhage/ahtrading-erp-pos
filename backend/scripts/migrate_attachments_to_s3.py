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
import time
from typing import Optional

import psycopg

from backend.app.storage.s3 import s3_enabled, put_bytes


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def main() -> int:
    db_url = env("DATABASE_URL", "postgresql://localhost/ahtrading")
    company_id = env("COMPANY_ID")
    # Total rows to process in this run.
    limit = max(1, int(env("LIMIT", "200")))
    # Per-query batch size (keep conservative; rows include bytea blobs).
    batch_rows = max(1, int(env("BATCH_ROWS", "20")))
    dry_run = env("DRY_RUN", "0").lower() in {"1", "true", "yes"}

    if not s3_enabled():
        print("S3 not configured. Set S3_ENDPOINT_URL/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_BUCKET.", file=sys.stderr)
        return 2
    if not company_id:
        print("COMPANY_ID is required.", file=sys.stderr)
        return 2

    moved = 0
    moved_bytes = 0
    dry_run_offset = 0
    with psycopg.connect(db_url) as conn:
        conn.row_factory = psycopg.rows.dict_row
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_company_id', %s, true)", (company_id,))
            while moved < limit:
                remaining = limit - moved
                take = min(batch_rows, remaining)
                if dry_run:
                    # In dry-run we don't update rows, so paginate deterministically with OFFSET
                    # to avoid re-reading the same records.
                    cur.execute(
                        """
                        SELECT id, filename, content_type, bytes
                        FROM document_attachments
                        WHERE company_id=%s
                          AND (storage_backend='db' OR storage_backend IS NULL)
                          AND bytes IS NOT NULL
                        ORDER BY uploaded_at ASC
                        LIMIT %s OFFSET %s
                        """,
                        (company_id, take, dry_run_offset),
                    )
                else:
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
                        (company_id, take),
                    )
                rows = cur.fetchall() or []
                if not rows:
                    break
                if dry_run:
                    dry_run_offset += len(rows)

                for r in rows:
                    key = f"attachments/{company_id}/{r['id']}"
                    raw_blob = r["bytes"] or b""
                    blob = raw_blob.tobytes() if isinstance(raw_blob, memoryview) else bytes(raw_blob)
                    size = len(blob)
                    if dry_run:
                        print(f"[dry-run] would move {r['id']} ({size} bytes) -> {key}")
                        moved += 1
                        moved_bytes += size
                        continue
                    etag = ""
                    # S3/MinIO uploads can fail transiently under load.
                    for attempt in range(1, 4):
                        try:
                            etag = put_bytes(key=key, data=blob, content_type=r["content_type"] or "application/octet-stream")
                            break
                        except Exception as exc:
                            if attempt >= 3:
                                raise
                            print(f"warn: put_object failed for {r['id']} (attempt {attempt}/3): {exc}", file=sys.stderr)
                            time.sleep(0.4 * attempt)
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
                    moved_bytes += size

                if not dry_run:
                    conn.commit()

    mode = "would migrate" if dry_run else "migrated"
    print(f"{mode} {moved} attachment(s), bytes={moved_bytes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
