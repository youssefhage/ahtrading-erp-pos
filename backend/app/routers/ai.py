from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, set_company_context
from ..deps import get_company_id, require_permission

router = APIRouter(prefix="/ai", tags=["ai"])


class RecommendationDecision(BaseModel):
    status: str


class AgentSetting(BaseModel):
    agent_code: str
    auto_execute: bool = False
    max_amount_usd: float = 0
    max_actions_per_day: int = 0


@router.get("/recommendations", dependencies=[Depends(require_permission("ai:read"))])
def list_recommendations(status: Optional[str] = None, company_id: str = Depends(get_company_id)):
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            if status:
                cur.execute(
                    """
                    SELECT id, agent_code, status, recommendation_json, created_at
                    FROM ai_recommendations
                    WHERE company_id = %s AND status = %s
                    ORDER BY created_at DESC
                    """,
                    (company_id, status),
                )
            else:
                cur.execute(
                    """
                    SELECT id, agent_code, status, recommendation_json, created_at
                    FROM ai_recommendations
                    WHERE company_id = %s
                    ORDER BY created_at DESC
                    """,
                    (company_id,),
                )
            return {"recommendations": cur.fetchall()}


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
def decide_recommendation(rec_id: str, data: RecommendationDecision, company_id: str = Depends(get_company_id)):
    if data.status not in {"approved", "rejected", "executed"}:
        return {"error": "invalid status"}
    with get_conn() as conn:
        set_company_context(conn, company_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ai_recommendations
                SET status = %s, decided_at = now()
                WHERE id = %s AND company_id = %s
                """,
                (data.status, rec_id, company_id),
            )
            return {"ok": True}
