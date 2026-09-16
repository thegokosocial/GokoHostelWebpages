ALTER TABLE menu_items ADD COLUMN price_on_request INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN indicative_min_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN indicative_max_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN price_basis TEXT NOT NULL DEFAULT 'per portion';
ALTER TABLE food_order_items ADD COLUMN pricing_status TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE food_order_items ADD COLUMN notes TEXT NOT NULL DEFAULT '';
