-- Migration: Add users, audit_log, and system_logs tables

CREATE TABLE IF NOT EXISTS `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `password_hash` text NOT NULL,
  `display_name` text NOT NULL,
  `role` text NOT NULL DEFAULT 'staff',
  `permissions` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL,
  `created_by` text DEFAULT '',
  `is_system` integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS `users_username_unique` ON `users` (`username`);

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `timestamp` text NOT NULL,
  `user_id` integer,
  `username` text NOT NULL,
  `action` text NOT NULL,
  `target` text DEFAULT '',
  `details` text DEFAULT '',
  `ip_address` text DEFAULT ''
);

CREATE INDEX IF NOT EXISTS `idx_audit_time` ON `audit_log` (`timestamp`);
CREATE INDEX IF NOT EXISTS `idx_audit_user` ON `audit_log` (`username`);
CREATE INDEX IF NOT EXISTS `idx_audit_action` ON `audit_log` (`action`);

CREATE TABLE IF NOT EXISTS `system_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `timestamp` text NOT NULL,
  `level` text NOT NULL,
  `source` text DEFAULT '',
  `message` text NOT NULL,
  `details` text DEFAULT '',
  `request_id` text DEFAULT ''
);

CREATE INDEX IF NOT EXISTS `idx_logs_time` ON `system_logs` (`timestamp`);
CREATE INDEX IF NOT EXISTS `idx_logs_level` ON `system_logs` (`level`);
