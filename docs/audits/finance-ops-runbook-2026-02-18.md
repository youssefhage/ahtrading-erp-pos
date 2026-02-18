# Finance Ops Runbook (POS / Sales / VAT / Purchases)

## Scope
- Sales invoice posting and payment capture
- Sales returns and VAT reversal
- Purchase receipts and supplier invoice posting
- Unified POS outbox reliability (web + desktop)

## Runbook 1: Sales Payment Rejection Handling
- Symptom: `POST /sales/payments` returns `409` (`payment exceeds invoice outstanding balance`) or `400` (`invoice is not receivable-backed`).
- Steps:
1. Confirm invoice state is `posted`.
2. Confirm invoice has `customer_id` (AR-backed).
3. Recompute paid amount with `sales_payments` excluding voided rows.
4. If race condition suspected, retry once after reading latest invoice totals.

## Runbook 2: Outbox Failed/Dead Recovery
- Symptom: device shows failed/dead events in `/pos/outbox/device-summary`.
- Steps:
1. Query `/pos/outbox/device?status=failed` and capture `error_message`.
2. Fix root cause (config, mapping, closed period, missing default account).
3. For company-admin flow, requeue dead/failed rows with `/pos/outbox/{event_id}/requeue`.
4. Trigger processing via `/sync/push` (web) or worker loop (desktop/backend).

## Runbook 3: Posting-Date Exceptions
- Symptom: returns/receipts/invoices rejected with period lock errors.
- Steps:
1. Verify business date in payload (`return_date`, `receipt_date`, `invoice_date`).
2. Verify lock range in `accounting_period_locks`.
3. Re-submit with a date in an open period if policy allows.

## Operational KPI Queries

### 1) Outbox age and queue pressure
```sql
SELECT
  d.company_id,
  o.status,
  COUNT(*) AS cnt,
  MIN(o.created_at) AS oldest_created_at
FROM pos_events_outbox o
JOIN pos_devices d ON d.id = o.device_id
GROUP BY d.company_id, o.status
ORDER BY d.company_id, o.status;
```

### 2) Duplicate prevention hits (idempotency)
```sql
SELECT
  d.company_id,
  o.event_type,
  o.idempotency_key,
  COUNT(*) AS occurrences
FROM pos_events_outbox o
JOIN pos_devices d ON d.id = o.device_id
WHERE o.idempotency_key IS NOT NULL
  AND btrim(o.idempotency_key) <> ''
GROUP BY d.company_id, o.event_type, o.idempotency_key
HAVING COUNT(*) > 1;
```

### 3) Posting date anomalies
```sql
SELECT id, source_type, source_id, journal_date, created_at
FROM gl_journals
WHERE source_type IN ('sales_return', 'goods_receipt', 'supplier_invoice')
  AND journal_date <> created_at::date
ORDER BY created_at DESC
LIMIT 200;
```
