# POS Sync API (Draft)

## Authentication
- Device token or API key per POS device
- Each request binds to a company_id

## Endpoints
### POST /pos/devices/register
Register a POS device.

Payload:
- company_id
- branch_id
- device_code

### POST /pos/outbox/submit
Device sends a batch of offline events.

Payload:
- device_id
- company_id
- events[]: {event_id, event_type, payload, created_at}

Server behavior:
- Store events as received
- Acknowledge accepted event IDs
- Process asynchronously into business documents

### GET /pos/inbox/pull
Device requests server updates.

Response:
- events[]: {event_id, event_type, payload}

### GET /pos/catalog
Fetch items and latest prices for offline cache.

### POST /pos/heartbeat
Device sends status (online, shift, cash drawer open/close).

## Idempotency
- event_id must be unique
- duplicates are ignored

## Error Handling
- Event-level errors are returned per event
- Device retries only failed events
