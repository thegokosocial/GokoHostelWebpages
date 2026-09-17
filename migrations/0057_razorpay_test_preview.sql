-- Cloudflare-owned TEST evidence only. Not a booking, guest receipt or settlement.
CREATE TABLE gateway_preview_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL DEFAULT 'test' CHECK (environment = 'test'),
  key_id TEXT NOT NULL CHECK (key_id LIKE 'rzp_test_%'),
  receipt TEXT NOT NULL UNIQUE,
  amount_paise INTEGER NOT NULL DEFAULT 100 CHECK (amount_paise = 100),
  order_id TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'creating' CHECK (state IN ('creating','order_unknown','created')),
  checkout_started_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE gateway_preview_payments (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES gateway_preview_attempts(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise = 100),
  status TEXT NOT NULL CHECK (status IN ('created','authorized','captured','refunded','failed')),
  captured INTEGER NOT NULL DEFAULT 0 CHECK (captured IN (0,1)),
  refunded_paise INTEGER NOT NULL DEFAULT 0 CHECK (refunded_paise BETWEEN 0 AND 100),
  verified_at TEXT NOT NULL
);
CREATE INDEX idx_gateway_preview_payments_attempt ON gateway_preview_payments(attempt_id);
CREATE TABLE gateway_preview_refunds (
  payment_id TEXT PRIMARY KEY NOT NULL REFERENCES gateway_preview_payments(id),
  id TEXT NOT NULL UNIQUE,
  receipt TEXT NOT NULL UNIQUE,
  provider_id TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'submitting' CHECK (state IN ('submitting','unknown','pending','processed','failed')),
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE gateway_preview_webhooks (
  event_id TEXT PRIMARY KEY NOT NULL,
  payload_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  order_id TEXT,
  payment_id TEXT,
  attempt_id TEXT,
  state TEXT NOT NULL DEFAULT 'received' CHECK (state IN ('received','retry','processed','ignored')),
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_gateway_preview_webhooks_state ON gateway_preview_webhooks(state, received_at);
