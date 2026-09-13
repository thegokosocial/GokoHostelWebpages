# Aiosell channel-manager API reference

Git-safe vendor reference for the Aiosell CM integration. It contains no credentials.

Sources reviewed **4 Sep 2026**:

- [Official Aiosell API documentation](https://apidocs.aiosell.com/api-overview)
- Aiosell's downloaded AI context, supplied locally as `aiosell-api-context.md`
- GokoWeb's implementation in `src/lib/aiosell.ts` and `src/app/api/aiosell/`

Use this file for the vendor contract. Use [flows-pms.md](flows-pms.md#aiosell) for
GokoWeb behavior and operational state. If this document and code disagree, code
describes what GokoWeb currently sends; confirm the current vendor contract before
changing it.

## Integration model

Base URL: `https://live.aiosell.com/api/v2/cm`

There are two directions:

1. **GokoWeb → Aiosell:** property mapping, push, fetch, no-show, and multiplier calls.
2. **Aiosell → GokoWeb:** reservation `book`, `modify`, and `cancel` events delivered
   to one webhook hosted by GokoWeb.

All calls use HTTP Basic authentication and JSON except the property-details GET.
Aiosell supplies the production username, password, and partner/PMS id during
onboarding. Store them only in D1 `channel_config` / the local secrets file. Never
commit them here. The inbound webhook must authenticate the caller before retaining
or processing its body.

Dates are `YYYY-MM-DD`; date ranges are inclusive. Aiosell expands a range into
individual nights. Room and rate-plan identifiers must come from property details;
never infer them from display names.

## Endpoint index

`{base}` means the base URL above, `{pms}` is Aiosell's partner id, and `{hotel}` is
the Aiosell property code.

| Operation | Method and path | Direction |
|---|---|---|
| Property / mapping details | `GET {base}/property_details/{hotel}?partnerId={pms}` | pull |
| Inventory push | `POST {base}/update/{pms}` | push |
| Inventory restrictions | `POST {base}/update/{pms}` | push |
| Rate push | `POST {base}/update-rates/{pms}` | push |
| Rate restrictions | `POST {base}/update-rates/{pms}` | push |
| Mark no-show (current docs) | `POST {base}/marknoshow/{pms}` | push |
| Fetch inventory, rates, reservations | `POST {base}/data/{pms}` | pull |
| Channel multiplier | `POST {base}/channel_multiplier/{pms}` | push |
| Reservation webhook | one GokoWeb URL, currently `/api/aiosell/reservations` | inbound |

The same push endpoint distinguishes inventory from restrictions by whether each
room/rate item contains `available`/`rate` or `restrictions`. The shared fetch
endpoint distinguishes datasets with `type`.

## Property and mapping details

Call property details before sending mapped data.

- Path field: hotel code.
- Query field: `partnerId={pms}`.
- Response top level: `hotel_id`, `hotel_name`, `property_category`, `currency`,
  `timezone`, `tax_id`, `address`, `contact`, and `rooms[]`.
- Address may contain `line`, `city`, `state`, `country_code`, and
  `location.{long,latt}` (the API spells latitude `latt`).
- Each room may contain `room_id`, `room_name`, `description`, `count`, `active`,
  `type`, `min_occ`, `max_occ`, and `rateplans[]`.
- Each rate plan may contain `rateplan_id`, `rateplan_name`, `description`,
  `occupancy`, `no_of_meals`, and `extra_adult`.

Use `hotel_id` as `hotelCode`, `room_id` as `roomCode`, and `rateplan_id` as
`rateplanCode` in subsequent calls. Ignore inactive rooms for outbound validation.

## Push contracts

Every POST includes `Content-Type: application/json`, Basic Auth, and `hotelCode`.
Successful inventory/restriction responses normally return
`{"success":true,"message":"Inventory Updated Successfully"}`; rate operations
similarly return `Rates Updated Successfully`. Treat HTTP errors, invalid JSON,
`success:false`, and warnings about rejected mappings as failures requiring review.

### Inventory

```json
{
  "hotelCode": "sandbox-pms",
  "updates": [{
    "startDate": "2026-09-04",
    "endDate": "2026-09-06",
    "rooms": [{ "roomCode": "executive", "available": 5 }]
  }]
}
```

`available` is a non-negative integer. Sending a new value replaces the prior value
for that room/date. Consecutive dates with the same payload may be coalesced.

### Rates

```json
{
  "hotelCode": "sandbox-pms",
  "updates": [{
    "startDate": "2026-09-04",
    "endDate": "2026-09-06",
    "rates": [{
      "roomCode": "executive",
      "rateplanCode": "executive-s-ep",
      "rate": 1749
    }]
  }]
}
```

Rates are numeric nightly amounts in the property's currency, at
room + rate-plan + date grain.

### Restrictions

Inventory restrictions use `rooms[]` with `roomCode`; rate restrictions use
`rates[]` with `roomCode` and `rateplanCode`. Either item contains a
`restrictions` object. An optional top-level `toChannels: string[]` limits the
target channels.

| Restriction | Type | Meaning |
|---|---|---|
| `stopSell` | boolean | close bookings |
| `minimumStay` | integer or null | minimum nights |
| `maximumStay` | integer or null | maximum nights |
| `closeOnArrival` | boolean | disallow arrival |
| `closeOnDeparture` | boolean | disallow departure |
| `minimumStayArrival` | integer or null | arrival-based minimum |
| `maximumStayArrival` | integer or null | arrival-based maximum |
| `exactStayArrival` | integer or null | required arrival stay length |
| `minimumAdvanceReservation` | integer or null | minimum lead days |
| `maximumAdvanceReservation` | integer or null | maximum lead days |

Inventory restrictions apply at room-type level. Rate restrictions apply at
room + rate-plan level. The vendor examples send unused nullable fields explicitly
as `null`. GokoWeb's bulk auto-push intentionally sends a one-field patch because
the live integration treats omitted keys as unchanged; manual/full sync sends the
complete stored snapshot. Reconfirm merge semantics before altering this behavior.

### No-show

The current vendor reference describes:

```http
POST {base}/marknoshow/{pms}
```

```json
{
  "hotelCode": "sandbox-pms",
  "bookingId": "111222350",
  "channel": "gommt"
}
```

Documented channel values include `booking.com` and `gommt` (Goibibo/MakeMyTrip).
Expected success message: `Noshow Marked Successfully`.

GokoWeb sends the documented `hotelCode`, `bookingId`, and `channel` fields. The
dashboard uses the inbound OTA `bookingId` stored as `bookingRef`, with a legacy
`cmBookingId` fallback only when Aiosell returns HTTP 404.

### Channel multiplier

```json
{
  "hotelCode": "sandbox-pms",
  "multiplier": 1.25,
  "channels": ["gommt", "airbnb"]
}
```

`channels` is required and non-empty. `multiplier` is a factor, not a percentage:
`1.2` is +20%, `0.9` is -10%, and `1` is unchanged. It is applied on top of pushed
rates and only to listed channels. Expected success shape uses `status: true`
rather than `success: true`.

## Fetch contracts

All three fetches call `POST {base}/data/{pms}` with:

```json
{
  "type": "inventory",
  "hotelCode": "sandbox-pms",
  "startDate": "2026-09-04",
  "endDate": "2026-09-06"
}
```

`type` is exactly `inventory`, `rates`, or singular `reservation`.

- Inventory returns `{hotelCode, updates[]}`; each update has an inclusive range and
  `rooms[]` entries with `roomCode` and `available`.
- Rates returns `{hotelCode, updates[]}`; each update has an inclusive range and
  `rates[]` entries with `roomCode`, `rateplanCode`, and `rate`.
- Reservations returns an array matching the Book webhook schema below. Guest data
  and special requests vary by OTA.

In GokoWeb, inventory/rate fetch is read-only. Reservation fetch also imports
previously unknown live bookings; see [flows-pms.md](flows-pms.md#aiosell) for its
duplicate, cancellation, and assignment rules.

## Reservation webhook contract

Aiosell sends all reservation actions to one PMS-owned POST endpoint with Basic
Auth. GokoWeb's endpoint is `/api/aiosell/reservations`. `action` selects `book`,
`modify`, or `cancel`.

### Book and modify payload

| Field | Required | Notes |
|---|---|---|
| `action` | yes | `book` or `modify` |
| `hotelCode`, `channel`, `bookingId` | yes | property, OTA, OTA booking id |
| `cmBookingId` | no | channel-manager/itinerary id; nullable |
| `bookedOn` | yes | vendor examples use `YYYY-MM-DD HH:MM:SS` |
| `checkin`, `checkout` | yes | `YYYY-MM-DD`; checkout is the exclusive stay end |
| `segment` | yes | booking category, e.g. `OTA` |
| `specialRequests` | no | nullable OTA-dependent free text; do not parse |
| `pah` | yes | `true` = collect at hotel; `false` = prepaid |
| `amount` | yes | totals described below |
| `guest` | no in practice | all nested guest fields may be missing/null/empty |
| `rooms[]` | yes | sold room/rate-plan units and nightly prices |

`amount` contains required `amountAfterTax`, `amountBeforeTax`, `tax`, and ISO-4217
`currency`; optional/nullable `commission`, `tcs`, and `tds` may also be present.

`guest` may contain `firstName`, `lastName`, `email`, `phone`, and
`address.{line1,city,state,country,zipCode}`. OTAs may mask or omit every one of
these fields. Never reject a reservation solely because guest details are absent.

Each `rooms[]` item contains:

- required `roomCode` and `rateplanCode`;
- optional/nullable `guestName`;
- `occupancy.{adults,children}` integers;
- `prices[]` entries with `date` and numeric `sellRate`.

Treat `modify` as a complete new booking snapshot, not a delta. Processing must be
idempotent on `bookingId`, because deliveries may repeat. A normal successful book
response is `{"success":true,"message":"Reservation Updated Successfully"}`;
modify commonly says `Reservation Modified Successfully`.

### Cancel payload

Cancel is intentionally minimal:

```json
{
  "action": "cancel",
  "hotelCode": "sandbox-pms",
  "channel": "Goibibo",
  "bookingId": "111222333"
}
```

Expected response:
`{"success":true,"message":"Reservation Cancelled Successfully"}`.

## GokoWeb implementation map

| Concern | Source |
|---|---|
| HTTP client, payload types, coalescing | `src/lib/aiosell.ts` |
| Mapping/date validation | `src/lib/aiosellValidation.ts` |
| Automatic inventory/rate/restriction push | `src/lib/aiosellSync.ts` |
| Inbound webhook and fetched-reservation ingest | `src/app/api/aiosell/reservations/route.ts` |
| Manual push/fetch routes | `src/app/api/aiosell/` |
| Channel configuration | `src/app/api/admin/channel-manager/route.ts` |
| Detailed business behavior and live caveats | `docs/flows-pms.md` |

Notable deliberate implementation rules:

- Webhook hotel code must match configured hotel code.
- `book`/`modify` do not echo inventory to Aiosell; `cancel` releases local beds and
  pushes the newly available inventory.
- Reservation guest fields are normalized defensively.
- Consecutive identical push rows are coalesced; gaps remain separate.
- Outbound room/rate-plan codes are checked against active property mappings.
- Every vendor call is logged in `channel_sync_log`.

## Change checklist

- Re-open the official per-endpoint page; this file is a reviewed snapshot, not the
  authority for a future vendor change.
- Confirm the exact path, PMS id placement, field names, and response success key.
- Keep Basic Auth and secrets out of logs/docs where credentials could be exposed.
- Validate hotel, room, and rate-plan codes from property details.
- Use inclusive date ranges and valid non-negative inventory.
- Preserve optional guest/null handling, idempotency, and full-replacement modify.
- Do not create a webhook feedback loop: inbound book/modify never push the same
  occupancy back; cancellation may push released availability.
- Add/update focused tests, then update this reference and `flows-pms.md` if behavior
  changed.
