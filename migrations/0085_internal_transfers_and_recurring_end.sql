ALTER TABLE expenses ADD COLUMN transfer_id TEXT;
ALTER TABLE expenses ADD COLUMN transfer_method TEXT;
ALTER TABLE expenses ADD COLUMN reverses_transfer_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_transfer_id ON expenses(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_reverses_transfer ON expenses(reverses_transfer_id) WHERE reverses_transfer_id IS NOT NULL;

ALTER TABLE daily_income ADD COLUMN transfer_id TEXT;
ALTER TABLE daily_income ADD COLUMN transfer_method TEXT;
ALTER TABLE daily_income ADD COLUMN reverses_transfer_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_income_transfer_id ON daily_income(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_income_reverses_transfer ON daily_income(reverses_transfer_id) WHERE reverses_transfer_id IS NOT NULL;

ALTER TABLE recurring_expense_rules ADD COLUMN end_date TEXT;
