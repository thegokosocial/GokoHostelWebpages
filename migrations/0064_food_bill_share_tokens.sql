-- Opaque guest food-bill share links (Cloudflare-only; not Pi-synced).
CREATE TABLE food_bill_share_tokens (
  token TEXT PRIMARY KEY NOT NULL,
  phone TEXT NOT NULL,
  checkin_id INTEGER,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_food_bill_share_phone ON food_bill_share_tokens(phone);
CREATE INDEX idx_food_bill_share_expires ON food_bill_share_tokens(expires_at);
