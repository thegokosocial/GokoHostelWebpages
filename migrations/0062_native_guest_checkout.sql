-- Cloudflare-owned native guest checkout ledger. Not a Pi-synced table set.
-- Separate from gateway_preview_* (admin ₹1 tests) and from PMS money fields until fulfilment.

CREATE TABLE native_booking_checkouts (
  id TEXT PRIMARY KEY NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  guest_access_hash TEXT NOT NULL,
  booking_id INTEGER REFERENCES bookings(id),
  hold_id TEXT REFERENCES native_inventory_holds(id),
  accepted_quote_id TEXT REFERENCES native_accepted_quotes(id),
  payment_choice TEXT NOT NULL CHECK (payment_choice IN ('advance','full','property')),
  environment TEXT NOT NULL DEFAULT 'test' CHECK (environment IN ('test','live')),
  state TEXT NOT NULL DEFAULT 'preparing' CHECK (state IN (
    'preparing','order_unknown','ready','claimed','captured','fulfilled','captured_unfulfilled','cancelled','expired'
  )),
  razorpay_order_id TEXT UNIQUE,
  razorpay_key_id TEXT,
  receipt TEXT UNIQUE,
  due_now_paise INTEGER NOT NULL CHECK (due_now_paise >= 0),
  checkout_started_at TEXT,
  closure_reason TEXT CHECK (closure_reason IS NULL OR closure_reason IN ('guest_cancelled','hold_expired','cannot_fulfil')),
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (environment != 'test' OR (razorpay_key_id IS NULL OR razorpay_key_id LIKE 'rzp_test_%')),
  CHECK (due_now_paise = 0 OR due_now_paise >= 100)
);
CREATE INDEX idx_native_checkout_state ON native_booking_checkouts(state, updated_at);
CREATE INDEX idx_native_checkout_booking ON native_booking_checkouts(booking_id);

CREATE TABLE native_booking_payments (
  id TEXT PRIMARY KEY NOT NULL,
  checkout_id TEXT NOT NULL REFERENCES native_booking_checkouts(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 100),
  status TEXT NOT NULL CHECK (status IN ('created','authorized','captured','refunded','failed')),
  captured INTEGER NOT NULL DEFAULT 0 CHECK (captured IN (0,1)),
  refunded_paise INTEGER NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0),
  verified_at TEXT NOT NULL,
  CHECK (refunded_paise <= amount_paise)
);
CREATE INDEX idx_native_booking_payments_checkout ON native_booking_payments(checkout_id);

CREATE TABLE native_booking_refunds (
  payment_id TEXT PRIMARY KEY NOT NULL REFERENCES native_booking_payments(id),
  id TEXT NOT NULL UNIQUE,
  receipt TEXT NOT NULL UNIQUE,
  provider_id TEXT UNIQUE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 100),
  state TEXT NOT NULL DEFAULT 'submitting' CHECK (state IN ('submitting','unknown','pending','processed','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE native_booking_webhooks (
  event_id TEXT PRIMARY KEY NOT NULL,
  payload_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  order_id TEXT,
  payment_id TEXT,
  refund_id TEXT,
  checkout_id TEXT,
  state TEXT NOT NULL DEFAULT 'received' CHECK (state IN ('received','retry','processed','ignored')),
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_native_booking_webhooks_state ON native_booking_webhooks(state, received_at);
