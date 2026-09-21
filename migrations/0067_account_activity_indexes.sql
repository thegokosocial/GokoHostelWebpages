CREATE INDEX IF NOT EXISTS idx_expenses_account_date ON expenses(account_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_daily_income_account_date ON daily_income(account_id, date);
CREATE INDEX IF NOT EXISTS idx_guest_receipts_account_date ON guest_receipts(account_id, business_date);
