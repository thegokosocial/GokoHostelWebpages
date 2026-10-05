-- A paid-closed Razorpay QR can briefly have no captured payment in the QR payment list.
-- Keep its active claim during that provider propagation window rather than releasing it.
ALTER TABLE food_qr_attempts ADD COLUMN capture_pending INTEGER NOT NULL DEFAULT 0
  CHECK (capture_pending IN (0, 1));
