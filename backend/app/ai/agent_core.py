"""
Unified agent core for the Kai AI copilot.

This module replaces the limited two-tool copilot with a full agent that:
- Dynamically loads tools from the registry (read + write)
- Manages multi-turn conversations with persistent memory
- Enforces a confirmation flow for write operations
- Works across channels: Web UI, Telegram, WhatsApp

The agent core is channel-agnostic.  Channel adapters (web endpoint,
Telegram webhook, etc.) call into this module with a unified interface
and receive structured responses.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from datetime import date, datetime
from typing import Any, Generator, Optional
from uuid import UUID

from ..db import get_conn, set_company_context
from .tools import (
    ToolResult,
    build_openai_tools_array,
    execute_tool,
    get_all_tools,
    get_tool,
    get_tools_for_user,
)

# Import tools so they self-register via decorators at import time.
from .tools import read_tools as _read_tools  # noqa: F401
from .tools import write_tools as _write_tools  # noqa: F401
from .tools import compound_tools as _compound_tools  # noqa: F401

logger = logging.getLogger(__name__)

_MAX_TOOL_ROUNDS = 8  # Increased from 5 for richer multi-step conversations.
_MAX_TOOLS_PER_CALL = 25  # Limit tools sent to LLM to reduce token usage.

# ---------------------------------------------------------------------------
# Smart tool selection — keyword-based relevance filtering
# ---------------------------------------------------------------------------

# Maps keywords/phrases to tool names that are likely relevant.
_TOOL_RELEVANCE: dict[str, list[str]] = {
    # Inventory
    "stock": ["search_items", "get_stock_levels", "create_stock_adjustment", "expiring_batches"],
    "inventory": ["search_items", "get_stock_levels", "create_stock_adjustment", "expiring_batches"],
    "reorder": ["search_items", "get_stock_levels", "restock_check", "create_purchase_order"],
    "low stock": ["get_stock_levels", "restock_check", "create_purchase_order"],
    "expir": ["expiring_batches"],
    "batch": ["expiring_batches"],
    # Sales
    "sales": ["sales_summary", "recent_invoices", "customer_lookup"],
    "invoice": ["recent_invoices", "sales_summary"],
    "customer": ["customer_lookup", "create_customer"],
    "aging": ["aging_report"],
    "overdue": ["aging_report", "recent_invoices"],
    # Purchasing
    "purchase": ["create_purchase_order", "purchases_summary", "supplier_lookup"],
    "supplier": ["supplier_lookup", "purchases_summary", "create_purchase_order"],
    "po": ["create_purchase_order", "purchases_summary"],
    "buy": ["create_purchase_order", "get_stock_levels"],
    # Pricing
    "price": ["update_item_price", "search_items"],
    "margin": ["update_item_price", "search_items"],
    "cost": ["search_items", "update_item_price"],
    # Recommendations
    "recommend": ["query_recommendations", "decide_recommendation", "batch_decide_recommendations"],
    "approve": ["query_recommendations", "decide_recommendation", "batch_decide_recommendations"],
    "reject": ["query_recommendations", "decide_recommendation"],
    "pending": ["query_recommendations"],
    # Operations
    "outbox": ["pos_outbox_status", "retry_failed_outbox"],
    "sync": ["pos_outbox_status", "retry_failed_outbox"],
    "exchange": ["current_exchange_rate", "set_exchange_rate"],
    "rate": ["current_exchange_rate", "set_exchange_rate"],
    "period": ["accounting_period_locks"],
    "lock": ["accounting_period_locks"],
    "close": ["accounting_period_locks", "month_close_prep"],
    # Compound skills
    "briefing": ["morning_briefing"],
    "morning": ["morning_briefing"],
    "restock": ["restock_check"],
    "month close": ["month_close_prep"],
    "overview": ["operations_overview"],
    "health": ["operations_overview"],
    # Navigation
    "navigate": ["navigate"],
    "go to": ["navigate"],
    "open": ["navigate"],
    "page": ["navigate"],
}


def _select_relevant_tools(
    query: str,
    available_tools: list,
    *,
    max_tools: int = _MAX_TOOLS_PER_CALL,
) -> list:
    """
    Smart tool selection — filters available tools to the most relevant
    subset based on the user's query keywords.

    Falls back to all tools if no specific relevance is detected
    (e.g. for compound/broad queries like "what should I do today?").
    """
    if len(available_tools) <= max_tools:
        return available_tools

    query_lower = query.lower()

    # Score each tool based on keyword matches
    tool_scores: dict[str, float] = {}
    for keyword, tool_names in _TOOL_RELEVANCE.items():
        if keyword in query_lower:
            for tn in tool_names:
                tool_scores[tn] = tool_scores.get(tn, 0) + 1.0

    if not tool_scores:
        # No specific relevance detected — include all tools
        return available_tools

    # Always include core tools: navigate + search_items + operations_overview
    always_include = {"navigate", "search_items", "operations_overview"}

    scored = []
    unscored = []
    for t in available_tools:
        if t.name in always_include or t.name in tool_scores:
            scored.append((tool_scores.get(t.name, 0.5), t))
        else:
            unscored.append(t)

    # Sort scored tools by relevance (highest first)
    scored.sort(key=lambda x: x[0], reverse=True)
    selected = [t for _, t in scored]

    # Fill remaining slots with unscored tools
    remaining = max_tools - len(selected)
    if remaining > 0:
        selected.extend(unscored[:remaining])

    return selected

# ---------------------------------------------------------------------------
# 1. System Prompt
# ---------------------------------------------------------------------------

_PERSONALITY = """\
You are **Kai**, the AI operations copilot for Codex POS — a business \
management platform for wholesale/retail.  You are concise, data-driven, \
action-oriented, and helpful.

## Capabilities
You have access to a set of tools that let you **both read and modify** \
business data.  You can search products, check stock, look up customers, \
review sales, approve AI recommendations, create purchase orders, update \
prices, and more.

## Rules
1. Always use tools to get real data — **never invent numbers**.
2. When the user asks you to *do* something (create a PO, change a price, \
   approve recommendations, adjust stock), you must:
   a. First gather the necessary data via read tools.
   b. Present a clear confirmation summary showing what you will do, \
      including names, quantities, and amounts.
   c. **Wait for the user to say "yes" / "confirm" / "go ahead"** before \
      calling any write tool.
   d. After confirmation, call the write tool and report the result.
3. If the user says "no" or "cancel" to a pending confirmation, acknowledge \
   and do NOT execute the write tool.
4. For read-only questions, answer directly using tool results.
5. Use the navigate tool to direct users to relevant pages when helpful.
6. Respond in the same language the user writes in.
7. Keep answers short and practical — use bullet points and bold for clarity.
8. When you mention specific items, include SKU when available.
"""


def build_system_prompt(
    *,
    company_name: str,
    context: dict[str, Any] | None = None,
    overview: dict[str, Any] | None = None,
    attention: list[dict[str, Any]] | None = None,
    pending_confirmation: dict[str, Any] | None = None,
) -> str:
    parts: list[str] = [_PERSONALITY]

    parts.append(f"\n## Context\n- Company: {company_name or 'Unknown'}")
    parts.append(f"- Today: {date.today().isoformat()}")

    if context:
        page = context.get("page") or context.get("current_page")
        if page:
            parts.append(f"- User is currently on page: {page}")
        channel = context.get("channel")
        if channel:
            parts.append(f"- Channel: {channel}")

    # Metrics snapshot
    if overview:
        ai_info = overview.get("ai") or {}
        pending_recs = sum((ai_info.get("pending_recommendations_by_agent") or {}).values())
        pos_info = overview.get("pos") or {}
        outbox_failed = pos_info.get("outbox_failed", 0)
        inv_info = overview.get("inventory") or {}
        neg_stock = inv_info.get("negative_on_hand_rows", 0)
        jobs_info = overview.get("jobs") or {}
        failed_24h = jobs_info.get("failed_runs_24h", 0)

        parts.append("\n## Quick metrics")
        parts.append(f"- Pending AI recommendations: {pending_recs}")
        if outbox_failed:
            parts.append(f"- POS outbox failed events: {outbox_failed}")
        if neg_stock:
            parts.append(f"- Negative stock positions: {neg_stock}")
        if failed_24h:
            parts.append(f"- Failed background jobs (24h): {failed_24h}")

    if attention:
        critical = [a for a in attention if a.get("severity") == "critical"]
        warnings = [a for a in attention if a.get("severity") == "warning"]
        if critical or warnings:
            parts.append("\n## Attention items")
            for item in (critical + warnings)[:8]:
                parts.append(
                    f"- [{item.get('severity','info').upper()}] "
                    f"{item.get('label','?')}: {item.get('count',0)}"
                )

    # Pending confirmation context
    if pending_confirmation:
        parts.append(
            "\n## Pending confirmation\n"
            f"There is a pending action awaiting user confirmation:\n"
            f"- Tool: {pending_confirmation.get('tool_name')}\n"
            f"- Summary: {pending_confirmation.get('summary')}\n"
            "If the user says 'yes', 'confirm', or 'go ahead', execute the "
            "pending tool with the stored arguments.  If they say 'no', 'cancel', "
            "or change the request, abandon it and respond accordingly."
        )

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 2. Conversation memory
# ---------------------------------------------------------------------------

def get_or_create_conversation(
    company_id: str,
    user_id: str | None,
    channel: str = "web",
    channel_user_id: str | None = None,
    conversation_id: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """
    Retrieve an existing conversation or create a new one.
    Returns (conversation_id, history_messages).
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # Try to find existing conversation
            if conversation_id:
                cur.execute(
                    "SELECT id FROM ai_conversations WHERE id = %s AND company_id = %s",
                    (conversation_id, company_id),
                )
                if cur.fetchone():
                    return conversation_id, _load_history(cur, conversation_id)

            # For external channels, try to find by channel user
            if channel_user_id and channel != "web":
                cur.execute(
                    """
                    SELECT id FROM ai_conversations
                    WHERE company_id = %s AND channel = %s AND channel_user_id = %s
                      AND last_message_at > now() - interval '2 hours'
                    ORDER BY last_message_at DESC
                    LIMIT 1
                    """,
                    (company_id, channel, channel_user_id),
                )
                row = cur.fetchone()
                if row:
                    return str(row["id"]), _load_history(cur, str(row["id"]))

            # Create new conversation
            cur.execute(
                """
                INSERT INTO ai_conversations (company_id, user_id, channel, channel_user_id)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (company_id, user_id, channel, channel_user_id),
            )
            new_id = str(cur.fetchone()["id"])
            return new_id, []


def _load_history(cur, conversation_id: str, limit: int = 30) -> list[dict[str, Any]]:
    """Load recent messages for context injection."""
    cur.execute(
        """
        SELECT role, content, tool_calls_json, tool_call_id, tool_name
        FROM ai_conversation_messages
        WHERE conversation_id = %s
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (conversation_id, limit),
    )
    rows = list(reversed(cur.fetchall()))
    messages = []
    for r in rows:
        msg: dict[str, Any] = {"role": r["role"]}
        if r["content"]:
            msg["content"] = r["content"]
        if r["tool_calls_json"]:
            msg["tool_calls"] = r["tool_calls_json"]
            if not r["content"]:
                msg["content"] = None
        if r["tool_call_id"]:
            msg["tool_call_id"] = r["tool_call_id"]
            msg["content"] = r["content"] or ""
        messages.append(msg)
    return messages


def save_message(
    conversation_id: str,
    role: str,
    content: str | None = None,
    tool_calls: list[dict] | None = None,
    tool_call_id: str | None = None,
    tool_name: str | None = None,
) -> None:
    """Persist a message to conversation history."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_conversation_messages
                  (conversation_id, role, content, tool_calls_json, tool_call_id, tool_name)
                VALUES (%s, %s, %s, %s::jsonb, %s, %s)
                """,
                (
                    conversation_id, role, content,
                    json.dumps(tool_calls, default=str) if tool_calls else None,
                    tool_call_id, tool_name,
                ),
            )
            # Touch conversation
            cur.execute(
                "UPDATE ai_conversations SET last_message_at = now() WHERE id = %s",
                (conversation_id,),
            )


# ---------------------------------------------------------------------------
# 3. Pending confirmation management
# ---------------------------------------------------------------------------

def create_pending_confirmation(
    conversation_id: str,
    company_id: str,
    user_id: str | None,
    tool_name: str,
    arguments: dict[str, Any],
    summary: str,
) -> str:
    """Store a pending write-tool confirmation. Returns the confirmation ID."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            # Expire any previous pending confirmations for this conversation
            cur.execute(
                """
                UPDATE ai_pending_confirmations
                SET status = 'expired', decided_at = now()
                WHERE conversation_id = %s AND status = 'pending'
                """,
                (conversation_id,),
            )
            cur.execute(
                """
                INSERT INTO ai_pending_confirmations
                  (conversation_id, company_id, user_id, tool_name, arguments_json, summary)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s)
                RETURNING id
                """,
                (
                    conversation_id, company_id, user_id,
                    tool_name, json.dumps(arguments, default=str), summary,
                ),
            )
            return str(cur.fetchone()["id"])


def get_pending_confirmation(
    conversation_id: str,
    company_id: str,
) -> dict[str, Any] | None:
    """Get the current pending confirmation for a conversation, if any."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, user_id, tool_name, arguments_json, summary, created_at, expires_at
                FROM ai_pending_confirmations
                WHERE conversation_id = %s AND company_id = %s
                  AND status = 'pending'
                  AND (expires_at IS NULL OR expires_at > now())
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (conversation_id, company_id),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": str(row["id"]),
                "user_id": str(row["user_id"]) if row.get("user_id") else None,
                "tool_name": row["tool_name"],
                "arguments": row["arguments_json"],
                "summary": row["summary"],
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                "expires_at": row["expires_at"].isoformat() if row["expires_at"] else None,
            }


def resolve_pending_confirmation(
    confirmation_id: str,
    company_id: str,
    status: str,  # 'confirmed' or 'rejected'
) -> None:
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ai_pending_confirmations
                SET status = %s, decided_at = now()
                WHERE id = %s AND company_id = %s
                """,
                (status, confirmation_id, company_id),
            )


# ---------------------------------------------------------------------------
# 4. Channel user linking
# ---------------------------------------------------------------------------

def resolve_channel_user(
    company_id: str,
    channel: str,
    channel_user_id: str,
) -> dict[str, Any] | None:
    """Look up the system user linked to an external channel user."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT l.user_id, u.email
                FROM ai_channel_user_links l
                JOIN users u ON u.id = l.user_id
                WHERE l.company_id = %s AND l.channel = %s
                  AND l.channel_user_id = %s AND l.is_active = true
                LIMIT 1
                """,
                (company_id, channel, channel_user_id),
            )
            row = cur.fetchone()
            if row:
                return {"user_id": str(row["user_id"]), "email": row["email"]}
            return None


def link_channel_user(
    company_id: str,
    channel: str,
    channel_user_id: str,
    user_id: str,
) -> None:
    """Link an external channel user to a system user."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_channel_user_links
                  (company_id, channel, channel_user_id, user_id)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (company_id, channel, channel_user_id)
                DO UPDATE SET user_id = EXCLUDED.user_id, is_active = true, linked_at = now()
                """,
                (company_id, channel, channel_user_id, user_id),
            )


# ---------------------------------------------------------------------------
# 5. Synchronous agent response
# ---------------------------------------------------------------------------

def agent_respond(
    *,
    user_query: str,
    company_id: str,
    company_name: str,
    user: dict[str, Any],
    ai_config: dict[str, Any],
    conversation_id: str | None = None,
    channel: str = "web",
    channel_user_id: str | None = None,
    context: dict[str, Any] | None = None,
    overview: dict[str, Any] | None = None,
    attention: list[dict[str, Any]] | None = None,
    user_permissions: set[str] | None = None,
) -> dict[str, Any]:
    """
    Non-streaming agent response.  Returns::

        {
            "answer": str,
            "actions": list[dict],
            "conversation_id": str,
            "pending_confirmation": dict | None,
        }
    """
    model = ai_config.get("copilot_model") or ai_config.get("item_naming_model") or ""
    if not model:
        raise RuntimeError("No copilot model configured")
    base_url = ai_config.get("base_url") or "https://api.openai.com"
    api_key = ai_config.get("api_key") or ""
    if not api_key:
        raise RuntimeError("AI API key is not configured")

    # Get or create conversation
    conv_id, history = get_or_create_conversation(
        company_id, user.get("user_id"), channel, channel_user_id, conversation_id,
    )

    # Check for pending confirmation
    pending = get_pending_confirmation(conv_id, company_id)

    # Check if user is confirming or rejecting a pending action
    if pending and _is_confirmation(user_query):
        return _handle_confirmation(
            pending=pending,
            confirmed=True,
            company_id=company_id,
            user=user,
            conv_id=conv_id,
            user_permissions=user_permissions,
        )
    elif pending and _is_rejection(user_query):
        return _handle_confirmation(
            pending=pending,
            confirmed=False,
            company_id=company_id,
            user=user,
            conv_id=conv_id,
            user_permissions=user_permissions,
        )

    # Build system prompt
    ctx = dict(context or {})
    ctx["channel"] = channel
    system_prompt = build_system_prompt(
        company_name=company_name,
        context=ctx,
        overview=overview,
        attention=attention,
        pending_confirmation=pending,
    )

    # Build tool array filtered by user permissions + relevance
    available_tools = get_tools_for_user(user_permissions)
    available_tools = _select_relevant_tools(user_query, available_tools)
    openai_tools = build_openai_tools_array(available_tools)

    # Build messages
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_query})

    # Save user message
    save_message(conv_id, "user", user_query)

    actions: list[dict[str, Any]] = []
    confirmation_created = None

    for _round in range(_MAX_TOOL_ROUNDS):
        payload = _build_payload(messages, model, openai_tools, stream=False)
        result = _call_api(base_url, api_key, payload)

        choice = (result.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        finish = choice.get("finish_reason") or ""

        tool_calls = msg.get("tool_calls") or []
        if tool_calls and finish == "tool_call":
            messages.append(msg)

            for tc in tool_calls:
                fn = tc.get("function") or {}
                name = fn.get("name") or ""
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except (json.JSONDecodeError, TypeError):
                    args = {}

                tool_def = get_tool(name)

                # Check if this is a write tool requiring confirmation
                if tool_def and tool_def.requires_confirmation:
                    # Generate a summary and create a pending confirmation
                    summary = _build_confirmation_summary(tool_def, args)
                    conf_id = create_pending_confirmation(
                        conv_id, company_id, user.get("user_id"),
                        name, args, summary,
                    )
                    confirmation_created = {
                        "id": conf_id,
                        "tool_name": name,
                        "summary": summary,
                        "arguments": args,
                    }
                    # Tell the LLM the action is pending confirmation
                    tool_result_data = {
                        "status": "pending_confirmation",
                        "message": f"Action requires user confirmation. Summary presented to user: {summary}",
                    }
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id") or "",
                        "content": json.dumps(tool_result_data),
                    })
                    # Save tool call and result to history
                    save_message(conv_id, "assistant", tool_calls=[{
                        "id": tc.get("id"), "type": "function",
                        "function": {"name": name, "arguments": fn.get("arguments") or "{}"},
                    }])
                    save_message(conv_id, "tool", json.dumps(tool_result_data),
                                 tool_call_id=tc.get("id"), tool_name=name)
                else:
                    # Execute read tool directly
                    tool_result = execute_tool(name, args, company_id, user, user_permissions)
                    if tool_result.actions:
                        actions.extend(tool_result.actions)
                    result_data = tool_result.data if not tool_result.error else {"error": tool_result.error}
                    if tool_result.message:
                        result_data["_message"] = tool_result.message
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id") or "",
                        "content": json.dumps(result_data, default=str),
                    })
                    # Save to history
                    save_message(conv_id, "assistant", tool_calls=[{
                        "id": tc.get("id"), "type": "function",
                        "function": {"name": name, "arguments": fn.get("arguments") or "{}"},
                    }])
                    save_message(conv_id, "tool", json.dumps(result_data, default=str),
                                 tool_call_id=tc.get("id"), tool_name=name)

            continue

        # Text response
        answer = (msg.get("content") or "").strip()
        save_message(conv_id, "assistant", answer)

        return {
            "answer": answer,
            "actions": actions,
            "conversation_id": conv_id,
            "pending_confirmation": confirmation_created,
        }

    return {
        "answer": "I ran into a processing loop. Please try rephrasing your request.",
        "actions": actions,
        "conversation_id": conv_id,
        "pending_confirmation": None,
    }


# ---------------------------------------------------------------------------
# 6. Streaming agent response
# ---------------------------------------------------------------------------

def agent_stream(
    *,
    user_query: str,
    company_id: str,
    company_name: str,
    user: dict[str, Any],
    ai_config: dict[str, Any],
    conversation_id: str | None = None,
    channel: str = "web",
    channel_user_id: str | None = None,
    context: dict[str, Any] | None = None,
    overview: dict[str, Any] | None = None,
    attention: list[dict[str, Any]] | None = None,
    user_permissions: set[str] | None = None,
) -> Generator[str, None, None]:
    """
    Streaming agent response.  Yields SSE-formatted lines.

    Event types:
      data: {"type":"chunk","content":"..."}
      data: {"type":"action","action":{...}}
      data: {"type":"confirmation","confirmation":{...}}
      data: {"type":"done","full_answer":"...","conversation_id":"..."}
      data: {"type":"error","message":"..."}
    """
    model = ai_config.get("copilot_model") or ai_config.get("item_naming_model") or ""
    if not model:
        yield _sse({"type": "error", "message": "No copilot model configured"})
        yield _sse({"type": "done", "full_answer": "", "conversation_id": ""})
        return

    base_url = ai_config.get("base_url") or "https://api.openai.com"
    api_key = ai_config.get("api_key") or ""
    if not api_key:
        yield _sse({"type": "error", "message": "AI API key is not configured"})
        yield _sse({"type": "done", "full_answer": "", "conversation_id": ""})
        return

    # Get or create conversation
    conv_id, history = get_or_create_conversation(
        company_id, user.get("user_id"), channel, channel_user_id, conversation_id,
    )

    # Check for pending confirmation
    pending = get_pending_confirmation(conv_id, company_id)

    if pending and _is_confirmation(user_query):
        result = _handle_confirmation(pending, True, company_id, user, conv_id, user_permissions)
        yield _sse({"type": "chunk", "content": result["answer"]})
        for a in result.get("actions", []):
            yield _sse({"type": "action", "action": a})
        yield _sse({"type": "done", "full_answer": result["answer"], "conversation_id": conv_id})
        return
    elif pending and _is_rejection(user_query):
        result = _handle_confirmation(pending, False, company_id, user, conv_id, user_permissions)
        yield _sse({"type": "chunk", "content": result["answer"]})
        yield _sse({"type": "done", "full_answer": result["answer"], "conversation_id": conv_id})
        return

    ctx = dict(context or {})
    ctx["channel"] = channel
    system_prompt = build_system_prompt(
        company_name=company_name,
        context=ctx,
        overview=overview,
        attention=attention,
        pending_confirmation=pending,
    )

    available_tools = get_tools_for_user(user_permissions)
    available_tools = _select_relevant_tools(user_query, available_tools)
    openai_tools = build_openai_tools_array(available_tools)

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_query})
    save_message(conv_id, "user", user_query)

    actions: list[dict[str, Any]] = []
    full_answer = ""

    try:
        for _round in range(_MAX_TOOL_ROUNDS):
            payload = _build_payload(messages, model, openai_tools, stream=True)
            url = f"{base_url.rstrip('/')}/v1/chat/completions"
            req = urllib.request.Request(
                url,
                data=json.dumps(payload, default=str).encode("utf-8"),
                headers=_auth_headers(api_key),
                method="POST",
            )
            try:
                resp = urllib.request.urlopen(req, timeout=90)
            except urllib.error.HTTPError as e:
                logger.exception("AI provider HTTP error in streaming: %s", e)
                yield _sse({"type": "error", "message": "An error occurred while processing your request. Please try again."})
                yield _sse({"type": "done", "full_answer": full_answer, "conversation_id": conv_id})
                return
            except Exception as e:
                logger.exception("Connection error in streaming: %s", e)
                yield _sse({"type": "error", "message": "An error occurred while processing your request. Please try again."})
                yield _sse({"type": "done", "full_answer": full_answer, "conversation_id": conv_id})
                return

            round_content = ""
            round_tool_calls: dict[int, dict[str, Any]] = {}
            finish_reason = ""

            try:
                for raw_line in resp:
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    delta = ((chunk.get("choices") or [{}])[0].get("delta") or {})
                    fr = ((chunk.get("choices") or [{}])[0].get("finish_reason") or "")
                    if fr:
                        finish_reason = fr

                    text_piece = delta.get("content") or ""
                    if text_piece:
                        round_content += text_piece
                        full_answer += text_piece
                        yield _sse({"type": "chunk", "content": text_piece})

                    for tc_delta in (delta.get("tool_calls") or []):
                        idx = tc_delta.get("index", 0)
                        if idx not in round_tool_calls:
                            round_tool_calls[idx] = {"id": "", "name": "", "arguments": ""}
                        if tc_delta.get("id"):
                            round_tool_calls[idx]["id"] = tc_delta["id"]
                        fn = tc_delta.get("function") or {}
                        if fn.get("name"):
                            round_tool_calls[idx]["name"] = fn["name"]
                        if fn.get("arguments"):
                            round_tool_calls[idx]["arguments"] += fn["arguments"]
            finally:
                resp.close()

            if round_tool_calls and finish_reason == "tool_call":
                assistant_msg: dict[str, Any] = {"role": "assistant", "content": round_content or None}
                tc_list = []
                for idx in sorted(round_tool_calls.keys()):
                    tc = round_tool_calls[idx]
                    tc_list.append({
                        "id": tc["id"], "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    })
                assistant_msg["tool_calls"] = tc_list
                messages.append(assistant_msg)

                for tc in tc_list:
                    fn_name = tc["function"]["name"]
                    try:
                        fn_args = json.loads(tc["function"]["arguments"] or "{}")
                    except (json.JSONDecodeError, TypeError):
                        fn_args = {}

                    tool_def = get_tool(fn_name)

                    if tool_def and tool_def.requires_confirmation:
                        summary = _build_confirmation_summary(tool_def, fn_args)
                        conf_id = create_pending_confirmation(
                            conv_id, company_id, user.get("user_id"),
                            fn_name, fn_args, summary,
                        )
                        yield _sse({
                            "type": "confirmation",
                            "confirmation": {
                                "id": conf_id,
                                "tool_name": fn_name,
                                "summary": summary,
                            },
                        })
                        tool_result_data = {
                            "status": "pending_confirmation",
                            "message": f"Action requires user confirmation. Summary: {summary}",
                        }
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": json.dumps(tool_result_data),
                        })
                        save_message(conv_id, "assistant", tool_calls=[tc])
                        save_message(conv_id, "tool", json.dumps(tool_result_data),
                                     tool_call_id=tc["id"], tool_name=fn_name)
                    else:
                        tool_result = execute_tool(fn_name, fn_args, company_id, user, user_permissions)
                        if tool_result.actions:
                            actions.extend(tool_result.actions)
                            for a in tool_result.actions:
                                yield _sse({"type": "action", "action": a})
                        result_data = tool_result.data if not tool_result.error else {"error": tool_result.error}
                        if tool_result.message:
                            result_data["_message"] = tool_result.message
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": json.dumps(result_data, default=str),
                        })
                        save_message(conv_id, "assistant", tool_calls=[tc])
                        save_message(conv_id, "tool", json.dumps(result_data, default=str),
                                     tool_call_id=tc["id"], tool_name=fn_name)
                continue

            break

        if full_answer:
            save_message(conv_id, "assistant", full_answer)

        yield _sse({"type": "done", "full_answer": full_answer, "conversation_id": conv_id})

    except Exception as exc:
        logger.exception("agent streaming error: %s", exc)
        yield _sse({"type": "error", "message": "An error occurred while processing your request. Please try again."})
        yield _sse({"type": "done", "full_answer": full_answer, "conversation_id": conv_id})


# ---------------------------------------------------------------------------
# 7. Confirmation handling
# ---------------------------------------------------------------------------

def _is_confirmation(text: str) -> bool:
    t = text.strip().lower()
    confirms = {
        "yes", "y", "confirm", "confirmed", "go ahead", "do it", "proceed",
        "ok", "okay", "sure", "yep", "yeah", "approve", "approved",
        "نعم", "اكيد", "ماشي", "تمام", "يلا",
    }
    return t in confirms or t.startswith("yes ")


def _is_rejection(text: str) -> bool:
    t = text.strip().lower()
    rejects = {
        "no", "n", "cancel", "cancelled", "stop", "don't", "dont",
        "never mind", "nevermind", "abort", "reject", "nope", "nah",
        "لا", "الغي", "الغاء",
    }
    return t in rejects or t.startswith("no ")


def _handle_confirmation(
    pending: dict[str, Any],
    confirmed: bool,
    company_id: str,
    user: dict[str, Any],
    conv_id: str,
    user_permissions: set[str] | None = None,
) -> dict[str, Any]:
    """Execute or reject a pending confirmation."""
    # Verify the confirming user matches the user who initiated the action
    if pending.get("user_id") and pending["user_id"] != user.get("user_id"):
        return {
            "answer": "You cannot confirm another user's pending action.",
            "actions": [],
            "conversation_id": conv_id,
            "pending_confirmation": None,
        }

    conf_id = pending["id"]
    tool_name = pending["tool_name"]
    args = pending["arguments"]

    if confirmed:
        resolve_pending_confirmation(conf_id, company_id, "confirmed")
        # Execute the write tool
        result = execute_tool(tool_name, args, company_id, user, user_permissions)
        answer = result.message if result.message else "Action completed."
        if result.error:
            answer = f"Error: {result.error}"
        save_message(conv_id, "user", "confirmed")
        save_message(conv_id, "assistant", answer)
        return {
            "answer": answer,
            "actions": result.actions,
            "conversation_id": conv_id,
            "pending_confirmation": None,
        }
    else:
        resolve_pending_confirmation(conf_id, company_id, "rejected")
        answer = "Action cancelled."
        save_message(conv_id, "user", "cancelled")
        save_message(conv_id, "assistant", answer)
        return {
            "answer": answer,
            "actions": [],
            "conversation_id": conv_id,
            "pending_confirmation": None,
        }


def _build_confirmation_summary(tool_def, args: dict[str, Any]) -> str:
    """Build a human-readable summary of a pending write action."""
    parts = [f"**{tool_def.confirm_verb} {tool_def.confirm_entity}**"]
    # Add key details from arguments
    for key, val in args.items():
        if val is None or val == "":
            continue
        label = key.replace("_", " ").title()
        if isinstance(val, list):
            parts.append(f"- {label}: {len(val)} item(s)")
            for i, item in enumerate(val[:5]):
                if isinstance(item, dict):
                    item_desc = ", ".join(f"{k}: {v}" for k, v in item.items() if v)
                    parts.append(f"  {i+1}. {item_desc}")
        else:
            parts.append(f"- {label}: {val}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 8. HTTP / API helpers
# ---------------------------------------------------------------------------

def _build_payload(
    messages: list[dict[str, Any]],
    model: str,
    tools: list[dict[str, Any]],
    *,
    stream: bool = False,
) -> dict[str, Any]:
    return {
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "stream": stream,
        "temperature": 0.3,
    }


def _auth_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _call_api(base_url: str, api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/v1/chat/completions"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, default=str).encode("utf-8"),
        headers=_auth_headers(api_key),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
        raise RuntimeError(f"AI provider HTTP {getattr(e, 'code', '?')}: {body[:500]}") from e


def _sse(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data, default=str)}\n\n"


# ---------------------------------------------------------------------------
# 9. User permission loader
# ---------------------------------------------------------------------------

def load_user_permissions(company_id: str, user_id: str) -> set[str]:
    """Load permission codes for a user in a company."""
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT p.code
                FROM user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE ur.user_id = %s AND ur.company_id = %s
                """,
                (user_id, company_id),
            )
            return {r["code"] for r in cur.fetchall()}
