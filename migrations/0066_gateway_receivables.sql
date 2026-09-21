-- Cloudflare-only: native guest checkout/payment tables do not exist on Pi.
-- Provider fee evidence is optional until Razorpay reports it.
ALTER TABLE native_booking_payments ADD COLUMN fee_paise INTEGER CHECK (fee_paise IS NULL OR fee_paise >= 0);
ALTER TABLE native_booking_payments ADD COLUMN tax_paise INTEGER CHECK (tax_paise IS NULL OR tax_paise >= 0);
