-- POS local cache schema (SQLite)

CREATE TABLE IF NOT EXISTS local_items_cache (
  id TEXT PRIMARY KEY,
  sku TEXT,
  barcode TEXT,
  name TEXT,
  unit_of_measure TEXT,
  tax_code_id TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS local_prices_cache (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  price_usd REAL,
  price_lbp REAL,
  effective_from TEXT,
  effective_to TEXT
);

CREATE TABLE IF NOT EXISTS local_promotions_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  rules_json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS local_customers_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS pos_outbox_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT,
  payload_json TEXT,
  created_at TEXT,
  status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS pos_inbox_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT,
  payload_json TEXT,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS pos_sync_state (
  id TEXT PRIMARY KEY,
  last_sync_at TEXT,
  last_event_id TEXT
);
