-- Payment-level Account Activity grouping and prospective ordinary guest cash journal.
ALTER TABLE guest_receipts ADD COLUMN operation_id TEXT;

UPDATE guest_receipts
SET operation_id = substr(receipt_id, 1, length(receipt_id) - length(':food:' || source_id))
WHERE source_type = 'food_order'
  AND receipt_id LIKE '%:food:' || source_id;

CREATE INDEX idx_guest_receipts_operation ON guest_receipts(operation_id);

CREATE TABLE cash_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  operation_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('food_order','booking')),
  source_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('collection','refund','correction')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise != 0),
  business_date TEXT NOT NULL,
  corrects_event_id TEXT,
  guest_name_snapshot TEXT NOT NULL DEFAULT '',
  reference_snapshot TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sync_id TEXT,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare'
);

CREATE INDEX idx_cash_payment_events_operation ON cash_payment_events(operation_id);
CREATE INDEX idx_cash_payment_events_date ON cash_payment_events(business_date);
CREATE INDEX idx_cash_payment_events_source ON cash_payment_events(source_type, source_id);
