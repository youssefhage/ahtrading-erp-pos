"""
WhatsApp integration – v2 with full conversational AI agent.

Supports two modes:
1. **File ingestion** (original v1): Documents create AI-imported
   Supplier Invoice drafts.
2. **Conversational agent** (v2): Text messages are routed through the
   Kai agent core for read/write operations with confirmation flow.

Requires a WhatsApp Business API provider (Meta Cloud API, Twilio, etc.).
The webhook format follows the Meta Cloud API structure, but adapts to
provider-specific payloads via normalization helpers.

Required env:
- WHATSAPP_WEBHOOK_SECRET
- WHATSAPP_COMPANY_ID
- WHATSAPP_SYSTEM_USER_ID
- WHATSAPP_API_URL          (provider API endpoint)
- WHATSAPP_API_TOKEN         (provider API bearer token)
- WHATSAPP_PHONE_NUMBER_ID   (sender phone number ID for Meta Cloud API)
"""
import io
import json
import logging
import os
import hmac
import hashlib
import urllib.error
import urllib.request
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Request, File, UploadFile
from starlette.datastructures import Headers

from ..db import get_conn, set_company_context
from ..deps import require_permission
from ..ai.policy import is_external_ai_allowed
from ..ai.providers import get_ai_provider_config
from ..ai.agent_core import (
    agent_respond,
    resolve_channel_user,
    link_channel_user,
    load_user_permissions,
    get_pending_confirmation,
    resolve_pending_confirmation,
    get_or_create_conversation,
)
from ..ai.copilot_llm import fetch_company_name, fetch_attention_items
from .purchases import import_supplier_invoice_draft_from_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/whatsapp", tags=["integrations"])


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _whatsapp_api_post(url: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    """POST to WhatsApp Business API."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
        logger.warning("WhatsApp API error: %s", body[:500])
        return {"error": body[:500]}
    except Exception as e:
        logger.warning("WhatsApp API error: %s", e)
        return {"error": str(e)}


def _load_wa_config(company_id: str) -> dict[str, str]:
    """Load WhatsApp config from DB with env var fallback."""
    from ..ai.providers import get_kai_channel_config
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            ch_cfg = get_kai_channel_config(cur, company_id)
    return ch_cfg["whatsapp"]


# Module-level cache for config within a single request
_wa_config_cache: dict[str, dict[str, str]] = {}


def _get_wa_config(company_id: str | None = None) -> dict[str, str]:
    """Get WhatsApp config, loading from DB if needed."""
    cid = company_id or (os.environ.get("WHATSAPP_COMPANY_ID") or "").strip()
    if not cid:
        return {
            "api_url": (os.environ.get("WHATSAPP_API_URL") or "").strip(),
            "api_token": (os.environ.get("WHATSAPP_API_TOKEN") or "").strip(),
            "phone_number_id": (os.environ.get("WHATSAPP_PHONE_NUMBER_ID") or "").strip(),
            "verify_token": (os.environ.get("WHATSAPP_VERIFY_TOKEN") or "").strip(),
            "app_secret": (os.environ.get("WHATSAPP_APP_SECRET") or "").strip(),
        }
    return _load_wa_config(cid)


def _send_whatsapp_text(phone: str, text: str, wa_cfg: dict[str, str] | None = None) -> dict[str, Any]:
    """Send a text message via WhatsApp Business API."""
    cfg = wa_cfg or _get_wa_config()
    api_url = cfg.get("api_url", "")
    api_token = cfg.get("api_token", "")
    phone_number_id = cfg.get("phone_number_id", "")
    if not api_url or not api_token:
        logger.debug("WhatsApp API not configured, skipping send")
        return {"error": "not configured"}

    # Meta Cloud API format
    payload: dict[str, Any] = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "text",
        "text": {"body": text},
    }
    if phone_number_id:
        # Some providers require this in the URL
        url = api_url.rstrip("/")
        if phone_number_id not in url:
            url = f"{url}/{phone_number_id}/messages"
    else:
        url = api_url

    return _whatsapp_api_post(url, api_token, payload)


def _send_whatsapp_interactive(
    phone: str,
    text: str,
    buttons: list[dict[str, str]],
    wa_cfg: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Send an interactive button message via WhatsApp."""
    cfg = wa_cfg or _get_wa_config()
    api_url = cfg.get("api_url", "")
    api_token = cfg.get("api_token", "")
    phone_number_id = cfg.get("phone_number_id", "")
    if not api_url or not api_token:
        return {"error": "not configured"}

    # WhatsApp interactive buttons (max 3)
    button_rows = []
    for btn in buttons[:3]:
        button_rows.append({
            "type": "reply",
            "reply": {
                "id": btn.get("id", ""),
                "title": btn.get("title", "")[:20],  # WhatsApp 20 char limit
            },
        })

    payload: dict[str, Any] = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "interactive",
        "interactive": {
            "type": "button",
            "body": {"text": text},
            "action": {"buttons": button_rows},
        },
    }

    url = api_url.rstrip("/")
    if phone_number_id and phone_number_id not in url:
        url = f"{url}/{phone_number_id}/messages"

    return _whatsapp_api_post(url, api_token, payload)


def _download_whatsapp_media(media_id: str, wa_cfg: dict[str, str] | None = None) -> tuple[bytes, str]:
    """Download media from WhatsApp (Meta Cloud API pattern)."""
    cfg = wa_cfg or _get_wa_config()
    api_token = cfg.get("api_token", "")
    graph_url = (os.environ.get("WHATSAPP_GRAPH_URL") or "https://graph.facebook.com/v18.0").strip()

    # Step 1: Get media URL
    media_info_url = f"{graph_url}/{media_id}"
    req = urllib.request.Request(
        media_info_url, method="GET",
        headers={"Authorization": f"Bearer {api_token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        info = json.loads(resp.read().decode("utf-8"))

    download_url = info.get("url", "")
    mime_type = info.get("mime_type", "application/octet-stream")

    # Step 2: Download the file
    req2 = urllib.request.Request(
        download_url, method="GET",
        headers={"Authorization": f"Bearer {api_token}"},
    )
    with urllib.request.urlopen(req2, timeout=60) as resp2:
        raw = resp2.read()

    return raw, mime_type


# ---------------------------------------------------------------------------
# Meta Cloud API webhook verification (GET)
# ---------------------------------------------------------------------------

@router.get("/webhook")
def whatsapp_verify(
    hub_mode: Optional[str] = None,
    hub_verify_token: Optional[str] = None,
    hub_challenge: Optional[str] = None,
):
    """
    WhatsApp webhook verification (Meta Cloud API GET challenge).
    Returns hub.challenge if the verify_token matches.
    Config read from company_settings with env var fallback.
    """
    wa_cfg = _get_wa_config()
    expected = wa_cfg.get("verify_token", "")
    if not expected:
        raise HTTPException(status_code=404, detail="whatsapp verify token not configured")

    mode = (hub_mode or "").strip()
    token = (hub_verify_token or "").strip()
    challenge = (hub_challenge or "").strip()

    if mode == "subscribe" and hmac.compare_digest(token, expected):
        return int(challenge) if challenge.isdigit() else challenge

    raise HTTPException(status_code=403, detail="verification failed")


# ---------------------------------------------------------------------------
# Legacy file-only endpoint (v1 compatibility)
# ---------------------------------------------------------------------------

@router.post("/webhook/upload")
def whatsapp_file_upload(
    file: UploadFile = File(...),
    x_whatsapp_webhook_secret: Optional[str] = Header(None, alias="X-WhatsApp-Webhook-Secret"),
):
    """
    Direct file upload endpoint (v1 compat).
    POST a file directly to create a supplier invoice draft.
    """
    company_id = (os.environ.get("WHATSAPP_COMPANY_ID") or "").strip()
    system_user_id = (os.environ.get("WHATSAPP_SYSTEM_USER_ID") or "").strip()

    if not company_id or not system_user_id:
        raise HTTPException(status_code=404, detail="whatsapp integration not configured")

    wa_cfg = _get_wa_config(company_id)
    expected_secret = wa_cfg.get("verify_token", "")
    if not expected_secret:
        raise HTTPException(status_code=500, detail="whatsapp webhook secret not configured")
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

    user = {"user_id": system_user_id, "email": "whatsapp@integration"}
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
        auto_create_items=False,
        auto_apply=False,
        async_import=True,
        company_id=company_id,
        user=user,
    )
    return {"ok": True, "supplier_invoice": res}


# ---------------------------------------------------------------------------
# Main webhook (v2 – full conversational + file ingestion)
# ---------------------------------------------------------------------------

@router.post("/webhook")
async def whatsapp_webhook(request: Request):
    """
    WhatsApp webhook receiver (v2).

    Handles Meta Cloud API webhook format:
    - Text messages → Kai agent (conversational AI)
    - Media messages → Supplier Invoice import
    - Interactive button replies → Confirmation flow
    - /link command → Link WhatsApp user to system account

    Also handles simple JSON POST format for other providers.
    """
    company_id = (os.environ.get("WHATSAPP_COMPANY_ID") or "").strip()
    system_user_id = (os.environ.get("WHATSAPP_SYSTEM_USER_ID") or "").strip()

    if not company_id or not system_user_id:
        raise HTTPException(status_code=404, detail="whatsapp integration not configured")

    # Load config from DB (with env var fallback)
    wa_cfg = _get_wa_config(company_id)

    body = await request.body()
    try:
        update = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="invalid JSON")

    # Verify signature (Meta sends X-Hub-Signature-256)
    app_secret = wa_cfg.get("app_secret", "")
    if not app_secret:
        raise HTTPException(status_code=500, detail="whatsapp app_secret not configured")
    if app_secret:
        signature = request.headers.get("X-Hub-Signature-256", "")
        expected_sig = "sha256=" + hmac.new(
            app_secret.encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            raise HTTPException(status_code=401, detail="invalid signature")

    # Store raw event for traceability
    try:
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO events (id, company_id, event_type, source_type, source_id, payload_json)
                    VALUES (gen_random_uuid(), %s, 'whatsapp_update', 'whatsapp', NULL, %s::jsonb)
                    """,
                    (company_id, json.dumps(update)),
                )
    except Exception:
        pass

    # Parse Meta Cloud API webhook format
    # Structure: { "entry": [{ "changes": [{ "value": { "messages": [...] } }] }] }
    entries = update.get("entry") or []
    for entry in entries:
        changes = entry.get("changes") or []
        for change in changes:
            value = change.get("value") or {}

            # Process messages
            messages = value.get("messages") or []
            for msg in messages:
                phone = msg.get("from", "")
                msg_type = msg.get("type", "")

                if msg_type == "text":
                    text = (msg.get("text", {}).get("body") or "").strip()
                    if text:
                        _handle_text_message(text, phone, company_id, system_user_id)

                elif msg_type == "interactive":
                    interactive = msg.get("interactive") or {}
                    if interactive.get("type") == "button_reply":
                        button_id = interactive.get("button_reply", {}).get("id", "")
                        if button_id:
                            _handle_button_reply(button_id, phone, company_id, system_user_id)

                elif msg_type in ("image", "document"):
                    media_info = msg.get(msg_type) or {}
                    media_id = media_info.get("id", "")
                    caption = media_info.get("caption", "")
                    filename = media_info.get("filename", f"whatsapp-{msg_type}")
                    mime_type = media_info.get("mime_type", "application/octet-stream")
                    if media_id:
                        _handle_media_message(
                            media_id, filename, mime_type, phone,
                            company_id, system_user_id,
                        )

                elif msg_type == "audio":
                    audio_info = msg.get("audio") or {}
                    media_id = audio_info.get("id", "")
                    mime_type = audio_info.get("mime_type", "audio/ogg")
                    if media_id:
                        _handle_voice_message(
                            media_id, mime_type, phone,
                            company_id, system_user_id,
                        )

            # Process statuses (delivery receipts) — just acknowledge
            # statuses = value.get("statuses") or []

    # Also handle simple/flat JSON format for non-Meta providers
    if not entries and update.get("from"):
        phone = update.get("from", "")
        text = update.get("text", {}).get("body", "") if isinstance(update.get("text"), dict) else str(update.get("text", ""))
        if text.strip():
            _handle_text_message(text.strip(), phone, company_id, system_user_id)

    return {"ok": True}


# ---------------------------------------------------------------------------
# Text message handler → Kai agent
# ---------------------------------------------------------------------------

def _handle_text_message(
    text: str,
    phone: str,
    company_id: str,
    system_user_id: str,
) -> None:
    """Route a text message through the Kai agent core."""
    # Handle commands
    if text.lower().startswith("/start") or text.lower() == "hi" or text.lower() == "hello":
        _send_whatsapp_text(
            phone,
            "👋 *Welcome to Kai* — your AI operations copilot.\n\n"
            "You can ask me things like:\n"
            "• _What are today's sales?_\n"
            "• _Show me low stock items_\n"
            "• _Create a PO for ABC Trading_\n"
            "• _Approve all pending pricing recommendations_\n\n"
            "📎 Send me a photo or document of a supplier invoice to import it.\n\n"
            "To link your system account, send:\n"
            "_link your-email@company.com_",
        )
        return

    if text.lower().startswith("link ") or text.lower().startswith("/link "):
        _handle_link_command(text, phone, company_id)
        return

    # Resolve user
    linked_user = resolve_channel_user(company_id, "whatsapp", phone)
    is_linked = bool(linked_user)
    if linked_user:
        user = linked_user
    else:
        user = {"user_id": system_user_id, "email": "whatsapp@integration"}

    # Check AI availability
    ai_config: dict[str, Any] = {}
    company_name = ""
    attention_items: list[dict[str, Any]] = []
    try:
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                if not is_external_ai_allowed(cur, company_id):
                    _send_whatsapp_text(phone, "AI processing is not enabled for this company.")
                    return
                ai_config = get_ai_provider_config(cur, company_id)
                if not ai_config.get("api_key") or not (ai_config.get("copilot_model") or ai_config.get("item_naming_model")):
                    _send_whatsapp_text(phone, "AI provider is not configured. Please set up AI settings in the admin panel.")
                    return
                company_name = fetch_company_name(cur, company_id)
                attention_items = fetch_attention_items(cur, company_id)
    except Exception as e:
        logger.exception("WhatsApp: Failed to load AI config: %s", e)
        _send_whatsapp_text(phone, "Sorry, I'm having trouble connecting to the system right now.")
        return

    # Load user permissions
    user_permissions = None
    try:
        user_permissions = load_user_permissions(company_id, user["user_id"])
    except Exception:
        pass
    # Restrict unlinked users to read-only operations.
    if not is_linked:
        user_permissions = {"ai:read", "inventory:read", "sales:read", "purchases:read"}

    # Call agent
    try:
        result = agent_respond(
            user_query=text,
            company_id=company_id,
            company_name=company_name,
            user=user,
            ai_config=ai_config,
            channel="whatsapp",
            channel_user_id=phone,
            context={"channel": "whatsapp"},
            overview=None,
            attention=attention_items,
            user_permissions=user_permissions,
        )
    except Exception as e:
        logger.exception("WhatsApp: Agent respond failed: %s", e)
        _send_whatsapp_text(phone, "Sorry, something went wrong processing your request.")
        return

    answer = result.get("answer", "No response generated.")

    # Check for pending confirmation → send interactive buttons
    pending = result.get("pending_confirmation")
    if pending:
        _send_whatsapp_interactive(
            phone,
            answer,
            [
                {"id": f"confirm:{pending['id']}", "title": "✅ Confirm"},
                {"id": f"reject:{pending['id']}", "title": "❌ Cancel"},
            ],
        )
    else:
        _send_whatsapp_text(phone, answer)


# ---------------------------------------------------------------------------
# Interactive button reply handler
# ---------------------------------------------------------------------------

def _handle_button_reply(
    button_id: str,
    phone: str,
    company_id: str,
    system_user_id: str,
) -> None:
    """Handle interactive button replies for confirmations."""
    if ":" not in button_id:
        return

    action, conf_id = button_id.split(":", 1)

    # Resolve user
    linked_user = resolve_channel_user(company_id, "whatsapp", phone)
    user = linked_user if linked_user else {"user_id": system_user_id, "email": "whatsapp@integration"}

    if action == "confirm":
        from ..ai.tools import execute_tool
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT tool_name, arguments_json, summary
                    FROM ai_pending_confirmations
                    WHERE id = %s AND company_id = %s AND status = 'pending'
                    """,
                    (conf_id, company_id),
                )
                row = cur.fetchone()

        if not row:
            _send_whatsapp_text(phone, "This action has expired or was already handled.")
            return

        resolve_pending_confirmation(conf_id, company_id, "confirmed")
        result = execute_tool(row["tool_name"], row["arguments_json"], company_id, user)

        if result.error:
            _send_whatsapp_text(phone, f"❌ Error: {result.error}")
        else:
            _send_whatsapp_text(phone, f"✅ {result.message or 'Action completed.'}")

    elif action == "reject":
        resolve_pending_confirmation(conf_id, company_id, "rejected")
        _send_whatsapp_text(phone, "❌ Action cancelled.")


# ---------------------------------------------------------------------------
# /link command handler
# ---------------------------------------------------------------------------

def _handle_link_command(
    text: str,
    phone: str,
    company_id: str,
) -> None:
    """Link a WhatsApp user to their system account via email."""
    # Handle "link email" or "/link email" format
    parts = text.split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        _send_whatsapp_text(
            phone,
            "Usage: _link your-email@company.com_\n\n"
            "This links your WhatsApp number to your system user, "
            "enabling personalized access and permissions.",
        )
        return

    email = parts[1].strip().lower()

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.id, u.email
                FROM users u
                JOIN user_roles ur ON ur.user_id = u.id
                WHERE u.email = %s AND ur.company_id = %s
                LIMIT 1
                """,
                (email, company_id),
            )
            user_row = cur.fetchone()
            if not user_row:
                _send_whatsapp_text(
                    phone,
                    f"No user found with email _{email}_ in this company. "
                    "Please check the email and try again.",
                )
                return

            link_channel_user(company_id, "whatsapp", phone, str(user_row["id"]))

            _send_whatsapp_text(
                phone,
                f"✅ Linked! Your WhatsApp is now connected to _{user_row['email']}_.\n\n"
                "Your actions through Kai will now use your personal permissions.",
            )


# ---------------------------------------------------------------------------
# Media message handler (supplier invoice import)
# ---------------------------------------------------------------------------

def _handle_media_message(
    media_id: str,
    filename: str,
    mime_type: str,
    phone: str,
    company_id: str,
    system_user_id: str,
) -> None:
    """Handle document/image uploads – create supplier invoice drafts."""
    try:
        max_mb = int(os.environ.get("ATTACHMENT_MAX_MB", "5"))
    except Exception:
        max_mb = 5
    max_mb = max(1, min(max_mb, 100))
    max_bytes = max_mb * 1024 * 1024

    try:
        raw, detected_mime = _download_whatsapp_media(media_id)
    except Exception as e:
        logger.warning("WhatsApp: Failed to download media %s: %s", media_id, e)
        _send_whatsapp_text(phone, "❌ Failed to download the file. Please try again.")
        return

    if len(raw) > max_bytes:
        _send_whatsapp_text(phone, f"❌ File too large (max {max_mb}MB).")
        return

    user = {"user_id": system_user_id, "email": "whatsapp@integration"}
    try:
        require_permission("purchases:write")(company_id=company_id, user=user)
    except Exception:
        _send_whatsapp_text(phone, "❌ Insufficient permissions for invoice import.")
        return

    up = UploadFile(
        file=io.BytesIO(raw),
        filename=filename,
        headers=Headers({"content-type": detected_mime or mime_type}),
    )
    try:
        res = import_supplier_invoice_draft_from_file(
            file=up,
            exchange_rate=None,
            tax_code_id=None,
            auto_create_supplier=True,
            auto_create_items=True,
            company_id=company_id,
            user=user,
        )
    except Exception as e:
        logger.exception("WhatsApp: Invoice import failed: %s", e)
        _send_whatsapp_text(phone, "❌ Invoice import failed. Please try again or upload through the admin panel.")
        return

    inv_id = res.get("id") or res.get("invoice_id") or ""
    inv_no = res.get("invoice_no") or ""
    _send_whatsapp_text(
        phone,
        f"📄 Supplier invoice draft created!\n"
        f"Invoice: {inv_no or inv_id}\n"
        f"File: {filename}\n\n"
        "The AI will extract details in the background. "
        "Review it in the admin panel under Purchasing → Supplier Invoices.",
    )


# ---------------------------------------------------------------------------
# Voice message handler (speech-to-text → agent)
# ---------------------------------------------------------------------------

def _handle_voice_message(
    media_id: str,
    mime_type: str,
    phone: str,
    company_id: str,
    system_user_id: str,
) -> None:
    """Handle voice notes: download → speech-to-text → route through agent."""
    try:
        raw, detected_mime = _download_whatsapp_media(media_id)
    except Exception as e:
        logger.warning("WhatsApp: Failed to download voice %s: %s", media_id, e)
        _send_whatsapp_text(phone, "❌ Failed to download voice message.")
        return

    # Transcribe using the shared STT helper
    from ..ai.speech import transcribe_audio
    text = transcribe_audio(raw, detected_mime or mime_type, company_id)

    if not text:
        _send_whatsapp_text(phone, "❌ I couldn't understand the voice message. Please try again or type your request.")
        return

    # Send transcription confirmation
    _send_whatsapp_text(phone, f"🎤 _{text}_")

    # Route through the normal text handler
    _handle_text_message(text, phone, company_id, system_user_id)
