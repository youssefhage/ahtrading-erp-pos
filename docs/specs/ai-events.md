# AI Event Pipeline

## events
- event_type: e.g., sales.created, inventory.low_stock
- payload_json: full event body

## ai_recommendations
- agent_code: AI_PURCHASE, AI_DEMAND, AI_PRICING, AI_INVENTORY, AI_SALES, AI_FULFILLMENT, AI_DATA_HYGIENE, AI_PRICE_IMPACT, AI_EXPIRY_OPS, AI_ANOMALY, AI_SHRINKAGE, AI_AP_GUARD
- status: pending|approved|rejected|executed

Execution profile:
- executable agents (AI_PURCHASE, AI_DEMAND, AI_PRICING) can create actions and optionally auto-execute.
- review-only agents emit recommendations for manual review only.

## ai_actions
- actions executed when auto-execute is enabled
- fully auditable

## ai_agent_settings
- per-company auto-execute rules and thresholds
