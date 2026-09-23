-- Atomic/idempotent food-order edit batches and audited manual refunds.
ALTER TABLE food_orders ADD COLUMN amount_refunded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE food_orders ADD COLUMN refund_method TEXT NOT NULL DEFAULT '';
ALTER TABLE food_orders ADD COLUMN refund_cash INTEGER NOT NULL DEFAULT 0;
ALTER TABLE food_orders ADD COLUMN refunded_at TEXT NOT NULL DEFAULT '';
ALTER TABLE food_orders ADD COLUMN refunded_by TEXT NOT NULL DEFAULT '';

CREATE TABLE food_order_edit_batches (
  operation_id TEXT PRIMARY KEY NOT NULL,
  order_id INTEGER NOT NULL REFERENCES food_orders(id),
  request_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sync_id TEXT,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare'
);
CREATE INDEX idx_food_order_edit_batches_order ON food_order_edit_batches(order_id, created_at);

CREATE TABLE food_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES food_orders(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('refund','correction')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  cash_paise INTEGER NOT NULL DEFAULT 0 CHECK (cash_paise >= 0),
  online_paise INTEGER NOT NULL DEFAULT 0 CHECK (online_paise >= 0),
  account_id INTEGER REFERENCES accounts(id),
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sync_id TEXT,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare',
  CHECK (cash_paise + online_paise = amount_paise)
);
CREATE INDEX idx_food_payment_events_order ON food_payment_events(order_id, created_at);
CREATE INDEX idx_food_payment_events_account_date ON food_payment_events(account_id, created_at);
