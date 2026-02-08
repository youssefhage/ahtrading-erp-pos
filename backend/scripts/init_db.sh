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

ensure_app_role() {
  local role="${APP_DB_USER:-ahapp}"
  local pass="${APP_DB_PASSWORD:-ahapp}"
  if [[ -z "$role" ]]; then
    return
  fi

  if [[ ! "$role" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    echo "Invalid APP_DB_USER '$role' (must match ^[a-zA-Z_][a-zA-Z0-9_]*$)" >&2
    exit 2
  fi

  local pass_escaped="${pass//\'/\'\'}"
  # Create the role if missing. This is safe to run concurrently (API + worker may start together).
  psql_exec <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE "${role}" LOGIN PASSWORD '${pass_escaped}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END
\$\$;
SQL

  # Grant required privileges on existing and future objects in `public`.
  psql_exec -c "GRANT USAGE ON SCHEMA public TO \"${role}\";"
  psql_exec -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \"${role}\";"
  psql_exec -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"${role}\";"
  psql_exec -c "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO \"${role}\";"

  psql_exec -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO \"${role}\";"
  psql_exec -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO \"${role}\";"
  psql_exec -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO \"${role}\";"
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
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_sessions' AND column_name='active_company_id' LIMIT 1;")" ]]; then
    mark_version "027_auth_sessions_active_company"
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
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sales_return_lines' LIMIT 1;")" ]]; then
    mark_version "023_sales_return_lines"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='goods_receipt_lines' LIMIT 1;")" ]]; then
    mark_version "024_goods_receipt_lines"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='supplier_invoice_lines' LIMIT 1;")" ]]; then
    mark_version "025_supplier_invoice_lines"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_returns' AND column_name='return_no' LIMIT 1;")" ]]; then
    mark_version "026_doc_metadata"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='background_job_schedules' LIMIT 1;")" ]]; then
    mark_version "028_background_jobs"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_actions' AND column_name='attempt_count' LIMIT 1;")" ]]; then
    mark_version "029_ai_actions_attempts"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gl_journals' AND column_name='memo' LIMIT 1;")" ]]; then
    mark_version "030_gl_journals_metadata"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM permissions WHERE code='accounting:read' LIMIT 1;")" ]]; then
    mark_version "031_accounting_permissions"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gl_journals' AND column_name='exchange_rate' LIMIT 1;")" ]]; then
    mark_version "032_gl_journals_exchange_rate"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_invoices' AND column_name='due_date' LIMIT 1;")" ]]; then
    mark_version "033_due_dates_terms"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounting_period_locks' LIMIT 1;")" ]]; then
    mark_version "034_accounting_period_locks"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='item_barcodes' LIMIT 1;")" ]]; then
    mark_version "035_item_barcodes"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='goods_receipt_lines' AND column_name='batch_id' LIMIT 1;")" ]]; then
    mark_version "036_batch_links"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pos_cashiers' LIMIT 1;")" ]]; then
    mark_version "037_pos_cashiers"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_settings' LIMIT 1;")" ]]; then
    mark_version "038_company_settings"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='price_lists' LIMIT 1;")" ]]; then
    mark_version "039_price_lists"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bank_accounts' LIMIT 1;")" ]]; then
    mark_version "040_banking"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='goods_receipts' AND column_name='purchase_order_id' LIMIT 1;")" ]]; then
    mark_version "049_purchasing_doc_links"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_invoices' AND column_name='canceled_at' LIMIT 1;")" ]]; then
    mark_version "050_cancel_metadata_and_party_codes"
  fi
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_invoices' AND column_name='doc_subtype' LIMIT 1;")" ]]; then
    mark_version "052_opening_balances_doc_subtype"
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
  if [[ -n "$(psql_value -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='background_job_schedules' LIMIT 1;")" ]]; then
    if [[ -n "$(psql_value -c "SELECT 1 FROM background_job_schedules LIMIT 1;")" ]]; then
      mark_version "seed_background_job_schedules"
    fi
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
run_migration "027_auth_sessions_active_company" "backend/db/migrations/027_auth_sessions_active_company.sql"
run_migration "015_pos_device_tokens" "backend/db/migrations/015_pos_device_tokens.sql"
run_migration "016_permissions" "backend/db/migrations/016_permissions.sql"
run_migration "017_pos_shifts" "backend/db/migrations/017_pos_shifts.sql"
run_migration "018_payment_method_mappings" "backend/db/migrations/018_payment_method_mappings.sql"
run_migration "019_document_sequences" "backend/db/migrations/019_document_sequences.sql"
run_migration "020_pos_cash_movements" "backend/db/migrations/020_pos_cash_movements.sql"
run_migration "021_item_costing" "backend/db/migrations/021_item_costing.sql"
run_migration "022_catalog_timestamps" "backend/db/migrations/022_catalog_timestamps.sql"
run_migration "023_sales_return_lines" "backend/db/migrations/023_sales_return_lines.sql"
run_migration "024_goods_receipt_lines" "backend/db/migrations/024_goods_receipt_lines.sql"
run_migration "025_supplier_invoice_lines" "backend/db/migrations/025_supplier_invoice_lines.sql"
run_migration "026_doc_metadata" "backend/db/migrations/026_doc_metadata.sql"
run_migration "028_background_jobs" "backend/db/migrations/028_background_jobs.sql"
run_migration "029_ai_actions_attempts" "backend/db/migrations/029_ai_actions_attempts.sql"
run_migration "030_gl_journals_metadata" "backend/db/migrations/030_gl_journals_metadata.sql"
run_migration "031_accounting_permissions" "backend/db/migrations/031_accounting_permissions.sql"
run_migration "032_gl_journals_exchange_rate" "backend/db/migrations/032_gl_journals_exchange_rate.sql"
run_migration "033_due_dates_terms" "backend/db/migrations/033_due_dates_terms.sql"
run_migration "034_accounting_period_locks" "backend/db/migrations/034_accounting_period_locks.sql"
run_migration "035_item_barcodes" "backend/db/migrations/035_item_barcodes.sql"
run_migration "036_batch_links" "backend/db/migrations/036_batch_links.sql"
run_migration "037_pos_cashiers" "backend/db/migrations/037_pos_cashiers.sql"
run_migration "038_company_settings" "backend/db/migrations/038_company_settings.sql"
run_migration "039_price_lists" "backend/db/migrations/039_price_lists.sql"
run_migration "040_banking" "backend/db/migrations/040_banking.sql"
run_migration "041_customer_membership" "backend/db/migrations/041_customer_membership.sql"
run_migration "042_ai_action_governance" "backend/db/migrations/042_ai_action_governance.sql"
run_migration "043_ai_feature_store" "backend/db/migrations/043_ai_feature_store.sql"
run_migration "044_ai_demand_forecasts" "backend/db/migrations/044_ai_demand_forecasts.sql"
run_migration "045_promotions" "backend/db/migrations/045_promotions.sql"
run_migration "046_sales_invoice_warehouse" "backend/db/migrations/046_sales_invoice_warehouse.sql"
run_migration "047_supplier_invoice_tax_code" "backend/db/migrations/047_supplier_invoice_tax_code.sql"
run_migration "048_parties_business_individual" "backend/db/migrations/048_parties_business_individual.sql"
run_migration "049_purchasing_doc_links" "backend/db/migrations/049_purchasing_doc_links.sql"
run_migration "050_cancel_metadata_and_party_codes" "backend/db/migrations/050_cancel_metadata_and_party_codes.sql"
run_migration "051_opening_stock_role_and_inv_adj_default" "backend/db/migrations/051_opening_stock_role_and_inv_adj_default.sql"
run_migration "052_opening_balances_doc_subtype" "backend/db/migrations/052_opening_balances_doc_subtype.sql"

run_migration "seed_coa_lebanon" "backend/db/seeds/seed_coa_lebanon.sql"
run_migration "seed_account_roles" "backend/db/seeds/seed_account_roles.sql"
run_migration "seed_companies" "backend/db/seeds/seed_companies.sql"
run_migration "seed_company_coa" "backend/db/seeds/seed_company_coa.sql"
run_migration "seed_bootstrap_master_data" "backend/db/seeds/seed_bootstrap_master_data.sql"
run_migration "seed_payment_method_mappings" "backend/db/seeds/seed_payment_method_mappings.sql"
run_migration "seed_background_job_schedules" "backend/db/seeds/seed_background_job_schedules.sql"

ensure_app_role

if [[ "${BOOTSTRAP_ADMIN:-}" == "1" ]]; then
  # When running as a script, Python sets sys.path[0] to the script directory, which
  # breaks imports like `from backend...` unless we add the repo root to PYTHONPATH.
  PYTHONPATH=. python3 backend/scripts/bootstrap_admin.py
fi

echo "Database initialized."
