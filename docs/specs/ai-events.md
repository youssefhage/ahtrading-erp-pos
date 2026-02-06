# AI Event Pipeline

## events
- event_type: e.g., sales.created, inventory.low_stock
- payload_json: full event body

## ai_recommendations
- agent_code: AI_PURCHASE, AI_SALES, AI_INVENTORY, AI_FULFILLMENT
- status: pending|approved|rejected|executed

## ai_actions
- actions executed when auto-execute is enabled
- fully auditable

## ai_agent_settings
- per-company auto-execute rules and thresholds
