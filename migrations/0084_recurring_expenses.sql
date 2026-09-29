-- Cloudflare-only recurring expense rules and drafts. These do not sync to Pi.
CREATE TABLE recurring_expense_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, amount INTEGER, frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
  start_date TEXT NOT NULL, posting_mode TEXT NOT NULL CHECK (posting_mode IN ('review','automatic')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  category TEXT NOT NULL, custom_category TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL DEFAULT '', vendor_id INTEGER, account_id INTEGER,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','online')),
  main_category TEXT NOT NULL DEFAULT 'stay_expense', sub_category TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_recurring_expense_rules_active ON recurring_expense_rules(active);
CREATE TABLE recurring_expense_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INTEGER NOT NULL REFERENCES recurring_expense_rules(id), due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','skipped')), expense_id INTEGER REFERENCES expenses(id), idempotency_key TEXT NOT NULL UNIQUE,
  error TEXT NOT NULL DEFAULT '', skipped_reason TEXT NOT NULL DEFAULT '', amount INTEGER, category TEXT NOT NULL,
  custom_category TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL DEFAULT '', vendor_id INTEGER, account_id INTEGER,
  payment_method TEXT NOT NULL, main_category TEXT NOT NULL, sub_category TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(rule_id, due_date), UNIQUE(expense_id)
);
CREATE INDEX idx_recurring_expense_occurrence_status_date ON recurring_expense_occurrences(status, due_date);
