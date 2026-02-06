# AI Settings API

All endpoints require header:
- `X-Company-Id: <company_uuid>`

## List Settings
- GET /ai/settings

## Upsert Setting
- POST /ai/settings

Fields:
- agent_code
- auto_execute
- max_amount_usd
- max_actions_per_day
