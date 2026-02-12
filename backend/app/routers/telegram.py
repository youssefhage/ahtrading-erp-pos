import io
import json
import os
import urllib.request
import urllib.error
import hmac
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from starlette.datastructures import UploadFile, Headers

from ..db import get_conn, set_company_context
from ..deps import require_permission
from .purchases import import_supplier_invoice_draft_from_file

router = APIRouter(prefix="/integrations/telegram", tags=["integrations"])


def _http_get_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
        raise RuntimeError(f"Telegram HTTP {getattr(e, 'code', '?')}: {body}") from e


def _http_get_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read() or b""


def _extract_file_info(update: dict[str, Any]) -> tuple[str, str, str, int]:
    """
    Returns: (file_id, filename, content_type, size_bytes_guess)
    """
    msg = update.get("message") or update.get("channel_post") or {}
    doc = msg.get("document")
    if isinstance(doc, dict) and doc.get("file_id"):
        file_id = str(doc["file_id"])
        filename = str(doc.get("file_name") or "telegram-upload")
        content_type = str(doc.get("mime_type") or "application/octet-stream")
        size_bytes = int(doc.get("file_size") or 0)
        return file_id, filename, content_type, size_bytes

    photos = msg.get("photo")
    if isinstance(photos, list) and photos:
        # Take the largest photo.
        best = photos[-1]
        file_id = str(best.get("file_id"))
        size_bytes = int(best.get("file_size") or 0)
        return file_id, "telegram-photo.jpg", "image/jpeg", size_bytes

    raise HTTPException(status_code=400, detail="no supported file found in update (expected document or photo)")


@router.post("/webhook")
def telegram_webhook(
    update: dict[str, Any],
    x_telegram_bot_api_secret_token: Optional[str] = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
):
    """
    Telegram webhook receiver (v1).

    Behavior:
    - Off-by-default unless env vars are set.
    - On receiving a document/photo message, downloads the file and creates an AI-imported Supplier Invoice draft.
    - Always retains the original file as an attachment on the invoice.

    Required env:
    - TELEGRAM_BOT_TOKEN
    - TELEGRAM_WEBHOOK_SECRET (should match Telegram webhook secret token)
    - TELEGRAM_COMPANY_ID (target company UUID)
    - TELEGRAM_SYSTEM_USER_ID (user UUID with purchases:write; optional items/suppliers permissions if auto-create enabled)
    """
    bot_token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    expected_secret = (os.environ.get("TELEGRAM_WEBHOOK_SECRET") or "").strip()
    company_id = (os.environ.get("TELEGRAM_COMPANY_ID") or "").strip()
    system_user_id = (os.environ.get("TELEGRAM_SYSTEM_USER_ID") or "").strip()

    if not bot_token or not expected_secret or not company_id or not system_user_id:
        # Hide the endpoint when not configured.
        raise HTTPException(status_code=404, detail="telegram integration not configured")

    if not hmac.compare_digest((x_telegram_bot_api_secret_token or "").strip(), expected_secret):
        raise HTTPException(status_code=401, detail="invalid telegram secret token")

    try:
        max_mb = int(os.environ.get("ATTACHMENT_MAX_MB", "5"))
    except Exception:
        max_mb = 5
    max_mb = max(1, min(max_mb, 100))
    max_bytes = max_mb * 1024 * 1024

    file_id, filename, content_type, size_guess = _extract_file_info(update)
    if size_guess and size_guess > max_bytes:
        raise HTTPException(status_code=413, detail=f"file too large (max {max_mb}MB)")

    # Store the raw update for traceability.
    try:
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO events (id, company_id, event_type, source_type, source_id, payload_json)
                    VALUES (gen_random_uuid(), %s, 'telegram_update', 'telegram', NULL, %s::jsonb)
                    """,
                    (company_id, json.dumps(update)),
                )
    except Exception:
        # Never block invoice creation just because telemetry failed.
        pass

    # Download file from Telegram.
    meta = _http_get_json(f"https://api.telegram.org/bot{bot_token}/getFile?file_id={file_id}")
    if not meta.get("ok"):
        raise HTTPException(status_code=400, detail=f"telegram getFile failed: {meta}")
    file_path = ((meta.get("result") or {}) or {}).get("file_path")
    if not file_path:
        raise HTTPException(status_code=400, detail="telegram getFile did not return file_path")

    raw = _http_get_bytes(f"https://api.telegram.org/file/bot{bot_token}/{file_path}")
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"file too large (max {max_mb}MB)")

    # Reuse the same import logic as the Admin file upload.
    user = {"user_id": system_user_id, "email": "telegram@integration"}
    require_permission("purchases:write")(company_id=company_id, user=user)

    up = UploadFile(
        file=io.BytesIO(raw),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )
    res = import_supplier_invoice_draft_from_file(
        file=up,
        exchange_rate=None,
        tax_code_id=None,
        auto_create_supplier=True,
        auto_create_items=True,
        company_id=company_id,
        user=user,
    )
    return {"ok": True, "supplier_invoice": res}
