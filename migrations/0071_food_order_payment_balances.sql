-- Preserve collected food-order money when an order is edited.
ALTER TABLE food_orders ADD COLUMN amount_paid INTEGER NOT NULL DEFAULT 0;

UPDATE food_orders
SET amount_paid = total
WHERE payment_status = 'paid' AND amount_paid = 0;
