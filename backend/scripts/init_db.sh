#!/usr/bin/env bash
set -euo pipefail

DB_URL=${DATABASE_URL:-postgresql://localhost/ahtrading}

psql_exec() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"
}

psql_value() {
  psql "$DB_URL" -tA "$@"
}

ensure_schema_migrations() {
  psql_exec -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"
}

has_version() {
  local version=$1
  psql_value -c "SELECT 1 FROM schema_migrations WHERE version = '${version}' LIMIT 1;"
}

mark_version() {
  local version=$1
  psql_exec -c "INSERT INTO schema_migrations (version) VALUES ('${version}') ON CONFLICT DO NOTHING;"
}

run_migration() {
  local version=$1
  local file=$2
  if [[ -z "$(has_version "$version")" ]]; then
    psql_exec -f "$file"
    mark_version "$version"
  fi
}

bootstrap_existing_versions() {
  if [[ -n "$(psql_value -c "SELECT 1 FROM schema_migrations LIMIT 1;")" ]]; then
    return
  fi

  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='companies' LIMIT 1;")" ]]; then
    mark_version "001_init"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM pg_proc WHERE proname='clone_coa_template_to_company' LIMIT 1;")" ]]; then
    mark_version "002_coa_clone"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tax_lines' AND column_name='company_id' LIMIT 1;")" ]]; then
    mark_version "003_tax_lines_company"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='account_roles' LIMIT 1;")" ]]; then
    mark_version "004_account_roles"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_events_outbox' AND column_name='processed_at' LIMIT 1;")" ]]; then
    mark_version "005_pos_events_and_tax"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='vat_report_monthly' LIMIT 1;")" ]]; then
    mark_version "006_reports"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='events' LIMIT 1;")" ]]; then
    mark_version "007_ai_events"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='items' AND column_name='reorder_point' LIMIT 1;")" ]]; then
    mark_version "008_item_reorder"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM pg_indexes WHERE indexname='idx_ai_recommendations_event_agent' LIMIT 1;")" ]]; then
    mark_version "009_ai_indexes"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='item_suppliers' LIMIT 1;")" ]]; then
    mark_version "010_item_suppliers"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customer_loyalty_ledger' LIMIT 1;")" ]]; then
    mark_version "011_customer_credit_loyalty"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ai_agent_settings' LIMIT 1;")" ]]; then
    mark_version "012_ai_settings"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='purchase_order_lines' LIMIT 1;")" ]]; then
    mark_version "013_purchase_order_lines"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='auth_sessions' LIMIT 1;")" ]]; then
    mark_version "014_auth_sessions"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_devices' AND column_name='device_token_hash' LIMIT 1;")" ]]; then
    mark_version "015_pos_device_tokens"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM permissions WHERE code='pos:manage' LIMIT 1;")" ]]; then
    mark_version "016_permissions"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pos_shifts' LIMIT 1;")" ]]; then
    mark_version "017_pos_shifts"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payment_method_mappings' LIMIT 1;")" ]]; then
    mark_version "018_payment_method_mappings"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='document_sequences' LIMIT 1;")" ]]; then
    mark_version "019_document_sequences"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pos_cash_movements' LIMIT 1;")" ]]; then
    mark_version "020_pos_cash_movements"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='item_warehouse_costs' LIMIT 1;")" ]]; then
    mark_version "021_item_costing"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='items' AND column_name='updated_at' LIMIT 1;")" ]]; then
    mark_version "022_catalog_timestamps"
  fi

  if [[ -n "$(psql_value -c "SELECT 1 FROM coa_templates WHERE code='LB_COA_2025' LIMIT 1;")" ]]; then
    mark_version "seed_coa_lebanon"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM account_roles LIMIT 1;")" ]]; then
    mark_version "seed_account_roles"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM companies LIMIT 1;")" ]]; then
    mark_version "seed_companies"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM company_coa_versions LIMIT 1;")" ]]; then
    mark_version "seed_company_coa"
  fi
}

ensure_schema_migrations
bootstrap_existing_versions

run_migration "001_init" "backend/db/migrations/001_init.sql"
run_migration "002_coa_clone" "backend/db/migrations/002_coa_clone.sql"
run_migration "003_tax_lines_company" "backend/db/migrations/003_tax_lines_company.sql"
run_migration "004_account_roles" "backend/db/migrations/004_account_roles.sql"
run_migration "005_pos_events_and_tax" "backend/db/migrations/005_pos_events_and_tax.sql"
run_migration "006_reports" "backend/db/migrations/006_reports.sql"
run_migration "007_ai_events" "backend/db/migrations/007_ai_events.sql"
run_migration "008_item_reorder" "backend/db/migrations/008_item_reorder.sql"
run_migration "009_ai_indexes" "backend/db/migrations/009_ai_indexes.sql"
run_migration "010_item_suppliers" "backend/db/migrations/010_item_suppliers.sql"
run_migration "011_customer_credit_loyalty" "backend/db/migrations/011_customer_credit_loyalty.sql"
run_migration "012_ai_settings" "backend/db/migrations/012_ai_settings.sql"
run_migration "013_purchase_order_lines" "backend/db/migrations/013_purchase_order_lines.sql"
run_migration "014_auth_sessions" "backend/db/migrations/014_auth_sessions.sql"
run_migration "015_pos_device_tokens" "backend/db/migrations/015_pos_device_tokens.sql"
run_migration "016_permissions" "backend/db/migrations/016_permissions.sql"
run_migration "017_pos_shifts" "backend/db/migrations/017_pos_shifts.sql"
run_migration "018_payment_method_mappings" "backend/db/migrations/018_payment_method_mappings.sql"
run_migration "019_document_sequences" "backend/db/migrations/019_document_sequences.sql"
run_migration "020_pos_cash_movements" "backend/db/migrations/020_pos_cash_movements.sql"
run_migration "021_item_costing" "backend/db/migrations/021_item_costing.sql"
run_migration "022_catalog_timestamps" "backend/db/migrations/022_catalog_timestamps.sql"

run_migration "seed_coa_lebanon" "backend/db/seeds/seed_coa_lebanon.sql"
run_migration "seed_account_roles" "backend/db/seeds/seed_account_roles.sql"
run_migration "seed_companies" "backend/db/seeds/seed_companies.sql"
run_migration "seed_company_coa" "backend/db/seeds/seed_company_coa.sql"

echo "Database initialized."
