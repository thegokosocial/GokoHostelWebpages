# LLM onboarding — how to pick this repo up

**Git-safe.** Read this **first** after `docs/README.md`. Then gitignored `secrets-and-access.md` if you need to run anything.

This handbook is an **orientation layer**, not a substitute for `src/`. It is enough to know *what exists, why, which file to open, and which traps kill a patch*. It is **not** enough to invent request JSON, SQL, or UI without reading the route/component you are changing.

Trust order: **running system → secrets files → `MAINTAINER.local.md` (live stamps) → `src/` → these docs → committed README/ARCHITECTURE (stale).**

Handoff to another agent (not autopilot): [developing.md](developing.md#handoff-to-another-agent). Never commit secrets. Workers Builds deploys on push to `main`; GitHub Actions does not.

---

## What is documented well

- Product map, two runtimes (Cloudflare Worker + Pi SQLite), storage split (Drive PII vs R2 CMS).
- Decision records (action-POST, paise, no JWT, no D1 transactions around `getDb()`).
- Table *catalog* (52 tables) and FK graph — not every column default.
- Route list + exact `action` names + RBAC maps we verified **31 Aug 2026**.
- End-to-end stories: check-in, food, PMS occupancy, stay collect/refund, Room Revenue, accounts, **splits**, CMS, sync, reviews/Form C.
- Logins, Google, Cloudflare, Pi SSH (gitignored secrets file on this machine).
- Stale-doc list so you do not follow `goko-web-overview.mdc` auto-deploy.

## What you must still open in source

| Need | Open |
|------|------|
| Column types / indexes | `src/db/schema.ts` |
| Query helpers (~100 exports) | `src/db/queries.ts`, CMS: `src/db/siteQueries.ts`, Splits: `src/db/splitQueries.ts` |
| Request/response bodies | the `route.ts` you are calling |
| Admin UI behavior | the component in `src/components/admin/` |
| Permission UI vs API mismatch | `ManagementUsers.tsx` **and** the route map |
| Vision scoring | `src/lib/validateIdDocument.ts` |
| Inventory math | `src/lib/inventoryAvailability.ts` |
| Stay collect / refund (rupees) | `src/lib/stayPayment.ts` |
| Food tab (client vs DB) | `src/lib/foodTab.ts` vs `src/lib/foodTabDb.ts` |
| Sync apply/conflict | `src/lib/syncEngine.ts` |

There is **no OpenAPI**. There is **no middleware.ts**.

---

## Landmines (wrong guess = broken feature)

### 1. Two occupancy systems

| | Physical beds | Calendar PMS |
|--|---------------|--------------|
| Tables | `beds.status` | `bookings` + `booking_bed_assignments` |
| UI | Beds, Timeline, Dashboard | Bookings (`booking-dashboard/`) |
| Check-out | `checkoutBed` → cleanup | `checkOut` shortens assignment exclusive checkout (same-day: checkout=checkin, row stays `assigned`); does **not** flip `beds.status`. Zero-night rows do not overlap. `rollbackCheckOut` restores `[assignment.checkoutDate, bookings.checkoutDate)`. Closed stays (`checked_out` / `no_show` / `cancelled`) are not realigned by Aiosell **modify**. Aiosell **cancel** is **not** closed-guarded except `status === "cancelled"` — a late cancel of `checked_out`/`no_show` overwrites to cancelled, unassigns, and `triggerInventoryPush` (`reservations/route.ts` `handleCancelBooking`). Do not assume fetch ingest checks `hotelCode` (webhook does; ingest does not). Admin `hold` has no `stayClosed` — it can revive a cancelled CM row into OTA hold SQL; `getExpiredHoldBookings` is never invoked. |
| OTA inventory | date-aware assignments + blocks + overrides | |

Calendar `checkIn` **does not** insert `checkins` and **does not** set `beds.occupied`. Guest ID book is Self Check-in / Records. Hostel food tabs (`food_orders.checkin_id`) attach to that self-check-in row, **not** `bookings.id`. Admin UI imports `@/lib/foodTab` only (copy + `canLookupFoodTab`). Routes import `@/lib/foodTabDb` — never from a client component (Worker build pulls `better-sqlite3`). Calendar **Check Out Guest**, Beds checkout, Timeline, and Dashboard today-checkout **live-call** `getPendingFoodTab` (phone-normalized match to **all** active `checkins`) and warn before confirming. Empty / non-normalizable phone (`canLookupFoodTab`) or lookup failure is an explicit “could not check” confirm, not an all-clear. Dashboard Pay uses `orderIds` from that lookup (`on_tab`+`pending`) and **does not checkout** if `markOrderPaid` fails. **Unassign** is not checkout (food tab stays). Walk-in cafe orders (no `checkin_id`) are not matched by phone. Checkout APIs still do **not** refuse unpaid food. Aiosell `pah: false` is **prepaid** (do not collect at the desk). Ingest leaves `amountPaid` 0; calendar `checkIn` runs `prepaidCheckInWrite` (amountPaid = total, method online, status stays prepaid) so Room Revenue and cancel-refund see it. Detail Paid/Balance for prepaid is `displayedStayPayment` (shows total / ₹0). Hotel-due is `stayDueAtHotel` (prepaid → 0, else `amountTotal − amountPaid`) — not `paymentStatus === paid`. `pah: true` is `pay_at_hotel`. Omitted `pah` is `unknown`, not prepaid. Booking detail **Collect payment** / **Payment done** is `collectionCopy(paymentStatus, due)`. Desk **Collected** / Dashboard **Mark Paid** / detail **Collect** share `RecordPaymentModal` and write `paymentStatus: paid` **plus** `paymentMethod` via `mergeStayCollect`. Walk-in `createBooking` stays `unknown`; red Balance still means collect. Cancel-after-check-in refund does **not** reduce `amountPaid`. Refund cap is `stayRefundCap(amountPaid)` so Later unpaid cannot pay out from the Goko till; prepaid after check-in can. `checkIn` of prepaid records stay revenue as online and ignores a cash `collectPayment` payload. Stay UI must pass `amountUnit="rupees"` into `RecordPaymentModal` (food stays paise).

**Date pickers:** Bookings stay nights are `[checkin, checkout)` — missing checkout is coerced with `exclusiveEndDate` / `stayCheckout` (one night). Inventory Bulk Update and Channel Manager **push** start/end are **inclusive nights** (1 Sep–2 Sep = both nights). Check Rates scrape is **exclusive** (`current < To`). `exclusiveEndFromInclusive` converts bulk inclusive end to the exclusive end stored on `bed_blocks`. Past dates are greyed (`min` = today IST) on future-stay pickers only (bulk, New Booking, enquiry, Check Rates, CM push) — not calendar/food/ledger/DOB. Calendar/grid date math uses `addCalendarDays` (civil UTC), never `new Date(date + "T00:00:00")` then `localDateStr`. Inventory grid `rangeStart` is `todayIST()`, not the browser’s local midnight.

New Booking / Unassigned chips: `tagBedsForPicker` offers `min(online)+min(offline)` across the stay (tightest night), **minus unassigned `channel_manager` rooms** on those nights (`getUnassignedOtaHoldsForRange`). Webhook auto-assign is the only path that passes `excludeBookingId` (so the new sale can take its own held online slots). Staff Unassigned **does not** exclude the own hold — leftover chips stay **offline**. OTA hold is released only when the stay has an **online** assignment (`coalesce(inventory_pool,'online')='online'`); overflow assigned entirely on offline beds still holds the sold room. Release is booking-level `NOT EXISTS` — one online bed drops the **whole** booking hold (mixed 2-room / 1-online over-releases the unassigned room; do not “fix” to remaining rooms). Hold count is **rooms** (`rawData.rooms`), not persons — 2 adults in 1 executive room still holds 1. Non-empty `rooms[]` with no matching `roomCode` does not fall back to `roomType` (hold 0); empty/`null` `rooms` does. **Equal CI=CO / empty checkout:** hold SQL matches `occupiedNights` (`date(checkin, '+1 day')` when checkout is NULL, `''`, or `<=` checkin, including inverted dates). `exclusiveEndDate` is null when checkout `<` checkin (auto-assign/Unassigned refuse); do not change hold SQL to match that. Cancelled stays are excluded in those SQL filters, not in `explodeUnassignedOtaHolds`. Extra physically free beds are dropped so a multi-night pick cannot squeeze OTA. Blocked beds still appear as `pool: "block"`. Block Beds chips are physical-free only (no blocked). Inventory override modal remaining is `heldOnline` (assigned online + unassigned OTA), same as the grid OTA/walk-in cell — never `remainingSplit(..., onlineAssigned)` alone. Default ceiling (no override) is `total − blocked` (`otaCeiling`) so Unblock returns beds to Online; a saved override still lets Block eat walk-in first. `assignBeds` must `Number()` bed ids (the picker can POST strings). `assignTaggedBeds` rolls back beds written in that call if a later write fails (`unassignBookingBedsByBedIds`). `getBookingCalendarData` hydrates booking rows for assignment ids missing from the date filter. Bookings calendar POSTs go through `fetchWithRetry` (retry 429/5xx only). Aiosell `book` / cancelled-ref rebook / `modify` auto-assigns online beds in the mapped room type (`src/lib/channelAutoAssign.ts`) for the whole stay — 1 person → 1 bed; 2 persons × 2 nights → 2 beds covering both nights. **One rooms[] row** uses occupancy as persons (1 executive × adults 2 → 2 beds). **Repeated same `roomCode`** with occupancy on every row is 1 bed per sold unit (6 suite × adults 3 → 6 beds, not 18). `persons` and Unassigned `requestedBedCount` both use that count. Guest `lastName: null` must not stringify to `"null"`. True for every room type (executive, dorm, mixed). `modify` re-seats when person count or room type changes (unassign + all-or-nothing auto-assign). Staff overflow in another dorm is kept when count and type are unchanged. Concurrent auto-assign retries a fresh picker up to 3 times (`refreshTagged`; failed bed ids are skipped even if refresh still lists them). `{adults:0,children:0}` is empty occupancy and uses `persons`. Mixed specified+missing rooms[] put leftover persons only on unspecified rooms. Extra staff overflow beds are not occupancy growth (`previousNeedCount`). All-or-nothing: unmapped type or not enough online chips → Unassigned (`getUnassigned` enriches `requestedRoomCodes` / `requestedBedCount` / `requestedNeedLabels` / `requestedNeeds`). Staff then Assign leftover **offline** (walk-in) chips, one per person, or **Reject** (admin/manager only; Goko-only `cancelBooking` — cancel the OTA separately). Staff do not see Reject; API 403s staff full-cancel of an unassigned stay even with `canDeleteBooking`. `assignBeds` count+dorm-match run only when `currentAssigned === 0` and `requestedBedCount > 0` (`route.ts` ~422–451). Walk-in without `roomType` has `requestedBedCount` 0 and skips the count 400. Mapped requested-dorm picks must match `requestedNeeds` (cannot dump 3 Executive for 2 Exec + 1 Dorm). `assignedBedsMatchNeeds` must not require `status === "assigned"`: `assignBeds` passes `getBedById` rows whose `status` is the physical bed (`available` / `occupied`), not `booking_bed_assignments.status` — only skip `unassigned` assignment rows. **Any** selected bed outside `requestedDormIds` is overflow and **skips** that dorm-match 400 — mixed 2 Exec + 1 other-dorm for a 2+1 stay is 200 (intended; UI copy: overflow does not have to match the room-type split). Unassigned caps requested-dorm chips at that dorm’s quota (`canSelectBed`, `picked/quota`) and labels **Other rooms (overflow)**. **Add-bed cap:** already-assigned stays cannot exceed one per person (`currentAssigned + bedIds.length > requestedBedCount` → 400). Completing a stay that has 1 of 2 beds is allowed. Calendar add-bed is `editReservation` `addBedIds`. Mixed types show `requestedNeedLabels` (empty → `roomLabel`). Auto-assign writes `inventory_pool=online` and **skips** `pushIfOtaChanged`. Staff Unassigned assign stores the **chip** pool (`offline` leftover stays offline). Later unassign/cancel/move/date-edit/check-out of a `channel_manager` row still **skips** `pushIfOtaChanged` (Aiosell already sold the night). After Assign, if the stay is off the visible calendar, `rangeCoveringStay` jumps to check-in (same window length, custom mode) **without** first reloading the old window, and collapses other dorms — do not treat a missing bar as a failed write. Unassigned rows outside the window show **Off this calendar**. The Timeline tab is not the bookings grid. `markNoShow` is the exception: Booking.com + `cmBookingId` calls `pushNoShow`, then **always** `pushIfOtaChanged` (including CM source). Unassigned CM no-show fingerprints mapped dorms from room type, not only assignment ids. Hostelworld / missing `cmBookingId` skip the noshow API. Beds-tab assign/checkout does **not** call `triggerInventoryPush`. Channel Manager **Fetch reservations** ingest-creates missing refs only (same auto-assign path) and **never rebooks** an existing ref (including cancelled/no_show). Fetch `action: "cancel"` is skipped even when the ref is unknown (no `received` insert — same as webhook cancel of a missing ref). Fetch also skips snapshots whose `hotelCode` ≠ config. `book` / `modify` snapshots of unknown refs still ingest. Webhook cancel of `checked_out` / `no_show` is a no-op (`already closed`). Inventory `bulkSetRates` with `channelId` writes `channel_rates` and must **not** `triggerRatePush` (that helper reads `daily_rates`). D1 `db.run()` is `{ meta: { changes } }` — never `result.changes` / `rowsWritten`. Use `sqliteWriteCount` (`src/lib/sqliteWriteCount.ts`) after `INSERT...SELECT` in `assignBedToBooking` or a successful assign looks like 409 and the stay vanishes from Unassigned after refresh. A second attempt that writes 0 rows still returns true if this `bookingId`+`bedId` is already assigned (client 500 retry). Same helper for checkins `checkoutGuest` (do not default missing counts to 1) and food-order delete row counts. New booking IDs come from Drizzle `.returning({ id })` (`addBooking`), not `meta.last_row_id` / `lastInsertRowid`. Walk-in `createBooking` also writes `gokoBookingId` `GOKO{YYYYMMDD}{6}` (IST date, same shape as Records). Detail **Goko Booking ID** falls back to `#id` when that column is empty on `source=manual`. Channel ingest still leaves `goko_booking_id` empty (`booking_ref` = Aiosell `bookingId`). Multi-bed assign is all-or-nothing (preflight the picker list; create rolls back + cancels if any bed fails). Night counts are `occupiedNights` / `stayNightCount`, never `new Date(date + "T00:00:00")`. Walk-in tax is setting `booking_tax_rate` (default **5%**, Channel Manager Configuration) — **not** 12%. **`0` is 0%** (`bookingTaxPercent`); do not `Number(x) || 5`. Same for food: `food_tax_rate` via `foodTaxPercent`. `%` / amount discount tabs exist only for `platform === "walkin"`; server ignores discounts on Booking Engine and ignores a client tax rate. Stash walk-in discount in `rawData.gokoWalkin` — never overwrite Aiosell `rawData`. Helpers: `src/lib/bookingPricing.ts`.

### 2. Check-ins / beds APIs return **positional arrays** (legacy Sheets)

`list` rows (`parse` with `CHECKIN_COLUMNS` + extra ids at the end):

| idx | field |
|-----|--------|
| 0–10 | submittedAt … emergencyPhone |
| 11–12 | bookingPlatform (required), bookingId (optional) |
| 13–16 | idType, idCardLink, visaLink, verified |
| 17 | numeric id (string) |
| 18–19 | status, checkedOutAt |
| 20–22 | dob, vibeMatched, dobFromId |

`add` sends `entry: string[]` with the **same** layout (`e[3]` name, `e[13]` idType, …).

`getBeds` → `beds[]` parsed by `parseBedRow`: `[dormName, bedId, position, type, status, guestName, guestContact, checkinDate, expectedCheckout, stayingDays, id]`.

`getBeds.unassigned` is a **different** 16-column layout (no platform/bookingId; `id` is index 15). Do not parse unassigned guests with `CHECKIN_COLUMNS` / list indices.

Newer routes (`/api/admin/bookings`, inventory, food) return **objects**. Do not mix styles.

### 3. `useAdminApi` only hits `/api/admin/checkins`

```ts
// src/components/admin/useAdminApi.ts
fetchWithRetry("/api/admin/checkins", { body: { password, username, ... } })
```

Food, expenses, bookings calendar, website, inventory each `fetch` their **own** URL. Reusing `useAdminApi` for those is a bug. Bookings calendar uses `fetchWithRetry("/api/admin/bookings", …, { retryServerError: body.action !== "createBooking" })`. JSON 500 retry is **opt-in** so check-in `add` / `createBooking` cannot duplicate after a succeeded write. `assignBedToBooking` is retry-safe (`dbWrite` + already-ours). D1 `isTransientError` matches patterns case-insensitively (`failed query`, `d1_error`).

### 4. Permission keys: UI ≠ API

Full checkbox list: `ManagementUsers.tsx` (`NAV_`, `CHECKIN_`, `BOOKING_`, `FOOD_`, `EXPENSE_`, `SPLITS_`, `TOOLS_`).

Collisions / orphans:

| Key | UI label | What actually gates |
|-----|----------|---------------------|
| `canManageInventory` | “Manage inventory / add stock” (food group) | Inventory PMS tab, `/api/admin/inventory`, and Menu stock controls |
| `canViewMenu` | “View menu management” | Menu tab and read-only menu actions |
| `canManageMenuCategories` | “Manage menu categories” | Add, edit, and delete categories |
| `canManageMenuItems` | “Manage menu items” | Add, edit, and delete items; menu item photos |
| `canToggleMenuAvailability` | “Toggle menu availability” | Category/item availability and bulk availability |
| `canManageFoodSettings` | “Manage food settings” | Food Settings tab and settings writes |
| `canAccessKitchen` / `canSyncBookings` | Legacy permission keys | Removed from the active permission catalog; retained only in stored JSON during the compatibility window. See `docs/permission-debt.md`. |
| `canCheckIn` / `canCheckOut` | Calendar check-in / check-out controls | Calendar buttons also accept grantable `canAddBooking`. API `checkIn`/`checkOut`/`collectStayPayment` is OR of dedicated key + `canAddBooking`. |
| `canCheckout` | Checkout guests (beds) | checkins `checkoutBed` — different from `canCheckOut` |

Calendar Cancel / No Show: `canDeleteBooking` (same as the API). Unassigned **Reject** is admin/manager only (not that key). Do not hide Cancel/No Show behind `canCancelBooking` / `canMarkNoShow` / `canCreateBooking` — those keys are not in Users.

Env manager (`MANAGER_PASSWORD`) → `permissions: {}` → **fails every gated action** except Unassigned Reject (`cancelBooking` of a stay with no assigned beds).

### 5. Food Kannada sync drift

UI/settings: `food_kannada_kitchen_print`, `food_kannada_kitchen_display`.  
`syncEngine` still syncs `food_kannada_labels`. Do not invent a third name.

### 6. Session storage keys

| Key | Where | Value |
|-----|--------|--------|
| `gokoAdminSession` | localStorage | **raw** `{ password, username }` if Remember me |
| `kitchen_pw` | sessionStorage | raw kitchen password |
| `gokoFoodCart` / `gokoFoodPhone` | localStorage | guest food |
| `goko.splits.lastGroupId` | localStorage | last Splits group with ≥1 human |

### 7. PWA failover

`public/sw.js` registered from admin (`PwaInstallBanner`, scope `/`). Polls `GET /api/failover-config`. If `failoverEnabled` + `pi_local_url`, intercepts GET/POST (not `/_next/` static) and fails over to Pi. Toggle is `/api/sync` `toggleFailover`, not the GET.

### 8. Book now is not Aiosell

Header Book now → `BookingGateProvider` (age/terms copy in `src/content/bookingGate.ts`) → Stayflexi URL `hotel_id=30819`. Inventory/rates = Aiosell.

### 8b. Bulk restriction auto-push is a patch

`bulkSetRestrictions` writes one field on D1 (other flags stay per night) then `triggerRestrictionPush(dates, ids, restrictionPatch(type, value))`. Unknown/null min stay **400** — never fall through to a full snapshot (`?? undefined`). Aiosell `restrictions.*` fields are optional. Manual CM push (`/api/aiosell/push-rates` `includeRestrictions`, `/api/aiosell/push-inventory-restrictions`) is still a full snapshot (`minimumStay ?? null`, not `||`). `bulkSetAvailability` uses one bounded availability snapshot and writes the default inventory override per dorm/night. Its value is absolute remaining OTA/PMS inventory, converted with `overrideCeilingToSave` so online assignments and unassigned OTA holds remain protected; `clear` deletes only the default override. It triggers one mapped-dorm inventory push and leaves dirty rows for retry when PMS sync is not accepted.

### 8b2. Aiosell push bodies coalesce consecutive identical nights

`pushRates` / `pushInventory` / `pushRateRestrictions` / `pushInventoryRestrictions` run `coalesceAiosellUpdates` before HTTP. Aiosell expands `startDate`–`endDate` server-side ([rate-push](https://apidocs.aiosell.com/api/rate-push)). Do **not** send a range across a weekday-filter gap or when leftover/rate/restriction differs. Callers still pass per-day rows (inventory dirty clear keys off `startDate`).

### 8c. PMS log cards must not import `pmsLog.ts`

`ManagementLogs` is a client component. Operation lines come from `src/lib/pmsLogSummary.ts`. `pmsLog.ts` `import()`s `@/db/queries` to write `channel_sync_log` — do not import it from the browser. Download is a menu (**PDF** / **JSON**), same `download: true` fetch (cap `LOG_DOWNLOAD_MAX`). PDF text is built in `src/lib/logExport.ts` (full request/response; `jspdf` is dynamic-imported). Retention is **30 days** (`src/lib/logRetention.ts`) for both `channel_sync_log` and `system_logs` — prune on insert and list, not `LIMIT 500`. `getSyncLogs` / `getSystemLogs` return `{ logs, total, page, pageSize }` (system also `sources`). Default pageSize 50. System level/source filters are server-side so pagination is correct. Channel Manager widget still uses `limit: 50` + `since` 15 days; extra response fields are ignored.

### 8d. Framer transform vs Tailwind translate

Any Framer node that sets `transform` (`modalVariants` scale/y, or `animate={{ y }}`) must **not** also use `left-1/2 -translate-x-1/2`. Framer overwrites `transform`, so the box’s top-left sits at the viewport center and overflows on a phone. Bookings detail Check In / Cancel / No Show / Check Out: `fixed inset-0 flex items-center justify-center p-4` (`CheckInPopup`, `ConfirmDialog`). Food-order cart FAB and reorder toast: `inset-x-4 mx-auto` (no `left-1/2`). Beds checkout must not add `mx-4` on a `w-full` card inside a padded flex overlay. `src/lib/animations.ts` documents this.

### 9. Do not

- `Number(x) || 5` on `food_tax_rate` or `booking_tax_rate` — **0 is 0%**. Use `foodTaxPercent` / `bookingTaxPercent`.
- SSR `/events` or `/community-area` (`force-static` + `/api/site`).
- `db.transaction()` around `queries.ts` (`getDb()` inside).
- `drizzle-kit generate` as production SQL (`migrations/` only).
- Deploy Worker from **GitHub Actions** CI (there is no `deploy-cloudflare.yml`). Dashboard **Workers Builds** on `goko-hostel-latest-webpage` **does** auto-deploy on push to `main` (`npm run cf:build`). A `tsc` error there leaves production on the last successful build.
- Commit `docs/secrets-and-access.md` or `MAINTAINER.local.md`.
- Run `next build` / `deploy:cf` in the same tree as `next dev`.

### 10. Splits ≠ Accounts

IOUs live in `split_*` (Cloudflare-only). Hostel cash hits `expenses` only when money moves (Goko-as-payer add/update, or `payGokoReimbursement`). Goko identity = `isHouse`, never `name === "Goko"`. Goko is never default-checked. Attribution is FIFO per expense, not group nets. UI `fetch("/api/admin/splits")`. Hide on Pi with `NEXT_PUBLIC_GOKO_RUNTIME` + omit from `ADMIN_NAV` — never `isOfflineMode()` in `page.tsx`. `getMonthKey()` is UTC. Edit of equal-with-Goko must infer `equal` (not `grid`) or Save drops the hostel share. After Accounts books a split **or** the group has a live human settlement, money fields are locked. Retry a 500 with the returned `hostelExpenseId` (same `createdBy`) instead of posting Accounts again. Do not change/delete that Accounts row from the Accounts tab.

---

## Admin UI → code

| Tab | Component | Primary API |
|-----|-----------|-------------|
| Dashboard | `AdminDashboard` | checkins `getDashboard` |
| Bookings | `booking-dashboard/` | `/api/admin/bookings` |
| Beds | `AdminBeds` | checkins beds actions |
| Timeline | `AdminTimeline` | checkins `getBeds` |
| Inventory | `InventoryRatePlan` | `/api/admin/inventory` |
| Records | `AdminRecords` | checkins list/add/update… |
| Food Orders | `AdminFoodOrders` | `/api/admin/food-orders` + kitchen (including per-stage bulk advance controls) |
| Accounts | `AdminExpenditure` | `/api/admin/expenses` (Food + Room Revenue) |
| Splits | `AdminSplits` | `/api/admin/splits` (not `useAdminApi`) |
| Reviews | `AdminReviews` | `/api/admin/reviews` |
| Management | `AdminManagement` | mixed (see overview) |

`AdminBookings.tsx` is **legacy Gmail-list UI**; live nav Bookings is the calendar dashboard.

---

## Suggested read order for a new session

### Current-booking hold exception

The Unassigned picker sends the current `bookingId` when loading and assigning beds. The availability query excludes only that booking's own temporary OTA hold; holds from other unassigned OTA bookings remain protected. This allows an existing failed OTA booking to be completed once capacity is available.

The Booking Calendar and Inventory UI show the held bucket only when the visible range contains an active unassigned OTA hold; zero-held ranges omit it without changing the backend calculation.

1. `developing.md` + this file + `overview.md`
2. `architecture.md` + `decisions.md` + `interactions.md`
3. `auth-rbac.md` + `api-map.md`
4. The **one** flow file for the task
5. The route + component named in that flow (`pages-and-ui.md`)
6. `secrets-and-access.md` / `maintain.md` only if you must run or deploy

After you change product code, update `docs/` (`goko-local-docs` rule). If this file’s landmines change, update **this file**. Do not commit secrets.
