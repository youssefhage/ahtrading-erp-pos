#!/usr/bin/env python3
"""
Long-running worker service.

Processes POS outbox events for all companies (or a specified subset) using the
same logic as `pos_processor.py`, but runs continuously.

Also runs scheduled background jobs (AI agents + executor) using a DB-backed
schedule (`background_job_schedules`).
"""

import argparse
import json
import time
import sys
import traceback
from datetime import datetime
from typing import Any
from decimal import Decimal

import psycopg
from psycopg.rows import dict_row

try:
    from .pos_processor import process_events, DB_URL_DEFAULT, MAX_ATTEMPTS_DEFAULT, set_company_context
    from .ai_inventory import run_inventory_agent
    from .ai_purchase import run_purchase_agent
    from .ai_crm import run_crm_agent
    from .ai_pricing import run_pricing_agent
    from .ai_price_impact import run_price_impact_agent
    from .ai_shrinkage import run_shrinkage_agent
    from .ai_demand import run_demand_agent
    from .ai_anomaly import run_anomaly_agent
    from .ai_data_hygiene import run_data_hygiene_agent
    from .ai_ap_guard import run_ap_guard_agent
    from .ai_expiry_ops import run_expiry_ops_agent
    from .ai_action_executor import run_executor
    from .supplier_invoice_import_job import run_supplier_invoice_import_job
    from .cycle_count_scheduler import run_cycle_count_scheduler
    from .recurring_journal_scheduler import run_recurring_journal_scheduler
    from .edge_cloud_sync import run_edge_cloud_sync
    from .edge_cloud_masterdata_pull import run_edge_cloud_masterdata_pull
except ImportError:  # pragma: no cover
    # Allow running as a script: `python3 backend/workers/worker_service.py`
    from pos_processor import process_events, DB_URL_DEFAULT, MAX_ATTEMPTS_DEFAULT, set_company_context
    from ai_inventory import run_inventory_agent
    from ai_purchase import run_purchase_agent
    from ai_crm import run_crm_agent
    from ai_pricing import run_pricing_agent
    from ai_price_impact import run_price_impact_agent
    from ai_shrinkage import run_shrinkage_agent
    from ai_demand import run_demand_agent
    from ai_anomaly import run_anomaly_agent
    from ai_data_hygiene import run_data_hygiene_agent
    from ai_ap_guard import run_ap_guard_agent
    from ai_expiry_ops import run_expiry_ops_agent
    from ai_action_executor import run_executor
    from supplier_invoice_import_job import run_supplier_invoice_import_job
    from cycle_count_scheduler import run_cycle_count_scheduler
    from recurring_journal_scheduler import run_recurring_journal_scheduler
    from edge_cloud_sync import run_edge_cloud_sync
    from edge_cloud_masterdata_pull import run_edge_cloud_masterdata_pull


DEFAULT_JOB_SPECS: dict[str, dict[str, Any]] = {
    "AI_INVENTORY": {"interval_seconds": 3600, "options_json": {}},
    "AI_PURCHASE": {"interval_seconds": 3600, "options_json": {}},
    "AI_DEMAND": {"interval_seconds": 86400, "options_json": {"window_days": 28, "review_days": 7, "safety_days": 3}},
    "AI_CRM": {"interval_seconds": 86400, "options_json": {"inactive_days": 60}},
    "AI_DATA_HYGIENE": {"interval_seconds": 86400, "options_json": {"limit": 300}},
    "AI_AP_GUARD": {"interval_seconds": 3600, "options_json": {"due_soon_days": 7, "limit": 200}},
    "AI_EXPIRY_OPS": {"interval_seconds": 21600, "options_json": {"days": 30, "limit": 200}},
    "AI_PRICING": {
        "interval_seconds": 86400,
        "options_json": {"min_margin_pct": 0.05, "target_margin_pct": 0.15},
    },
    "AI_PRICE_IMPACT": {"interval_seconds": 3600, "options_json": {"lookback_days": 30, "min_pct_increase": 0.05, "target_margin_pct": 0.15, "limit": 200}},
    "AI_SHRINKAGE": {"interval_seconds": 3600, "options_json": {}},
    "AI_ANOMALY": {"interval_seconds": 3600, "options_json": {"lookback_days": 7, "return_rate": 0.20, "min_return_qty": 2, "adjustment_usd": 250}},
    "AI_EXECUTOR": {"interval_seconds": 60, "options_json": {"limit": 20}},
    # Queue-first supplier invoice import: fills drafts created by the upload endpoint.
    "SUPPLIER_INVOICE_IMPORT": {"interval_seconds": 30, "options_json": {"limit": 2}},
    # Warehouse v2: cycle count scheduling.
    "CYCLE_COUNT_SCHEDULER": {"interval_seconds": 3600, "options_json": {"limit_plans": 50}},
    # Accounting v2: recurring journals from templates.
    "RECURRING_JOURNAL_SCHEDULER": {"interval_seconds": 3600, "options_json": {"limit_rules": 25}},
    # Edge -> Cloud replication (phase 1): push posted docs to cloud when internet is available.
    "EDGE_CLOUD_SYNC": {"interval_seconds": 15, "options_json": {"limit": 5}},
    # Cloud -> Edge replication (phase 1): pull master data so edge can run offline.
    "EDGE_CLOUD_MASTERDATA_PULL": {"interval_seconds": 60, "options_json": {"limit": 500}},
}

WORKER_NAME = "outbox-worker"

def _json_log(level: str, event: str, **fields):
    rec = {"ts": datetime.utcnow().isoformat(), "level": level, "event": event, **fields}
    print(json.dumps(rec, default=str), file=sys.stderr)


def list_company_ids(db_url: str):
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM companies ORDER BY created_at ASC")
            return [str(r["id"]) for r in cur.fetchall()]

def record_worker_heartbeat(db_url: str, company_id: str, details: dict, worker_name=None):
    # Persist a per-company heartbeat so the Admin UI can show "worker alive" without log access.
    name = str(worker_name or WORKER_NAME).strip() or WORKER_NAME
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                set_company_context(cur, company_id)
                details_json = json.dumps(details or {})
                cur.execute(
                    """
                    INSERT INTO worker_heartbeats (company_id, worker_name, last_seen_at, details)
                    VALUES (%s, %s, now(), %s::jsonb)
                    ON CONFLICT (company_id, worker_name)
                    DO UPDATE SET last_seen_at = now(), details = EXCLUDED.details
                    """,
                    (company_id, name, details_json),
                )


def ensure_default_job_schedules(conn, company_id: str):
    with conn.cursor() as cur:
        set_company_context(cur, company_id)
        for job_code, spec in DEFAULT_JOB_SPECS.items():
            cur.execute(
                """
                INSERT INTO background_job_schedules
                  (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
                VALUES
                  (%s, %s, true, %s, %s::jsonb, now())
                ON CONFLICT (company_id, job_code) DO NOTHING
                """,
                (company_id, job_code, spec["interval_seconds"], json.dumps(spec["options_json"])),
            )


def claim_due_job(conn, company_id: str):
    with conn.cursor() as cur:
        set_company_context(cur, company_id)
        cur.execute(
            """
            WITH due AS (
              SELECT job_code
              FROM background_job_schedules
              WHERE company_id = %s
                AND enabled = true
                AND (next_run_at IS NULL OR next_run_at <= now())
              ORDER BY next_run_at NULLS FIRST, job_code
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            UPDATE background_job_schedules s
            SET last_run_at = now(),
                next_run_at = now() + interval '1 second' * s.interval_seconds,
                updated_at = now()
            FROM due
            WHERE s.company_id = %s AND s.job_code = due.job_code
            RETURNING s.job_code, s.options_json
            """,
            (company_id, company_id),
        )
        return cur.fetchone()


def record_job_run_start(conn, company_id: str, job_code: str, details: dict):
    with conn.cursor() as cur:
        set_company_context(cur, company_id)
        cur.execute(
            """
            INSERT INTO background_job_runs
              (id, company_id, job_code, status, started_at, details_json)
            VALUES
              (gen_random_uuid(), %s, %s, 'running', now(), %s::jsonb)
            RETURNING id
            """,
            (company_id, job_code, json.dumps(details)),
        )
        return cur.fetchone()["id"]


def record_job_run_finish(conn, company_id: str, run_id: str, status: str, error_message: str | None = None):
    with conn.cursor() as cur:
        set_company_context(cur, company_id)
        cur.execute(
            """
            UPDATE background_job_runs
            SET status = %s,
                finished_at = now(),
                error_message = %s
            WHERE company_id = %s AND id = %s
            """,
            (status, error_message, company_id, run_id),
        )


def execute_job(db_url: str, company_id: str, job_code: str, options: dict):
    if job_code == "AI_INVENTORY":
        run_inventory_agent(db_url, company_id)
        return
    if job_code == "AI_PURCHASE":
        run_purchase_agent(db_url, company_id)
        return
    if job_code == "AI_DEMAND":
        window_days = int(options.get("window_days") or 28)
        review_days = int(options.get("review_days") or 7)
        safety_days = int(options.get("safety_days") or 3)
        run_demand_agent(db_url, company_id, window_days=window_days, review_days=review_days, safety_days=safety_days)
        return
    if job_code == "AI_CRM":
        inactive_days = int(options.get("inactive_days") or 60)
        run_crm_agent(db_url, company_id, inactive_days=inactive_days)
        return
    if job_code == "AI_DATA_HYGIENE":
        limit = int(options.get("limit") or 300)
        run_data_hygiene_agent(db_url, company_id, limit=limit)
        return
    if job_code == "AI_AP_GUARD":
        due_soon_days = int(options.get("due_soon_days") or 7)
        limit = int(options.get("limit") or 200)
        run_ap_guard_agent(db_url, company_id, due_soon_days=due_soon_days, limit=limit)
        return
    if job_code == "AI_EXPIRY_OPS":
        days = int(options.get("days") or 30)
        limit = int(options.get("limit") or 200)
        run_expiry_ops_agent(db_url, company_id, days=days, limit=limit)
        return
    if job_code == "AI_PRICING":
        min_margin_pct = Decimal(str(options.get("min_margin_pct") or "0.05"))
        target_margin_pct = Decimal(str(options.get("target_margin_pct") or "0.15"))
        run_pricing_agent(db_url, company_id, min_margin_pct=min_margin_pct, target_margin_pct=target_margin_pct)
        return
    if job_code == "AI_PRICE_IMPACT":
        lookback_days = int(options.get("lookback_days") or 30)
        min_pct_increase = Decimal(str(options.get("min_pct_increase") or "0.05"))
        target_margin_pct = Decimal(str(options.get("target_margin_pct") or "0.15"))
        limit = int(options.get("limit") or 200)
        run_price_impact_agent(
            db_url,
            company_id,
            lookback_days=lookback_days,
            min_pct_increase=min_pct_increase,
            target_margin_pct=target_margin_pct,
            limit=limit,
        )
        return
    if job_code == "AI_SHRINKAGE":
        run_shrinkage_agent(db_url, company_id)
        return
    if job_code == "AI_ANOMALY":
        lookback_days = int(options.get("lookback_days") or 7)
        return_rate = Decimal(str(options.get("return_rate") or "0.20"))
        min_return_qty = Decimal(str(options.get("min_return_qty") or "2"))
        adjustment_usd = Decimal(str(options.get("adjustment_usd") or "250"))
        run_anomaly_agent(
            db_url,
            company_id,
            lookback_days=lookback_days,
            return_rate_threshold=return_rate,
            min_return_qty=min_return_qty,
            adjustment_value_usd_threshold=adjustment_usd,
        )
        return
    if job_code == "AI_EXECUTOR":
        limit = int(options.get("limit") or 20)
        run_executor(db_url, company_id, limit=limit)
        return
    if job_code == "SUPPLIER_INVOICE_IMPORT":
        limit = int(options.get("limit") or 2)
        run_supplier_invoice_import_job(db_url, company_id, limit=limit)
        return
    if job_code == "CYCLE_COUNT_SCHEDULER":
        limit_plans = int(options.get("limit_plans") or 50)
        run_cycle_count_scheduler(db_url, company_id, limit_plans=limit_plans)
        return
    if job_code == "RECURRING_JOURNAL_SCHEDULER":
        limit_rules = int(options.get("limit_rules") or 25)
        run_recurring_journal_scheduler(db_url, company_id, limit_rules=limit_rules)
        return
    if job_code == "EDGE_CLOUD_SYNC":
        limit = int(options.get("limit") or 5)
        processed = run_edge_cloud_sync(db_url, company_id, limit=limit)
        record_worker_heartbeat(
            db_url,
            company_id,
            {"edge_cloud_sync": {"processed": int(processed or 0), "limit": limit}},
            worker_name="EDGE_CLOUD_SYNC",
        )
        return
    if job_code == "EDGE_CLOUD_MASTERDATA_PULL":
        limit = int(options.get("limit") or 500)
        summary = run_edge_cloud_masterdata_pull(db_url, company_id, limit=limit)
        record_worker_heartbeat(
            db_url,
            company_id,
            {"edge_cloud_masterdata_pull": {"limit": limit, "summary": summary}},
            worker_name="EDGE_CLOUD_MASTERDATA_PULL",
        )
        return
    raise ValueError(f"unknown job_code: {job_code}")


def run_due_jobs(db_url: str, company_id: str, max_jobs: int = 3) -> int:
    ran = 0
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.transaction():
            ensure_default_job_schedules(conn, company_id)

        for _ in range(max_jobs):
            with conn.transaction():
                claimed = claim_due_job(conn, company_id)
                if not claimed:
                    break
                job_code = claimed["job_code"]
                options = claimed.get("options_json") or {}
                if isinstance(options, str):
                    options = json.loads(options)
                run_id = record_job_run_start(conn, company_id, job_code, {"options": options})

            try:
                execute_job(db_url, company_id, job_code, options)
                with conn.transaction():
                    record_job_run_finish(conn, company_id, run_id, "success")
            except Exception as ex:
                with conn.transaction():
                    record_job_run_finish(conn, company_id, run_id, "failed", error_message=str(ex))
            ran += 1
    return ran


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_URL_DEFAULT)
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--max-attempts", type=int, default=MAX_ATTEMPTS_DEFAULT)
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("--companies", nargs="*", help="Optional list of company UUIDs to process")
    parser.add_argument("--once", action="store_true", help="Run a single pass and exit")
    args = parser.parse_args()

    while True:
        company_ids = args.companies or list_company_ids(args.db)
        did_work = False
        for cid in company_ids:
            processed = 0
            jobs_ran = 0
            outbox_error = None
            jobs_error = None
            try:
                processed = process_events(args.db, cid, args.limit, max_attempts=args.max_attempts)
                if processed:
                    did_work = True
            except Exception as ex:
                # Never crash the worker loop due to outbox processing errors.
                _json_log("error", "worker.outbox.error", company_id=cid, error=str(ex))
                traceback.print_exc(file=sys.stderr)
                outbox_error = str(ex)

            try:
                jobs_ran = run_due_jobs(args.db, cid, max_jobs=3)
                if jobs_ran:
                    did_work = True
            except Exception as ex:
                # Never crash the worker loop due to background scheduling issues.
                # But do log so we can see it in Docker/Dokploy logs.
                _json_log("error", "worker.jobs.error", company_id=cid, error=str(ex))
                traceback.print_exc(file=sys.stderr)
                jobs_error = str(ex)

            try:
                record_worker_heartbeat(
                    args.db,
                    cid,
                    {
                        "processed": processed,
                        "jobs_ran": jobs_ran,
                        "outbox_error": outbox_error,
                        "jobs_error": jobs_error,
                    },
                )
            except Exception as ex:
                _json_log("error", "worker.heartbeat.error", company_id=cid, error=str(ex))
                traceback.print_exc(file=sys.stderr)

        if args.once:
            break

        # If we processed anything, loop again quickly; otherwise back off.
        time.sleep(0 if did_work else args.sleep)


if __name__ == "__main__":
    main()
