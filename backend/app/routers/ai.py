import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Optional
from datetime import datetime
from urllib.parse import quote
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..validation import AiActionStatus, AiRecommendationStatus, AiRecommendationDecisionStatus

router = APIRouter(prefix="/ai", tags=["ai"])

EXECUTABLE_AGENT_CODES = frozenset({"AI_PURCHASE", "AI_DEMAND", "AI_PRICING"})


def _normalize_agent_code(agent_code: Optional[str]) -> str:
    return (agent_code or "").strip().upper()


def _is_executable_agent(agent_code: str) -> bool:
    return _normalize_agent_code(agent_code) in EXECUTABLE_AGENT_CODES


def _with_execution_mode(row: dict[str, Any]) -> dict[str, Any]:
    agent_code = str(row.get("agent_code") or "")
    return {
        **row,
        "is_executable": _is_executable_agent(agent_code),
        "execution_mode": _execution_mode(agent_code),
    }


def _execution_mode(agent_code: str) -> str:
    return "executable" if _is_executable_agent(agent_code) else "review_only"


def _first_non_empty(*values: Any) -> Optional[str]:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return None


def _to_json_obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _fmt_ratio_percent(value: Any, digits: int = 1) -> Optional[str]:
    n = _to_float(value)
    if n is None:
        return None
    return f"{n * 100:.{digits}f}%"


def _fmt_amount_usd(value: Any, digits: int = 2) -> Optional[str]:
    n = _to_float(value)
    if n is None:
        return None
    return f"${n:,.{digits}f}"


def _normalize_severity(value: Any) -> Optional[str]:
    s = str(value or "").strip().lower()
    if s in {"critical", "high", "med", "medium", "low", "info"}:
        if s == "med":
            return "medium"
        return s
    return None


def _max_severity(values: list[Any]) -> Optional[str]:
    rank = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    best = None
    best_rank = -1
    for value in values:
        normalized = _normalize_severity(value)
        if not normalized:
            continue
        score = rank[normalized]
        if score > best_rank:
            best_rank = score
            best = normalized
    return best


def _humanize_token(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "Recommendation"
    parts = [p for p in raw.replace("-", "_").split("_") if p]
    return " ".join(p.capitalize() for p in parts) if parts else "Recommendation"


def _entity_link(entity_type: Optional[str], entity_id: Optional[str]) -> Optional[str]:
    et = str(entity_type or "").strip().lower()
    eid = str(entity_id or "").strip()
    if not eid:
        if et == "pos_outbox":
            return "/system/pos-devices"
        return None
    qid = quote(eid, safe="")
    if et in {"item"}:
        return f"/catalog/items/{qid}"
    if et in {"supplier_invoice", "invoice"}:
        return f"/purchasing/supplier-invoices/{qid}"
    if et == "customer":
        return f"/partners/customers/{qid}"
    if et == "purchase_order":
        return f"/purchasing/purchase-orders/{qid}"
    if et == "item_price":
        return f"/pricing/item-prices/{qid}"
    if et == "pos_outbox":
        return "/system/pos-devices"
    return None


def _recommendation_view(row: dict[str, Any]) -> dict[str, Any]:
    agent_code = _normalize_agent_code(str(row.get("agent_code") or ""))
    payload = _to_json_obj(row.get("recommendation_json"))
    raw_kind = _first_non_empty(payload.get("kind"), payload.get("type"), payload.get("recommendation"))
    kind = (raw_kind or agent_code.lower() or "recommendation").strip().lower()
    explain = payload.get("explain") if isinstance(payload.get("explain"), dict) else {}

    entity_type: Optional[str] = _first_non_empty(payload.get("entity_type"))
    entity_id: Optional[str] = _first_non_empty(payload.get("entity_id"))
    if not entity_id:
        if payload.get("item_id"):
            entity_type, entity_id = "item", str(payload.get("item_id"))
        elif payload.get("invoice_id"):
            entity_type, entity_id = "supplier_invoice", str(payload.get("invoice_id"))
        elif payload.get("customer_id"):
            entity_type, entity_id = "customer", str(payload.get("customer_id"))
        elif payload.get("outbox_id"):
            entity_type, entity_id = "pos_outbox", str(payload.get("outbox_id"))
        elif payload.get("change_id"):
            entity_type, entity_id = "cost_change", str(payload.get("change_id"))

    item_label = _first_non_empty(payload.get("name"), payload.get("item_name"), payload.get("sku"))
    title = "Recommendation"
    summary = _first_non_empty(explain.get("why"), payload.get("key"), "Triggered by an internal rule.") or "Triggered by an internal rule."
    next_step = "Review recommendation details and decide."
    severity = _normalize_severity(payload.get("severity")) or "medium"
    details: list[str] = []
    link_href: Optional[str] = None
    link_label: Optional[str] = None

    if agent_code == "AI_DATA_HYGIENE" or kind == "data_hygiene":
        issues = payload.get("issues") if isinstance(payload.get("issues"), list) else []
        issue_messages = []
        issue_severities = []
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            message = _first_non_empty(issue.get("message"), issue.get("code"))
            if message:
                issue_messages.append(message)
            issue_severities.append(issue.get("severity"))
        issue_count = len(issues)
        title = "Item master-data issues"
        primary_issue = issue_messages[0] if issue_messages else ""
        if primary_issue:
            extra = f" (+{max(0, issue_count - 1)} more)" if issue_count > 1 else ""
            summary = f"{item_label or 'Item'}: {primary_issue}{extra}"
        else:
            summary = f"{item_label or 'Item'} has {issue_count} data issue(s)." if issue_count else "Item has data quality issues."
        next_step = "Open item details and complete missing barcode, tax, or supplier fields."
        severity = _max_severity(issue_severities) or "medium"
        details = issue_messages[:4]
        if entity_type == "item" and entity_id:
            link_href = _entity_link(entity_type, entity_id)
            link_label = "Open item"

    elif agent_code == "AI_AP_GUARD" and kind == "supplier_invoice_hold":
        invoice_no = _first_non_empty(payload.get("invoice_no"), payload.get("supplier_ref"), payload.get("invoice_id"))
        hold_reason = _first_non_empty(payload.get("hold_reason"), "Invoice is on hold.")
        title = "Supplier invoice on hold"
        summary = f"Invoice {invoice_no or '-'} is on hold. {hold_reason}"
        next_step = "Open invoice and resolve hold reason before posting or payment."
        severity = "high"
        link_href = _entity_link("supplier_invoice", _first_non_empty(payload.get("invoice_id"), entity_id))
        link_label = "Open invoice"

    elif agent_code == "AI_AP_GUARD" and kind == "supplier_invoice_due_soon":
        invoice_no = _first_non_empty(payload.get("invoice_no"), payload.get("supplier_ref"), payload.get("invoice_id"))
        due_date = _first_non_empty(payload.get("due_date"))
        outstanding_usd = _fmt_amount_usd(payload.get("outstanding_usd"))
        title = "Supplier invoice due soon"
        summary = f"Invoice {invoice_no or '-'} is due on {due_date or '-'}{f' with {outstanding_usd} outstanding' if outstanding_usd else ''}."
        next_step = "Plan payment and confirm terms before due date."
        severity = "medium"
        link_href = _entity_link("supplier_invoice", _first_non_empty(payload.get("invoice_id"), entity_id))
        link_label = "Open invoice"

    elif agent_code == "AI_EXPIRY_OPS" or kind == "expiry_ops":
        expiry_date = _first_non_empty(payload.get("expiry_date")) or "-"
        warehouse = _first_non_empty(payload.get("warehouse_name"), payload.get("warehouse_id"), "warehouse")
        qty_on_hand = _first_non_empty(payload.get("qty_on_hand"), "0")
        batch_no = _first_non_empty(payload.get("batch_no"), payload.get("batch_id"), "-")
        title = "Batch expiring soon"
        summary = f"{item_label or 'Item'} batch {batch_no} in {warehouse} expires on {expiry_date} (qty {qty_on_hand})."
        next_step = "Review promotion, transfer, or write-off plan before expiry."
        severity = "medium"
        details = [str(x.get("message")) for x in (payload.get("suggestions") or []) if isinstance(x, dict) and str(x.get("message") or "").strip()][:3]
        if _first_non_empty(payload.get("item_id")):
            link_href = _entity_link("item", str(payload.get("item_id")))
            link_label = "Open item"

    elif agent_code == "AI_ANOMALY" and kind == "high_return_rate":
        rate = _fmt_ratio_percent(payload.get("return_rate"))
        sold = _first_non_empty(payload.get("sold_qty"), "0")
        returned = _first_non_empty(payload.get("returned_qty"), "0")
        title = "High return-rate anomaly"
        summary = f"{item_label or 'Item'} shows {rate or 'high'} returns ({returned}/{sold} units)."
        next_step = "Review item quality, supplier, and pricing signals."
        severity = "high"
        if _first_non_empty(payload.get("item_id")):
            link_href = _entity_link("item", str(payload.get("item_id")))
            link_label = "Open item"

    elif agent_code == "AI_ANOMALY" and kind == "large_adjustment":
        approx = _fmt_amount_usd(payload.get("approx_value_usd"))
        warehouse = _first_non_empty(payload.get("warehouse_name"), payload.get("warehouse_id"), "warehouse")
        qty_delta = _first_non_empty(payload.get("qty_delta"))
        title = "Large inventory adjustment"
        summary = f"{item_label or 'Item'} had a large adjustment in {warehouse}{f' (~{approx})' if approx else ''}{f', qty delta {qty_delta}' if qty_delta else ''}."
        next_step = "Validate adjustment reason and supporting approvals."
        severity = "high"
        if _first_non_empty(payload.get("item_id")):
            link_href = _entity_link("item", str(payload.get("item_id")))
            link_label = "Open item"

    elif agent_code == "AI_ANOMALY" and kind == "pos_outbox_failure":
        device_code = _first_non_empty(payload.get("device_code"), "-")
        event_type = _first_non_empty(payload.get("event_type"), "-")
        attempts = _first_non_empty(payload.get("attempt_count"), "0")
        title = "POS sync failure"
        summary = f"POS outbox failure on {device_code} for {event_type} after {attempts} attempt(s)."
        next_step = "Check POS devices and retry failed outbox events."
        severity = "high"
        link_href = _entity_link("pos_outbox", _first_non_empty(payload.get("outbox_id")))
        link_label = "Open POS devices"

    elif agent_code == "AI_SHRINKAGE":
        warehouse = _first_non_empty(payload.get("warehouse_name"), payload.get("warehouse_id"), "warehouse")
        qty = _first_non_empty(payload.get("on_hand_qty"), "0")
        approx = _fmt_amount_usd(payload.get("approx_value_usd"))
        title = "Negative stock signal"
        summary = f"{item_label or 'Item'} is negative in {warehouse} (qty {qty}{f', value ~{approx}' if approx else ''})."
        next_step = "Investigate stock moves and reconcile inventory."
        severity = "high"
        if _first_non_empty(payload.get("item_id")):
            link_href = _entity_link("item", str(payload.get("item_id")))
            link_label = "Open item"

    elif agent_code in {"AI_PURCHASE", "AI_DEMAND", "AI_INVENTORY"}:
        on_hand = _first_non_empty(payload.get("on_hand_qty"), payload.get("qty_on_hand"))
        reorder_qty = _first_non_empty(payload.get("reorder_qty"))
        title = "Reorder recommendation"
        summary = f"{item_label or 'Item'} is below target stock{f' (on hand {on_hand})' if on_hand else ''}{f'; suggested reorder {reorder_qty}' if reorder_qty else ''}."
        next_step = "Review quantity, then approve to create purchase action."
        severity = "medium"
        if _first_non_empty(payload.get("item_id")):
            link_href = _entity_link("item", str(payload.get("item_id")))
            link_label = "Open item"

    elif agent_code == "AI_PRICING":
        margin = _fmt_ratio_percent(payload.get("margin_pct"))
        suggested = _fmt_amount_usd(payload.get("suggested_price_usd"), digits=4)
        title = "Low margin pricing signal"
        summary = f"{item_label or 'Item'} margin is {margin or 'below target'}{f'; suggested price {suggested}' if suggested else ''}."
        next_step = "Review selling price update to restore margin."
        severity = "medium"
        if _first_non_empty(payload.get("item_id")):
            link_href = _entity_link("item", str(payload.get("item_id")))
            link_label = "Open item"

    elif agent_code == "AI_PRICE_IMPACT":
        pct = _fmt_ratio_percent(payload.get("pct_change_usd"))
        suggested = _fmt_amount_usd(payload.get("suggested_price_usd"), digits=4)
        title = "Cost increase impact"
        summary = f"{item_label or 'Item'} cost increased by {pct or 'a meaningful amount'}{f'; suggested price {suggested}' if suggested else ''}."
        next_step = "Review price adjustment to preserve target margin."
        severity = "medium"
        if _first_non_empty(payload.get("item_id")):
            link_href = _entity_link("item", str(payload.get("item_id")))
            link_label = "Open item"

    elif agent_code == "AI_CRM":
        customer_name = _first_non_empty(payload.get("name"), "Customer")
        last_purchase = _first_non_empty(payload.get("last_purchase"), "no purchase yet")
        inactive_days = _first_non_empty(payload.get("inactive_days"))
        title = "Customer inactivity"
        summary = f"{customer_name} has been inactive since {last_purchase}{f' ({inactive_days} days threshold)' if inactive_days else ''}."
        next_step = "Plan retention outreach or follow-up campaign."
        severity = "low"
        if _first_non_empty(payload.get("customer_id")):
            link_href = _entity_link("customer", str(payload.get("customer_id")))
            link_label = "Open customer"

    elif agent_code == "AI_PURCHASE_INVOICE_INSIGHTS":
        changes = payload.get("changes") if isinstance(payload.get("changes"), list) else payload.get("price_changes")
        change_count = len(changes) if isinstance(changes, list) else 0
        title = "Purchase invoice cost insights"
        summary = f"Detected cost impact on {change_count} line(s) from imported invoice."
        next_step = "Review margins and selling prices for impacted items."
        severity = "medium"
        if _first_non_empty(payload.get("invoice_id")):
            link_href = _entity_link("supplier_invoice", str(payload.get("invoice_id")))
            link_label = "Open invoice"

    elif agent_code == "AI_CORE":
        event_type = _first_non_empty(payload.get("event_type"), "event")
        title = "Core AI review"
        summary = f"Generated from {event_type}."
        next_step = "Review recommendation and confirm next action."
        severity = "low"

    if not link_href:
        link_href = _entity_link(entity_type, entity_id)
    if not link_label and link_href:
        link_label = "Open related document"

    return {
        "kind": kind,
        "kind_label": _humanize_token(kind),
        "title": title,
        "summary": summary,
        "next_step": next_step,
        "severity": severity,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "link_href": link_href,
        "link_label": link_label,
        "details": details[:4],
    }


class RecommendationDecision(BaseModel):
    status: AiRecommendationDecisionStatus
    reason: Optional[str] = None
    notes: Optional[str] = None


class AgentSetting(BaseModel):
    agent_code: str
    auto_execute: bool = False
    max_amount_usd: float = Field(default=0, ge=0)
    max_actions_per_day: int = Field(default=0, ge=0)


class CopilotQueryIn(BaseModel):
    query: str


class JobScheduleIn(BaseModel):
    job_code: str
    enabled: bool = True
    interval_seconds: int = 3600
    options_json: dict[str, Any] = Field(default_factory=dict)


def _normalize_text(value: Optional[str]) -> Optional[str]:
    s = (value or "").strip()
    return s or None


def _upsert_ai_action_from_recommendation(cur, company_id: str, rec: dict[str, Any], user_id: str) -> str | None:
    if not _is_executable_agent(rec.get("agent_code") or ""):
        return None

    cur.execute(
        """
        SELECT auto_execute
        FROM ai_agent_settings
        WHERE company_id = %s AND agent_code = %s
        """,
        (company_id, rec["agent_code"]),
    )
    setting = cur.fetchone() or {"auto_execute": False}
    action_status = "queued" if bool(setting.get("auto_execute")) else "approved"

    cur.execute(
        """
        INSERT INTO ai_actions
          (id, company_id, agent_code, recommendation_id, action_json, status,
           approved_by_user_id, approved_at,
           queued_by_user_id, queued_at)
        VALUES
          (gen_random_uuid(), %s, %s, %s, %s::jsonb, %s,
           %s, now(),
           CASE WHEN %s = 'queued' THEN %s ELSE NULL END,
           CASE WHEN %s = 'queued' THEN now() ELSE NULL END)
        ON CONFLICT (company_id, recommendation_id) DO UPDATE
        SET status = EXCLUDED.status,
                action_json = EXCLUDED.action_json,
            approved_by_user_id = EXCLUDED.approved_by_user_id,
            approved_at = EXCLUDED.approved_at,
            queued_by_user_id = CASE
              WHEN EXCLUDED.status = 'queued' THEN EXCLUDED.queued_by_user_id
              ELSE NULL
            END,
            queued_at = CASE
              WHEN EXCLUDED.status = 'queued' THEN EXCLUDED.queued_at
              ELSE NULL
            END,
            error_message = NULL,
            attempt_count = CASE
              WHEN ai_actions.status IN ('failed', 'blocked', 'canceled') THEN 0
              ELSE ai_actions.attempt_count
            END,
            updated_at = now()
        RETURNING id
        """,
        (
            company_id,
            rec["agent_code"],
            rec["id"],
            json.dumps(rec["recommendation_json"]),
            action_status,
            user_id,
            action_status,
            user_id,
            action_status,
        ),
    )
    action = cur.fetchone()
    return str(action["id"]) if action else None


@router.get("/recommendations", dependencies=[Depends(require_permission("ai:read"))])
def list_recommendations(
    status: Optional[AiRecommendationStatus] = None,
    agent_code: Optional[str] = None,
    limit: int = 500,
    company_id: str = Depends(get_company_id),
):
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT
                  id, agent_code, status, recommendation_json, created_at,
                  decided_at, decided_by_user_id, decision_reason, decision_notes
                FROM ai_recommendations
                WHERE company_id = %s
            """
            params: list[Any] = [company_id]
            if status:
                sql += " AND status = %s"
                params.append(status)
            if agent_code:
                sql += " AND agent_code = %s"
                params.append(agent_code)
            sql += " ORDER BY created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            rows = cur.fetchall()
            out = []
            for r in rows:
                row = _with_execution_mode(dict(r))
                row["recommendation_view"] = _recommendation_view(row)
                out.append(row)
            return {"recommendations": out}


@router.get("/recommendations/summary", dependencies=[Depends(require_permission("ai:read"))])
def recommendations_summary(
    status: Optional[AiRecommendationStatus] = None,
    agent_code: Optional[str] = None,
    company_id: str = Depends(get_company_id),
):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT agent_code, status, COUNT(*)::int AS count
                FROM ai_recommendations
                WHERE company_id = %s
            """
            params: list[Any] = [company_id]
            if status:
                sql += " AND status = %s"
                params.append(status)
            if agent_code:
                sql += " AND agent_code = %s"
                params.append(agent_code)
            sql += " GROUP BY agent_code, status ORDER BY agent_code, status"
            cur.execute(sql, params)
            return {"rows": cur.fetchall()}


@router.get("/settings", dependencies=[Depends(require_permission("ai:read"))])
def list_settings(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT agent_code, auto_execute, max_amount_usd, max_actions_per_day
                FROM ai_agent_settings
                WHERE company_id = %s
                ORDER BY agent_code
                """,
                (company_id,),
            )
            rows = cur.fetchall()
            return {
                "settings": [
                    _with_execution_mode(dict(row))
                    for row in rows
                ]
            }


@router.post("/settings", dependencies=[Depends(require_permission("ai:write"))])
def upsert_setting(data: AgentSetting, company_id: str = Depends(get_company_id)):
    agent_code = _normalize_agent_code(data.agent_code)
    if not agent_code:
        raise HTTPException(status_code=400, detail="agent_code is required")
    if data.auto_execute and not _is_executable_agent(agent_code):
        raise HTTPException(
            status_code=400,
            detail=f"{agent_code} is review-only and cannot auto-execute in this release.",
        )

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_agent_settings
                  (company_id, agent_code, auto_execute, max_amount_usd, max_actions_per_day)
                VALUES
                  (%s, %s, %s, %s, %s)
                ON CONFLICT (company_id, agent_code) DO UPDATE
                SET auto_execute = EXCLUDED.auto_execute,
                    max_amount_usd = EXCLUDED.max_amount_usd,
                    max_actions_per_day = EXCLUDED.max_actions_per_day
                """,
                (company_id, agent_code, data.auto_execute, data.max_amount_usd, data.max_actions_per_day),
            )
            return {"ok": True}


@router.post("/recommendations/{rec_id}/decide", dependencies=[Depends(require_permission("ai:write"))])
def decide_recommendation(
    rec_id: str,
    data: RecommendationDecision,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    # Validated by Pydantic, but keep as a guardrail if this endpoint is called without schema validation.
    if data.status not in {"approved", "rejected", "executed"}:
        raise HTTPException(status_code=400, detail="invalid status")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, agent_code, recommendation_json
                    FROM ai_recommendations
                    WHERE company_id = %s AND id = %s
                    """,
                    (company_id, rec_id),
                )
                rec = cur.fetchone()
                if not rec:
                    raise HTTPException(status_code=404, detail="recommendation not found")

                cur.execute(
                    """
                    UPDATE ai_recommendations
                    SET status = %s,
                        decided_at = now(),
                        decided_by_user_id = %s,
                        decision_reason = %s,
                        decision_notes = %s
                    WHERE id = %s AND company_id = %s
                    """,
                    (
                        data.status,
                        user["user_id"],
                        _normalize_text(data.reason),
                        _normalize_text(data.notes),
                        rec_id,
                        company_id,
                    ),
                    )

                reason = _normalize_text(data.reason)
                notes = _normalize_text(data.notes)
                agent_code = str(rec["agent_code"] or "")
                is_executable_agent = _is_executable_agent(agent_code)
                decision_log = {
                    "agent_code": rec["agent_code"],
                    "decision_status": data.status,
                    "execution_mode": _execution_mode(agent_code),
                    "reason": reason,
                    "notes": notes,
                }

                cur.execute(
                    """
                    SELECT id FROM ai_actions
                    WHERE company_id = %s AND recommendation_id = %s
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (company_id, rec_id),
                )
                action_row = cur.fetchone()
                action_id = action_row["id"] if action_row else None

                # For executable agents, approval creates/updates an action row.
                if data.status == "approved":
                    if _is_executable_agent(agent_code):
                        action_id = _upsert_ai_action_from_recommendation(
                            cur,
                            company_id,
                            {**dict(rec), "agent_code": agent_code},
                            user["user_id"],
                        )
                        if action_id:
                            decision_log["action_id"] = action_id
                    cur.execute(
                        """
                        INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                        VALUES (gen_random_uuid(), %s, %s, 'ai_approve', 'ai_recommendation', %s, %s::jsonb)
                        """,
                        (
                            company_id,
                            user["user_id"],
                            rec_id,
                            json.dumps(decision_log),
                        ),
                    )

                elif data.status == "executed":
                    if action_id:
                        cur.execute(
                            """
                            UPDATE ai_actions
                            SET status = 'executed',
                                executed_by_user_id = %s,
                                executed_at = now(),
                                error_message = NULL,
                                updated_at = now()
                            WHERE id = %s
                            """,
                            (user["user_id"], action_id),
                        )
                    elif is_executable_agent:
                        decision_log["non_executable_path_comment"] = "executed_without_action_row"
                    else:
                        decision_log["non_executable_path_comment"] = "review_only_marked"
                    cur.execute(
                        """
                        INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                        VALUES (gen_random_uuid(), %s, %s, 'ai_executed', 'ai_recommendation', %s, %s::jsonb)
                        """,
                        (
                            company_id,
                            user["user_id"],
                            rec_id,
                            json.dumps(decision_log),
                        ),
                    )

                elif data.status == "rejected":
                    reject_reason = reason or notes or "Rejected by user"
                    cur.execute(
                        """
                        UPDATE ai_actions
                        SET status = 'canceled',
                            error_message = %s,
                            queued_by_user_id = NULL,
                            queued_at = NULL,
                            attempt_count = 0,
                            updated_at = now()
                        WHERE company_id = %s
                          AND recommendation_id = %s
                          AND status IN ('queued', 'approved', 'blocked', 'failed')
                        """,
                        (reject_reason, company_id, rec_id),
                    )
                    cur.execute(
                        """
                        INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                        VALUES (gen_random_uuid(), %s, %s, 'ai_reject', 'ai_recommendation', %s, %s::jsonb)
                        """,
                        (
                            company_id,
                            user["user_id"],
                            rec_id,
                            json.dumps(decision_log),
                        ),
                    )

                return {"ok": True, "action_id": str(action_id) if action_id else None}


@router.get("/actions", dependencies=[Depends(require_permission("ai:read"))])
def list_actions(
    status: Optional[AiActionStatus] = None,
    agent_code: Optional[str] = None,
    limit: int = 200,
    company_id: str = Depends(get_company_id),
):
    if limit <= 0 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            sql = """
                SELECT id, agent_code, recommendation_id, status,
                       attempt_count, error_message,
                       result_entity_type, result_entity_id, result_json,
                       action_json,
                       approved_by_user_id, approved_at,
                       queued_by_user_id, queued_at,
                       executed_by_user_id,
                       created_at, executed_at, updated_at
                FROM ai_actions
                WHERE company_id = %s
            """
            params: list[Any] = [company_id]
            if status:
                sql += " AND status = %s"
                params.append(status)
            if agent_code:
                sql += " AND agent_code = %s"
                params.append(agent_code)
            sql += " ORDER BY created_at DESC LIMIT %s"
            params.append(limit)
            cur.execute(sql, params)
            rows = cur.fetchall()
            return {"actions": [_with_execution_mode(dict(r)) for r in rows]}

@router.get("/copilot/overview", dependencies=[Depends(require_permission("ai:read"))])
def copilot_overview(company_id: str = Depends(get_company_id)):
    """
    Read-only operational snapshot for an "Ops Copilot" UI.

    This intentionally avoids free-form SQL/LLM execution; it returns curated metrics that are safe and predictable.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT status, COUNT(*)::int AS count
                FROM ai_actions
                WHERE company_id = %s
                GROUP BY status
                """,
                (company_id,),
            )
            actions_by_status = {r["status"]: r["count"] for r in cur.fetchall()}

            cur.execute(
                """
                SELECT status, COUNT(*)::int AS count
                FROM ai_recommendations
                WHERE company_id = %s
                GROUP BY status
                """,
                (company_id,),
            )
            recs_by_status = {r["status"]: r["count"] for r in cur.fetchall()}

            cur.execute(
                """
                SELECT agent_code, COUNT(*)::int AS count
                FROM ai_recommendations
                WHERE company_id = %s AND status = 'pending'
                GROUP BY agent_code
                ORDER BY agent_code
                """,
                (company_id,),
            )
            pending_by_agent = {r["agent_code"]: r["count"] for r in cur.fetchall()}

            cur.execute(
                """
                SELECT status, COUNT(*)::int AS count
                FROM pos_events_outbox o
                JOIN pos_devices d ON d.id = o.device_id
                WHERE d.company_id = %s
                GROUP BY status
                """,
                (company_id,),
            )
            pos_outbox_by_status = {r["status"]: r["count"] for r in cur.fetchall()}

            cur.execute(
                """
                SELECT COUNT(*)::int AS failed
                FROM pos_events_outbox o
                JOIN pos_devices d ON d.id = o.device_id
                WHERE d.company_id = %s AND o.error_message IS NOT NULL
                """,
                (company_id,),
            )
            pos_outbox_failed = int(cur.fetchone()["failed"])

            cur.execute(
                """
                SELECT COUNT(*)::int AS rows,
                       COALESCE(SUM(ABS(on_hand_qty) * avg_cost_usd), 0)::numeric(18,4) AS approx_value_usd,
                       COALESCE(SUM(ABS(on_hand_qty) * avg_cost_lbp), 0)::numeric(18,2) AS approx_value_lbp
                FROM item_warehouse_costs
                WHERE company_id = %s AND on_hand_qty < 0
                """,
                (company_id,),
            )
            neg = cur.fetchone()

            cur.execute(
                """
                SELECT id, start_date, end_date, reason, locked, created_at
                FROM accounting_period_locks
                WHERE company_id = %s AND locked = true
                ORDER BY end_date DESC, created_at DESC
                LIMIT 5
                """,
                (company_id,),
            )
            locks = cur.fetchall()

            # Worker liveness (per company) so Ops can see if the background worker is alive.
            cur.execute(
                """
                SELECT worker_name, last_seen_at, details
                FROM worker_heartbeats
                WHERE company_id = %s
                ORDER BY worker_name
                """,
                (company_id,),
            )
            heartbeats = cur.fetchall()

            # Background jobs: quick health signals + recent failures.
            cur.execute(
                """
                SELECT COUNT(*)::int AS failed_24h
                FROM background_job_runs
                WHERE company_id = %s
                  AND status = 'failed'
                  AND started_at >= now() - interval '24 hours'
                """,
                (company_id,),
            )
            failed_24h = int(cur.fetchone()["failed_24h"])

            cur.execute(
                """
                SELECT id, job_code, status, started_at, finished_at, error_message
                FROM background_job_runs
                WHERE company_id = %s AND status = 'failed'
                ORDER BY started_at DESC
                LIMIT 10
                """,
                (company_id,),
            )
            recent_failed_runs = cur.fetchall()

            cur.execute(
                """
                SELECT job_code, enabled, interval_seconds, last_run_at, next_run_at, updated_at,
                       (enabled = true AND next_run_at IS NOT NULL AND next_run_at < now() - interval '5 minutes') AS is_overdue
                FROM background_job_schedules
                WHERE company_id = %s
                ORDER BY job_code
                """,
                (company_id,),
            )
            schedules = cur.fetchall()

            overdue_schedules = [s for s in schedules if s.get("is_overdue")]

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "ai": {
            "actions_by_status": actions_by_status,
            "recommendations_by_status": recs_by_status,
            "pending_recommendations_by_agent": pending_by_agent,
        },
        "pos": {
            "outbox_by_status": pos_outbox_by_status,
            "outbox_failed": pos_outbox_failed,
        },
        "inventory": {
            "negative_on_hand_rows": int(neg["rows"]),
            "approx_value_usd": str(neg["approx_value_usd"]),
            "approx_value_lbp": str(neg["approx_value_lbp"]),
        },
        "accounting": {"period_locks": locks},
        "workers": {"heartbeats": heartbeats},
        "jobs": {
            "failed_runs_24h": failed_24h,
            "recent_failed_runs": recent_failed_runs,
            "schedules": schedules,
            "overdue_schedules": overdue_schedules,
        },
    }


@router.post("/copilot/query", dependencies=[Depends(require_permission("ai:read"))])
def copilot_query(data: CopilotQueryIn, company_id: str = Depends(get_company_id)):
    """
    Natural-language-ish copilot endpoint (v1): deterministic, safe, read-only.

    We intentionally do NOT execute arbitrary SQL nor external LLM calls.
    """
    q = (data.query or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="query is required")
    ql = q.lower()

    # Default: always provide an overview so the UI has something useful.
    overview = copilot_overview(company_id=company_id)

    answer = ""
    cards: list[dict[str, Any]] = []

    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            if "reorder" in ql or "purchase" in ql or "buy" in ql:
                cur.execute(
                    """
                    SELECT r.id, r.agent_code, r.created_at, r.recommendation_json
                    FROM ai_recommendations r
                    WHERE r.company_id = %s
                      AND r.agent_code IN ('AI_DEMAND','AI_PURCHASE','AI_INVENTORY')
                      AND r.status = 'pending'
                    ORDER BY r.created_at DESC
                    LIMIT 25
                    """,
                    (company_id,),
                )
                rows = cur.fetchall()
                rec_rows: list[dict[str, Any]] = []
                for row in rows:
                    item = dict(row)
                    item["recommendation_view"] = _recommendation_view(item)
                    rec_rows.append(item)
                answer = f"I found {len(rec_rows)} pending reorder-related recommendations. You can approve them in AI Hub, then Queue actions if needed."
                cards.append({"type": "reorder_recommendations", "rows": rec_rows})
            elif "anomal" in ql or "shrink" in ql or "return" in ql or "adjust" in ql or "error" in ql:
                cur.execute(
                    """
                    SELECT r.id, r.agent_code, r.created_at, r.recommendation_json
                    FROM ai_recommendations r
                    WHERE r.company_id = %s
                      AND r.agent_code IN ('AI_ANOMALY','AI_SHRINKAGE')
                      AND r.status = 'pending'
                    ORDER BY r.created_at DESC
                    LIMIT 50
                    """,
                    (company_id,),
                )
                rows = cur.fetchall()
                anomaly_rows: list[dict[str, Any]] = []
                for row in rows:
                    item = dict(row)
                    item["recommendation_view"] = _recommendation_view(item)
                    anomaly_rows.append(item)
                answer = f"I found {len(anomaly_rows)} pending anomalies/shrinkage signals."
                cards.append({"type": "anomalies", "rows": anomaly_rows})
            elif "pos" in ql or "outbox" in ql or "sync" in ql:
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
                answer = "Here is the POS outbox breakdown by device and status."
                cards.append({"type": "pos_outbox", "rows": rows})
            elif "lock" in ql or "close" in ql or "period" in ql:
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
                answer = f"There are {len(rows)} active period locks."
                cards.append({"type": "period_locks", "rows": rows})
            else:
                answer = "Ask me about reorders, anomalies/shrinkage, POS sync/outbox, or period locks. I will keep answers read-only and operational."

    return {"query": q, "answer": answer, "overview": overview, "cards": cards}

@router.post("/actions/{action_id}/queue", dependencies=[Depends(require_permission("ai:write"))])
def queue_action(
    action_id: str,
    company_id: str = Depends(get_company_id),
    user=Depends(get_current_user),
):
    """
    Manually queue an approved/blocked action for execution by the worker executor.
    """
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT agent_code FROM ai_actions
                WHERE company_id = %s AND id = %s AND status IN ('approved', 'blocked', 'failed', 'canceled')
                """,
                (company_id, action_id),
            )
            action = cur.fetchone()
            if not action:
                raise HTTPException(status_code=404, detail="action not found or not queueable")
            if not _is_executable_agent(action["agent_code"]):
                raise HTTPException(status_code=400, detail="Agent does not support queueing actions in this product version")

            cur.execute(
                """
                UPDATE ai_actions
                SET status = 'queued',
                    queued_by_user_id = %s,
                    queued_at = now(),
                    error_message = NULL,
                    updated_at = now()
                WHERE company_id = %s AND id = %s AND status IN ('approved', 'blocked', 'failed', 'canceled')
                RETURNING id, status
                """,
                (user["user_id"], company_id, action_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="action not found or not queueable")
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'ai_queue', 'ai_action', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], action_id, json.dumps({})),
            )
            return {"action": row}


@router.post("/actions/{action_id}/cancel", dependencies=[Depends(require_permission("ai:write"))])
def cancel_action(action_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT agent_code FROM ai_actions
                WHERE company_id = %s AND id = %s AND status = 'queued'
                """,
                (company_id, action_id),
            )
            action = cur.fetchone()
            if action and not _is_executable_agent(action["agent_code"]):
                raise HTTPException(status_code=400, detail="Agent does not support queue actions in this product version")

            cur.execute(
                """
                UPDATE ai_actions
                SET status = 'canceled', updated_at = now()
                WHERE company_id = %s AND id = %s AND status = 'queued'
                RETURNING id, status
                """,
                (company_id, action_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="action not found or not cancelable")
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'ai_cancel', 'ai_action', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], action_id, json.dumps({})),
            )
            return {"action": row}


@router.post("/actions/{action_id}/requeue", dependencies=[Depends(require_permission("ai:write"))])
def requeue_action(action_id: str, company_id: str = Depends(get_company_id), user=Depends(get_current_user)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT agent_code FROM ai_actions
                WHERE company_id = %s AND id = %s AND status IN ('failed', 'canceled', 'blocked')
                """,
                (company_id, action_id),
            )
            action = cur.fetchone()
            if action and not _is_executable_agent(action["agent_code"]):
                raise HTTPException(status_code=400, detail="Agent does not support queue actions in this product version")

            cur.execute(
                """
                UPDATE ai_actions
                SET status = 'queued',
                    error_message = NULL,
                    queued_by_user_id = COALESCE(queued_by_user_id, %s),
                    queued_at = COALESCE(queued_at, now()),
                    updated_at = now()
                WHERE company_id = %s AND id = %s AND status IN ('failed', 'canceled', 'blocked')
                RETURNING id, status
                """,
                (user["user_id"], company_id, action_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="action not found or not requeueable")
            cur.execute(
                """
                INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                VALUES (gen_random_uuid(), %s, %s, 'ai_requeue', 'ai_action', %s, %s::jsonb)
                """,
                (company_id, user["user_id"], action_id, json.dumps({})),
            )
            return {"action": row}


@router.get("/jobs/schedules", dependencies=[Depends(require_permission("ai:read"))])
def list_job_schedules(company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT job_code, enabled, interval_seconds, options_json,
                       last_run_at, next_run_at, updated_at
                FROM background_job_schedules
                WHERE company_id = %s
                ORDER BY job_code
                """,
                (company_id,),
            )
            return {"schedules": cur.fetchall()}


@router.post("/jobs/schedules", dependencies=[Depends(require_permission("ai:write"))])
def upsert_job_schedule(data: JobScheduleIn, company_id: str = Depends(get_company_id)):
    if not data.job_code.strip():
        raise HTTPException(status_code=400, detail="job_code is required")
    if data.interval_seconds <= 0:
        raise HTTPException(status_code=400, detail="interval_seconds must be > 0")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO background_job_schedules
                  (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
                VALUES
                  (%s, %s, %s, %s, %s::jsonb, now())
                ON CONFLICT (company_id, job_code) DO UPDATE
                SET enabled = EXCLUDED.enabled,
                    interval_seconds = EXCLUDED.interval_seconds,
                    options_json = EXCLUDED.options_json,
                    updated_at = now()
                RETURNING job_code, enabled, interval_seconds, options_json, last_run_at, next_run_at, updated_at
                """,
                (company_id, data.job_code.strip(), data.enabled, data.interval_seconds, json.dumps(data.options_json)),
            )
            return {"schedule": cur.fetchone()}


@router.post("/jobs/{job_code}/run-now", dependencies=[Depends(require_permission("ai:write"))])
def run_job_now(job_code: str, company_id: str = Depends(get_company_id)):
    code = (job_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="job_code is required")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE background_job_schedules
                SET next_run_at = now(),
                    updated_at = now()
                WHERE company_id = %s AND job_code = %s
                RETURNING job_code, enabled, interval_seconds, options_json, last_run_at, next_run_at, updated_at
                """,
                (company_id, code),
            )
            row = cur.fetchone()
            if row:
                return {"schedule": row}
            cur.execute(
                """
                INSERT INTO background_job_schedules
                  (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
                VALUES
                  (%s, %s, true, 3600, '{}'::jsonb, now())
                RETURNING job_code, enabled, interval_seconds, options_json, last_run_at, next_run_at, updated_at
                """,
                (company_id, code),
            )
            return {"schedule": cur.fetchone()}


@router.get("/jobs/runs", dependencies=[Depends(require_permission("ai:read"))])
def list_job_runs(limit: int = 200, company_id: str = Depends(get_company_id)):
    if limit <= 0 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, job_code, status, started_at, finished_at, error_message, details_json
                FROM background_job_runs
                WHERE company_id = %s
                ORDER BY started_at DESC
                LIMIT %s
                """,
                (company_id, limit),
            )
            return {"runs": cur.fetchall()}
