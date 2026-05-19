-- Initial schema for Goko Hostel D1 database
-- Migrated from Google Sheets

CREATE TABLE IF NOT EXISTS `checkins` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `submitted_at` text NOT NULL,
  `arrival_date` text NOT NULL,
  `arrival_time` text DEFAULT '',
  `name` text NOT NULL,
  `persons` text DEFAULT '1',
  `contact` text NOT NULL,
  `staying_days` text DEFAULT '1',
  `coming_from` text DEFAULT '',
  `nationality` text DEFAULT '',
  `emergency_name` text DEFAULT '',
  `emergency_phone` text DEFAULT '',
  `id_type` text DEFAULT '',
  `id_card_link` text DEFAULT '',
  `visa_link` text DEFAULT '',
  `verified` text DEFAULT 'pending',
  `created_month` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_checkins_month` ON `checkins` (`created_month`);
CREATE INDEX IF NOT EXISTS `idx_checkins_contact` ON `checkins` (`contact`);
CREATE INDEX IF NOT EXISTS `idx_checkins_arrival` ON `checkins` (`arrival_date`);

CREATE TABLE IF NOT EXISTS `dorms` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `created_at` text DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS `dorms_name_unique` ON `dorms` (`name`);

CREATE TABLE IF NOT EXISTS `beds` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `dorm_id` integer NOT NULL REFERENCES `dorms`(`id`),
  `dorm_name` text NOT NULL,
  `bed_id` text NOT NULL,
  `position` text NOT NULL DEFAULT 'Lower',
  `type` text NOT NULL DEFAULT 'Bunk',
  `status` text NOT NULL DEFAULT 'available',
  `guest_name` text DEFAULT '',
  `guest_contact` text DEFAULT '',
  `checkin_date` text DEFAULT '',
  `expected_checkout` text DEFAULT '',
  `staying_days` text DEFAULT ''
);

CREATE INDEX IF NOT EXISTS `idx_beds_dorm` ON `beds` (`dorm_id`);
CREATE INDEX IF NOT EXISTS `idx_beds_status` ON `beds` (`status`);

CREATE TABLE IF NOT EXISTS `bed_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `bed_id_label` text NOT NULL,
  `dorm_name` text NOT NULL,
  `action` text NOT NULL,
  `guest_name` text DEFAULT '',
  `guest_contact` text DEFAULT '',
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_history_action` ON `bed_history` (`action`);
CREATE INDEX IF NOT EXISTS `idx_history_dorm` ON `bed_history` (`dorm_name`);

CREATE TABLE IF NOT EXISTS `settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS `api_stats` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `month` text NOT NULL,
  `vision` integer NOT NULL DEFAULT 0,
  `sheets` integer NOT NULL DEFAULT 0,
  `drive` integer NOT NULL DEFAULT 0,
  `total` integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_stats_month` ON `api_stats` (`month`);
