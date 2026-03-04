"""
Telegram integration – v2 with full conversational AI agent.

Supports two modes:
1. **File ingestion** (original v1): Photos/documents create AI-imported
   Supplier Invoice drafts.
2. **Conversational agent** (v2): Text messages are routed through the
   Kai agent core for read/write operations with confirmation flow.

The bot replies to the user with results, and uses inline keyboards
for write-action confirmations.
"""
import io
import json
import logging
import os
import urllib.error
import urllib.request
import hmac
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from starlette.datastructures import UploadFile, Headers

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

router = APIRouter(prefix="/integrations/telegram", tags=["integrations"])

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

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


def _telegram_api(bot_token: str, method: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Call a Telegram Bot API method."""
    url = f"https://api.telegram.org/bot{bot_token}/{method}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.warning("Telegram API %s failed: %s", method, e)
        return {"ok": False, "error": str(e)}


def _send_message(
    bot_token: str,
    chat_id: str | int,
    text: str,
    reply_markup: dict | None = None,
    parse_mode: str = "Markdown",
) -> dict[str, Any]:
    """Send a text message to a Telegram chat."""
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return _telegram_api(bot_token, "sendMessage", payload)


def _send_typing(bot_token: str, chat_id: str | int) -> None:
    """Send a 'typing' action indicator."""
    _telegram_api(bot_token, "sendChatAction", {"chat_id": chat_id, "action": "typing"})


# ---------------------------------------------------------------------------
# File extraction (unchanged from v1)
# ---------------------------------------------------------------------------

def _extract_file_info(msg: dict[str, Any]) -> tuple[str, str, str, int] | None:
    """
    Extract file info from a message.
    Returns: (file_id, filename, content_type, size_bytes_guess) or None.
    """
    doc = msg.get("document")
    if isinstance(doc, dict) and doc.get("file_id"):
        file_id = str(doc["file_id"])
        filename = str(doc.get("file_name") or "telegram-upload")
        content_type = str(doc.get("mime_type") or "application/octet-stream")
        size_bytes = int(doc.get("file_size") or 0)
        return file_id, filename, content_type, size_bytes

    photos = msg.get("photo")
    if isinstance(photos, list) and photos:
        best = photos[-1]
        file_id = str(best.get("file_id"))
        size_bytes = int(best.get("file_size") or 0)
        return file_id, "telegram-photo.jpg", "image/jpeg", size_bytes

    return None


# ---------------------------------------------------------------------------
# Main webhook
# ---------------------------------------------------------------------------

@router.post("/webhook")
def telegram_webhook(
    update: dict[str, Any],
    x_telegram_bot_api_secret_token: Optional[str] = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
):
    """
    Telegram webhook receiver (v2).

    Handles:
    - Text messages → Kai agent (conversational AI)
    - Documents/photos → Supplier Invoice import (original v1)
    - Callback queries → Confirmation flow (approve/reject pending actions)
    - /start command → Welcome message
    - /link <email> → Link Telegram user to system account

    Config is read from company_settings (key='kai_channels') with env var fallback.
    Env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_COMPANY_ID, TELEGRAM_SYSTEM_USER_ID
    """
    company_id = (os.environ.get("TELEGRAM_COMPANY_ID") or "").strip()
    system_user_id = (os.environ.get("TELEGRAM_SYSTEM_USER_ID") or "").strip()

    if not company_id or not system_user_id:
        raise HTTPException(status_code=404, detail="telegram integration not configured")

    # Load channel config from DB (with env var fallback)
    from ..ai.providers import get_kai_channel_config
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            ch_cfg = get_kai_channel_config(cur, company_id)

    bot_token = ch_cfg["telegram"]["bot_token"]
    expected_secret = ch_cfg["telegram"]["webhook_secret"]

    if not bot_token:
        raise HTTPException(status_code=404, detail="telegram bot token not configured")

    if expected_secret and not hmac.compare_digest((x_telegram_bot_api_secret_token or "").strip(), expected_secret):
        raise HTTPException(status_code=401, detail="invalid telegram secret token")

    # Store raw update for traceability.
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
        pass

    # Route by update type
    if "callback_query" in update:
        return _handle_callback_query(update, bot_token, company_id, system_user_id)

    msg = update.get("message") or update.get("channel_post") or {}
    chat_id = msg.get("chat", {}).get("id")
    if not chat_id:
        return {"ok": True}

    # Check for voice/audio messages first (speech-to-text)
    voice = msg.get("voice") or msg.get("audio")
    if isinstance(voice, dict) and voice.get("file_id"):
        return _handle_voice_message(voice, msg, bot_token, company_id, system_user_id, chat_id)

    # Check for files (original v1 behaviour)
    file_info = _extract_file_info(msg)
    if file_info:
        return _handle_file_upload(file_info, msg, bot_token, company_id, system_user_id, chat_id)

    # Text message → conversational agent
    text = (msg.get("text") or "").strip()
    if not text:
        return {"ok": True}

    # Handle commands
    if text.startswith("/start"):
        _send_message(
            bot_token, chat_id,
            "👋 *Welcome to Kai* — your AI operations copilot.\n\n"
            "You can ask me things like:\n"
            "• _What are today's sales?_\n"
            "• _Show me low stock items_\n"
            "• _Create a PO for ABC Trading_\n"
            "• _Approve all pending pricing recommendations_\n\n"
            "📎 Send me a photo or PDF of a supplier invoice to import it.\n\n"
            "To link your system account, use:\n"
            "`/link your-email@company.com`",
        )
        return {"ok": True}

    if text.startswith("/link"):
        return _handle_link_command(text, msg, bot_token, company_id, chat_id)

    # Regular text → agent
    return _handle_text_message(text, msg, bot_token, company_id, system_user_id, chat_id)


# ---------------------------------------------------------------------------
# Text message handler → Kai agent
# ---------------------------------------------------------------------------

def _handle_text_message(
    text: str,
    msg: dict[str, Any],
    bot_token: str,
    company_id: str,
    system_user_id: str,
    chat_id: int | str,
) -> dict[str, Any]:
    """Route a text message through the Kai agent core."""
    chat_id_str = str(chat_id)

    # Send typing indicator
    _send_typing(bot_token, chat_id)

    # Resolve user
    linked_user = resolve_channel_user(company_id, "telegram", chat_id_str)
    if linked_user:
        user = linked_user
    else:
        user = {"user_id": system_user_id, "email": "telegram@integration"}

    # Check AI availability
    ai_config: dict[str, Any] = {}
    company_name = ""
    attention_items: list[dict[str, Any]] = []
    try:
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                if not is_external_ai_allowed(cur, company_id):
                    _send_message(bot_token, chat_id, "AI processing is not enabled for this company.")
                    return {"ok": True}
                ai_config = get_ai_provider_config(cur, company_id)
                if not ai_config.get("api_key") or not (ai_config.get("copilot_model") or ai_config.get("item_naming_model")):
                    _send_message(bot_token, chat_id, "AI provider is not configured. Please set up the AI settings in the admin panel.")
                    return {"ok": True}
                company_name = fetch_company_name(cur, company_id)
                attention_items = fetch_attention_items(cur, company_id)
    except Exception as e:
        logger.exception("Telegram: Failed to load AI config: %s", e)
        _send_message(bot_token, chat_id, "Sorry, I'm having trouble connecting to the system right now.")
        return {"ok": True}

    # Load user permissions
    user_permissions = None
    try:
        user_permissions = load_user_permissions(company_id, user["user_id"])
    except Exception:
        pass

    # Call agent
    try:
        result = agent_respond(
            user_query=text,
            company_id=company_id,
            company_name=company_name,
            user=user,
            ai_config=ai_config,
            channel="telegram",
            channel_user_id=chat_id_str,
            context={"channel": "telegram"},
            overview=None,
            attention=attention_items,
            user_permissions=user_permissions,
        )
    except Exception as e:
        logger.exception("Telegram: Agent respond failed: %s", e)
        _send_message(bot_token, chat_id, "Sorry, something went wrong processing your request.")
        return {"ok": True}

    answer = result.get("answer", "No response generated.")

    # Check for pending confirmation → show inline keyboard
    pending = result.get("pending_confirmation")
    if pending:
        reply_markup = {
            "inline_keyboard": [
                [
                    {"text": "✅ Confirm", "callback_data": f"confirm:{pending['id']}"},
                    {"text": "❌ Cancel", "callback_data": f"reject:{pending['id']}"},
                ]
            ]
        }
        _send_message(bot_token, chat_id, answer, reply_markup=reply_markup)
    else:
        _send_message(bot_token, chat_id, answer)

    return {"ok": True}


# ---------------------------------------------------------------------------
# Callback query handler (inline button presses)
# ---------------------------------------------------------------------------

def _handle_callback_query(
    update: dict[str, Any],
    bot_token: str,
    company_id: str,
    system_user_id: str,
) -> dict[str, Any]:
    """Handle inline keyboard button presses for confirmations."""
    cq = update["callback_query"]
    cq_id = cq.get("id")
    data = (cq.get("data") or "").strip()
    chat_id = cq.get("message", {}).get("chat", {}).get("id")
    chat_id_str = str(chat_id) if chat_id else ""

    # Acknowledge the callback
    _telegram_api(bot_token, "answerCallbackQuery", {"callback_query_id": cq_id})

    if not data or ":" not in data:
        return {"ok": True}

    action, conf_id = data.split(":", 1)

    # Resolve user
    linked_user = resolve_channel_user(company_id, "telegram", chat_id_str) if chat_id_str else None
    user = linked_user if linked_user else {"user_id": system_user_id, "email": "telegram@integration"}

    if action == "confirm":
        # Get the pending confirmation
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
            _send_message(bot_token, chat_id, "This action has expired or was already handled.")
            return {"ok": True}

        resolve_pending_confirmation(conf_id, company_id, "confirmed")
        result = execute_tool(row["tool_name"], row["arguments_json"], company_id, user)

        if result.error:
            _send_message(bot_token, chat_id, f"❌ Error: {result.error}")
        else:
            _send_message(bot_token, chat_id, f"✅ {result.message or 'Action completed.'}")

    elif action == "reject":
        resolve_pending_confirmation(conf_id, company_id, "rejected")
        _send_message(bot_token, chat_id, "❌ Action cancelled.")

    return {"ok": True}


# ---------------------------------------------------------------------------
# /link command handler
# ---------------------------------------------------------------------------

def _handle_link_command(
    text: str,
    msg: dict[str, Any],
    bot_token: str,
    company_id: str,
    chat_id: int | str,
) -> dict[str, Any]:
    """Link a Telegram user to their system account via email."""
    parts = text.split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        _send_message(
            bot_token, chat_id,
            "Usage: `/link your-email@company.com`\n\n"
            "This links your Telegram account to your system user, "
            "enabling personalized access and permissions.",
        )
        return {"ok": True}

    email = parts[1].strip().lower()
    chat_id_str = str(chat_id)

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # Find user by email
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
                _send_message(
                    bot_token, chat_id,
                    f"No user found with email `{email}` in this company. "
                    "Please check the email and try again.",
                )
                return {"ok": True}

            # Link
            link_channel_user(company_id, "telegram", chat_id_str, str(user_row["id"]))

            tg_from = msg.get("from") or {}
            tg_name = tg_from.get("first_name") or tg_from.get("username") or "User"

            _send_message(
                bot_token, chat_id,
                f"✅ Linked! {tg_name}, your Telegram is now connected to `{user_row['email']}`.\n\n"
                "Your actions through Kai will now use your personal permissions.",
            )

    return {"ok": True}


# ---------------------------------------------------------------------------
# Voice message handler (speech-to-text → agent)
# ---------------------------------------------------------------------------

def _handle_voice_message(
    voice: dict[str, Any],
    msg: dict[str, Any],
    bot_token: str,
    company_id: str,
    system_user_id: str,
    chat_id: int | str,
) -> dict[str, Any]:
    """Handle voice notes: download → speech-to-text → route through agent."""
    file_id = str(voice.get("file_id", ""))
    mime_type = str(voice.get("mime_type", "audio/ogg"))
    duration = int(voice.get("duration", 0))

    # Limit voice note duration (5 minutes max)
    if duration > 300:
        _send_message(bot_token, chat_id, "❌ Voice message too long (max 5 minutes).")
        return {"ok": True}

    _send_typing(bot_token, chat_id)

    try:
        # Download voice file from Telegram
        meta = _http_get_json(f"https://api.telegram.org/bot{bot_token}/getFile?file_id={file_id}")
        if not meta.get("ok"):
            _send_message(bot_token, chat_id, "❌ Failed to retrieve the voice message.")
            return {"ok": True}
        file_path = ((meta.get("result") or {}).get("file_path") or "")
        if not file_path:
            _send_message(bot_token, chat_id, "❌ Could not get voice file path.")
            return {"ok": True}

        raw = _http_get_bytes(f"https://api.telegram.org/file/bot{bot_token}/{file_path}")

        # Transcribe
        from ..ai.speech import transcribe_audio
        text = transcribe_audio(raw, mime_type, company_id)

        if not text:
            _send_message(
                bot_token, chat_id,
                "❌ I couldn't understand the voice message. Please try again or type your request.",
            )
            return {"ok": True}

        # Send transcription confirmation
        _send_message(bot_token, chat_id, f"🎤 _{text}_")

        # Route through the normal text handler
        return _handle_text_message(text, msg, bot_token, company_id, system_user_id, chat_id)

    except Exception as e:
        logger.exception("Telegram: Voice message processing failed: %s", e)
        _send_message(bot_token, chat_id, "❌ Failed to process voice message. Please try typing your request.")
        return {"ok": True}


# ---------------------------------------------------------------------------
# File upload handler (original v1 – supplier invoice import)
# ---------------------------------------------------------------------------

def _handle_file_upload(
    file_info: tuple[str, str, str, int],
    msg: dict[str, Any],
    bot_token: str,
    company_id: str,
    system_user_id: str,
    chat_id: int | str,
) -> dict[str, Any]:
    """Handle document/photo uploads – create supplier invoice drafts."""
    file_id, filename, content_type, size_guess = file_info

    try:
        max_mb = int(os.environ.get("ATTACHMENT_MAX_MB", "5"))
    except Exception:
        max_mb = 5
    max_mb = max(1, min(max_mb, 100))
    max_bytes = max_mb * 1024 * 1024

    if size_guess and size_guess > max_bytes:
        _send_message(bot_token, chat_id, f"❌ File too large (max {max_mb}MB).")
        raise HTTPException(status_code=413, detail=f"file too large (max {max_mb}MB)")

    # Download file from Telegram
    meta = _http_get_json(f"https://api.telegram.org/bot{bot_token}/getFile?file_id={file_id}")
    if not meta.get("ok"):
        _send_message(bot_token, chat_id, "❌ Failed to retrieve the file from Telegram.")
        raise HTTPException(status_code=400, detail=f"telegram getFile failed: {meta}")
    file_path = ((meta.get("result") or {}) or {}).get("file_path")
    if not file_path:
        raise HTTPException(status_code=400, detail="telegram getFile did not return file_path")

    raw = _http_get_bytes(f"https://api.telegram.org/file/bot{bot_token}/{file_path}")
    if len(raw) > max_bytes:
        _send_message(bot_token, chat_id, f"❌ File too large (max {max_mb}MB).")
        raise HTTPException(status_code=413, detail=f"file too large (max {max_mb}MB)")

    _send_typing(bot_token, chat_id)

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

    # Notify the user
    inv_id = res.get("id") or res.get("invoice_id") or ""
    inv_no = res.get("invoice_no") or ""
    _send_message(
        bot_token, chat_id,
        f"📄 Supplier invoice draft created!\n"
        f"Invoice: `{inv_no or inv_id}`\n"
        f"File: {filename}\n\n"
        "The AI will extract details in the background. "
        "Review it in the admin panel under Purchasing → Supplier Invoices.",
    )

    return {"ok": True, "supplier_invoice": res}
