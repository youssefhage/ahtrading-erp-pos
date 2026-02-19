# Platform Performance Audit (2026-02-19)

Repo: `/Users/Youssef/oDocuments/Business/Codex POS`

## Executive Summary

Primary root cause of perceived slowness and instability is **local infrastructure pressure**, not only internet latency:

- Host disk was critically low (`~1.1 GiB` free on `/System/Volumes/Data`).
- Docker VM reported filesystem I/O failures and stopped:
  - `no space left on device`
  - `EXT4-fs ... potential data loss`
  - `Buffer I/O error on device vda1`
- This can cause random API failures, stalled containers, and request slowness that looks like “internet issues”.

Internet checks were not the main bottleneck:
- External HTTPS requests completed in roughly `0.2s–0.45s` (first warm-up call higher).

## What Was Already Optimized In Code

- Backend gzip + tunable perf flags.
- Customers endpoint supports pagination/search (legacy full-list still available).
- Inventory stock/moves/alerts endpoints enriched with names/SKU to remove extra catalog preloads.
- Multiple Admin pages switched away from loading full item/customer lists.
- Search indexes added (`pg_trgm` + GIN) for large text-search paths.

## Measured API Timings (After Optimizations)

12-sample runs, authenticated, company-scoped.

- Direct `GET /customers?limit=25`: avg `0.0065s`, p95 `0.0075s`, payload `14,715 B`
- Proxy `GET /api/customers?limit=25`: avg `0.0092s`, p95 `0.0117s`, payload `14,715 B`
- Direct `GET /inventory/moves?limit=50`: avg `0.0069s`, p95 `0.0073s`, payload `21,171 B`
- Proxy `GET /api/inventory/moves?limit=50`: avg `0.0088s`, p95 `0.0100s`, payload `21,171 B`
- Direct `GET /inventory/expiry-alerts?days=60`: avg `0.0048s`, p95 `0.0052s`, payload `11 B`
- Proxy `GET /api/inventory/expiry-alerts?days=60`: avg `0.0068s`, p95 `0.0075s`, payload `11 B`
- Direct `GET /inventory/stock?by_batch=false`: avg `0.0050s`, p95 `0.0064s`, payload `606 B`
- Proxy `GET /api/inventory/stock?by_batch=false`: avg `0.0072s`, p95 `0.0080s`, payload `606 B`

Remaining heavy endpoints (still significant payloads):

- Direct `GET /customers` (full): avg `0.0258s`, payload `220,512 B`
- Direct `GET /items/min`: avg `0.0462s`, payload `325,005 B`

Conclusion:
- Proxy overhead is small.
- Large payload endpoints are still a key performance tax for UI flows that preload everything.

## Attachment Storage Audit (Major DB Bloat Driver)

Initial state:

- `document_attachments`: `3748` rows with `bytes` populated
- Total inline bytes: `9,812,136,399` (`~9.36 GiB`)
- Relation size: `~9.7 GiB`, mostly TOAST

Migration progress achieved before Docker VM failure:

- `940` attachments moved to `storage_backend='s3'`
- Remaining inline rows: `2808`
- Remaining inline bytes: `7,165,652,250`
- Approx bytes offloaded so far: `~2.65 GiB`

## Infra Findings (Critical)

From Docker logs:

- Docker backend reported: `write .../vm/init.log: no space left on device`
- VM console showed ext4 I/O failures during write activity.
- Docker Desktop then entered error state and daemon became unavailable.

Host space snapshot:

- Before cleanup: `~1.1 GiB` free
- After safe cache cleanup: `~7.2 GiB` free

Safe cleanup performed:

- Removed large rebuildable cache folders under `~/Library/Caches` (Playwright/Yarn/pnpm/pip/Google cache and related updater caches).

## Script Hardening Done

`backend/scripts/migrate_attachments_to_s3.py` was improved to be safer and auditable:

- Added `BATCH_ROWS` control for chunked processing.
- Added byte counters in summary output.
- Fixed dry-run duplicate-row behavior (OFFSET pagination).
- Added conversion of fetched blobs to concrete bytes for upload.
- Added transient retry loop for S3/MinIO upload failures.

## Current Blocker

Docker daemon is currently unavailable after repeated VM storage failures, so full rerun/verification is blocked until Docker Desktop recovers.

## Recommended Completion Steps

1. Recover Docker Desktop runtime:
   - Relaunch Docker Desktop.
   - If it still fails, use Docker Desktop’s recovery flow (non-destructive restart first, factory reset only as last resort).
2. Resume attachment offload in controlled batches:
   - `LIMIT=100` and `BATCH_ROWS=10..20` per run.
3. Re-check attachment footprint and then vacuum:
   - `VACUUM (ANALYZE) document_attachments;`
   - Consider `VACUUM FULL document_attachments` only during maintenance window if file shrink is required.
4. Finish replacing remaining `/items/min` preloads in Admin routes.

