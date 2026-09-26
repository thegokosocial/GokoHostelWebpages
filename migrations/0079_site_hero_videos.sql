-- Cloudflare-only: hero video library + per-page assignments (not synced to Pi).
-- Pi migrator stamps this file without applying SQL.

CREATE TABLE IF NOT EXISTS site_hero_videos (
  id TEXT PRIMARY KEY NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('desktop', 'mobile')),
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  poster_url TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_site_hero_videos_slot ON site_hero_videos(slot);

CREATE TABLE IF NOT EXISTS site_page_heroes (
  page TEXT PRIMARY KEY NOT NULL,
  desktop_video_id TEXT NOT NULL DEFAULT '',
  mobile_video_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
