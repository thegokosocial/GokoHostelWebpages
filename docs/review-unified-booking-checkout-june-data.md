# Booking and Check-in Matching Review

This note contains design guidance only. Production dates, row counts, guest contacts, booking identifiers, and other record-level details are intentionally excluded. The runnable simulation in `scripts/audit-june-booking-matching.ts` uses synthetic fixture data.

## Synthetic simulation result

The simulation validates 14 synthetic check-ins: 10 linked, 2 intentionally unmatched, 1 ambiguous, and 1 standalone walk-in. The group scenarios use synthetic contacts and fixture dates.

It covers:

- One-person OTA booking matching.
- Multi-person offline bookings where guests use different synthetic contacts and a shared optional Booking ID.
- Group members arriving on different fixture dates.
- Offline booking-holder matching by unique contact and stay date when no Booking ID is supplied.
- Returning contacts across non-overlapping stays.
- Wrong or duplicate booking references.
- Walk-ins with generated synthetic IDs.

The model links only exact, unique Booking ID matches within the property and stay dates. Contact/date fallback applies only to Offline booking. Walk-ins remain standalone.

## Matching behavior

It works for:

- OTA groups when every guest enters the shared platform Booking ID.
- Offline groups when every guest enters the same optional Booking ID supplied by staff.
- A single offline booking holder when contact and dates identify exactly one booking.
- Group sizes that differ from the value typed into “number of persons,” because matching does not use that field.

It cannot automatically map:

- A check-in when no compatible booking row exists.
- An offline group member who enters their own contact but no shared Booking ID.
- A wrong or missing OTA reference.
- Duplicate booking references that remain ambiguous after property and date filtering.
- Historical stays when the source no longer retains enough identity data.

These cases must remain unlinked or require staff selection. Guessing could allow one checkout to close the wrong booking.

## Implementation guidance

1. Define compatible dates as `booking.checkin_date <= checkin.arrival_date < booking.checkout_date`. This supports a group member arriving later while rejecting a reused Booking ID outside the stay.
2. Match exact IDs against `booking_ref` and `goko_booking_id`. Do not use `cm_booking_id` until legacy numeric check-in IDs have been separated from genuine channel-manager IDs.
3. Normalize IDs by trimming whitespace and comparing case-insensitively; preserve punctuation because it may be meaningful.
4. Show an optional Booking ID field for Offline booking. Without it, only the booking holder may be found through the contact/date fallback.
5. Never use “number of persons” to create links. Compare linked record count with `bookings.persons` only as a staff warning.
6. Treat duplicate or over-capacity linked check-ins as a review warning. Do not silently unlink guests during checkout.
7. For a single-property self-check-in form, use the configured property when matching. Add a check-in property field only if the same form later serves multiple properties.
8. Do not infer historical links when source identity fields have been discarded.

Whole-booking checkout remains feasible when it uses a unique shared Booking ID and explicit database relationships. Contact/date is a narrow offline fallback, and “number of persons” is validation information rather than identity.
