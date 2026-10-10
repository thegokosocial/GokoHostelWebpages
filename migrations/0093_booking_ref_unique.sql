-- Aiosell retries must not create multiple bookings for the same non-empty reference.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_ref_unique_nonempty
  ON bookings(booking_ref) WHERE booking_ref <> '';
