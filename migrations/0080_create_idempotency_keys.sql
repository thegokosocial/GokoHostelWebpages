-- Create-path idempotency keys (nullable for legacy rows; unique when set).
-- food_orders already has idempotency_key (0011).
-- split_expenses is Cloudflare-only (0041); see 0081.

ALTER TABLE expenses ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_idempotency ON expenses(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE daily_income ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_income_idempotency ON daily_income(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE checkins ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_idempotency ON checkins(idempotency_key) WHERE idempotency_key IS NOT NULL;
