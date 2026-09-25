-- Scope Cloudflare-only guest food-bill links to one walk-in identity.
ALTER TABLE food_bill_share_tokens ADD COLUMN walkin_name_key TEXT;

-- Existing walk-in links were phone-wide. Expire them instead of allowing a
-- reused dummy number to expose another guest's orders. Existing hostel links
-- already carry checkin_id and become properly scoped by the updated API.
UPDATE food_bill_share_tokens
SET expires_at = '1970-01-01T00:00:00.000Z'
WHERE checkin_id IS NULL;
