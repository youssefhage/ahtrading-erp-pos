#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

API_BASE="${API_BASE:-http://localhost:8001}"
COMPANY_ID="${COMPANY_ID:-00000000-0000-0000-0000-000000000001}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@ahtrading.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-ahtrading}"
DB_NAME="${DB_NAME:-ahtrading}"

if [[ ! -f "pos-desktop/config.json" ]]; then
  echo "Missing pos-desktop/config.json" >&2
  exit 1
fi

DEVICE_ID="${DEVICE_ID:-$(jq -r '.device_id' pos-desktop/config.json)}"
DEVICE_TOKEN="${DEVICE_TOKEN:-$(jq -r '.device_token' pos-desktop/config.json)}"
WAREHOUSE_ID="${WAREHOUSE_ID:-$(jq -r '.warehouse_id' pos-desktop/config.json)}"
SHIFT_ID="${SHIFT_ID:-$(jq -r '.shift_id // ""' pos-desktop/config.json)}"
CASHIER_ID="${CASHIER_ID:-$(jq -r '.cashier_id // ""' pos-desktop/config.json)}"
EXCHANGE_RATE="${EXCHANGE_RATE:-$(jq -r '.exchange_rate // 90000' pos-desktop/config.json)}"

if [[ -z "$DEVICE_ID" || "$DEVICE_ID" == "null" || -z "$DEVICE_TOKEN" || "$DEVICE_TOKEN" == "null" ]]; then
  echo "DEVICE_ID/DEVICE_TOKEN are required (from pos-desktop/config.json or env)." >&2
  exit 1
fi

HTTP_CODE=""
HTTP_BODY=""
PASS_COUNT=0
FAIL_COUNT=0

now_ts() { date +"%Y-%m-%dT%H:%M:%S"; }
log() { echo "[$(now_ts)] $*"; }
pass() { PASS_COUNT=$((PASS_COUNT + 1)); echo "[PASS] $*"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); echo "[FAIL] $*"; }

uuid_lc() { uuidgen | tr 'A-Z' 'a-z'; }

db_value() {
  local q="$1"
  docker compose exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -At -c "$q"
}

request_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  shift 3 || true
  local tmp
  tmp="$(mktemp)"
  local args=( -sS -o "$tmp" -w "%{http_code}" -X "$method" "$url" )
  while [[ $# -gt 0 ]]; do
    args+=( -H "$1" )
    shift
  done
  if [[ -n "$body" ]]; then
    args+=( --data "$body" )
  fi
  HTTP_CODE="$(curl "${args[@]}")"
  HTTP_BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

expect_code() {
  local expected="$1"
  local label="$2"
  if [[ "$HTTP_CODE" == "$expected" ]]; then
    pass "$label (HTTP $HTTP_CODE)"
    return 0
  fi
  fail "$label (expected $expected, got $HTTP_CODE) body=$HTTP_BODY"
  return 1
}

TODAY="$(date +%F)"
AUDIT_TAG="AUDIT-OPS-$(date +%s)"

log "Login"
request_json "POST" "$API_BASE/auth/login" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "Content-Type: application/json"
expect_code "200" "auth login" || exit 1
TOKEN="$(echo "$HTTP_BODY" | jq -r '.token // empty')"
if [[ -z "$TOKEN" ]]; then
  fail "auth token missing"
  exit 1
fi

AUTH_H="Authorization: Bearer $TOKEN"
COMPANY_H="X-Company-Id: $COMPANY_ID"
DEV_ID_H="X-Device-Id: $DEVICE_ID"
DEV_TOKEN_H="X-Device-Token: $DEVICE_TOKEN"

# Ensure active company is official.
request_json "POST" "$API_BASE/auth/select-company" "{\"company_id\":\"$COMPANY_ID\"}" "Content-Type: application/json" "$AUTH_H"
expect_code "200" "auth select-company" || exit 1

log "Load base entities"
SUPPLIER_ID="$(db_value "SELECT id FROM suppliers WHERE company_id='$COMPANY_ID' ORDER BY created_at LIMIT 1;")"
CUSTOMER_ID="$(db_value "SELECT id FROM customers WHERE company_id='$COMPANY_ID' AND is_active=true ORDER BY created_at LIMIT 1;")"
ITEM_ROW="$(db_value "SELECT id,tax_code_id,unit_of_measure FROM items WHERE company_id='$COMPANY_ID' ORDER BY created_at LIMIT 1;")"
ITEM_ID="${ITEM_ROW%%|*}"
ITEM_REST="${ITEM_ROW#*|}"
ITEM_TAX_CODE_ID="${ITEM_REST%%|*}"
ITEM_UOM="${ITEM_ROW##*|}"
if [[ -z "${ITEM_UOM:-}" ]]; then
  ITEM_UOM="EA"
fi
if [[ -z "$SUPPLIER_ID" || -z "$CUSTOMER_ID" || -z "$ITEM_ID" ]]; then
  fail "missing supplier/customer/item seed data"
  exit 1
fi
pass "seed entities resolved"

request_json "GET" "$API_BASE/pos/config" "" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "pos config" || exit 1
DEFAULT_VAT="$(echo "$HTTP_BODY" | jq -r '.default_vat_tax_code_id // empty')"
if [[ -n "$DEFAULT_VAT" ]]; then
  pass "default_vat_tax_code_id present"
else
  fail "default_vat_tax_code_id missing"
fi

# 1) Purchase receipt event -> process and validate dates.
GR_EVENT_ID="$(uuid_lc)"
GR_PAYLOAD="$(jq -nc \
  --arg sid "$SUPPLIER_ID" \
  --arg wid "$WAREHOUSE_ID" \
  --arg iid "$ITEM_ID" \
  --arg tag "$AUDIT_TAG" \
  --arg d "$TODAY" \
  --argjson ex "$EXCHANGE_RATE" \
  '{supplier_id:$sid,receipt_no:null,receipt_date:$d,supplier_ref:($tag+"-GR"),exchange_rate:$ex,warehouse_id:$wid,lines:[{item_id:$iid,qty:20,unit_cost_usd:1,unit_cost_lbp:90000,line_total_usd:20,line_total_lbp:1800000,batch_no:($tag+"-B1"),expiry_date:null}]}' )"
SUBMIT_GR="$(jq -nc --arg cid "$COMPANY_ID" --arg did "$DEVICE_ID" --arg eid "$GR_EVENT_ID" --argjson p "$GR_PAYLOAD" '{company_id:$cid,device_id:$did,events:[{event_id:$eid,event_type:"purchase.received",payload:$p,created_at:(now|todate),idempotency_key:null}]}')"
request_json "POST" "$API_BASE/pos/outbox/submit" "$SUBMIT_GR" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "submit purchase.received" || exit 1
request_json "POST" "$API_BASE/pos/outbox/process-one" "{\"event_id\":\"$GR_EVENT_ID\"}" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "process purchase.received" || exit 1

GR_ID="$(db_value "SELECT id FROM goods_receipts WHERE company_id='$COMPANY_ID' AND source_event_id='$GR_EVENT_ID' LIMIT 1;")"
if [[ -n "$GR_ID" ]]; then pass "goods receipt created"; else fail "goods receipt missing"; fi
GR_DATE_MISMATCH="$(db_value "SELECT COUNT(*) FROM goods_receipts gr JOIN gl_journals gj ON gj.company_id=gr.company_id AND gj.source_type='goods_receipt' AND gj.source_id=gr.id WHERE gr.id='$GR_ID' AND gj.journal_date <> gr.received_at::date;")"
if [[ "$GR_DATE_MISMATCH" == "0" ]]; then pass "goods receipt journal_date matches receipt_date"; else fail "goods receipt date mismatch count=$GR_DATE_MISMATCH"; fi

# 2) Purchase invoice event -> process and validate dates.
PI_EVENT_ID="$(uuid_lc)"
PI_PAYLOAD="$(jq -nc \
  --arg sid "$SUPPLIER_ID" \
  --arg iid "$ITEM_ID" \
  --arg d "$TODAY" \
  --argjson ex "$EXCHANGE_RATE" \
  --arg tc "$ITEM_TAX_CODE_ID" \
  --arg tag "$AUDIT_TAG" \
  '{supplier_id:$sid,invoice_no:null,supplier_ref:($tag+"-PI"),invoice_date:$d,exchange_rate:$ex,lines:[{item_id:$iid,qty:10,unit_cost_usd:1,unit_cost_lbp:90000,line_total_usd:10,line_total_lbp:900000}],tax:{tax_code_id:$tc,base_usd:10,base_lbp:900000,tax_usd:1.1,tax_lbp:99000,tax_date:$d},payments:[]}' )"
SUBMIT_PI="$(jq -nc --arg cid "$COMPANY_ID" --arg did "$DEVICE_ID" --arg eid "$PI_EVENT_ID" --argjson p "$PI_PAYLOAD" '{company_id:$cid,device_id:$did,events:[{event_id:$eid,event_type:"purchase.invoice",payload:$p,created_at:(now|todate),idempotency_key:null}]}')"
request_json "POST" "$API_BASE/pos/outbox/submit" "$SUBMIT_PI" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "submit purchase.invoice" || exit 1
request_json "POST" "$API_BASE/pos/outbox/process-one" "{\"event_id\":\"$PI_EVENT_ID\"}" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "process purchase.invoice" || exit 1

PI_ID="$(db_value "SELECT id FROM supplier_invoices WHERE company_id='$COMPANY_ID' AND source_event_id='$PI_EVENT_ID' LIMIT 1;")"
if [[ -n "$PI_ID" ]]; then pass "supplier invoice created"; else fail "supplier invoice missing"; fi
PI_DATE_MISMATCH="$(db_value "SELECT COUNT(*) FROM supplier_invoices si JOIN gl_journals gj ON gj.company_id=si.company_id AND gj.source_type='supplier_invoice' AND gj.source_id=si.id WHERE si.id='$PI_ID' AND gj.journal_date <> si.invoice_date;")"
if [[ "$PI_DATE_MISMATCH" == "0" ]]; then pass "supplier invoice journal_date matches invoice_date"; else fail "supplier invoice date mismatch count=$PI_DATE_MISMATCH"; fi

# 3) Sales credit invoice (no immediate payment) for /sales/payments checks.
SALE_A_EVENT_ID="$(uuid_lc)"
SALE_A_PAYLOAD="$(jq -nc \
  --arg cid "$CUSTOMER_ID" \
  --arg iid "$ITEM_ID" \
  --arg wid "$WAREHOUSE_ID" \
  --arg d "$TODAY" \
  --arg tc "$DEFAULT_VAT" \
  --arg uom "$ITEM_UOM" \
  --argjson ex "$EXCHANGE_RATE" \
  '{invoice_no:null,customer_id:$cid,exchange_rate:$ex,pricing_currency:"USD",settlement_currency:"USD",warehouse_id:$wid,invoice_date:$d,lines:[{item_id:$iid,qty:2,qty_factor:1,qty_entered:2,uom:$uom,unit_price_usd:3,unit_price_lbp:270000,line_total_usd:6,line_total_lbp:540000,tax_code_id:$tc}],tax:{tax_code_id:$tc,base_usd:6,base_lbp:540000,tax_usd:0,tax_lbp:0,tax_date:$d},payments:[]}' )"
SUBMIT_SALE_A="$(jq -nc --arg cid "$COMPANY_ID" --arg did "$DEVICE_ID" --arg eid "$SALE_A_EVENT_ID" --argjson p "$SALE_A_PAYLOAD" '{company_id:$cid,device_id:$did,events:[{event_id:$eid,event_type:"sale.completed",payload:$p,created_at:(now|todate),idempotency_key:null}]}')"
request_json "POST" "$API_BASE/pos/outbox/submit" "$SUBMIT_SALE_A" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "submit sale A" || exit 1
request_json "POST" "$API_BASE/pos/outbox/process-one" "{\"event_id\":\"$SALE_A_EVENT_ID\",\"force\":true}" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "process sale A" || exit 1
SALE_A_INVOICE_ID="$(echo "$HTTP_BODY" | jq -r '.invoice_id // empty')"
if [[ -n "$SALE_A_INVOICE_ID" ]]; then pass "sale A invoice created"; else fail "sale A missing invoice_id"; fi

TAX_LINE_MATCH="$(db_value "SELECT COUNT(*) FROM tax_lines WHERE company_id='$COMPANY_ID' AND source_type='sales_invoice' AND source_id='$SALE_A_INVOICE_ID' AND tax_code_id='$ITEM_TAX_CODE_ID' AND tax_lbp > 0;")"
if [[ "$TAX_LINE_MATCH" != "0" ]]; then pass "line-level VAT used for sale A"; else fail "line-level VAT not written for sale A"; fi

# 4) sales/payments happy path + guardrails.
PAY_BODY="{\"invoice_id\":\"$SALE_A_INVOICE_ID\",\"method\":\"cash\",\"amount_usd\":2,\"amount_lbp\":180000,\"payment_date\":\"$TODAY\"}"
request_json "POST" "$API_BASE/sales/payments" "$PAY_BODY" "Content-Type: application/json" "$AUTH_H" "$COMPANY_H"
expect_code "200" "sales payment accepted for posted AR invoice" || exit 1

OVERPAY_BODY="{\"invoice_id\":\"$SALE_A_INVOICE_ID\",\"method\":\"cash\",\"amount_usd\":999,\"amount_lbp\":89910000,\"payment_date\":\"$TODAY\"}"
request_json "POST" "$API_BASE/sales/payments" "$OVERPAY_BODY" "Content-Type: application/json" "$AUTH_H" "$COMPANY_H"
if [[ "$HTTP_CODE" == "409" ]]; then pass "sales payment overpay blocked"; else fail "sales payment overpay expected 409 got $HTTP_CODE body=$HTTP_BODY"; fi

DRAFT_BODY="$(jq -nc --arg wid "$WAREHOUSE_ID" --arg d "$TODAY" --argjson ex "$EXCHANGE_RATE" '{warehouse_id:$wid,invoice_date:$d,exchange_rate:$ex,pricing_currency:"USD",settlement_currency:"USD",lines:[]}')"
request_json "POST" "$API_BASE/sales/invoices/drafts" "$DRAFT_BODY" "Content-Type: application/json" "$AUTH_H" "$COMPANY_H"
expect_code "200" "create sales draft" || exit 1
DRAFT_ID="$(echo "$HTTP_BODY" | jq -r '.id // empty')"
DRAFT_PAY_BODY="{\"invoice_id\":\"$DRAFT_ID\",\"method\":\"cash\",\"amount_usd\":1,\"amount_lbp\":90000,\"payment_date\":\"$TODAY\"}"
request_json "POST" "$API_BASE/sales/payments" "$DRAFT_PAY_BODY" "Content-Type: application/json" "$AUTH_H" "$COMPANY_H"
if [[ "$HTTP_CODE" == "409" ]]; then pass "sales payment blocked for draft invoice"; else fail "draft payment expected 409 got $HTTP_CODE body=$HTTP_BODY"; fi

# 5) Non-AR posted invoice should reject /sales/payments.
SALE_C_EVENT_ID="$(uuid_lc)"
SALE_C_PAYLOAD="$(jq -nc \
  --arg iid "$ITEM_ID" \
  --arg wid "$WAREHOUSE_ID" \
  --arg d "$TODAY" \
  --arg uom "$ITEM_UOM" \
  --argjson ex "$EXCHANGE_RATE" \
  '{invoice_no:null,customer_id:null,exchange_rate:$ex,pricing_currency:"USD",settlement_currency:"USD",warehouse_id:$wid,invoice_date:$d,lines:[{item_id:$iid,qty:1,qty_factor:1,qty_entered:1,uom:$uom,unit_price_usd:3,unit_price_lbp:270000,line_total_usd:3,line_total_lbp:270000}],payments:[{method:"cash",amount_usd:3,amount_lbp:0}]}' )"
SUBMIT_SALE_C="$(jq -nc --arg cid "$COMPANY_ID" --arg did "$DEVICE_ID" --arg eid "$SALE_C_EVENT_ID" --argjson p "$SALE_C_PAYLOAD" '{company_id:$cid,device_id:$did,events:[{event_id:$eid,event_type:"sale.completed",payload:$p,created_at:(now|todate),idempotency_key:null}]}')"
request_json "POST" "$API_BASE/pos/outbox/submit" "$SUBMIT_SALE_C" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "submit sale C" || exit 1
request_json "POST" "$API_BASE/pos/outbox/process-one" "{\"event_id\":\"$SALE_C_EVENT_ID\",\"force\":true}" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "process sale C" || exit 1
SALE_C_INVOICE_ID="$(echo "$HTTP_BODY" | jq -r '.invoice_id // empty')"
NON_AR_PAY_BODY="{\"invoice_id\":\"$SALE_C_INVOICE_ID\",\"method\":\"cash\",\"amount_usd\":1,\"amount_lbp\":90000,\"payment_date\":\"$TODAY\"}"
request_json "POST" "$API_BASE/sales/payments" "$NON_AR_PAY_BODY" "Content-Type: application/json" "$AUTH_H" "$COMPANY_H"
if [[ "$HTTP_CODE" == "400" ]]; then pass "sales payment blocked for non-AR invoice"; else fail "non-AR payment expected 400 got $HTTP_CODE body=$HTTP_BODY"; fi

# 6) Return event + device receipt endpoints (web print data paths).
RETURN_EVENT_ID="$(uuid_lc)"
RETURN_PAYLOAD="$(jq -nc \
  --arg inv "$SALE_C_INVOICE_ID" \
  --arg iid "$ITEM_ID" \
  --arg wid "$WAREHOUSE_ID" \
  --arg d "$TODAY" \
  --arg uom "$ITEM_UOM" \
  --argjson ex "$EXCHANGE_RATE" \
  '{return_no:null,invoice_id:$inv,return_date:$d,exchange_rate:$ex,pricing_currency:"USD",settlement_currency:"USD",warehouse_id:$wid,refund_method:"cash",lines:[{item_id:$iid,qty:1,qty_factor:1,qty_entered:1,uom:$uom,unit_price_usd:3,unit_price_lbp:270000,line_total_usd:3,line_total_lbp:270000}]}' )"
SUBMIT_RETURN="$(jq -nc --arg cid "$COMPANY_ID" --arg did "$DEVICE_ID" --arg eid "$RETURN_EVENT_ID" --argjson p "$RETURN_PAYLOAD" '{company_id:$cid,device_id:$did,events:[{event_id:$eid,event_type:"sale.returned",payload:$p,created_at:(now|todate),idempotency_key:null}]}')"
request_json "POST" "$API_BASE/pos/outbox/submit" "$SUBMIT_RETURN" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "submit return" || exit 1
request_json "POST" "$API_BASE/pos/outbox/process-one" "{\"event_id\":\"$RETURN_EVENT_ID\",\"force\":true}" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "process return" || exit 1
RETURN_ID="$(echo "$HTTP_BODY" | jq -r '.return_id // empty')"
if [[ -n "$RETURN_ID" ]]; then pass "return created with return_id"; else fail "return missing return_id"; fi

request_json "GET" "$API_BASE/pos/sales-returns/by-event/$RETURN_EVENT_ID" "" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "pos return by-event" || exit 1
request_json "GET" "$API_BASE/pos/sales-returns/last" "" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "pos return last" || exit 1
LAST_RETURN_ID="$(echo "$HTTP_BODY" | jq -r '.receipt.return.id // empty')"
if [[ -n "$LAST_RETURN_ID" ]]; then pass "pos return last contains receipt"; else fail "pos return last missing receipt"; fi

RET_DATE_MISMATCH="$(db_value "SELECT COUNT(*) FROM stock_moves sm JOIN gl_journals gj ON gj.company_id=sm.company_id AND gj.source_type='sales_return' AND gj.source_id=sm.source_id WHERE sm.company_id='$COMPANY_ID' AND sm.source_type='sales_return' AND sm.source_id='$RETURN_ID' AND sm.move_date::date <> gj.journal_date;")"
if [[ "$RET_DATE_MISMATCH" == "0" ]]; then pass "sales return stock move date matches journal date"; else fail "sales return date mismatch count=$RET_DATE_MISMATCH"; fi

request_json "GET" "$API_BASE/pos/sales-invoices/$SALE_C_INVOICE_ID" "" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "pos sales invoice detail" || exit 1
request_json "GET" "$API_BASE/pos/receipts/last" "" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "pos receipts last" || exit 1
LAST_RECEIPT_ID="$(echo "$HTTP_BODY" | jq -r '.receipt.invoice.id // empty')"
if [[ -n "$LAST_RECEIPT_ID" ]]; then pass "pos receipts last contains receipt"; else fail "pos receipts last missing receipt"; fi

request_json "GET" "$API_BASE/pos/customers/$CUSTOMER_ID" "" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "pos customer by-id" || exit 1

# 7) Durable idempotency path.
IDEMP_KEY="$AUDIT_TAG-idem"
SALE_D_EVENT1="$(uuid_lc)"
SALE_D_EVENT2="$(uuid_lc)"
SALE_D_PAYLOAD="$(jq -nc \
  --arg iid "$ITEM_ID" \
  --arg wid "$WAREHOUSE_ID" \
  --arg d "$TODAY" \
  --arg uom "$ITEM_UOM" \
  --argjson ex "$EXCHANGE_RATE" \
  '{invoice_no:null,customer_id:null,exchange_rate:$ex,pricing_currency:"USD",settlement_currency:"USD",warehouse_id:$wid,invoice_date:$d,lines:[{item_id:$iid,qty:1,qty_factor:1,qty_entered:1,uom:$uom,unit_price_usd:2,unit_price_lbp:180000,line_total_usd:2,line_total_lbp:180000}],payments:[{method:"cash",amount_usd:2,amount_lbp:0}]}' )"
SUBMIT_D1="$(jq -nc --arg cid "$COMPANY_ID" --arg did "$DEVICE_ID" --arg eid "$SALE_D_EVENT1" --arg ik "$IDEMP_KEY" --argjson p "$SALE_D_PAYLOAD" '{company_id:$cid,device_id:$did,events:[{event_id:$eid,event_type:"sale.completed",payload:$p,created_at:(now|todate),idempotency_key:$ik}]}')"
request_json "POST" "$API_BASE/pos/outbox/submit" "$SUBMIT_D1" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "submit idempotent event #1" || exit 1
request_json "POST" "$API_BASE/pos/outbox/process-one" "{\"event_id\":\"$SALE_D_EVENT1\",\"force\":true}" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "process idempotent event #1" || exit 1
D1_INVOICE_ID="$(echo "$HTTP_BODY" | jq -r '.invoice_id // empty')"

SUBMIT_D2="$(jq -nc --arg cid "$COMPANY_ID" --arg did "$DEVICE_ID" --arg eid "$SALE_D_EVENT2" --arg ik "$IDEMP_KEY" --argjson p "$SALE_D_PAYLOAD" '{company_id:$cid,device_id:$did,events:[{event_id:$eid,event_type:"sale.completed",payload:$p,created_at:(now|todate),idempotency_key:$ik}]}')"
request_json "POST" "$API_BASE/pos/outbox/submit" "$SUBMIT_D2" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "submit idempotent event #2" || exit 1
D2_STATUS="$(echo "$HTTP_BODY" | jq -r --arg eid "$SALE_D_EVENT2" '.accepted_meta[] | select(.event_id==$eid) | .status')"
D2_EXISTING="$(echo "$HTTP_BODY" | jq -r --arg eid "$SALE_D_EVENT2" '.accepted_meta[] | select(.event_id==$eid) | .existing_event_id // empty')"
if [[ "$D2_STATUS" == "duplicate" && "$D2_EXISTING" == "$SALE_D_EVENT1" ]]; then
  pass "idempotency duplicate recognized with existing_event_id"
else
  fail "idempotency duplicate metadata unexpected status=$D2_STATUS existing=$D2_EXISTING"
fi
request_json "POST" "$API_BASE/pos/outbox/process-one" "{\"event_id\":\"$D2_EXISTING\",\"force\":true}" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "process duplicate using existing_event_id" || exit 1
D2_INVOICE_ID="$(echo "$HTTP_BODY" | jq -r '.invoice_id // empty')"
if [[ "$D1_INVOICE_ID" == "$D2_INVOICE_ID" && -n "$D1_INVOICE_ID" ]]; then
  pass "idempotent replay resolves to single invoice"
else
  fail "idempotent replay invoice mismatch d1=$D1_INVOICE_ID d2=$D2_INVOICE_ID"
fi
INVOICE_COUNT_DUPE="$(db_value "SELECT COUNT(*) FROM sales_invoices WHERE company_id='$COMPANY_ID' AND source_event_id IN ('$SALE_D_EVENT1','$SALE_D_EVENT2');")"
if [[ "$INVOICE_COUNT_DUPE" == "1" ]]; then pass "duplicate event did not create second invoice"; else fail "duplicate created extra invoices count=$INVOICE_COUNT_DUPE"; fi

# 8) Backoff metadata on failed event.
FAIL_EVENT_ID="$(uuid_lc)"
FAIL_PAYLOAD='{"warehouse_id":"'$WAREHOUSE_ID'","exchange_rate":'$EXCHANGE_RATE',"lines":[]}'
SUBMIT_FAIL="$(jq -nc --arg cid "$COMPANY_ID" --arg did "$DEVICE_ID" --arg eid "$FAIL_EVENT_ID" --argjson p "$FAIL_PAYLOAD" '{company_id:$cid,device_id:$did,events:[{event_id:$eid,event_type:"sale.completed",payload:$p,created_at:(now|todate),idempotency_key:null}]}')"
request_json "POST" "$API_BASE/pos/outbox/submit" "$SUBMIT_FAIL" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "submit intentionally invalid event" || exit 1
request_json "POST" "$API_BASE/pos/outbox/process-one" "{\"event_id\":\"$FAIL_EVENT_ID\",\"force\":true}" "Content-Type: application/json" "$DEV_ID_H" "$DEV_TOKEN_H"
if [[ "$HTTP_CODE" == "409" ]]; then
  pass "invalid event failed as expected"
else
  fail "invalid event expected 409 got $HTTP_CODE body=$HTTP_BODY"
fi
FAIL_STATUS_ROW="$(db_value "SELECT status || '|' || attempt_count || '|' || COALESCE(to_char(next_attempt_at,'YYYY-MM-DD"T"HH24:MI:SS'),'') FROM pos_events_outbox WHERE id='$FAIL_EVENT_ID';")"
FAIL_STATUS="${FAIL_STATUS_ROW%%|*}"
FAIL_REST="${FAIL_STATUS_ROW#*|}"
FAIL_ATTEMPT="${FAIL_REST%%|*}"
FAIL_NEXT="${FAIL_STATUS_ROW##*|}"
if [[ "$FAIL_STATUS" == "failed" && "$FAIL_ATTEMPT" -ge 1 && -n "$FAIL_NEXT" ]]; then
  pass "failed outbox event has retry schedule"
else
  fail "failed outbox retry metadata unexpected row=$FAIL_STATUS_ROW"
fi

# 9) Outbox summary health endpoint.
request_json "GET" "$API_BASE/pos/outbox/device-summary" "" "$DEV_ID_H" "$DEV_TOKEN_H"
expect_code "200" "pos outbox device summary" || exit 1
SUMMARY_TOTAL="$(echo "$HTTP_BODY" | jq -r '.total // -1')"
if [[ "$SUMMARY_TOTAL" =~ ^[0-9]+$ ]]; then pass "outbox summary shape valid"; else fail "outbox summary invalid body=$HTTP_BODY"; fi

echo
echo "Smoke Summary: PASS=$PASS_COUNT FAIL=$FAIL_COUNT"
if [[ "$FAIL_COUNT" -ne 0 ]]; then
  exit 1
fi
