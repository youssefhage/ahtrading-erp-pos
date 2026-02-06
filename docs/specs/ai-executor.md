# AI Action Executor

## Purpose
Executes queued AI actions (auto-execute).

## Current Support
- AI_PURCHASE → creates purchase orders

## Command
```bash
python3 backend/workers/ai_action_executor.py \
  --db postgresql://localhost/ahtrading \
  --company-id <company_uuid>
```
