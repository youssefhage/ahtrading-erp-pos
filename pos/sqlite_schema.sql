-- POS local cache schema (SQLite)

CREATE TABLE IF NOT EXISTS local_items_cache (
  id TEXT PRIMARY KEY,
  sku TEXT,
  barcode TEXT,
  name TEXT,
  unit_of_measure TEXT,
  tax_code_id TEXT,
  is_active INTEGER DEFAULT 1,
  category_id TEXT,
  brand TEXT,
  short_name TEXT,
  description TEXT,
  track_batches INTEGER DEFAULT 0,
  track_expiry INTEGER DEFAULT 0,
  default_shelf_life_days INTEGER,
  min_shelf_life_days_for_sale INTEGER,
  expiry_warning_days INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS local_item_categories_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  parent_id TEXT,
  is_active INTEGER DEFAULT 1,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS local_item_barcodes_cache (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  barcode TEXT,
  uom_code TEXT,
  qty_factor REAL DEFAULT 1,
  uom_code TEXT,
  label TEXT,
  is_primary INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_item_barcodes_item ON local_item_barcodes_cache(item_id);
CREATE INDEX IF NOT EXISTS idx_local_item_barcodes_barcode ON local_item_barcodes_cache(barcode);

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

CREATE TABLE IF NOT EXISTS pos_receipts (
  id TEXT PRIMARY KEY,
  receipt_type TEXT,
  receipt_json TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS local_customers_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT,
  membership_no TEXT,
  is_member INTEGER DEFAULT 0,
  membership_expires_at TEXT,
  payment_terms_days INTEGER DEFAULT 0,
  credit_limit_usd REAL DEFAULT 0,
  credit_limit_lbp REAL DEFAULT 0,
  credit_balance_usd REAL DEFAULT 0,
  credit_balance_lbp REAL DEFAULT 0,
  loyalty_points REAL DEFAULT 0,
  price_list_id TEXT,
  is_active INTEGER DEFAULT 1,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS local_cashiers_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  pin_hash TEXT,
  is_active INTEGER DEFAULT 1,
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

-- Per-resource sync cursors for delta endpoints.
CREATE TABLE IF NOT EXISTS pos_sync_cursors (
  resource TEXT PRIMARY KEY,
  cursor TEXT,
  cursor_id TEXT,
  updated_at TEXT
);

-- Local admin sessions (for LAN exposure).
CREATE TABLE IF NOT EXISTS pos_local_sessions (
  token TEXT PRIMARY KEY,
  expires_at TEXT
);
