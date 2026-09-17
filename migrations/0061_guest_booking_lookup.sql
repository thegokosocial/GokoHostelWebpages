-- Cloud-owned, short-lived email verification. No guest contact or plaintext codes stored.
CREATE TABLE guest_booking_lookup_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1))
);
