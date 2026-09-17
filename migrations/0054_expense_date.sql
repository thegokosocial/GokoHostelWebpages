ALTER TABLE expenses ADD COLUMN expense_date TEXT NOT NULL DEFAULT '';
UPDATE expenses SET expense_date = substr(created_at, 1, 10) WHERE expense_date = '';
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);
