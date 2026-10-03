-- Exact-order scope for opaque shared combined food-bill links (Cloudflare-only).
CREATE TABLE food_combined_bill_share_tokens (
  token TEXT PRIMARY KEY NOT NULL REFERENCES food_bill_share_tokens(token),
  selected_order_ids TEXT NOT NULL,
  created_at TEXT NOT NULL
);
