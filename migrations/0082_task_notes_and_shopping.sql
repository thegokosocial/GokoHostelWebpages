-- Task note journal + shopping checklist JSON on synced tasks row.
-- Legacy `note` remains readable via API fallback until rows are rewritten.
ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN shopping_items TEXT NOT NULL DEFAULT '[]';
