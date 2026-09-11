ALTER TABLE beds ADD COLUMN checkin_id INTEGER REFERENCES checkins(id);
CREATE INDEX IF NOT EXISTS idx_beds_checkin ON beds(checkin_id);
