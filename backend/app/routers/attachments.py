from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, RedirectResponse
from pydantic import BaseModel
from typing import Optional
import hashlib
import json
import os
import uuid

from ..db import get_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission
from ..storage.s3 import s3_enabled, put_bytes, presign_get

router = APIRouter(prefix="/attachments", tags=["attachments"])


def _permission_for_entity(entity_type: str, write: bool) -> str:
    t = (entity_type or "").strip().lower()
    if t.startswith("sales"):
        return "sales:write" if write else "sales:read"
    if t.startswith("purchase") or t.startswith("supplier") or t.startswith("goods_receipt"):
        return "purchases:write" if write else "purchases:read"
    if t.startswith("gl_") or t.startswith("accounting"):
        return "accounting:write" if write else "accounting:read"
    if t.startswith("item") or t.startswith("catalog"):
        return "items:write" if write else "items:read"
    if t.startswith("customer"):
        return "customers:write" if write else "customers:read"
    if t.startswith("supplier"):
        return "suppliers:write" if write else "suppliers:read"
    # Default to config read/write if unknown.
    return "config:write" if write else "config:read"

def _safe_filename_for_header(name: str) -> str:
    """
    Prevent header injection / broken Content-Disposition due to untrusted filenames.
    """
    n = (name or "").strip() or "attachment"
    n = n.replace("\r", "").replace("\n", "")
    n = n.replace('"', "")
    if len(n) > 180:
        n = n[:180]
    return n or "attachment"


@router.get("")
def list_attachments(
    entity_type: str,
    entity_id: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    # Dynamic permission check based on entity type.
    require_permission(_permission_for_entity(entity_type, write=False))(company_id=company_id, user=user)
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, filename, content_type, size_bytes, sha256, uploaded_by_user_id, uploaded_at
                FROM document_attachments
                WHERE company_id = %s AND entity_type = %s AND entity_id = %s
                ORDER BY uploaded_at DESC
                """,
                (company_id, entity_type, entity_id),
            )
            return {"attachments": cur.fetchall()}


@router.post("")
def upload_attachment(
    entity_type: str = Form(...),
    entity_id: str = Form(...),
    file: UploadFile = File(...),
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    require_permission(_permission_for_entity(entity_type, write=True))(company_id=company_id, user=user)
    if not entity_type.strip() or not entity_id.strip():
        raise HTTPException(status_code=400, detail="entity_type and entity_id are required")
    raw = file.file.read()
    if raw is None:
        raw = b""
    # Default size cap is intentionally conservative since we currently store bytes in Postgres.
    # Override via env var for on-prem deployments where larger attachments are required.
    try:
        max_mb = int(os.environ.get("ATTACHMENT_MAX_MB", "5"))
    except Exception:
        max_mb = 5
    max_mb = max(1, min(max_mb, 100))
    max_bytes = max_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"attachment too large (max {max_mb}MB)")
    sha = hashlib.sha256(raw).hexdigest() if raw else None
    filename = _safe_filename_for_header(file.filename or "attachment")
    content_type = (file.content_type or "application/octet-stream").strip() or "application/octet-stream"

    # Default: store in Postgres (v1). If S3/MinIO is configured, store bytes there.
    attachment_id = str(uuid.uuid4())
    storage_backend = "db"
    object_key = None
    object_etag = None
    object_bucket = None

    if s3_enabled():
        try:
            storage_backend = "s3"
            object_key = f"attachments/{company_id}/{attachment_id}"
            object_etag = put_bytes(key=object_key, data=raw, content_type=content_type)
        except Exception:
            # If object storage is unavailable, fall back to DB storage.
            storage_backend = "db"
            object_key = None
            object_etag = None
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO document_attachments
                  (id, company_id, entity_type, entity_id, filename, content_type, size_bytes, sha256,
                   storage_backend, object_bucket, object_key, object_etag,
                   bytes, uploaded_by_user_id)
                VALUES
                  (%s::uuid, %s, %s, %s, %s, %s, %s, %s,
                   %s, %s, %s, %s,
                   %s, %s)
                RETURNING id
                """,
                (
                    attachment_id,
                    company_id,
                    entity_type,
                    entity_id,
                    filename,
                    content_type,
                    len(raw),
                    sha,
                    storage_backend,
                    object_bucket,
                    object_key,
                    object_etag,
                    None if storage_backend == "s3" else raw,
                    user["user_id"],
                ),
            )
            attachment_id = cur.fetchone()["id"]
            # Keep attachments discoverable in the same Timeline/Audit stream as the document itself.
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    company_id,
                    user["user_id"],
                    "attachment_uploaded",
                    entity_type,
                    entity_id,
                    json.dumps(
                        {
                            "attachment_id": str(attachment_id),
                            "filename": filename,
                            "content_type": content_type,
                            "size_bytes": len(raw),
                            "sha256": sha,
                        }
                    ),
                ),
            )
            return {"id": attachment_id}


@router.get("/{attachment_id}/download")
def download_attachment(
    attachment_id: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT entity_type, filename, content_type, bytes,
                       storage_backend, object_key
                FROM document_attachments
                WHERE company_id = %s AND id = %s
                """,
                (company_id, attachment_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="attachment not found")
            require_permission(_permission_for_entity(row["entity_type"], write=False))(company_id=company_id, user=user)
            if (row.get("storage_backend") or "db") == "s3" and row.get("object_key"):
                url = presign_get(
                    key=row["object_key"],
                    filename=_safe_filename_for_header(row["filename"]),
                    content_type=row["content_type"],
                    disposition="attachment",
                )
                return RedirectResponse(url=url, status_code=302)
            data = row["bytes"] or b""
            headers = {"Content-Disposition": f'attachment; filename="{_safe_filename_for_header(row["filename"])}"'}
            return Response(content=data, media_type=row["content_type"], headers=headers)


@router.get("/{attachment_id}/view")
def view_attachment(
    attachment_id: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Inline view endpoint intended for images/previews in UIs.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT entity_type, filename, content_type, bytes,
                       storage_backend, object_key
                FROM document_attachments
                WHERE company_id = %s AND id = %s
                """,
                (company_id, attachment_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="attachment not found")
            require_permission(_permission_for_entity(row["entity_type"], write=False))(company_id=company_id, user=user)
            if (row.get("storage_backend") or "db") == "s3" and row.get("object_key"):
                url = presign_get(
                    key=row["object_key"],
                    filename=_safe_filename_for_header(row["filename"]),
                    content_type=row["content_type"],
                    disposition="inline",
                )
                return RedirectResponse(url=url, status_code=302)
            data = row["bytes"] or b""
            headers = {"Content-Disposition": f'inline; filename="{_safe_filename_for_header(row["filename"])}"'}
            return Response(content=data, media_type=row["content_type"], headers=headers)
