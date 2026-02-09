-- AI governance v1 improvements:
-- - Store decision metadata and explainability fields
-- - Add executor idempotency hooks (trace outputs to ai_action id)

BEGIN;

ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS decided_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS decision_notes text,
  ADD COLUMN IF NOT EXISTS explain_json jsonb,
  ADD COLUMN IF NOT EXISTS features_json jsonb;

ALTER TABLE ai_actions
  ADD COLUMN IF NOT EXISTS result_entity_type text,
  ADD COLUMN IF NOT EXISTS result_entity_id uuid,
  ADD COLUMN IF NOT EXISTS result_json jsonb;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_orders_source
  ON purchase_orders(company_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE item_prices
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS ux_item_prices_source
  ON item_prices(source_type, source_id)
  WHERE source_id IS NOT NULL;

COMMIT;

