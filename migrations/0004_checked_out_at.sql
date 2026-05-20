-- Add checked_out_at timestamp to track when checkout happened (for 24h reactivate window)
ALTER TABLE checkins ADD COLUMN checked_out_at TEXT DEFAULT '';
