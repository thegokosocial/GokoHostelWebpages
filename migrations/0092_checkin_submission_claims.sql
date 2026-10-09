-- Prevent concurrent self check-in retries from repeating Drive uploads.
CREATE TABLE IF NOT EXISTS checkin_submission_claims (
  idempotency_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
