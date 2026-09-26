-- Guest-facing room/property content shared by Stay and native booking.
-- Cloudflare-only: the Website and Booking Settings CMS remains unavailable on Pi.
CREATE TABLE IF NOT EXISTS site_room_content (
  dorm_id integer PRIMARY KEY NOT NULL REFERENCES dorms(id) ON DELETE CASCADE,
  public_name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  amenities text NOT NULL DEFAULT '[]' CHECK(json_valid(amenities) AND json_type(amenities) = 'array'),
  room_photos text NOT NULL DEFAULT '[]' CHECK(json_valid(room_photos) AND json_type(room_photos) = 'array'),
  washroom_photos text NOT NULL DEFAULT '[]' CHECK(json_valid(washroom_photos) AND json_type(washroom_photos) = 'array'),
  updated_at text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS site_property_content (
  id integer PRIMARY KEY NOT NULL CHECK(id = 1),
  exterior_photos text NOT NULL DEFAULT '[]' CHECK(json_valid(exterior_photos) AND json_type(exterior_photos) = 'array'),
  common_photos text NOT NULL DEFAULT '[]' CHECK(json_valid(common_photos) AND json_type(common_photos) = 'array'),
  washroom_photos text NOT NULL DEFAULT '[]' CHECK(json_valid(washroom_photos) AND json_type(washroom_photos) = 'array'),
  updated_at text NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO site_property_content (id, updated_at) VALUES (1, '');
