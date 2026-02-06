# Offline Sync Protocol (POS)

## Goals
- POS never blocks on internet outages.
- All transactions are recorded locally and synced later.
- Server remains the source of truth.

## Local Storage
- SQLite on each POS device.
- Tables:
  - local_items_cache
  - local_prices_cache
  - local_promotions_cache
  - local_customers_cache (optional)
  - pos_outbox_events
  - pos_sync_state
  - schema reference: `pos/sqlite_schema.sql`

## Outbox Events
- Each sale/return/payment creates an event:
  - event_id (UUID)
  - event_type
  - payload
  - created_at
  - status (pending|sent|acked|failed)

## Sync Steps
1) POS sends pending events in chronological order.
2) Server validates and writes to main DB.
3) Server returns ACK with authoritative IDs.
4) POS marks event as acked and maps local IDs to server IDs.

## Idempotency
- event_id is unique and stored server-side.
- Duplicate events are ignored safely.

## Conflict Rules
- POS never overwrites server data.
- Server updates always win.
- If a local item is removed or price changed:
  - POS uses cached price for historical sales.
  - New sales fetch updated price when online.

## Reconciliation
- End-of-day report compares:
  - POS totals vs server totals
  - Cash drawer vs sales payments
- Discrepancies flagged for review.

## Latency Targets
- Sale posting (offline): <2s
- Sync cycle: configurable (default 1-5 min when online)
