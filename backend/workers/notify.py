"""
Lightweight notification helper for AI worker agents.

Workers run as standalone scripts with their own DB connections,
so this module provides a self-contained notification function
that doesn't depend on the FastAPI app module.

Usage from a worker:
    from notify import notify_critical_recommendation
    notify_critical_recommendation(conn, company_id, agent_code, rec_payload, severity="critical")
"""
import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

# Agent labels for notification formatting
_AGENT_LABELS = {
    "AI_INVENTORY": "📦 Stock Alert",
    "AI_PURCHASE": "🛒 Reorder Suggestion",
    "AI_DEMAND": "📈 Demand Forecast",
    "AI_PRICING": "💰 Pricing Alert",
    "AI_SHRINKAGE": "📉 Shrinkage Detection",
    "AI_ANOMALY": "⚠️ Anomaly Detected",
    "AI_CRM": "👤 Customer Alert",
    "AI_EXPIRY_OPS": "⏰ Expiry Warning",
    "AI_AP_GUARD": "📋 AP Alert",
    "AI_PRICE_IMPACT": "💹 Cost Impact",
    "AI_DATA_HYGIENE": "🧹 Data Quality",
    "AI_POS_SHIFT_VARIANCE": "🏪 Shift Variance",
}

_SEVERITY_ICONS = {
    "critical": "🔴",
    "high": "🔴",
    "warning": "🟡",
}


def notify_critical_recommendation(
    conn,
    company_id: str,
    agent_code: str,
    rec_payload: dict[str, Any],
    severity: str = "warning",
    rec_id: str | None = None,
) -> None:
    """
    Push a notification for a critical/warning recommendation to linked
    Telegram and WhatsApp users.

    Best-effort — never raises on failure.
    """
    if severity not in ("critical", "warning", "high"):
        return

    try:
        message = _format_message(agent_code, rec_payload, severity)
        if not message:
            return

        # Find linked users and load channel config from DB
        with conn.cursor() as cur:
            cur.execute(
                "SELECT set_config('app.current_company_id', %s::text, true)",
                (company_id,),
            )
            cur.execute(
                """
                SELECT channel, channel_user_id
                FROM ai_channel_user_links
                WHERE company_id = %s AND is_active = true
                """,
                (company_id,),
            )
            links = cur.fetchall()

            if not links:
                return

            # Load channel config from company_settings (with env fallback)
            channel_cfg = _load_channel_config(cur, company_id)

        for link in links:
            channel = link["channel"]
            channel_user_id = link["channel_user_id"]
            try:
                if channel == "telegram":
                    bot_token = channel_cfg.get("telegram", {}).get("bot_token", "")
                    _send_telegram(channel_user_id, message, rec_id, bot_token=bot_token)
                elif channel == "whatsapp":
                    wa_cfg = channel_cfg.get("whatsapp", {})
                    _send_whatsapp(channel_user_id, message, wa_cfg=wa_cfg)
            except Exception as e:
                logger.debug("Failed to send %s notification: %s", channel, e)

    except Exception as e:
        logger.debug("notify_critical_recommendation failed: %s", e)


def _format_message(
    agent_code: str,
    rec: dict[str, Any],
    severity: str,
) -> str:
    """Format recommendation as a human-readable notification."""
    label = _AGENT_LABELS.get(agent_code, f"🤖 {agent_code}")
    icon = _SEVERITY_ICONS.get(severity, "🟡")

    title = rec.get("title") or rec.get("name") or rec.get("item_name") or rec.get("sku") or ""
    summary = rec.get("summary") or rec.get("reason") or rec.get("message") or ""
    item_name = rec.get("name") or rec.get("item_name") or ""
    sku = rec.get("sku") or rec.get("item_sku") or ""
    qty = rec.get("reorder_qty") or rec.get("suggested_qty") or rec.get("qty") or ""
    on_hand = rec.get("qty_on_hand") or rec.get("on_hand_qty") or ""

    parts = [f"{icon} *{label}*"]
    if title and title != item_name:
        parts.append(f"**{title}**")
    if item_name:
        sku_part = f" ({sku})" if sku else ""
        parts.append(f"Item: {item_name}{sku_part}")
    if on_hand:
        parts.append(f"On hand: {on_hand}")
    if qty:
        parts.append(f"Suggested qty: {qty}")
    if summary:
        parts.append(f"\n{summary}")

    parts.append("\n_Reply to ask Kai for details or take action._")
    return "\n".join(parts)


def _load_channel_config(cur, company_id: str) -> dict[str, Any]:
    """Load Kai channel config from company_settings with env var fallback."""
    cfg: dict[str, Any] = {
        "telegram": {
            "bot_token": (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip(),
        },
        "whatsapp": {
            "api_url": (os.environ.get("WHATSAPP_API_URL") or "").strip(),
            "api_token": (os.environ.get("WHATSAPP_API_TOKEN") or "").strip(),
        },
    }
    try:
        cur.execute(
            "SELECT value_json FROM company_settings WHERE company_id = %s AND key = 'kai_channels' LIMIT 1",
            (company_id,),
        )
        row = cur.fetchone()
        if row:
            v = row.get("value_json") or row.get("value_json") or {}
            for channel in ("telegram", "whatsapp"):
                db_ch = v.get(channel) or {}
                for field, db_val in db_ch.items():
                    if field in cfg.get(channel, {}) and not cfg[channel][field]:
                        cfg[channel][field] = (db_val or "").strip()
    except Exception:
        pass
    return cfg


def _send_telegram(chat_id: str, message: str, rec_id: str | None = None, *, bot_token: str = "") -> None:
    """Send notification via Telegram Bot API."""
    bot_token = bot_token or (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not bot_token:
        return

    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown",
    }
    if rec_id:
        payload["reply_markup"] = {
            "inline_keyboard": [[
                {"text": "📋 View Details", "callback_data": f"view_rec:{rec_id}"},
                {"text": "✅ Approve", "callback_data": f"approve_rec:{rec_id}"},
            ]]
        }

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception as e:
        logger.debug("Telegram send failed: %s", e)


def _send_whatsapp(phone: str, message: str, *, wa_cfg: dict[str, str] | None = None) -> None:
    """Send notification via WhatsApp Business API."""
    cfg = wa_cfg or {}
    api_url = cfg.get("api_url", "") or (os.environ.get("WHATSAPP_API_URL") or "").strip()
    api_token = cfg.get("api_token", "") or (os.environ.get("WHATSAPP_API_TOKEN") or "").strip()
    if not api_url or not api_token:
        return

    payload = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "text",
        "text": {"body": message},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        api_url, data=data, method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception as e:
        logger.debug("WhatsApp send failed: %s", e)
