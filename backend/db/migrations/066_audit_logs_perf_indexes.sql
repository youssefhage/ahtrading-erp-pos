-- Performance indexes for audit log querying (timeline views, ops debugging).

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_entity_created
ON audit_logs(company_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_action_created
ON audit_logs(company_id, action, created_at DESC);

