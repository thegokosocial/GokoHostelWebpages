# June Data Review: Booking and Check-in Matching

## Production data inspected

Read-only D1 queries on 2026-09-07 found:

- 8 check-in records with June 2026 arrival dates.
- 0 booking records with June 2026 check-in dates.
- The Bookings table currently contains 1 record, with a 2026-09-18 check-in date.
- All 8 June check-ins are already checked out.
- June check-ins consist of 1 Booking.com record, 3 Offline booking records, and 4 Walk-ins.
- The Booking.com record has a collected platform booking reference.
- Offline booking and Walk-in records have independently generated GOKO IDs.

Therefore, no real June check-in can currently be linked to a real June Bookings row. There is no booking-side historical data to join. The June records can validate the shape of collected check-in data, while matching correctness must be exercised with mock booking rows.

## Mock simulation result

The runnable simulation is `scripts/audit-june-booking-matching.ts`.

It passed all 14 modeled check-ins: 10 linked, 2 intentionally unmatched, 1 ambiguous, and 1 standalone walk-in. The five group records linked to the same booking despite using five different phone numbers, arriving on two dates, and reporting different “number of persons” values.

It covers:

- One-person OTA booking matching the shape of the real June Booking.com check-in.
- Two-person offline booking where both guests use different phones and the same optional Booking ID.
- Five-person booking with five separate self-check-ins and five different phone numbers.
- One group member arriving one day after the booking starts.
- Offline booking holder matched by unique phone and stay date when no Booking ID is supplied.
- Offline group member with their own phone and no shared Booking ID.
- Returning guest phone reused across two non-overlapping stays.
- Wrong OTA Booking ID.
- Duplicate Booking ID on two overlapping bookings.
- Walk-in with a generated GOKO ID.

The model deliberately links only exact, unique Booking ID matches within the property and stay dates. Phone/date fallback applies only to Offline booking. Walk-ins remain standalone.

## Does the plan work?

It works for:

- OTA groups when every guest enters the shared platform Booking ID.
- Offline groups when every guest enters the same optional Booking ID supplied by staff.
- A single offline booking holder when phone and dates identify exactly one booking.
- Group sizes that differ from the value typed into “number of persons,” because matching does not use that field.

It cannot automatically map:

- Historical June records, because June Bookings rows do not exist.
- An offline group member who enters their own phone but no shared Booking ID.
- A wrong/missing OTA reference.
- Duplicate booking references that remain ambiguous after property and date filtering.
- A bed to a historical June stay, because those stays are complete and the beds no longer retain a check-in relationship.

These cases must remain unlinked or require staff selection. Treating them as failures to match is the correct safety behavior; guessing would allow one checkout to close the wrong booking.

## Required corrections to the implementation plan

1. Define compatible dates as `booking.checkin_date <= checkin.arrival_date < booking.checkout_date`. This supports a group member arriving later while rejecting a reused Booking ID outside the stay.
2. Match exact IDs against `booking_ref` and `goko_booking_id`. Do not use `cm_booking_id` until legacy numeric check-in IDs have been separated from genuine channel-manager IDs.
3. Normalize Booking IDs by trimming whitespace and comparing case-insensitively; do not remove other characters because punctuation may be meaningful.
4. Show an optional Booking ID field for Offline booking. Without it, only the booking holder may be found through the phone/date fallback.
5. Never use the check-in “number of persons” to create links. Compare linked record count with `bookings.persons` only as a staff warning.
6. Treat a duplicate or over-capacity set of linked check-ins as a review warning. Do not silently unlink guests during checkout.
7. For the current single-property self-check-in, use the configured property when matching. Add a check-in property field only if the same form later serves multiple properties.
8. Do not claim that existing June bed links can be backfilled: completed beds no longer retain sufficient identity data for a reliable reconstruction.

## Conclusion

Whole-booking checkout remains feasible. Its reliable key is a unique shared Booking ID plus explicit database relationships. Phone/date is a narrow offline fallback, and “number of persons” is validation information rather than identity.
