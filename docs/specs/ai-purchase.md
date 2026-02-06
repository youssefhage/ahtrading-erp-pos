# AI Purchase Agent

## Trigger
- Items with qty_on_hand < reorder_point and a primary supplier.

## Recommendation
- Generates AI_PURCHASE recommendations with supplier_id and reorder_qty.
- min_order_qty is respected.

## Auto-Execute
- Controlled by `ai_agent_settings` (auto_execute, max_amount_usd, max_actions_per_day).
- When enabled, actions are queued in `ai_actions`.
