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

## Continuation (2026-02-19, 12:50 UTC)

This continuation focused on separating:
- internet/edge latency,
- backend processing latency,
- frontend payload/caching behavior.

### Current Runtime Snapshot

- Local Docker daemon is still unavailable.
- Local API is not listening on `localhost:8000` (local Postgres is up on `5432`).
- Host storage is critically full again: `/System/Volumes/Data` at ~`100%`, ~`1.1 GiB` free.
- Memory pressure is also visible (`vm.swapusage`: ~`4.2 GiB` used of `5.0 GiB`).

### Internet vs Backend Latency (Cloud)

Observed from this Mac:

- `ping 1.1.1.1` showed high variance and packet loss in this sample (`10%` loss, avg ~`117 ms`).
- `ping api.melqard.com` also high jitter (avg ~`186 ms`, max ~`429 ms`).

Warm-connection backend checks (single persistent HTTPS connection, 30 requests):

- `https://api.melqard.com/meta`: warm mean ~`0.208s` (min ~`0.087s`, p95-ish ~`0.354s`)
- `https://app.melqard.com/api/meta`: warm mean ~`0.187s`
- `https://pos.melqard.com/api/meta`: warm mean ~`0.222s`

External warm baselines from same host:

- `https://www.google.com/generate_204`: warm mean ~`0.067s`
- `https://cloudflare.com/cdn-cgi/trace`: warm mean ~`0.016s`

Interpretation:
- Backend is not the primary bottleneck on health/meta paths.
- Main delay felt by users is dominated by network/TLS/edge path variance, plus frontend asset delivery behavior.

### Frontend Delivery Findings

`app.melqard.com`:
- Next static assets are correctly cacheable (`Cache-Control: public, max-age=31536000, immutable`).
- Sample compressed static total on initial page asset set: ~`263,783 B`.

`pos.melqard.com`:
- Main bundle is large: `/assets/index-Dj759R_I.js` = `759,608 B`.
- CSS: `/assets/index-Yz5lG31Q.css` = `71,539 B`.
- In sampled responses this JS was not compressed in transit (download size stayed ~`759,608 B` with `--compressed`).
- Cache headers were missing long-lived immutable directives on these static assets.

Impact:
- POS first-load and hard-refresh times are significantly worse than necessary, especially on variable links.

### Dokploy Health Signal

- AH Trading compose (`rE3LOs75BjgPOtGTXR3u3`) currently reports `composeStatus: "error"`.
- Recent deployments include multiple `error` runs on 2026-02-19 (e.g. around `11:51`, `12:06`, `12:12` UTC), mixed with successful ones.

This does not prove current runtime outage by itself, but it is an operational risk indicator and should be investigated in deployment logs.

### Immediate Fix Applied

Applied a production delivery improvement for POS web:

- Updated `apps/pos-web/nginx.conf` to:
  - enable gzip for text/js/css/json/svg,
  - disable caching for `index.html`,
  - enable long-lived immutable caching for `/assets/*`.

This should reduce first-load transfer time and repeat-load bandwidth after redeploy.

### Updated Priority Actions

1. P0: Free substantial local disk space and recover Docker runtime stability (target >`30 GiB` free).
2. P0: Redeploy `pos_web` to apply new nginx compression/caching config.
3. P1: Investigate Dokploy deployment errors for compose `rE3LOs75BjgPOtGTXR3u3` and stabilize deploy pipeline.
4. P1: Reduce POS web JS bundle size (route/code splitting, dependency trimming).
5. P1: Capture real-user web vitals (TTFB/LCP) in production to separate network regions vs app regressions over time.
