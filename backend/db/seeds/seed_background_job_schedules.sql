-- Default background job schedules (idempotent).
-- These jobs are recommendation-first; auto-execution is still gated by ai_agent_settings.

BEGIN;

-- Run AI inventory scan hourly.
INSERT INTO background_job_schedules (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
SELECT c.id, 'AI_INVENTORY', true, 3600, '{}'::jsonb, now()
FROM companies c
ON CONFLICT (company_id, job_code) DO NOTHING;

-- Run AI purchase agent hourly.
INSERT INTO background_job_schedules (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
SELECT c.id, 'AI_PURCHASE', true, 3600, '{}'::jsonb, now()
FROM companies c
ON CONFLICT (company_id, job_code) DO NOTHING;

-- Run AI CRM follow-up agent daily.
INSERT INTO background_job_schedules (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
SELECT c.id, 'AI_CRM', true, 86400, '{"inactive_days": 60}'::jsonb, now()
FROM companies c
ON CONFLICT (company_id, job_code) DO NOTHING;

-- Run AI pricing guardrail daily.
INSERT INTO background_job_schedules (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
SELECT c.id, 'AI_PRICING', true, 86400, '{"min_margin_pct": 0.05, "target_margin_pct": 0.15}'::jsonb, now()
FROM companies c
ON CONFLICT (company_id, job_code) DO NOTHING;

-- Run daily POS cash-variance monitoring.
INSERT INTO background_job_schedules (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
SELECT c.id, 'AI_POS_SHIFT_VARIANCE', true, 86400, '{"lookback_days": 1, "min_variance_usd": 20, "min_variance_lbp": 2000000, "limit": 200}'::jsonb, now()
FROM companies c
ON CONFLICT (company_id, job_code) DO NOTHING;

-- Run AI shrinkage/integrity scan hourly.
INSERT INTO background_job_schedules (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
SELECT c.id, 'AI_SHRINKAGE', true, 3600, '{}'::jsonb, now()
FROM companies c
ON CONFLICT (company_id, job_code) DO NOTHING;

-- Run AI action executor every minute (only executes queued actions).
INSERT INTO background_job_schedules (company_id, job_code, enabled, interval_seconds, options_json, next_run_at)
SELECT c.id, 'AI_EXECUTOR', true, 60, '{}'::jsonb, now()
FROM companies c
ON CONFLICT (company_id, job_code) DO NOTHING;

COMMIT;
