# AI Inventory Agent

## Trigger
- Scans on-hand stock against reorder_point per item.

## Recommendation
- Generates AI_INVENTORY recommendation when qty_on_hand < reorder_point.
- Includes reorder_qty in recommendation payload.

## Controls
- Reorder thresholds are managed in items table (reorder_point, reorder_qty).
