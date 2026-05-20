-- Rate scrapes table: stores on-demand competitor price scraping results

CREATE TABLE IF NOT EXISTS `rate_scrapes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `city` text NOT NULL,
  `start_date` text NOT NULL,
  `end_date` text NOT NULL,
  `property_type` text DEFAULT 'hostels',
  `status` text NOT NULL DEFAULT 'pending',
  `results` text DEFAULT '',
  `created_at` text NOT NULL,
  `completed_at` text DEFAULT ''
);
