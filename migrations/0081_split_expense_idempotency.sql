-- Split expense create idempotency (Cloudflare only; Pi migrator skips 0041 + this file).

ALTER TABLE split_expenses ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_split_expenses_idempotency ON split_expenses(idempotency_key) WHERE idempotency_key IS NOT NULL;
