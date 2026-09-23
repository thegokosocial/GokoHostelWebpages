CREATE TABLE booking_contact_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  type TEXT NOT NULL CHECK (type IN ('phone', 'email')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'custom' CHECK (origin IN ('pms', 'custom')),
  is_primary INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  sync_id TEXT,
  sync_updated_at TEXT,
  sync_source TEXT DEFAULT 'cloudflare'
);
CREATE INDEX idx_booking_contacts_booking ON booking_contact_methods(booking_id, deleted_at);
CREATE UNIQUE INDEX idx_booking_contacts_value ON booking_contact_methods(booking_id, type, normalized_value, deleted_at);

INSERT INTO booking_contact_methods
  (booking_id, type, value, normalized_value, label, origin, is_primary, position, sync_id, sync_updated_at, sync_source)
SELECT id, 'phone', contact, contact, '', CASE WHEN source IN ('channel_manager', 'email') THEN 'pms' ELSE 'custom' END,
  1, 0, lower(hex(randomblob(16))), created_at, 'cloudflare'
FROM bookings
WHERE trim(COALESCE(contact, '')) <> '';

INSERT INTO booking_contact_methods
  (booking_id, type, value, normalized_value, label, origin, is_primary, position, sync_id, sync_updated_at, sync_source)
SELECT id, 'email', email, lower(trim(email)), '', CASE WHEN source IN ('channel_manager', 'email') THEN 'pms' ELSE 'custom' END,
  1, 0, lower(hex(randomblob(16))), created_at, 'cloudflare'
FROM bookings
WHERE trim(COALESCE(email, '')) <> '';
