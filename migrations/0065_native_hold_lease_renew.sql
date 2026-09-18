-- Allow lease renewal (created_at + expires_at) while a hold stays held.
-- Identity, beds, stay dates, owner, exclude_booking_id, and resurrect-from-released remain immutable.
-- Table CHECK still enforces expires_at <= created_at + 900.

DROP TRIGGER IF EXISTS native_hold_immutable;
CREATE TRIGGER native_hold_immutable BEFORE UPDATE ON native_inventory_holds
WHEN NEW.id != OLD.id OR NEW.request_key != OLD.request_key OR NEW.request_hash != OLD.request_hash
  OR NEW.owner_hash != OLD.owner_hash OR NEW.bed_ids != OLD.bed_ids
  OR NEW.checkin_date != OLD.checkin_date OR NEW.checkout_date != OLD.checkout_date
  OR NEW.exclude_booking_id != OLD.exclude_booking_id
  OR OLD.state = 'released' AND NEW.state != 'released'
BEGIN SELECT RAISE(ABORT, 'NATIVE_HOLD_IMMUTABLE'); END;
