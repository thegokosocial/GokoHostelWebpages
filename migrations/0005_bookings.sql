-- Bookings table: tracks OTA bookings from MakeMyTrip, Booking.com, Hostelworld, and manual entries

CREATE TABLE IF NOT EXISTS `bookings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `guest_name` text NOT NULL,
  `contact` text DEFAULT '',
  `platform` text NOT NULL,
  `booking_ref` text DEFAULT '',
  `checkin_date` text NOT NULL,
  `checkout_date` text DEFAULT '',
  `room_type` text DEFAULT '',
  `persons` integer NOT NULL DEFAULT 1,
  `payment_status` text DEFAULT 'unknown',
  `special_requests` text DEFAULT '',
  `status` text NOT NULL DEFAULT 'confirmed',
  `source` text DEFAULT 'manual',
  `raw_data` text DEFAULT '',
  `created_at` text NOT NULL,
  `synced_at` text DEFAULT ''
);

CREATE INDEX IF NOT EXISTS `idx_bookings_checkin` ON `bookings` (`checkin_date`);
CREATE INDEX IF NOT EXISTS `idx_bookings_platform` ON `bookings` (`platform`);
CREATE INDEX IF NOT EXISTS `idx_bookings_status` ON `bookings` (`status`);
