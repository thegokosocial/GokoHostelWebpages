ALTER TABLE bookings ADD COLUMN ota_payment_terms TEXT;
ALTER TABLE bookings ADD COLUMN ota_currency TEXT;

ALTER TABLE guest_receipts ADD COLUMN booking_event_id TEXT;
ALTER TABLE guest_receipts ADD COLUMN guest_name_snapshot TEXT;
ALTER TABLE guest_receipts ADD COLUMN booking_ref_snapshot TEXT;
ALTER TABLE guest_receipts ADD COLUMN platform_snapshot TEXT;
ALTER TABLE guest_receipts ADD COLUMN checkin_date_snapshot TEXT;
ALTER TABLE guest_receipts ADD COLUMN checkout_date_snapshot TEXT;
ALTER TABLE guest_receipts ADD COLUMN booking_cycle_snapshot INTEGER;
CREATE UNIQUE INDEX idx_guest_receipts_booking_event ON guest_receipts(booking_event_id);

CREATE TABLE booking_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  booking_cycle INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('collection','refund','correction')),
  amount_paise INTEGER NOT NULL,
  cash_paise INTEGER NOT NULL DEFAULT 0,
  online_paise INTEGER NOT NULL DEFAULT 0,
  unknown_paise INTEGER NOT NULL DEFAULT 0,
  cash_tender_paise INTEGER NOT NULL DEFAULT 0,
  change_paise INTEGER NOT NULL DEFAULT 0,
  account_id INTEGER REFERENCES accounts(id),
  currency TEXT NOT NULL DEFAULT 'INR',
  ota_payment_terms TEXT NOT NULL,
  business_date TEXT,
  is_opening INTEGER NOT NULL DEFAULT 0 CHECK (is_opening IN (0,1)),
  corrects_event_id TEXT,
  guest_name_snapshot TEXT NOT NULL,
  booking_ref_snapshot TEXT NOT NULL DEFAULT '',
  platform_snapshot TEXT NOT NULL DEFAULT '',
  checkin_date_snapshot TEXT NOT NULL,
  checkout_date_snapshot TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sync_id TEXT NOT NULL UNIQUE,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare'
);
CREATE INDEX idx_booking_payment_events_cycle ON booking_payment_events(booking_id, booking_cycle);
CREATE INDEX idx_booking_payment_events_date ON booking_payment_events(business_date);
CREATE INDEX idx_booking_payment_events_account_date ON booking_payment_events(account_id, business_date);

CREATE TABLE booking_cycle_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL UNIQUE,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  booking_cycle INTEGER NOT NULL,
  guest_name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  booking_ref TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  checkin_date TEXT NOT NULL,
  checkout_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  booking_created_at TEXT NOT NULL DEFAULT '',
  checked_in_at TEXT NOT NULL DEFAULT '',
  checked_out_at TEXT NOT NULL DEFAULT '',
  persons INTEGER NOT NULL DEFAULT 1,
  room_type TEXT NOT NULL DEFAULT '',
  amount_before_tax_paise INTEGER NOT NULL DEFAULT 0,
  amount_tax_paise INTEGER NOT NULL DEFAULT 0,
  amount_total_paise INTEGER NOT NULL DEFAULT 0,
  amount_paid_paise INTEGER NOT NULL DEFAULT 0,
  amount_refunded_paise INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unknown',
  payment_method TEXT NOT NULL DEFAULT '',
  cash_received_paise INTEGER NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT '',
  refund_cash_paise INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  ota_currency TEXT,
  ota_payment_terms TEXT,
  created_at TEXT NOT NULL,
  sync_id TEXT NOT NULL UNIQUE,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare',
  UNIQUE(booking_id, booking_cycle)
);

-- Use only values explicitly supplied in the persisted OTA payload. `currency` defaults
-- to INR elsewhere, so it is not evidence that the OTA supplied INR.
UPDATE bookings
SET ota_payment_terms = CASE
      WHEN json_valid(raw_data) = 1 AND json_type(raw_data, '$.pah') = 'true' THEN 'pay_at_hotel'
      WHEN json_valid(raw_data) = 1 AND json_type(raw_data, '$.pah') = 'false' THEN 'prepaid'
      ELSE ota_payment_terms
    END,
    ota_currency = CASE
      WHEN json_valid(raw_data) = 1
        AND json_type(raw_data, '$.amount.currency') = 'text'
        AND trim(json_extract(raw_data, '$.amount.currency')) <> ''
      THEN upper(trim(json_extract(raw_data, '$.amount.currency')))
      ELSE ota_currency
    END
WHERE source = 'channel_manager';

-- Preserve current-cycle legacy balances without inventing a payment date or receipt.
-- Event identity is stable across runtimes because booking sync IDs are shared.
INSERT OR IGNORE INTO booking_payment_events (
  event_id, booking_id, booking_cycle, event_type, amount_paise,
  cash_paise, online_paise, unknown_paise, cash_tender_paise, change_paise,
  currency, ota_payment_terms, business_date, is_opening,
  guest_name_snapshot, booking_ref_snapshot, platform_snapshot,
  checkin_date_snapshot, checkout_date_snapshot, note, actor, created_at,
  sync_id, sync_updated_at, sync_source
)
SELECT
  'opening-collection:' || b.sync_id || ':' || b.booking_cycle,
  b.id, b.booking_cycle, 'collection', CAST(ROUND(b.amount_paid * 100, 0) AS INTEGER),
  CASE lower(b.payment_method) WHEN 'cash' THEN CAST(ROUND(b.amount_paid * 100, 0) AS INTEGER)
    WHEN 'split' THEN min(CAST(ROUND(b.cash_received * 100, 0) AS INTEGER), CAST(ROUND(b.amount_paid * 100, 0) AS INTEGER)) ELSE 0 END,
  CASE lower(b.payment_method) WHEN 'online' THEN CAST(ROUND(b.amount_paid * 100, 0) AS INTEGER)
    WHEN 'split' THEN max(0, CAST(ROUND((b.amount_paid - b.cash_received) * 100, 0) AS INTEGER)) ELSE 0 END,
  CASE WHEN lower(b.payment_method) IN ('cash','online','split') THEN 0 ELSE CAST(ROUND(b.amount_paid * 100, 0) AS INTEGER) END,
  CASE WHEN lower(b.payment_method) IN ('cash','split') THEN CAST(ROUND(b.cash_received * 100, 0) AS INTEGER) ELSE 0 END,
  CASE WHEN lower(b.payment_method) = 'cash' THEN CAST(ROUND(b.change_given * 100, 0) AS INTEGER) ELSE 0 END,
  'INR', b.ota_payment_terms, NULL, 1,
  b.guest_name, coalesce(b.booking_ref,''), b.platform,
  b.checkin_date, coalesce(b.checkout_date,''), 'Legacy opening balance', 'migration', b.created_at,
  'opening-collection:' || b.sync_id || ':' || b.booking_cycle, coalesce(b.sync_updated_at, b.created_at), coalesce(b.sync_source,'cloudflare')
FROM bookings b
WHERE b.source = 'channel_manager' AND b.ota_payment_terms = 'pay_at_hotel'
  AND upper(coalesce(b.ota_currency,'')) = 'INR' AND b.sync_id IS NOT NULL AND b.sync_id <> ''
  AND coalesce(b.amount_paid,0) > 0;

INSERT OR IGNORE INTO booking_payment_events (
  event_id, booking_id, booking_cycle, event_type, amount_paise,
  cash_paise, online_paise, unknown_paise, currency, ota_payment_terms,
  business_date, is_opening, guest_name_snapshot, booking_ref_snapshot,
  platform_snapshot, checkin_date_snapshot, checkout_date_snapshot,
  note, actor, created_at, sync_id, sync_updated_at, sync_source
)
SELECT
  'opening-refund:' || b.sync_id || ':' || b.booking_cycle,
  b.id, b.booking_cycle, 'refund', CAST(ROUND(b.amount_refunded * 100, 0) AS INTEGER),
  -CASE lower(b.refund_method) WHEN 'cash' THEN CAST(ROUND(b.amount_refunded * 100, 0) AS INTEGER)
    WHEN 'split' THEN min(CAST(ROUND(b.refund_cash * 100, 0) AS INTEGER), CAST(ROUND(b.amount_refunded * 100, 0) AS INTEGER)) ELSE 0 END,
  -CASE lower(b.refund_method) WHEN 'online' THEN CAST(ROUND(b.amount_refunded * 100, 0) AS INTEGER)
    WHEN 'split' THEN max(0, CAST(ROUND((b.amount_refunded - b.refund_cash) * 100, 0) AS INTEGER)) ELSE 0 END,
  CASE WHEN lower(b.refund_method) IN ('cash','online','split') THEN 0 ELSE CAST(ROUND(b.amount_refunded * 100, 0) AS INTEGER) END,
  'INR', b.ota_payment_terms, NULL, 1, b.guest_name, coalesce(b.booking_ref,''), b.platform,
  b.checkin_date, coalesce(b.checkout_date,''), 'Legacy opening refund', 'migration', b.created_at,
  'opening-refund:' || b.sync_id || ':' || b.booking_cycle, coalesce(b.sync_updated_at, b.created_at), coalesce(b.sync_source,'cloudflare')
FROM bookings b
WHERE b.source = 'channel_manager' AND b.ota_payment_terms = 'pay_at_hotel'
  AND upper(coalesce(b.ota_currency,'')) = 'INR' AND b.sync_id IS NOT NULL AND b.sync_id <> ''
  AND coalesce(b.amount_refunded,0) > 0;
