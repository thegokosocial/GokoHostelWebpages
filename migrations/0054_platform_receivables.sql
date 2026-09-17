-- OTA receivables and settlement tracking. Monetary fields are paise unless noted.
ALTER TABLE accounts ADD COLUMN is_virtual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN platform_key TEXT DEFAULT '';
CREATE INDEX idx_accounts_virtual ON accounts(is_virtual);

ALTER TABLE bookings ADD COLUMN booking_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN payment_override INTEGER NOT NULL DEFAULT 0;

CREATE TABLE platform_payment_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  default_payment_mode TEXT NOT NULL DEFAULT 'unknown',
  virtual_account_id INTEGER NOT NULL REFERENCES accounts(id),
  currency TEXT NOT NULL DEFAULT 'INR',
  tax_treatment TEXT NOT NULL DEFAULT 'tax_charged_not_withheld',
  deduction_policy TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  sync_id TEXT,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare',
  deleted_at TEXT
);
CREATE INDEX idx_platform_profiles_active ON platform_payment_profiles(is_active);

CREATE TABLE platform_receivable_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  booking_cycle INTEGER NOT NULL DEFAULT 1,
  platform_key TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  entry_type TEXT NOT NULL,
  gross_paise INTEGER NOT NULL DEFAULT 0,
  tax_charged_paise INTEGER NOT NULL DEFAULT 0,
  tax_withheld_paise INTEGER NOT NULL DEFAULT 0,
  commission_paise INTEGER NOT NULL DEFAULT 0,
  tds_paise INTEGER NOT NULL DEFAULT 0,
  tcs_paise INTEGER NOT NULL DEFAULT 0,
  other_deductions_paise INTEGER NOT NULL DEFAULT 0,
  expected_net_paise INTEGER NOT NULL DEFAULT 0,
  recognition_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source_payload TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  sync_id TEXT,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare'
);
CREATE INDEX idx_platform_receivables_booking ON platform_receivable_entries(booking_id, booking_cycle);
CREATE INDEX idx_platform_receivables_platform ON platform_receivable_entries(platform_key, recognition_date);

CREATE TABLE platform_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_key TEXT NOT NULL,
  bank_account_id INTEGER NOT NULL REFERENCES accounts(id),
  receipt_id TEXT NOT NULL UNIQUE,
  payout_date TEXT NOT NULL,
  actual_amount_paise INTEGER NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sync_id TEXT,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare'
);
CREATE INDEX idx_platform_settlements_date ON platform_settlements(payout_date, platform_key);

CREATE TABLE platform_settlement_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id INTEGER NOT NULL REFERENCES platform_settlements(id),
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  booking_cycle INTEGER NOT NULL DEFAULT 1,
  allocation_key TEXT NOT NULL UNIQUE,
  allocated_paise INTEGER NOT NULL,
  variance_type TEXT NOT NULL DEFAULT 'none',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sync_id TEXT,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare'
);
CREATE INDEX idx_platform_allocations_settlement ON platform_settlement_allocations(settlement_id);
CREATE INDEX idx_platform_allocations_booking ON platform_settlement_allocations(booking_id, booking_cycle);
