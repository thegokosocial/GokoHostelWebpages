ALTER TABLE checkins ADD COLUMN booking_resolution TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE checkins ADD COLUMN booking_linked_ref TEXT DEFAULT '';
ALTER TABLE checkins ADD COLUMN booking_resolution_at TEXT DEFAULT '';
ALTER TABLE checkins ADD COLUMN booking_resolution_by TEXT DEFAULT '';
