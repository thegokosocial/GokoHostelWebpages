ALTER TABLE bookings ADD COLUMN write_off_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE food_orders ADD COLUMN write_off_amount INTEGER NOT NULL DEFAULT 0;

CREATE TABLE revenue_writeoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  booking_cycle INTEGER,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  guest_name_snapshot TEXT NOT NULL DEFAULT '',
  reference_snapshot TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  sync_id TEXT,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare',
  CHECK (source_type IN ('food_order', 'booking')),
  CHECK (booking_cycle IS NULL OR booking_cycle > 0)
);
CREATE INDEX idx_revenue_writeoffs_source ON revenue_writeoffs(source_type, source_id, booking_cycle);
CREATE INDEX idx_revenue_writeoffs_created ON revenue_writeoffs(created_at);
