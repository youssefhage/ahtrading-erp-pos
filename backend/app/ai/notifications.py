"""
Proactive notification system for Kai.

Called from AI worker agents after creating critical recommendations.
Pushes alert messages to linked Telegram/WhatsApp users so they can
act immediately without logging into the admin UI.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
import urllib.error
from typing import Any

from ..db import get_conn, set_company_context

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API (called from workers)
# ---------------------------------------------------------------------------

def notify_recommendation(
    company_id: str,
    agent_code: str,
    recommendation_json: dict[str, Any],
    severity: str = "info",
    rec_id: str | None = None,
) -> None:
    """
    Send a notification about a new AI recommendation to linked channel users.

    Only sends for 'critical' and 'warning' severity to avoid spamming.
    Runs in a best-effort manner — never raises on failure.
    """
    if severity not in ("critical", "warning", "high"):
        return

    try:
        message = _format_recommendation_message(agent_code, recommendation_json, severity)
        if not message:
            return

        # Find linked users for this company who should receive notifications
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
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

        for link in links:
            channel = link["channel"]
            channel_user_id = link["channel_user_id"]
            try:
                if channel == "telegram":
                    _send_telegram_notification(channel_user_id, message, rec_id)
                elif channel == "whatsapp":
                    _send_whatsapp_notification(channel_user_id, message)
            except Exception as e:
                logger.warning(
                    "Failed to send %s notification to %s: %s",
                    channel, channel_user_id, e,
                )
    except Exception as e:
        logger.warning("notify_recommendation failed: %s", e)


def notify_system_alert(
    company_id: str,
    alert_type: str,
    message: str,
) -> None:
    """
    Send a system alert (e.g. outbox failures, job failures) to linked users.
    """
    try:
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
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

        formatted = f"🔔 *System Alert — {alert_type}*\n\n{message}"
        for link in links:
            try:
                if link["channel"] == "telegram":
                    _send_telegram_notification(link["channel_user_id"], formatted)
                elif link["channel"] == "whatsapp":
                    _send_whatsapp_notification(link["channel_user_id"], formatted)
            except Exception as e:
                logger.warning("Failed to send system alert: %s", e)
    except Exception as e:
        logger.warning("notify_system_alert failed: %s", e)


# ---------------------------------------------------------------------------
# Message formatting
# ---------------------------------------------------------------------------

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
    "info": "ℹ️",
}


def _format_recommendation_message(
    agent_code: str,
    rec_json: dict[str, Any],
    severity: str,
) -> str:
    """Format a recommendation as a human-readable notification message."""
    label = _AGENT_LABELS.get(agent_code, f"🤖 {agent_code}")
    icon = _SEVERITY_ICONS.get(severity, "ℹ️")

    # Extract key details from the recommendation payload
    title = rec_json.get("title") or rec_json.get("item_name") or rec_json.get("customer_name") or ""
    summary = rec_json.get("summary") or rec_json.get("reason") or rec_json.get("message") or ""

    # Item-specific details
    item_name = rec_json.get("item_name") or ""
    item_sku = rec_json.get("item_sku") or rec_json.get("sku") or ""
    qty = rec_json.get("suggested_qty") or rec_json.get("qty") or ""
    on_hand = rec_json.get("on_hand_qty") or rec_json.get("current_qty") or ""

    parts = [f"{icon} *{label}*"]
    if title:
        parts.append(f"**{title}**")
    if item_name and item_sku:
        parts.append(f"Item: {item_name} ({item_sku})")
    if on_hand:
        parts.append(f"On hand: {on_hand}")
    if qty:
        parts.append(f"Suggested qty: {qty}")
    if summary:
        parts.append(f"\n{summary}")

    parts.append("\n_Reply to ask Kai for details or take action._")

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Channel senders
# ---------------------------------------------------------------------------

def _send_telegram_notification(
    chat_id: str,
    message: str,
    rec_id: str | None = None,
) -> None:
    """Send a notification to a Telegram chat."""
    bot_token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not bot_token:
        return

    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown",
    }

    # Add action buttons if we have a recommendation ID
    if rec_id:
        payload["reply_markup"] = {
            "inline_keyboard": [
                [
                    {"text": "📋 View Details", "callback_data": f"view_rec:{rec_id}"},
                    {"text": "✅ Approve", "callback_data": f"approve_rec:{rec_id}"},
                ]
            ]
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
        logger.debug("Telegram notification failed: %s", e)


def _send_whatsapp_notification(
    phone: str,
    message: str,
) -> None:
    """
    Send a notification via WhatsApp.

    This is a placeholder — actual implementation depends on the WhatsApp
    Business API provider (Meta Cloud API, Twilio, etc.).  The pattern is:
    POST the message to the provider's API with the phone number.
    """
    whatsapp_api_url = (os.environ.get("WHATSAPP_API_URL") or "").strip()
    whatsapp_api_token = (os.environ.get("WHATSAPP_API_TOKEN") or "").strip()
    if not whatsapp_api_url or not whatsapp_api_token:
        return

    payload = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "text",
        "text": {"body": message},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        whatsapp_api_url, data=data, method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {whatsapp_api_token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except Exception as e:
        logger.debug("WhatsApp notification failed: %s", e)
