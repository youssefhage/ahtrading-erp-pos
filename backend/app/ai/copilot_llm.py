"""
LLM orchestration for the enhanced Kai copilot.

This module handles building prompts, defining tool schemas, and making
streaming / non-streaming calls to the configured AI provider.  It is
intentionally read-only: the LLM can *query* business data through
well-defined tool calls, but cannot mutate state.

All external HTTP calls are wrapped in try/except so that LLM errors
never crash the endpoint.
"""
from __future__ import annotations

import json
import logging
import urllib.request
import urllib.error
from datetime import date, datetime
from typing import Any, Generator

from ..db import get_conn, set_company_context

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 1. System prompt builder
# ---------------------------------------------------------------------------

_PERSONALITY = (
    "You are Kai, the AI operations copilot for a business management platform "
    "(Codex POS). You are concise, data-driven, action-oriented, and helpful. "
    "Answer with short, practical sentences. When you have data, reference "
    "specific numbers. When you suggest an action, tell the user exactly "
    "where to go in the app (use the navigate tool when appropriate). "
    "Never invent data you haven't retrieved via a tool call. "
    "If you don't know, say so honestly. "
    "Respond in the same language the user writes in."
)


def _build_system_prompt(
    *,
    company_name: str,
    context: dict[str, Any] | None = None,
    overview: dict[str, Any] | None = None,
    attention: list[dict[str, Any]] | None = None,
) -> str:
    parts: list[str] = [_PERSONALITY]

    parts.append(f"\n## Context\n- Company: {company_name or 'Unknown'}")
    parts.append(f"- Today: {date.today().isoformat()}")

    if context:
        page = context.get("page") or context.get("current_page")
        if page:
            parts.append(f"- User is currently on page: {page}")

    # Inject a compact metrics snapshot so the LLM can answer basic questions
    # without needing a tool call.
    if overview:
        ai_info = overview.get("ai") or {}
        pending_recs = sum((ai_info.get("pending_recommendations_by_agent") or {}).values())
        recs_by_status = ai_info.get("recommendations_by_status") or {}
        pos_info = overview.get("pos") or {}
        outbox_failed = pos_info.get("outbox_failed", 0)
        inv_info = overview.get("inventory") or {}
        neg_stock = inv_info.get("negative_on_hand_rows", 0)
        jobs_info = overview.get("jobs") or {}
        failed_24h = jobs_info.get("failed_runs_24h", 0)

        parts.append("\n## Quick metrics snapshot")
        parts.append(f"- Pending AI recommendations: {pending_recs}")
        if recs_by_status:
            parts.append(f"- All recommendations by status: {json.dumps(recs_by_status)}")
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
                    f"{item.get('label','?')}: {item.get('count',0)} "
                    f"(link: {item.get('href','')})"
                )

    parts.append(
        "\n## Tool usage\n"
        "Use the query_data tool to fetch live data when the user asks about "
        "recommendations, anomalies, POS sync, period locks, or metrics. "
        "Use the navigate tool to direct the user to a specific page."
    )

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 2. Tool / function schemas (OpenAI function-calling format)
# ---------------------------------------------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "query_data",
            "description": (
                "Query business data. Use this to look up live operational data "
                "when the user asks a question that needs current numbers."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {
                        "type": "string",
                        "enum": [
                            "recommendations",
                            "attention",
                            "metrics",
                            "pos_outbox",
                            "period_locks",
                        ],
                        "description": (
                            "Which data source to query. "
                            "'recommendations' = pending AI recommendations, "
                            "'attention' = ops attention items, "
                            "'metrics' = sales/purchases/AR today, "
                            "'pos_outbox' = POS sync queue breakdown, "
                            "'period_locks' = active accounting period locks."
                        ),
                    },
                    "filter": {
                        "type": "string",
                        "description": (
                            "Optional filter. For 'recommendations' this can be an "
                            "agent_code like 'AI_DEMAND', 'AI_PURCHASE', 'AI_ANOMALY', "
                            "'AI_SHRINKAGE', 'AI_INVENTORY', 'AI_PRICING'. "
                            "For others, ignored."
                        ),
                    },
                },
                "required": ["source"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "navigate",
            "description": (
                "Navigate the user to a specific page in the application. "
                "Use this when the user wants to see something or you want to "
                "direct them to take action."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "page": {
                        "type": "string",
                        "description": (
                            "The app route to navigate to, e.g. "
                            "'/automation/ai-hub', '/purchasing/supplier-invoices', "
                            "'/inventory/stock', '/system/outbox', "
                            "'/system/pos-shifts', '/sales/invoices', "
                            "'/purchasing/purchase-orders', '/purchasing/goods-receipts', "
                            "'/inventory/alerts', '/inventory/batches', "
                            "'/accounting/period-locks'."
                        ),
                    },
                    "reason": {
                        "type": "string",
                        "description": "Brief reason for the navigation suggestion.",
                    },
                },
                "required": ["page"],
                "additionalProperties": False,
            },
        },
    },
]


# ---------------------------------------------------------------------------
# 3. Tool execution (read-only DB queries)
# ---------------------------------------------------------------------------

def _validate_internal_url(page: str) -> str:
    """Validate that a URL is internal (relative path only)."""
    from urllib.parse import urlparse

    page = (page or "").strip()
    if not page:
        return "/"
    parsed = urlparse(page)
    if parsed.scheme or parsed.netloc:
        return "/"  # Silently block external URLs
    if not page.startswith("/"):
        page = "/" + page
    if "//" in page or "\\" in page:
        return "/"
    return page


def _execute_tool_call(
    tool_name: str,
    arguments: dict[str, Any],
    company_id: str,
) -> dict[str, Any]:
    """
    Execute a tool call and return a JSON-serializable result dict.
    All queries are read-only.
    """
    if tool_name == "navigate":
        # Navigation is a client-side action; echo it back.
        # Include both page/reason (internal) and href/label (frontend KaiAction).
        page = _validate_internal_url(arguments.get("page", "/"))
        reason = arguments.get("reason", "")
        return {"navigated": True, "page": page, "reason": reason, "href": page, "label": reason}

    if tool_name == "query_data":
        source = (arguments.get("source") or "").strip()
        filt = (arguments.get("filter") or "").strip().upper()
        return _query_data(source, filt, company_id)

    return {"error": f"Unknown tool: {tool_name}"}


def _query_data(source: str, filt: str, company_id: str) -> dict[str, Any]:
    try:
        with get_conn() as conn:
            set_company_context(conn, company_id)
            with conn.cursor() as cur:
                if source == "recommendations":
                    agent_filter = ""
                    params: list[Any] = [company_id]
                    if filt:
                        agent_filter = "AND r.agent_code = %s"
                        params.append(filt)
                    cur.execute(
                        f"""
                        SELECT r.id, r.agent_code, r.created_at,
                               r.recommendation_json
                        FROM ai_recommendations r
                        WHERE r.company_id = %s
                          AND r.status = 'pending'
                          {agent_filter}
                        ORDER BY r.created_at DESC
                        LIMIT 25
                        """,
                        tuple(params),
                    )
                    rows = cur.fetchall()
                    return {"source": "recommendations", "count": len(rows), "rows": _serialize_rows(rows)}

                elif source == "attention":
                    # Re-use the attention query inline (lightweight version).
                    cur.execute(
                        "SELECT COUNT(*)::int AS c FROM ai_recommendations WHERE company_id=%s AND status='pending'",
                        (company_id,),
                    )
                    pending_ai = int(cur.fetchone()["c"])
                    cur.execute(
                        """
                        SELECT COUNT(*)::int AS c FROM pos_events_outbox
                        WHERE company_id=%s AND status='failed'
                        """,
                        (company_id,),
                    )
                    outbox_failed = int(cur.fetchone()["c"])
                    cur.execute(
                        "SELECT COUNT(*)::int AS c FROM item_warehouse_costs WHERE company_id=%s AND on_hand_qty < 0",
                        (company_id,),
                    )
                    neg_stock = int(cur.fetchone()["c"])
                    cur.execute(
                        """
                        SELECT COUNT(*)::int AS c FROM supplier_invoices
                        WHERE company_id=%s AND status='draft' AND is_on_hold=true
                        """,
                        (company_id,),
                    )
                    on_hold = int(cur.fetchone()["c"])
                    return {
                        "source": "attention",
                        "pending_ai_recommendations": pending_ai,
                        "pos_outbox_failed": outbox_failed,
                        "negative_stock_positions": neg_stock,
                        "supplier_invoices_on_hold": on_hold,
                    }

                elif source == "metrics":
                    cur.execute(
                        """
                        SELECT
                          (SELECT COALESCE(SUM(total_usd),0) FROM sales_invoices
                           WHERE company_id=%s AND status='posted'
                             AND created_at::date=current_date) AS sales_today_usd,
                          (SELECT COALESCE(SUM(total_lbp),0) FROM sales_invoices
                           WHERE company_id=%s AND status='posted'
                             AND created_at::date=current_date) AS sales_today_lbp,
                          (SELECT COALESCE(SUM(total_usd),0) FROM supplier_invoices
                           WHERE company_id=%s AND status='posted'
                             AND created_at::date=current_date) AS purchases_today_usd,
                          (SELECT COALESCE(SUM(total_lbp),0) FROM supplier_invoices
                           WHERE company_id=%s AND status='posted'
                             AND created_at::date=current_date) AS purchases_today_lbp
                        """,
                        (company_id, company_id, company_id, company_id),
                    )
                    row = cur.fetchone()
                    return {
                        "source": "metrics",
                        "sales_today_usd": str(row["sales_today_usd"]),
                        "sales_today_lbp": str(row["sales_today_lbp"]),
                        "purchases_today_usd": str(row["purchases_today_usd"]),
                        "purchases_today_lbp": str(row["purchases_today_lbp"]),
                    }

                elif source == "pos_outbox":
                    cur.execute(
                        """
                        SELECT d.device_code, o.status, COUNT(*)::int AS count
                        FROM pos_events_outbox o
                        JOIN pos_devices d ON d.id = o.device_id
                        WHERE d.company_id = %s
                        GROUP BY d.device_code, o.status
                        ORDER BY d.device_code, o.status
                        """,
                        (company_id,),
                    )
                    rows = cur.fetchall()
                    return {"source": "pos_outbox", "rows": _serialize_rows(rows)}

                elif source == "period_locks":
                    cur.execute(
                        """
                        SELECT id, start_date, end_date, reason, created_at
                        FROM accounting_period_locks
                        WHERE company_id = %s AND locked = true
                        ORDER BY end_date DESC, created_at DESC
                        LIMIT 20
                        """,
                        (company_id,),
                    )
                    rows = cur.fetchall()
                    return {"source": "period_locks", "count": len(rows), "rows": _serialize_rows(rows)}

                else:
                    return {"error": f"Unknown data source: {source}"}
    except Exception as exc:
        logger.exception("copilot tool query_data failed: %s", exc)
        return {"error": "An error occurred while querying data. Please try again."}


def _serialize_rows(rows: list[Any]) -> list[dict[str, Any]]:
    """Make DB rows JSON-safe (datetimes, Decimals, etc.)."""
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r) if hasattr(r, "keys") else r
        out.append({k: _json_safe(v) for k, v in d.items()})
    return out


def _json_safe(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, (int, float, bool)):
        return val
    if isinstance(val, str):
        return val
    if isinstance(val, dict):
        return {k: _json_safe(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_json_safe(i) for i in val]
    # Decimal, UUID, etc.
    return str(val)


# ---------------------------------------------------------------------------
# 4. OpenAI Chat Completions API helpers
# ---------------------------------------------------------------------------

_MAX_TOOL_ROUNDS = 5  # Safety cap on back-and-forth tool call loops.


def _build_messages(
    user_query: str,
    system_prompt: str,
    history: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    msgs: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    if history:
        msgs.extend(history)
    msgs.append({"role": "user", "content": user_query})
    return msgs


def _chat_completions_payload(
    messages: list[dict[str, Any]],
    model: str,
    *,
    stream: bool = False,
) -> dict[str, Any]:
    return {
        "model": model,
        "messages": messages,
        "tools": TOOLS,
        "tool_choice": "auto",
        "stream": stream,
        "temperature": 0.3,
    }


def _api_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/v1/chat/completions"


def _auth_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# 5. Synchronous (non-streaming) copilot response
# ---------------------------------------------------------------------------

def sync_copilot_response(
    *,
    user_query: str,
    company_id: str,
    company_name: str,
    ai_config: dict[str, Any],
    context: dict[str, Any] | None = None,
    overview: dict[str, Any] | None = None,
    attention: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Make a non-streaming call to the LLM.  Returns
    ``{"answer": str, "actions": list[dict]}``.
    """
    model = ai_config.get("copilot_model") or ai_config.get("item_naming_model") or ""
    if not model:
        raise RuntimeError("No copilot model configured")

    base_url = ai_config.get("base_url") or "https://api.openai.com"
    api_key = ai_config.get("api_key") or ""
    if not api_key:
        raise RuntimeError("AI API key is not configured")

    system_prompt = _build_system_prompt(
        company_name=company_name,
        context=context,
        overview=overview,
        attention=attention,
    )

    messages = _build_messages(user_query, system_prompt)
    actions: list[dict[str, Any]] = []

    for _round in range(_MAX_TOOL_ROUNDS):
        payload = _chat_completions_payload(messages, model, stream=False)
        result = _call_chat_completions(base_url, api_key, payload)

        choice = (result.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        finish = choice.get("finish_reason") or ""

        # If the model wants to call tools, execute and loop.
        tool_calls = msg.get("tool_calls") or []
        if tool_calls and finish == "tool_call":
            # Append the assistant message with tool calls.
            messages.append(msg)
            for tc in tool_calls:
                fn = tc.get("function") or {}
                name = fn.get("name") or ""
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except (json.JSONDecodeError, TypeError):
                    args = {}
                tool_result = _execute_tool_call(name, args, company_id)
                if name == "navigate":
                    actions.append({"type": "navigate", **tool_result})
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id") or "",
                    "content": json.dumps(tool_result, default=str),
                })
            continue  # Next round with tool results.

        # Normal text response -- we're done.
        answer = (msg.get("content") or "").strip()
        return {"answer": answer, "actions": actions}

    # Exhausted tool rounds.
    return {"answer": "I ran into a loop processing your request. Please try rephrasing.", "actions": actions}


def _call_chat_completions(base_url: str, api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = _api_url(base_url)
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


# ---------------------------------------------------------------------------
# 6. Streaming copilot response (SSE generator)
# ---------------------------------------------------------------------------

def stream_copilot_response(
    *,
    user_query: str,
    company_id: str,
    company_name: str,
    ai_config: dict[str, Any],
    context: dict[str, Any] | None = None,
    overview: dict[str, Any] | None = None,
    attention: list[dict[str, Any]] | None = None,
) -> Generator[str, None, None]:
    """
    Synchronous generator that yields SSE-formatted lines.

    Event types:
      data: {"type":"chunk","content":"..."}
      data: {"type":"action","action":{...}}
      data: {"type":"done","full_answer":"..."}
      data: {"type":"error","message":"..."}

    We use urllib (synchronous) because FastAPI's StreamingResponse works
    fine with sync generators and the existing codebase doesn't use async.
    """
    model = ai_config.get("copilot_model") or ai_config.get("item_naming_model") or ""
    if not model:
        yield _sse({"type": "error", "message": "No copilot model configured"})
        yield _sse({"type": "done", "full_answer": ""})
        return

    base_url = ai_config.get("base_url") or "https://api.openai.com"
    api_key = ai_config.get("api_key") or ""
    if not api_key:
        yield _sse({"type": "error", "message": "AI API key is not configured"})
        yield _sse({"type": "done", "full_answer": ""})
        return

    system_prompt = _build_system_prompt(
        company_name=company_name,
        context=context,
        overview=overview,
        attention=attention,
    )
    messages = _build_messages(user_query, system_prompt)
    actions: list[dict[str, Any]] = []
    full_answer = ""

    try:
        messages_for_round = list(messages)
        for _round in range(_MAX_TOOL_ROUNDS):
            payload = _chat_completions_payload(messages_for_round, model, stream=True)
            url = _api_url(base_url)
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
                yield _sse({"type": "done", "full_answer": full_answer})
                return
            except Exception as e:
                logger.exception("Connection error in streaming: %s", e)
                yield _sse({"type": "error", "message": "An error occurred while processing your request. Please try again."})
                yield _sse({"type": "done", "full_answer": full_answer})
                return

            # Parse SSE stream from the provider.
            round_content = ""
            round_tool_calls: dict[int, dict[str, Any]] = {}  # index -> {id, name, arguments}
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

                    # Text content
                    text_piece = delta.get("content") or ""
                    if text_piece:
                        round_content += text_piece
                        full_answer += text_piece
                        yield _sse({"type": "chunk", "content": text_piece})

                    # Tool calls (streamed incrementally)
                    for tc_delta in (delta.get("tool_calls") or []):
                        idx = tc_delta.get("index", 0)
                        if idx not in round_tool_calls:
                            round_tool_calls[idx] = {
                                "id": tc_delta.get("id") or "",
                                "name": "",
                                "arguments": "",
                            }
                        if tc_delta.get("id"):
                            round_tool_calls[idx]["id"] = tc_delta["id"]
                        fn = tc_delta.get("function") or {}
                        if fn.get("name"):
                            round_tool_calls[idx]["name"] = fn["name"]
                        if fn.get("arguments"):
                            round_tool_calls[idx]["arguments"] += fn["arguments"]
            finally:
                resp.close()

            # If tool calls were requested, execute them and loop.
            if round_tool_calls and finish_reason == "tool_call":
                assistant_msg: dict[str, Any] = {"role": "assistant", "content": round_content or None}
                tc_list = []
                for idx in sorted(round_tool_calls.keys()):
                    tc = round_tool_calls[idx]
                    tc_list.append({
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    })
                assistant_msg["tool_calls"] = tc_list
                messages_for_round.append(assistant_msg)

                for tc in tc_list:
                    fn_name = tc["function"]["name"]
                    try:
                        fn_args = json.loads(tc["function"]["arguments"] or "{}")
                    except (json.JSONDecodeError, TypeError):
                        fn_args = {}
                    tool_result = _execute_tool_call(fn_name, fn_args, company_id)
                    if fn_name == "navigate":
                        actions.append({"type": "navigate", **tool_result})
                        yield _sse({"type": "action", "action": {"type": "navigate", **tool_result}})
                    messages_for_round.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(tool_result, default=str),
                    })
                continue  # Next round.

            # Normal completion -- done.
            break

        # Emit any remaining actions and the done event.
        yield _sse({"type": "done", "full_answer": full_answer})

    except Exception as exc:
        logger.exception("copilot streaming error: %s", exc)
        yield _sse({"type": "error", "message": "An error occurred while processing your request. Please try again."})
        yield _sse({"type": "done", "full_answer": full_answer})


def _sse(data: dict[str, Any]) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(data, default=str)}\n\n"


# ---------------------------------------------------------------------------
# 7. Helpers for fetching context data (used by the endpoint)
# ---------------------------------------------------------------------------

def fetch_company_name(cur, company_id: str) -> str:
    try:
        cur.execute("SELECT name FROM companies WHERE id = %s", (company_id,))
        row = cur.fetchone()
        return str((row or {}).get("name") or "").strip()
    except Exception:
        return ""


def fetch_attention_items(cur, company_id: str) -> list[dict[str, Any]]:
    """Lightweight fetch of attention-worthy counters for the system prompt."""
    items: list[dict[str, Any]] = []
    try:
        cur.execute(
            "SELECT COUNT(*)::int AS c FROM ai_recommendations WHERE company_id=%s AND status='pending'",
            (company_id,),
        )
        c = int(cur.fetchone()["c"])
        if c:
            items.append({"key": "pending_ai", "severity": "info", "label": "Pending AI recommendations", "count": c, "href": "/automation/ai-hub"})

        cur.execute(
            "SELECT COUNT(*)::int AS c FROM pos_events_outbox WHERE company_id=%s AND status='failed'",
            (company_id,),
        )
        c = int(cur.fetchone()["c"])
        if c:
            items.append({"key": "outbox_failed", "severity": "critical", "label": "POS outbox failed events", "count": c, "href": "/system/outbox"})

        cur.execute(
            "SELECT COUNT(*)::int AS c FROM item_warehouse_costs WHERE company_id=%s AND on_hand_qty < 0",
            (company_id,),
        )
        c = int(cur.fetchone()["c"])
        if c:
            items.append({"key": "negative_stock", "severity": "critical", "label": "Negative stock positions", "count": c, "href": "/inventory/stock"})

        cur.execute(
            "SELECT COUNT(*)::int AS c FROM supplier_invoices WHERE company_id=%s AND status='draft' AND is_on_hold=true",
            (company_id,),
        )
        c = int(cur.fetchone()["c"])
        if c:
            items.append({"key": "invoices_on_hold", "severity": "critical", "label": "Supplier invoices on hold", "count": c, "href": "/purchasing/supplier-invoices"})
    except Exception:
        pass
    return items
