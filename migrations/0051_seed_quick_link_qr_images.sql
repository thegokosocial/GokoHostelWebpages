-- Persist the QR images supplied for the existing guest quick-link cards.
-- Only fill empty image fields so an administrator's existing upload wins.
UPDATE quick_links
SET image_url = '/images/quick-links/self-check-in-qr.png',
    updated_at = datetime('now')
WHERE lower(title) = 'self check-in qr' AND (image_url IS NULL OR image_url = '');

UPDATE quick_links
SET image_url = '/images/quick-links/food-order-qr.png',
    updated_at = datetime('now')
WHERE lower(title) = 'food order qr' AND (image_url IS NULL OR image_url = '');
