-- Cloudflare-only food bill QR payment tables (Razorpay dynamic QR).
-- Not synced to Pi; added to migrate-pi.ts skip list.

CREATE TABLE food_qr_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL CHECK (environment IN ('test','live')),
  key_id TEXT NOT NULL,
  qr_code_id TEXT UNIQUE,
  qr_image_url TEXT,
  payment_amount_paise INTEGER NOT NULL CHECK (payment_amount_paise >= 100),
  snapshot_due_paise INTEGER NOT NULL CHECK (snapshot_due_paise >= 100),
  state TEXT NOT NULL DEFAULT 'creating'
    CHECK (state IN ('creating','qr_unknown','active','paid','closed','expired')),
  close_by TEXT,
  food_order_ids TEXT NOT NULL DEFAULT '[]',
  checkin_id INTEGER,
  guest_name TEXT NOT NULL DEFAULT '',
  guest_phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_food_qr_attempts_state ON food_qr_attempts(state, updated_at);
CREATE INDEX idx_food_qr_attempts_checkin ON food_qr_attempts(checkin_id);

CREATE TABLE food_qr_order_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES food_qr_attempts(id),
  order_id INTEGER NOT NULL,
  claimed_at TEXT NOT NULL,
  released_at TEXT,
  UNIQUE (attempt_id, order_id)
);
CREATE INDEX idx_food_qr_order_claims_order ON food_qr_order_claims(order_id);
-- At most one active (unreleased) claim per food order — prevents overlapping QRs / cash races.
CREATE UNIQUE INDEX idx_food_qr_claims_active_order ON food_qr_order_claims(order_id) WHERE released_at IS NULL;

CREATE TABLE food_qr_payments (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES food_qr_attempts(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 100),
  status TEXT NOT NULL CHECK (status IN ('created','authorized','captured','refunded','failed')),
  captured INTEGER NOT NULL DEFAULT 0 CHECK (captured IN (0,1)),
  refunded_paise INTEGER NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0),
  fee_paise INTEGER CHECK (fee_paise IS NULL OR fee_paise >= 0),
  tax_paise INTEGER CHECK (tax_paise IS NULL OR tax_paise >= 0),
  method TEXT,
  verified_at TEXT NOT NULL
);
CREATE INDEX idx_food_qr_payments_attempt ON food_qr_payments(attempt_id);

CREATE TABLE food_qr_webhooks (
  event_id TEXT PRIMARY KEY NOT NULL,
  payload_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  qr_code_id TEXT,
  payment_id TEXT,
  attempt_id TEXT,
  state TEXT NOT NULL DEFAULT 'received'
    CHECK (state IN ('received','retry','processed','ignored')),
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_food_qr_webhooks_state ON food_qr_webhooks(state, received_at);
