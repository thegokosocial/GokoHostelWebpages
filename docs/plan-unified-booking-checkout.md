# Unified Booking, Check-in, and Checkout Plan

## Decision

Implement whole-booking checkout (option 2).

When a stay is reliably linked to a booking, checkout from either Bookings or Timeline closes the complete booking: the booking becomes checked out, every linked active check-in becomes checked out, and every linked occupied bed moves to cleanup.

This is possible. For example, one booking for five people can link to five self-check-in records, each with its own guest name and phone number. All five records share the same linked booking. The booking reference—not the booking contact phone or “number of persons”—groups them.

## What the system does today

- Self check-in requires a booking platform.
- Booking ID is required for Booking.com, Agoda, MakeMyTrip, Hostelworld, and Airbnb.
- Booking ID is not requested for Offline booking or Walk-in. A GOKO-style ID is generated and stored on the check-in record instead.
- The stored check-in `booking_id` is text. It is not a database relationship to `bookings.id`.
- Each person can submit a separate self-check-in with their own phone number. “Number of persons” is still only an aggregate form value and must not be used to decide which submitted records belong to the booking.
- Timeline checkout closes check-ins by matching the bed's phone number.
- Bookings checkout changes the booking, but does not close the check-in record or move the currently occupied bed to cleanup.

## Required data links

Add internal nullable relationships without adding a visible Records column:

1. `checkins.booking_record_id` → `bookings.id`
2. `beds.current_checkin_id` → `checkins.id`

The existing text fields remain unchanged:

- `checkins.booking_id` remains the Booking ID shown in Records.
- Booking references such as `booking_ref`, `goko_booking_id`, and `cm_booking_id` remain booking identifiers from their respective sources.

Do not reuse `bookings.cm_booking_id` to store a check-in ID. It already has channel-manager meaning and cannot safely represent both concepts.

Both new relationships must be included in Cloudflare/Pi synchronization and foreign-key ID remapping.

## Linking during self check-in

After validating the form, resolve the submitted stay against Bookings:

### OTA bookings

Normalize the entered Booking ID by trimming whitespace and comparing case-insensitively. Search exact matches against `booking_ref` and `goko_booking_id`. Do not search `cm_booking_id` until legacy numeric check-in IDs have been separated from genuine channel-manager IDs. Restrict candidates to the configured property and require `booking.checkin_date <= checkin.arrival_date < booking.checkout_date`; this permits a group member to arrive after the booking starts. Link automatically only when exactly one booking matches. Every member of a group who enters the same Booking ID links to the same booking, while retaining their own check-in record and phone number.

If no booking matches, accept the self check-in but leave it unlinked. If more than one booking matches, leave it unlinked and show it to staff for resolution. Never choose using phone or name alone.

### Offline bookings

Show Booking ID as an optional field for Offline booking. Staff can give every member of the group the same booking reference, allowing all their separate self-check-ins to link to one booking. When the guest supplies it, use the same exact-match rules as an OTA booking.

When no Booking ID is supplied, attempt a conservative match using property, arrival date, normalized phone, and an open booking status. This may link the booking holder, but it will usually not identify the other group members because they use their own phone numbers. Leave those records unlinked for staff to link from Records; do not infer that they belong to the group from the guest count alone.

### Walk-ins

Keep walk-ins as standalone check-ins. Do not automatically create a booking as part of this change. They retain the generated GOKO ID and use the existing Timeline/Records checkout behavior.

## Linking during bed assignment

When a check-in is assigned to a bed, store its ID in `beds.current_checkin_id`.

The chain is then:

`occupied bed → check-in → booking`

This avoids guessing from phone number. It allows one booking to have several occupied beds and several self-check-in records with different phone numbers.

Changing beds transfers `current_checkin_id` to the new bed. Unassigning, cleaning, or completing checkout clears it.

For the expected group flow, each guest has a separate self-check-in record and all records point to the same booking. The booking's active bed assignments identify the complete set of beds. Compare the number of linked records with `bookings.persons` only as a staff warning. A mismatch does not create links or silently remove them.

## One shared whole-booking checkout

Create one server-side checkout operation and call it from both Bookings and Timeline.

For a linked booking, the operation must:

1. Check the existing room-payment and food-tab warnings before confirmation.
2. Atomically claim the booking for checkout so repeated clicks are harmless.
3. Set the booking to `checked_out`, including the actor and timestamp.
4. Set every active check-in with that `booking_record_id` to `checked_out` with the same timestamp.
5. Move every occupied bed connected through those check-ins, plus any occupied bed covered by the booking's active assignments, to `cleanup`.
6. Clear `beds.current_checkin_id` after recording the checkout relationship in history/audit data.
7. Apply the existing early-checkout shortening and inventory update behavior.
8. Create review requests once per checked-out check-in and write one booking history entry plus bed/audit entries.

The API should return the number of check-ins and beds closed so the UI can say, for example, “Booking checked out: 2 records, 2 beds moved to cleanup.”

### Checkout from Timeline

If the selected occupied bed resolves to a linked booking, the confirmation must clearly say that the entire booking and all its beds will be checked out.

If the bed is not linked, do not guess. Check out only that bed/check-in using the existing flow and show “Booking not linked; only this guest was checked out.” This is the fallback for walk-ins and older data.

### Checkout from Bookings

Use the same shared operation. It closes all linked check-ins and occupied beds before refreshing Bookings and Timeline state.

## Records Booking ID link

Keep the existing Booking ID column.

- For a linked check-in, render its stored Booking ID as a button/link that opens the related booking detail panel.
- If the stored text is blank but a booking is linked, display the booking's preferred public ID: GOKO Booking ID, then platform booking reference, then internal `#id`.
- For a newly created unlinked record, keep the value as plain text and provide an authorized “Link booking” action in the record details.
- The link action searches existing bookings and requires staff to select one; it must not overwrite the original collected Booking ID.
- Apply the same behavior in Records table and card views.

## Existing data

Do not backfill or modify historical check-in records. Historical Bookings rows do not exist, so there is no trustworthy booking-side record to link them to.

The new relationships and unified checkout behavior apply only to bookings and check-ins created after this feature is deployed. Existing unlinked check-ins keep their current Booking ID text and existing individual checkout behavior.

## Undo behavior

Undo must also use the explicit links.

- Booking checkout undo restores the booking and the check-ins closed by that checkout event.
- Beds are restored to occupied only if they are still in cleanup and have not been reassigned or marked clean.
- If a bed cannot be safely restored, keep it unchanged and tell staff which bed needs manual assignment.
- Direct undo of an unlinked check-in continues to affect only that check-in.

## Delivery order

1. Add and synchronize the two internal relationship fields.
2. Resolve/link bookings during self check-in and bed assignment.
3. Add Records navigation and manual linking.
4. Introduce the shared checkout operation behind both checkout buttons.
5. Add linked undo behavior.
6. Enable whole-booking checkout for newly linked stays.

## Acceptance checks

- OTA self check-in with a valid Booking ID links to exactly one booking.
- Missing or ambiguous booking matches never close another guest's booking.
- Offline booking links only on a unique safe match.
- Walk-in remains standalone.
- Checkout from Timeline closes the entire linked booking and all linked beds/check-ins.
- Checkout from Bookings produces the same final state.
- Repeating checkout does not duplicate history, review requests, or inventory changes.
- Five guests using five different phone numbers and one shared Booking ID link to one booking; checkout closes all five linked records and all assigned beds.
- Different “number of persons” answers do not change an otherwise exact Booking ID match; the UI reports the count mismatch for staff review.
- A group member arriving after the booking starts but before checkout still links to the booking.
- Two bookings sharing one phone number do not affect each other.
- Records opens the correct booking from the existing Booking ID column.
- Cloudflare and Pi retain the same relationships after synchronization.
- Undo restores only the state changed by the relevant checkout event.

## Out of scope for this change

- Creating one identity/check-in record per member of a group.
- Automatically creating Bookings rows for walk-ins.
- Backfilling or linking historical check-in records.

Those are separate workflows and are not required for reliable whole-booking checkout once the explicit links exist.
