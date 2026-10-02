CREATE TABLE payable_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', original_amount INTEGER NOT NULL CHECK (original_amount > 0),
  category TEXT NOT NULL, custom_category TEXT NOT NULL DEFAULT '', main_category TEXT NOT NULL DEFAULT 'stay_expense', sub_category TEXT NOT NULL DEFAULT '',
  vendor_id INTEGER REFERENCES vendors(id), bill_date TEXT NOT NULL, due_date TEXT NOT NULL DEFAULT '', bill_image_link TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_id TEXT, sync_updated_at TEXT, sync_source TEXT DEFAULT 'cloudflare', deleted_at TEXT
);
CREATE INDEX idx_payable_bills_due ON payable_bills(due_date);
CREATE INDEX idx_payable_bills_vendor ON payable_bills(vendor_id);
CREATE TABLE payable_bill_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, payable_bill_id INTEGER NOT NULL REFERENCES payable_bills(id), amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, sync_id TEXT, sync_updated_at TEXT, sync_source TEXT DEFAULT 'cloudflare'
);
CREATE INDEX idx_payable_bill_adjustments_bill ON payable_bill_adjustments(payable_bill_id);
CREATE TABLE payable_bill_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, payable_bill_id INTEGER NOT NULL REFERENCES payable_bills(id), body TEXT NOT NULL,
  author_username TEXT NOT NULL, created_at TEXT NOT NULL, sync_id TEXT, sync_updated_at TEXT, sync_source TEXT DEFAULT 'cloudflare'
);
CREATE INDEX idx_payable_bill_notes_bill ON payable_bill_notes(payable_bill_id);
ALTER TABLE expenses ADD COLUMN payable_bill_id INTEGER REFERENCES payable_bills(id);
CREATE INDEX idx_expenses_payable_bill ON expenses(payable_bill_id);
CREATE TRIGGER payable_bill_payment_cap_insert BEFORE INSERT ON expenses
WHEN NEW.payable_bill_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.amount + COALESCE((SELECT SUM(amount) FROM expenses WHERE payable_bill_id = NEW.payable_bill_id AND deleted_at IS NULL), 0) >
    (SELECT original_amount + COALESCE((SELECT SUM(amount) FROM payable_bill_adjustments WHERE payable_bill_id = NEW.payable_bill_id), 0) FROM payable_bills WHERE id = NEW.payable_bill_id AND deleted_at IS NULL)
  THEN RAISE(ABORT, 'Payable bill payment exceeds remaining balance') END;
END;
CREATE TRIGGER payable_bill_payment_cap_update BEFORE UPDATE OF amount, payable_bill_id, deleted_at ON expenses
WHEN NEW.payable_bill_id IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  SELECT CASE WHEN NEW.amount + COALESCE((SELECT SUM(amount) FROM expenses WHERE payable_bill_id = NEW.payable_bill_id AND deleted_at IS NULL AND id != NEW.id), 0) >
    (SELECT original_amount + COALESCE((SELECT SUM(amount) FROM payable_bill_adjustments WHERE payable_bill_id = NEW.payable_bill_id), 0) FROM payable_bills WHERE id = NEW.payable_bill_id AND deleted_at IS NULL)
  THEN RAISE(ABORT, 'Payable bill payment exceeds remaining balance') END;
END;
CREATE TRIGGER payable_bill_payment_link_immutable BEFORE UPDATE OF payable_bill_id ON expenses
WHEN OLD.payable_bill_id IS NOT NULL AND NEW.payable_bill_id IS NOT OLD.payable_bill_id
BEGIN
  SELECT RAISE(ABORT, 'Payable bill link is immutable');
END;
