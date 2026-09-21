-- Cloudflare-only allocation journal for live website booking payment payouts.
CREATE TABLE gateway_settlement_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id INTEGER NOT NULL REFERENCES platform_settlements(id),
  payment_id TEXT NOT NULL REFERENCES native_booking_payments(id),
  allocation_key TEXT NOT NULL UNIQUE,
  allocated_paise INTEGER NOT NULL CHECK (allocated_paise > 0),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_gateway_allocations_settlement ON gateway_settlement_allocations(settlement_id);
CREATE INDEX idx_gateway_allocations_payment ON gateway_settlement_allocations(payment_id);
