# AI Action Executor

## Purpose
Executes queued AI actions (auto-execute).

## Current Support
- AI_PURCHASE → creates purchase orders
- AI_DEMAND → creates purchase orders
- AI_PRICING → creates item prices

All executable agents obey company settings (`auto_execute`, `max_amount_usd`, `max_actions_per_day`) and can be manually queued from AI Hub when needed.

## Command
```bash
python3 backend/workers/ai_action_executor.py \
  --db postgresql://localhost/ahtrading \
  --company-id <company_uuid>
```
