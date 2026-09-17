-- Allow tasks to be created in the shared queue before they are assigned.
-- Preserve task rows and linked expenses while rebuilding the SQLite table.
CREATE TABLE task_expense_links (
  expense_id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL
);
INSERT INTO task_expense_links (expense_id, task_id)
SELECT id, task_id FROM expenses WHERE task_id IS NOT NULL;
UPDATE expenses SET task_id = NULL WHERE task_id IS NOT NULL;

CREATE TABLE tasks_optional_assignee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT 'general',
  category TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_date TEXT DEFAULT '',
  assignee_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'todo',
  note TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT DEFAULT '',
  completed_by TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_id TEXT,
  sync_updated_at TEXT DEFAULT '',
  sync_source TEXT DEFAULT 'cloudflare',
  deleted_at TEXT
);
INSERT INTO tasks_optional_assignee (
  id, title, description, task_type, category, priority, due_date,
  assignee_user_id, status, note, attachments, completed_at, completed_by,
  created_by, updated_by, created_at, updated_at, sync_id, sync_updated_at,
  sync_source, deleted_at
)
SELECT
  id, title, description, task_type, category, priority, due_date,
  assignee_user_id, status, note, attachments, completed_at, completed_by,
  created_by, updated_by, created_at, updated_at, sync_id, sync_updated_at,
  sync_source, deleted_at
FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_optional_assignee RENAME TO tasks;

CREATE INDEX idx_tasks_assignee ON tasks(assignee_user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);

UPDATE expenses
SET task_id = (SELECT task_id FROM task_expense_links WHERE expense_id = expenses.id)
WHERE id IN (SELECT expense_id FROM task_expense_links);
DROP TABLE task_expense_links;
