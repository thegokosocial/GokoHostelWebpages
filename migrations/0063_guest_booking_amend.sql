-- Guest self-serve booking amend: link amend checkouts + allow holds to overlap the booking being amended.

ALTER TABLE native_booking_checkouts ADD COLUMN amends_checkout_id TEXT REFERENCES native_booking_checkouts(id);
CREATE INDEX idx_native_checkout_amends ON native_booking_checkouts(amends_checkout_id);

ALTER TABLE native_inventory_holds ADD COLUMN exclude_booking_id INTEGER;

DROP TRIGGER IF EXISTS native_hold_insert_guard;
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
      AND (NEW.exclude_booking_id IS NULL OR a.booking_id != NEW.exclude_booking_id)
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

DROP TRIGGER IF EXISTS native_hold_immutable;
CREATE TRIGGER native_hold_immutable BEFORE UPDATE ON native_inventory_holds
WHEN NEW.id != OLD.id OR NEW.request_key != OLD.request_key OR NEW.request_hash != OLD.request_hash
  OR NEW.owner_hash != OLD.owner_hash OR NEW.bed_ids != OLD.bed_ids
  OR NEW.checkin_date != OLD.checkin_date OR NEW.checkout_date != OLD.checkout_date
  OR NEW.expires_at != OLD.expires_at OR NEW.created_at != OLD.created_at
  OR IFNULL(NEW.exclude_booking_id, -1) != IFNULL(OLD.exclude_booking_id, -1)
  OR OLD.state = 'released' AND NEW.state != 'released'
BEGIN SELECT RAISE(ABORT, 'NATIVE_HOLD_IMMUTABLE'); END;
