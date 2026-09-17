-- Internal accepted contracts; no public checkout or money movement enabled.
CREATE TABLE native_accepted_quotes (
  id TEXT PRIMARY KEY NOT NULL,
  hold_id TEXT NOT NULL UNIQUE REFERENCES native_inventory_holds(id),
  quote_json TEXT NOT NULL CHECK(json_valid(quote_json) AND json_type(quote_json) = 'object'),
  accepted_at INTEGER NOT NULL
);
CREATE TRIGGER native_quote_insert_guard BEFORE INSERT ON native_accepted_quotes
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM native_inventory_holds h WHERE h.id = NEW.hold_id
      AND h.state = 'held' AND h.expires_at > CAST(strftime('%s','now') AS INTEGER)
      AND h.checkin_date = json_extract(NEW.quote_json, '$.checkinDate')
      AND h.checkout_date = json_extract(NEW.quote_json, '$.checkoutDate')
  ) THEN RAISE(ABORT, 'NATIVE_QUOTE_HOLD_CLOSED') END;
END;
CREATE TRIGGER native_quote_immutable BEFORE UPDATE ON native_accepted_quotes
BEGIN SELECT RAISE(ABORT, 'NATIVE_QUOTE_IMMUTABLE'); END;
CREATE TRIGGER native_quote_retained BEFORE DELETE ON native_accepted_quotes
BEGIN SELECT RAISE(ABORT, 'NATIVE_QUOTE_RETAINED'); END;
