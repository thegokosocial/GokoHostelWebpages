ALTER TABLE tasks ADD COLUMN secondary_assignee_user_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_tasks_secondary_assignee ON tasks(secondary_assignee_user_id);
