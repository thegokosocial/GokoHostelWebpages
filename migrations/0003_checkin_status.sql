-- Add status column to checkins table for guest lifecycle tracking
-- Values: 'active' (default), 'checked_out', 'cancelled'

ALTER TABLE checkins ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_checkins_status ON checkins (status);
