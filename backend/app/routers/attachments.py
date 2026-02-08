from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
import hashlib

from ..db import get_conn, set_company_context
from ..deps import get_company_id, get_current_user, require_permission

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
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="attachment too large (max 5MB in v1)")
    sha = hashlib.sha256(raw).hexdigest() if raw else None
    filename = (file.filename or "attachment").strip() or "attachment"
    content_type = (file.content_type or "application/octet-stream").strip() or "application/octet-stream"
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO document_attachments
                  (id, company_id, entity_type, entity_id, filename, content_type, size_bytes, sha256, bytes, uploaded_by_user_id)
                VALUES
                  (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (company_id, entity_type, entity_id, filename, content_type, len(raw), sha, raw, user["user_id"]),
            )
            return {"id": cur.fetchone()["id"]}


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
                SELECT entity_type, filename, content_type, bytes
                FROM document_attachments
                WHERE company_id = %s AND id = %s
                """,
                (company_id, attachment_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="attachment not found")
            require_permission(_permission_for_entity(row["entity_type"], write=False))(company_id=company_id, user=user)
            data = row["bytes"] or b""
            headers = {"Content-Disposition": f'attachment; filename="{row["filename"]}"'}
            return Response(content=data, media_type=row["content_type"], headers=headers)

