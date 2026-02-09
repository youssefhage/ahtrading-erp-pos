import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Optional
from datetime import datetime
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission, get_current_user
from ..validation import AiActionStatus, AiRecommendationStatus, AiRecommendationDecisionStatus

router = APIRouter(prefix="/ai", tags=["ai"])


class RecommendationDecision(BaseModel):
    status: AiRecommendationDecisionStatus
    reason: Optional[str] = None
    notes: Optional[str] = None


class AgentSetting(BaseModel):
    agent_code: str
    auto_execute: bool = False
    max_amount_usd: float = 0
    max_actions_per_day: int = 0


class CopilotQueryIn(BaseModel):
    query: str


class JobScheduleIn(BaseModel):
    job_code: str
    enabled: bool = True
    interval_seconds: int = 3600
    options_json: dict[str, Any] = Field(default_factory=dict)


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
                SELECT id, agent_code, status, recommendation_json, created_at
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
            return {"recommendations": cur.fetchall()}


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
            return {"settings": cur.fetchall()}


@router.post("/settings", dependencies=[Depends(require_permission("ai:write"))])
def upsert_setting(data: AgentSetting, company_id: str = Depends(get_company_id)):
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
                (company_id, data.agent_code, data.auto_execute, data.max_amount_usd, data.max_actions_per_day),
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
                        (data.reason or "").strip() or None,
                        (data.notes or "").strip() or None,
                        rec_id,
                        company_id,
                    ),
                )

                # For supported agents, approval creates an executable action.
                if data.status == "approved" and rec["agent_code"] in {"AI_PURCHASE", "AI_PRICING", "AI_DEMAND"}:
                    cur.execute(
                        """
                        SELECT auto_execute, max_amount_usd, max_actions_per_day
                        FROM ai_agent_settings
                        WHERE company_id = %s AND agent_code = %s
                        """,
                        (company_id, rec["agent_code"]),
                    )
                    setting = cur.fetchone() or {"auto_execute": False, "max_amount_usd": 0, "max_actions_per_day": 0}
                    auto_execute = bool(setting.get("auto_execute"))
                    # When auto_execute is disabled, we still create an action row, but it sits in
                    # "approved" until a human explicitly queues it.
                    action_status = "queued" if auto_execute else "approved"
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
                        ON CONFLICT DO NOTHING
                        RETURNING id
                        """,
                        (
                            company_id,
                            rec["agent_code"],
                            rec_id,
                            json.dumps(rec["recommendation_json"]),
                            action_status,
                            user["user_id"],
                            action_status,
                            user["user_id"],
                            action_status,
                        ),
                    )
                    action = cur.fetchone()
                    cur.execute(
                        """
                        INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, details)
                        VALUES (gen_random_uuid(), %s, %s, 'ai_approve', 'ai_recommendation', %s, %s::jsonb)
                        """,
                        (company_id, user["user_id"], rec_id, json.dumps({"agent_code": rec["agent_code"], "action_status": action_status})),
                    )
                    return {"ok": True, "action_id": (action["id"] if action else None)}

                # Reject cancels any queued action.
                if data.status == "rejected":
                    cur.execute(
                        """
                        UPDATE ai_actions
                        SET status = 'canceled', updated_at = now()
                        WHERE company_id = %s AND recommendation_id = %s AND status IN ('queued', 'approved', 'blocked')
                        """,
                        (company_id, rec_id),
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
                            json.dumps({"agent_code": rec["agent_code"], "reason": (data.reason or "").strip() or None}),
                        ),
                    )

                return {"ok": True}


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
            return {"actions": cur.fetchall()}

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
                answer = f"I found {len(rows)} pending reorder-related recommendations. You can approve them in AI Hub, then Queue actions if needed."
                cards.append({"type": "reorder_recommendations", "rows": rows})
            elif "anomal" in ql or "shrink" in ql or "return" in ql or "adjust" in ql or "error" in ql:
                cur.execute(
                    """
                    SELECT r.id, r.created_at, r.recommendation_json
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
                answer = f"I found {len(rows)} pending anomalies/shrinkage signals."
                cards.append({"type": "anomalies", "rows": rows})
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
