-- INTERNAL foundation only; no public checkout or money collection enabled.
CREATE TABLE native_inventory_holds (
  id TEXT PRIMARY KEY NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  bed_ids TEXT NOT NULL CHECK (json_valid(bed_ids) AND json_type(bed_ids) = 'array' AND json_array_length(bed_ids) BETWEEN 1 AND 4),
  checkin_date TEXT NOT NULL,
  checkout_date TEXT NOT NULL CHECK (checkout_date > checkin_date),
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'held' CHECK (state IN ('held','released')),
  created_at INTEGER NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + 900)
);
CREATE INDEX idx_native_hold_dates ON native_inventory_holds(state, checkin_date, checkout_date, expires_at);

CREATE TRIGGER block_native_hold_insert_guard BEFORE INSERT ON bed_blocks
WHEN NEW.is_active = 1
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM native_inventory_holds h JOIN json_each(h.bed_ids) occupied
    WHERE occupied.value = NEW.bed_id AND h.state = 'held'
      AND h.expires_at > CAST(strftime('%s','now') AS INTEGER)
      AND h.checkin_date < NEW.end_date AND h.checkout_date > NEW.start_date
  ) THEN RAISE(ABORT, 'NATIVE_HOLD_CONFLICT') END;
END;
CREATE TRIGGER block_native_hold_update_guard BEFORE UPDATE ON bed_blocks
WHEN NEW.is_active = 1
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM native_inventory_holds h JOIN json_each(h.bed_ids) occupied
    WHERE occupied.value = NEW.bed_id AND h.state = 'held'
      AND h.expires_at > CAST(strftime('%s','now') AS INTEGER)
      AND h.checkin_date < NEW.end_date AND h.checkout_date > NEW.start_date
  ) THEN RAISE(ABORT, 'NATIVE_HOLD_CONFLICT') END;
END;

CREATE TRIGGER native_hold_insert_guard BEFORE INSERT ON native_inventory_holds
WHEN NEW.state = 'held'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.bed_ids) selected
    WHERE selected.type != 'integer' OR NOT EXISTS (SELECT 1 FROM beds WHERE id = selected.value)
  ) OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.bed_ids)) != json_array_length(NEW.bed_ids)
  THEN RAISE(ABORT, 'NATIVE_HOLD_INVALID_BEDS') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.bed_ids) selected
    JOIN booking_bed_assignments a ON a.bed_id = selected.value
    WHERE a.status = 'assigned' AND a.checkin_date < NEW.checkout_date AND a.checkout_date > NEW.checkin_date
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.bed_ids) selected JOIN bed_blocks b ON b.bed_id = selected.value
    WHERE b.is_active = 1 AND b.start_date < NEW.checkout_date AND b.end_date > NEW.checkin_date
  ) OR EXISTS (
    SELECT 1 FROM native_inventory_holds h JOIN json_each(h.bed_ids) occupied
    JOIN json_each(NEW.bed_ids) selected ON selected.value = occupied.value
    WHERE h.request_key != NEW.request_key AND h.state = 'held'
      AND h.expires_at > CAST(strftime('%s','now') AS INTEGER)
      AND h.checkin_date < NEW.checkout_date AND h.checkout_date > NEW.checkin_date
  ) THEN RAISE(ABORT, 'NATIVE_HOLD_CONFLICT') END;
END;

-- Identity/allocation/expiry cannot be rewritten or resurrected by another writer.
CREATE TRIGGER native_hold_immutable BEFORE UPDATE ON native_inventory_holds
WHEN NEW.id != OLD.id OR NEW.request_key != OLD.request_key OR NEW.request_hash != OLD.request_hash
  OR NEW.owner_hash != OLD.owner_hash OR NEW.bed_ids != OLD.bed_ids
  OR NEW.checkin_date != OLD.checkin_date OR NEW.checkout_date != OLD.checkout_date
  OR NEW.expires_at != OLD.expires_at OR NEW.created_at != OLD.created_at
  OR OLD.state = 'released' AND NEW.state != 'released'
BEGIN SELECT RAISE(ABORT, 'NATIVE_HOLD_IMMUTABLE'); END;

-- Applies to every SQL assignment writer, not just website service calls.
CREATE TRIGGER assignment_native_hold_insert_guard BEFORE INSERT ON booking_bed_assignments
WHEN NEW.status = 'assigned'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM native_inventory_holds h JOIN json_each(h.bed_ids) occupied
    WHERE occupied.value = NEW.bed_id AND h.state = 'held'
      AND h.expires_at > CAST(strftime('%s','now') AS INTEGER)
      AND h.checkin_date < NEW.checkout_date AND h.checkout_date > NEW.checkin_date
  ) THEN RAISE(ABORT, 'NATIVE_HOLD_CONFLICT') END;
END;
CREATE TRIGGER assignment_native_hold_update_guard BEFORE UPDATE ON booking_bed_assignments
WHEN NEW.status = 'assigned'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM native_inventory_holds h JOIN json_each(h.bed_ids) occupied
    WHERE occupied.value = NEW.bed_id AND h.state = 'held'
      AND h.expires_at > CAST(strftime('%s','now') AS INTEGER)
      AND h.checkin_date < NEW.checkout_date AND h.checkout_date > NEW.checkin_date
  ) THEN RAISE(ABORT, 'NATIVE_HOLD_CONFLICT') END;
END;
