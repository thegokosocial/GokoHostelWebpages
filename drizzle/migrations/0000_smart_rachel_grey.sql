CREATE TABLE `api_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`vision` integer DEFAULT 0 NOT NULL,
	`sheets` integer DEFAULT 0 NOT NULL,
	`drive` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_stats_month_unique` ON `api_stats` (`month`);--> statement-breakpoint
CREATE TABLE `bed_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bed_id_label` text NOT NULL,
	`dorm_name` text NOT NULL,
	`action` text NOT NULL,
	`guest_name` text DEFAULT '',
	`guest_contact` text DEFAULT '',
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_history_action` ON `bed_history` (`action`);--> statement-breakpoint
CREATE INDEX `idx_history_dorm` ON `bed_history` (`dorm_name`);--> statement-breakpoint
CREATE TABLE `beds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dorm_id` integer NOT NULL,
	`dorm_name` text NOT NULL,
	`bed_id` text NOT NULL,
	`position` text DEFAULT 'Lower' NOT NULL,
	`type` text DEFAULT 'Bunk' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`guest_name` text DEFAULT '',
	`guest_contact` text DEFAULT '',
	`checkin_date` text DEFAULT '',
	`expected_checkout` text DEFAULT '',
	`staying_days` text DEFAULT '',
	FOREIGN KEY (`dorm_id`) REFERENCES `dorms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_beds_dorm` ON `beds` (`dorm_id`);--> statement-breakpoint
CREATE INDEX `idx_beds_status` ON `beds` (`status`);--> statement-breakpoint
CREATE TABLE `checkins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submitted_at` text NOT NULL,
	`arrival_date` text NOT NULL,
	`arrival_time` text,
	`name` text NOT NULL,
	`persons` text,
	`contact` text NOT NULL,
	`staying_days` text,
	`coming_from` text,
	`nationality` text,
	`emergency_name` text,
	`emergency_phone` text,
	`id_type` text,
	`id_card_link` text,
	`visa_link` text,
	`verified` text DEFAULT 'pending',
	`created_month` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_checkins_month` ON `checkins` (`created_month`);--> statement-breakpoint
CREATE INDEX `idx_checkins_contact` ON `checkins` (`contact`);--> statement-breakpoint
CREATE INDEX `idx_checkins_arrival` ON `checkins` (`arrival_date`);--> statement-breakpoint
CREATE TABLE `dorms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dorms_name_unique` ON `dorms` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
