CREATE TABLE IF NOT EXISTS quick_link_sections (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  display_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quick_link_sections_order ON quick_link_sections (display_order);

CREATE TABLE IF NOT EXISTS quick_links (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  section_id integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  display_order integer NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quick_links_section_order ON quick_links (section_id, display_order);
