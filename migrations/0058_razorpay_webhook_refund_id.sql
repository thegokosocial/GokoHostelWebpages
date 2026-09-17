-- Preserve exact test refund identity for durable API verification/replay.
ALTER TABLE gateway_preview_webhooks ADD COLUMN refund_id TEXT;
