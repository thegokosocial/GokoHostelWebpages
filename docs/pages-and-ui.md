# Pages and admin UI

**Git-safe.** Routes a human hits, then the React files behind `/admin`. APIs: [api-map.md](api-map.md). Nav permissions: [auth-rbac.md](auth-rbac.md).

---

## Public marketing (`src/app/(marketing)/`)

All `dynamic = "force-static"`. Wrapped in SiteShell + GTM. Sitemap lists these only.

| Path | Content source | Hero video (typical) |
|------|----------------|----------------------|
| `/` | `src/content/home.ts` | loop A |
| `/stay` | `stay.ts` | hero B |
| `/story` | `story.ts` | default loop (omit prop) |
| `/events` | D1 CMS + seed; `EventsPageLive` | still / no `heroVideo=` |
| `/community-area` | D1 CMS + seed; `CommunityPageLive` | hero B |
| `/how-to-reach` | content | hero B |
| `/things-to-do` | content | `heroVideo={null}` still |
| `/faqs` | content | hero B |
| `/reviews` | content | default loop |
| `/booking-enquiry` | form → WhatsApp / email | default loop |

`robots.ts` **disallows:** `/self-checkin`, `/admin`, `/api/`, `/food-order`, `/kitchen`, `/my-bills`, `/review/`.

Book now: `BookingGateProvider` (`src/content/bookingGate.ts`) → Stayflexi URL in `src/lib/site.ts` (`hotel_id=30819`). Not Aiosell.

---

## Guest / staff ops pages

| Path | Role | Auth |
|------|------|------|
| `/self-checkin` | ID check-in; foreign nationality is passport-only | none |
| `/food-order` | Menu + cart | phone in localStorage; session in `sessionStorage.gokoFoodSession`; Logout clears both |
| `/food-order/status` | Poll ~10s | phone |
| `/my-bills` | Food bills | phone; back → previous page |
| `/kitchen` | Queue, thermal print | `sessionStorage.kitchen_pw` |
| `/review/[token]` | Rating funnel | token |
| `/admin` | PMS SPA | direct username/password form; password every API call |

---

## Admin top nav (`src/lib/adminNav.ts`)

Lazy-loaded in `src/app/admin/page.tsx`. Query `?section=` / `?tab=` via `useTabWithHistory`.

| `section` | Component | API | Perm (non-admin) |
|-----------|-----------|-----|------------------|
| `dashboard` | `AdminDashboard` | checkins `getDashboard`; today-checkout live `getPendingFoodTab` | `canViewDashboard` |
| `bookings` | `booking-dashboard/` | `/api/admin/bookings` | `canViewBookings` |
| `beds` | `AdminBeds` | checkins beds | `canViewBeds` |
| `timeline` | `AdminTimeline` | checkins `getBeds` | `canViewTimeline` |
| `inventory` | `InventoryRatePlan` | `/api/admin/inventory` | `canManageInventory` |
| `records` | `AdminRecords` | checkins list/add/…; foreign add/past records prompt for passport + visa uploads | `canViewRecords` |
| `foodOrders` | `AdminFoodOrders` | `/api/admin/food-orders` + kitchen | `canViewFoodOrders` |
| `expenditure` | `AdminExpenditure` | `/api/admin/expenses` | `canViewAccounts` |
| `splits` | `AdminSplits` | `/api/admin/splits` | `canViewSplits` — **omitted on Pi** |
| `reviews` | `AdminReviews` | `/api/admin/reviews` | `canViewReviews` |
| `management` | `AdminManagement` | mixed | `canViewManagement` |

`AdminBookings.tsx` is leftover Gmail-list UI. Live Bookings is the calendar dashboard.

---

## Management tabs (`AdminManagement.tsx`)

Most `adminOnly: true`. Website hidden when `NEXT_PUBLIC_GOKO_RUNTIME === "pi"`.

| `tab` | UI | Permissions | Notes |
|-------|-----|-------------|-------|
| `dorms` | `AdminSetup` | admin only | init/remove dorms/beds |
| `users` | `ManagementUsers` | admin only | permission checkboxes |
| `backup` | `ManagementBackup` | admin only | |
| `audit` | `ManagementAudit` | admin only | |
| `logs` | `ManagementLogs` | admin only | PMS + system; import `pmsLogSummary` not `pmsLog` |
| `health` | `ManagementHealth` | admin only | |
| `history` | `AdminBedHistory` | management access | visible to non-admin |
| `rates` | `AdminCheckRates` | management access | competitor scrape; visible |
| `menu` | `AdminMenuManagement` | `canViewMenu`; actions: `canManageMenuCategories`, `canManageMenuItems`, `canToggleMenuAvailability`, `canManageInventory` | `/api/admin/food` per-action map |
| `website` | `AdminWebsite` | admin only | CMS; Cloudflare only |
| `foodSettings` | `AdminFoodSettings` | `canManageFoodSettings` | `/api/admin/food` |
| `bulkUpload` | `AdminBulkImport` | admin only | check-in XLSX |
| `qrGenerator` | `qr-generator/` | `canUseQRGenerator` | |
| `accountSettings` | `AccountSettings` | `canManageAccountSettings` | |
| `attendance` | `ManagementAttendance` | `canManageAttendance` | |
| `serverSync` | `ServerSync` | admin only | `/api/sync` |
| `channelManager` | `ChannelManager` | admin only | Aiosell config |
| `analytics` | `AdminAnalytics` | `canViewAnalytics` | existing managers retain compatibility access |

---

## Booking dashboard files

`src/components/admin/booking-dashboard/`

| File | Role |
|------|------|
| `index.tsx` | Calendar shell; Calendar, operational Table, and date-scoped All Bookings views |
| `BookingCalendarGrid.tsx` | Bars by dorm/night |
| `BookingDetailPanel.tsx` | Check-in/out (food-tab warn), Collect, cancel-with-refund |
| `CreateBookingModal.tsx` | Walk-in / engine; walk-in bookings include an optional advance-payment section between Special Requests and Discount. It records cash or online advance, selects an active online receiving account, and previews the remaining balance. |
| `UnassignedBookings.tsx` | OTA leftover chips, Reject |
| `BookingSearchBar.tsx` / `DateRangeSelector.tsx` / `BookingMobileDayView.tsx` / `BookingTableView.tsx` / `BookingTile.tsx` | chrome; All Bookings keeps the same row-click/detail-panel behavior, exposes every booking status, and wraps its filters on narrow screens |
| `CheckInPopup.tsx` | Collected → `RecordPaymentModal`; Later = check-in unpaid |
| `ConfirmDialog.tsx` | Overlay is `flex items-center justify-center` — **not** `left-1/2 -translate-x-1/2` (that combination with `modalVariants` `y` slides the dialog off a phone) |
| `utils.ts` / `types.ts` | date math, types |

`BookingDetailPanel.tsx` exposes **Edit Booking** for manual/offline/walk-in reservations when the user has `canAddBooking`. The editor supports guest details, dates (with derived nights), persons, nightly rate, special requests, and add/remove room units. Dates and bed changes are saved separately; active occupancy-affecting changes trigger the existing PMS refresh path, while closed historical bed assignments remain protected.

Dashboard check-ins linked to a booking open that booking in the Booking Dashboard for assignment; existing booking-bed assignments are also displayed on the check-in row. The legacy Beds assignment UI is reserved for unlinked walk-ins; each individual check-in is matched by guest name plus contact, so members of the same group can be assigned independently. A double-bed screen exposes its two physical slots independently for walk-in assignment. A one-person booking may also be assigned one physical slot of a double unit; overlapping physical occupancy removes only that occupied slot, while booking reservations and blocks retain complete-unit protection. Multi-person bookings retain capacity validation.

Calendar POSTs use `fetchWithRetry("/api/admin/bookings", …)` — not `useAdminApi`.

---

## Other admin helpers

| File | Role |
|------|------|
| `useAdminApi.ts` | **Only** `POST /api/admin/checkins` |
| `types.ts` | `parseBedRow`, `CHECKIN_COLUMNS`, `hasPermission` |
| `PwaInstallBanner.tsx` | registers `/sw.js` scope `/` |
| `SyncStatusBar.tsx` | Pi/CF badge |
| `FoodBillGenerator.tsx` | jsPDF dynamic import |
| `DailyLedger.tsx` / `DailyReconcile.tsx` / `AdminAddExpense.tsx` / `AdminFoodBill.tsx` / `AdminRoomRevenue.tsx` | Accounts tabs |
| `RecordPaymentModal.tsx` | Shared Cash/Online/Split collect + refund; stay must pass `amountUnit="rupees"` (food default is paise) |

---

## `src/lib/` (where logic lives)

| Cluster | Files |
|---------|--------|
| Auth / nav | `auth.ts`, `actionPermissions.ts`, `adminNav.ts` |
| Runtime | `runtime.ts`, `dbRetry.ts`, `sqliteWriteCount.ts` |
| Google / ID | `googleApiFetch.ts`, `validateIdDocument.ts`, `parsePassportData.ts`, `parseDob.ts`, `checkinSchema.ts`, `checkinLookup.ts`, `phoneUtils.ts` |
| PMS / Aiosell | `inventoryAvailability.ts`, `aiosell.ts`, `aiosellSync.ts`, `channelMapping.ts`, `channelAutoAssign.ts`, `bookingPricing.ts`, `stayPayment.ts`, `pmsLog.ts`, `pmsLogSummary.ts`, `logRetention.ts`, `logExport.ts` |
| Sync | `syncEngine.ts` |
| CMS | `siteContent.ts`, `siteCopy.ts`, `mediaR2.ts`, `mediaKeys.ts`, `processSiteImage.ts`, `cropRect.ts` |
| Food | `kitchenHours.ts`, `foodLookup.ts`, `foodTab.ts` (client), `foodTabDb.ts` (**server only**), `orderStatus.ts`, `thermalPrint.ts` |
| Splits | `splits.ts` |
| Other | `otaEmailParser.ts`, `pushNotify.ts`, `site.ts`, `seo.ts`, `format.ts`, `utils.ts`, `stayGallery.ts`, `animations.ts` |

Do not import `pmsLog.ts` or `foodTabDb.ts` from client components (`getDb` / `better-sqlite3` in the Worker bundle).

Phone-safe overlays: parent `flex items-center justify-center` + `modalVariants` (scale/y only). Never `left-1/2 -translate-x-1/2` on a node that also animates `y` (`src/lib/animations.ts`).

## Mobile shell invariants

The shared public shell keeps anchor targets below the sticky header, preserves the browser text scale on mobile, and offsets fixed WhatsApp/back-to-top controls for device safe areas. Footer links and booking actions use touch-sized inline targets. These are presentation-only changes: routes, APIs, auth, permissions, booking, check-in, food, and payment workflows remain unchanged.
