import io
import json
import os
import hmac
from typing import Optional

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from starlette.datastructures import Headers

from ..db import get_conn, set_company_context
from ..deps import require_permission
from .purchases import import_supplier_invoice_draft_from_file

router = APIRouter(prefix="/integrations/whatsapp", tags=["integrations"])


@router.post("/webhook")
def whatsapp_webhook(
    file: UploadFile = File(...),
    x_whatsapp_webhook_secret: Optional[str] = Header(None, alias="X-WhatsApp-Webhook-Secret"),
):
    """
    WhatsApp ingestion receiver (v1).

    This is intentionally simple and provider-agnostic: you POST the file bytes to this endpoint.
    It mirrors the Telegram pattern:
    - Off-by-default unless env vars are set.
    - Always creates a draft supplier invoice and attaches the original file.
    - Uses the same async import pipeline as Admin (worker fills or prepares review lines).

    Required env:
    - WHATSAPP_WEBHOOK_SECRET
    - WHATSAPP_COMPANY_ID (target company UUID)
    - WHATSAPP_SYSTEM_USER_ID (user UUID with purchases:write)
    """
    expected_secret = (os.environ.get("WHATSAPP_WEBHOOK_SECRET") or "").strip()
    company_id = (os.environ.get("WHATSAPP_COMPANY_ID") or "").strip()
    system_user_id = (os.environ.get("WHATSAPP_SYSTEM_USER_ID") or "").strip()

    if not expected_secret or not company_id or not system_user_id:
        raise HTTPException(status_code=404, detail="whatsapp integration not configured")
    if not hmac.compare_digest((x_whatsapp_webhook_secret or "").strip(), expected_secret):
        raise HTTPException(status_code=401, detail="invalid whatsapp secret")

    try:
        max_mb = int(os.environ.get("ATTACHMENT_MAX_MB", "5"))
    except Exception:
        max_mb = 5
    max_mb = max(1, min(max_mb, 100))
    max_bytes = max_mb * 1024 * 1024

    raw = file.file.read() or b""
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"file too large (max {max_mb}MB)")

    filename = (file.filename or "whatsapp-upload").strip() or "whatsapp-upload"
    content_type = (file.content_type or "application/octet-stream").strip() or "application/octet-stream"

    # Store a lightweight event for traceability (never blocks the main flow).
    try:
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO events (id, company_id, event_type, source_type, source_id, payload_json)
                    VALUES (gen_random_uuid(), %s, 'whatsapp_upload', 'whatsapp', NULL, %s::jsonb)
                    """,
                    (company_id, json.dumps({"filename": filename, "content_type": content_type, "size_bytes": len(raw)})),
                )
    except Exception:
        pass

    user = {"user_id": system_user_id, "email": "whatsapp@integration"}
    require_permission("purchases:write")(company_id=company_id, user=user)

    up = UploadFile(
        file=io.BytesIO(raw),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )
    # Queue-first (async) and human-in-the-loop (no auto-apply).
    res = import_supplier_invoice_draft_from_file(
        file=up,
        exchange_rate=None,
        tax_code_id=None,
        auto_create_supplier=True,
        auto_create_items=False,
        auto_apply=False,
        async_import=True,
        company_id=company_id,
        user=user,
    )
    return {"ok": True, "supplier_invoice": res}
