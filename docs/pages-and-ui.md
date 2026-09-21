# Pages and admin UI

Staff booking templates and review requests use [WhatsApp Business messaging](whatsapp-messaging.md): Android targets Business with copy/retry recovery, while other devices offer default-app/copy choices. Reviews prepare the message before a separate launch tap; counters show preparation attempts. Public/guest WhatsApp links retain existing behavior.

The admin header notification-settings dialog supports enable/test/disable with busy states and recoverable errors. Test success reports push-service acceptance; users confirm display on their device. See [Push notifications](push-notifications.md) for mobile rendering and Chrome-owned notices.

**Git-safe.** Routes a human hits, then the React files behind `/admin`. APIs: [api-map.md](api-map.md). Nav permissions: [auth-rbac.md](auth-rbac.md).

---

## Public marketing (`src/app/(marketing)/`)

All `dynamic = "force-static"`. Wrapped in SiteShell + GTM. Sitemap lists these only. Video-hero page titles use the shared `goko-hero-title` class (`PageRibbon` + homepage `HomeHeroPremium`): warm gold (`--brand-gold`) with a dark shadow for contrast over green foliage footage; subtitles stay white.

| Path | Content source | Hero video (typical) |
|------|----------------|----------------------|
| `/` | `src/content/home.ts` | loop A |
| `/stay` | `stay.ts` + shared `content/rooms.ts` gallery (`stayGalleryById`) | hero B; four room cards (12-bed mixed, female, 8-bed luxury, double bed) |
| `/story` | `story.ts` | default loop (omit prop) |
| `/events` | D1 CMS + seed; `EventsPageLive` | still / no `heroVideo=` |
| `/community-area` | D1 CMS + seed; `CommunityPageLive` | hero B |
| `/how-to-reach` | content | hero B |
| `/things-to-do` | content | `heroVideo={null}` still |
| `/faqs` | content | hero B |
| `/reviews` | content | default loop |
| `/booking-enquiry` | form → WhatsApp or `POST /api/booking-enquiry` (Cloudflare Email Sending) | default loop |
| `/book` | `BookingHeroPanel` in `PageRibbon` only (no lower-page copy block) | Native date/room checkout and payments not yet implemented |

`robots.ts` **disallows:** `/self-checkin`, `/admin`, `/api/`, `/food-order`, `/kitchen`, `/my-bills`, `/review/`.

Book now: `BookingGateProvider` (`src/content/bookingGate.ts`) → fresh sanitized `/api/booking/config` → `/api/booking/destination` → saved `channel_config.bookingEngineUrl`. Blank/invalid/unavailable configuration uses Booking Enquiry; external links use their provider checkout. `/book` currently offers enquiry only; native checkout is disabled. See [Website booking foundation](flows-website-booking.md).

---

## Guest / staff ops pages

| Path | Role | Auth |
|------|------|------|
| `/self-checkin` | ID check-in; foreign nationality is passport-only; mobile Form C flow has touch-safe country pickers, a reachable submit action, and inline submission errors. Foreign submissions create a recoverable Form C draft for Records review. | none |
| `/food-order` | Menu + cart; after selecting a category, the guest menu keeps the sorted category list in an independently scrollable vertical left rail beside a dish pane whose item list scrolls independently; the home category-card view is unchanged | phone in localStorage; session in `sessionStorage.gokoFoodSession`; Logout clears both |
| `/food-order/status` | Poll ~10s | phone |
| `/my-bills` | Food bills | phone; one combined Open tab + Paid card (no per-order IDs); shared `GuestFoodBillCard`; back → previous page |
| `/kitchen` | Queue, thermal print | `sessionStorage.kitchen_pw` |
| `/review/[token]` | Rating funnel | token |
| `/admin` | PMS SPA | direct username/password form; password every API call |

---

## Admin top nav (`src/lib/adminNav.ts`)

Lazy-loaded in `src/app/admin/page.tsx`. Query `?section=` / `?tab=` via `useTabWithHistory`.

| `section` | Component | API | Perm (non-admin) |
|-----------|-----------|-----|------------------|
| `dashboard` | `AdminDashboard` | checkins `getDashboard`; checkout rows show separate room/food status and use active bed-booking assignments, booking references, then unique phone/name matches for room status; check-ins, checkouts, unpaid stays, and bookings use bounded scrollable lists; `My Tasks` is filtered to the logged-in user and appears at the bottom immediately before the admin-only Image API validation switch | `canViewDashboard` |
| `bookings` | `booking-dashboard/` | `/api/admin/bookings`; nightly summaries show online, walk-in, blocked, and held-for-unassigned-OTA units; the page owns vertical scrolling while calendar/table content owns horizontal scrolling and headings remain aligned; Week/10 Days/30 Days plus Custom use inclusive visible dates, with Custom applied immediately from its date inputs | `canViewBookings` |
| `beds` | `AdminBeds` | checkins beds | `canViewBeds` |
| `timeline` | `AdminTimeline` | checkins `getBeds`; preset day counts plus Custom use an inclusive Start/End range, with Custom applied immediately | `canViewTimeline` |
| `inventory` | `InventoryRatePlan` | `/api/admin/inventory`; 7d/14d/30d plus Custom use an inclusive visible date range, and the grid requests exactly the selected inclusive start/end dates. Availability cells are `OTA / walk-in / blocked`; these are sales pools, not Cloud/Pi network status. Successful Aiosell pushes clear matching dirty rows in bounded batches. An inbound OTA booking with no sellable mapped online bed records an `OTA Inventory Reconciliation Warning` and sends an Operations alert before staff assigns an offline bed. | `canManageInventory` |
| `records` | `AdminRecords` | checkins list/add/…; delete confirmation shows linked food orders, then preserves their history and bed rows; foreign add/past records prompt for passport + visa uploads; active Walk-in/Offline check-ins with `canAddBooking` show Create/Link/Dismiss when `booking_resolution` is pending (including auto-matched); list heals stuck `created`/`linked` rows when no live booking remains; `canDeleteBooking` can hard-delete a Records-linked manual walk-in/offline booking via the same `hardDeleteRecordsWalkinBooking` action as Bookings (calendar-X icon; keeps the check-in); check-in delete uses a separate trash icon (`canDeleteRecords`); Form C review/submission is desktop-only and credentials have a password visibility toggle; current/previous month quick filters and custom arrival-date range selection; the page owns vertical scrolling while the table owns horizontal scrolling and headings remain aligned | `canViewRecords` |
| `foodOrders` | `AdminFoodOrders` | `/api/admin/food-orders` + kitchen (including per-stage bulk advance controls). Order Summary drawer: Print / Bill / Order More; Order More opens Place Order with a compact selected-guest row, while Change guest restores the full selector. Bill = in-drawer `GuestFoodBillCard` + Pay/Discount/WhatsApp (`createBillShareLink`). Combined Bill stacks per-guest cards + WhatsApp. Payment Summary reads allow `canMarkPaid`; Payment History reads its selected date range without loading line items or modification badges. | `canViewFoodOrders` |
| `expenditure` | `AdminExpenditure` | `/api/admin/expenses` | `canViewAccounts` |
| `splits` | `AdminSplits` | `/api/admin/splits` | `canViewSplits` — **omitted on Pi** |
| `reviews` | `AdminReviews` | `/api/admin/reviews` | `canViewReviews` |
| `management` | `AdminManagement` | mixed | `canViewManagement` |

`AdminBookings.tsx` is leftover Gmail-list UI. Live Bookings is the calendar dashboard.

Accounts reconciliation is additionally action-scoped: `canReconcileCash` controls the canonical Cash card, `canReconcileOnline` controls every configured online-account card, and either permission shows the Reconcile tab. Each card saves independently; undo is Admin-only.

Accounts also has an OTA Receivables tab under `canViewAccounts`. It displays recognized platform receivables and payout allocations. Recording/allocating a payout requires `canSettlePlatformPayments`; manual adjustments require `canAdjustPlatformReceivables`.

Accounts expense records, Food Revenue guest breakdowns, and Room Revenue stay breakdowns scroll horizontally within their tables on narrow screens. Their column headers stay with the table instead of covering rows during vertical page scrolling.

Menu deletion removes items/categories from active admin and guest-menu lists using existing soft-deletion fields. Category deletion archives its children too. Historical food-order references and menu photos are retained; no order history is deleted.

---

## Management tabs (`AdminManagement.tsx`)

Bulk availability saves its local override and mapped dirty retry rows before calling PMS. The modal stays in progress until Aiosell accepts the push, then shows the successful PMS confirmation; a failed or timed-out push leaves the local change saved and exposes a Retry PMS sync action. The Worker’s protected five-minute retry remains a server-side safety net for dirty inventory rows.

Most `adminOnly: true`. Audit and Logs are separately grantable view tabs; To Do is visible with `canViewTasks` or `canManageTasks`; users still need `canViewManagement` to enter Management. Website hidden when `NEXT_PUBLIC_GOKO_RUNTIME === "pi"`.

| `tab` | UI | Permissions | Notes |
|-------|-----|-------------|-------|
| `dorms` | `AdminSetup` | admin only | init/remove dorms/beds |
| `users` | `ManagementUsers` | admin only | permission checkboxes |
| `backup` | `ManagementBackup` | admin only | |
| `audit` | `ManagementAudit` | `canViewAudit` | Audit Logs includes Room/general, inventory, booking, attendance, and food audit views. Every view has search and From/To date filters, and server reads are clamped to the global audit-retention window. Entries retain raw values while the UI presents friendly action names, resolved room/rate-plan labels, readable dates, counts, and PMS results where available. Inventory mutations are excluded from Room/general and shown in their own responsive Records/Table view with expandable records, wrapped full-text targets/details, preserved columns, and horizontal scrolling. Food order history is preserved as operational data and has no separate destructive cleanup control. Retention controls remain admin-only. |
| `logs` | `ManagementLogs` | `canViewLogs` | PMS + system read views; log-level configuration remains admin-only. Import `pmsLogSummary` not `pmsLog`. |
| `health` | `ManagementHealth` | admin only | |
| `history` | `AdminBedHistory` | management access | visible to non-admin |
| `rates` | `AdminCheckRates` | management access | competitor scrape; visible |
| `menu` | `AdminMenuManagement` | `canViewMenu`; actions: `canManageMenuCategories`, `canManageMenuItems`, `canToggleMenuAvailability`, `canManageInventory` | `/api/admin/food` per-action map; Menu Items can be searched live by English/Kannada item or category name; selected items may use price-on-request with an indicative range |
| `website` | `AdminWebsite` | admin only | CMS; Cloudflare only |
| `foodSettings` | `AdminFoodSettings` | `canManageFoodSettings` | `/api/admin/food` kitchen/tax/hours |
| `billSettings` | `AdminBillSettings` | `canManageFoodSettings` | Bill branding, UPI, payment QR (`food_bill_*` keys); R2 folder `bills` |
| `bulkUpload` | `AdminBulkImport` | admin only | check-in XLSX |
| `qrGenerator` | `qr-generator/` | `canUseQRGenerator` | |
| `accountSettings` | `AccountSettings` | `canManageAccountSettings` | |
| `attendance` | `ManagementAttendance` | `canManageAttendance` | staff attendance, leave policy, calendar, and payroll summaries; attendance history is also available in Management → Audit → Attendance to users with `canViewAudit` |
| `tasks` | `ManagementTasks` | `canViewTasks` or `canManageTasks` | shared task queue; title-only tasks may remain unassigned until later; assigned users update their own tasks; task managers create, assign/reassign/unassign, archive, reopen, and record linked purchase expenses |
| `serverSync` | `ServerSync` | admin only | `/api/sync` |
| `channelManager` | `ChannelManager` | admin only | Aiosell config |
| `bookingSettings` | `BookingSettings` | admin only; Cloudflare only | Revision-protected draft policies, credential-presence metadata, Payments & Readiness → Website payments ledger (`listWebsiteAttempts`) plus authenticated Razorpay ₹1 test checkout/ledger/recovery when gateway mode is test; invalid/conflicting drafts block editing with reload |
| `analytics` | `AdminAnalytics` | `canViewAnalytics` | existing managers retain compatibility access |
| `quickLinks` | `QuickLinks` | `canViewQuickLinks` | mobile-friendly sections of links and QR/image cards; admins edit |

The public guest page is `/quick-links`. It displays active sections and cards from the Links & QRs Management tab. Uploaded QR images are the primary scan-first content; when a card has a URL but no uploaded image, the page generates and displays a QR code automatically. QR codes scale to the available phone width, and guests do not need to tap anything. The admin editor keeps upload/preview failures visible and prevents saving a failed upload as an empty QR card. The supplied Self Check-In QR and Food Order QR assets are seeded only when those existing cards have no saved image, so later administrator uploads are preserved.

---

## Booking dashboard files

Management → Booking Settings → Payments & Readiness shows dynamic readiness blockers from `evaluateNativeCheckoutReadiness` (migrations 0059–0062, env flags, `/book` destination, Razorpay credentials + webhook secret for the selected Test/Live mode). Flip `gatewayEnvironment` and Save to switch public checkout. **Website payments** (`WebsitePaymentsLedger`) lists recent native checkout attempts (test + live) with outcome, Goko booking ID, Razorpay order/payment IDs — admin-only via `listWebsiteAttempts`. The admin Razorpay ₹1 preview block (0057/0058, `RAZORPAY_TEST_PREVIEW_ENABLED`) remains separate when mode is test — all-methods runbook, failure hints, webhook inbox. **Email Templates** edits confirmation/updated/cancelled email copy (confirmation sent on website create). **Text Templates** stores SMS drafts only (not sent). See [Razorpay integration](integrations-razorpay.md) and [guest booking UI](guest-booking-ui.md).

`src/components/admin/booking-dashboard/`

| File | Role |
|------|------|
| `index.tsx` | Calendar shell; Calendar, operational Table, and date-scoped All Bookings views |
| `BookingCalendarGrid.tsx` | Bars by dorm/night |
| `BookingDetailPanel.tsx` | Check-in/out (food-tab warn), Collect, cancel-with-refund; website Razorpay IDs + orphan refund |
| `CreateBookingModal.tsx` | Walk-in / engine; walk-in bookings include an optional advance-payment section between Special Requests and Discount. It records cash or online advance, selects an active online receiving account, and previews the remaining balance. |
| `UnassignedBookings.tsx` | OTA leftover chips, Reject |
| `BookingSearchBar.tsx` / `DateRangeSelector.tsx` / `BookingMobileDayView.tsx` / `BookingTableView.tsx` / `BookingTile.tsx` / `PlatformBadge.tsx` | chrome; All Bookings keeps the same row-click/detail-panel behavior, exposes every booking status, wraps its filters on narrow screens, and keeps the table header aligned at the top of its horizontal scroll container. Website (`platform=Website` / `booking_engine`) tiles show the Goko `/logo.png` badge |
| `CheckInPopup.tsx` | Collected → `RecordPaymentModal`; Later = check-in unpaid |
| `ConfirmDialog.tsx` | Overlay is `flex items-center justify-center` — **not** `left-1/2 -translate-x-1/2` (that combination with `modalVariants` `y` slides the dialog off a phone) |
| `utils.ts` / `types.ts` | date math, types |

`BookingDetailPanel.tsx` exposes **Edit Booking** for **manual** and **website** reservations when the user has `canAddBooking` (not channel_manager/OTA). The editor supports guest details, dates (with derived nights), persons, nightly rate, special requests, and add/remove room units in **one save** using the same OTA/walk-in/block chip picker as New Booking. Availability for the edited date range is always shown; bed picks are pruned (not wiped) when a date tweak makes a unit unavailable. Capacity is checked on the **final** bed set (kept − remove + add) using assigned-slot `capacity` / `physicalBedIds` from `getDetail` (a kept full DOUBLE counts as 2, not 1 after UI dedupe) plus add-unit capacities — so date-only edits with a double + single for 3 guests are not falsely blocked. Stay-shape changes **recalculate payment totals** (nightly × nights × physical beds, implying nightly from the prior before-tax amount when stored rate is ₹0) and leave website `amountPaid` unchanged so Due / Collect remaining rises. A money strip previews Total / Due after save. **Amount received** is editable only for manual stays. The panel **History** list (`getBookingHistory`) reloads after every successful mutation (including `editReservation` via `EditBookingModal`), so each `booking_history` insert appears as its own row — matching Management Audit Trail. Website bookings show a **Website / Razorpay** section (Order ID, Payment ID(s), gateway env, dues, checkout id — copy buttons) from `rawData.websiteCheckout` for Razorpay dashboard cross-check; cancelled orphan captures show a banner and **Refund orphan capture** (`refundWebsiteOrphan`, `canDeleteBooking`). **Delete booking** hard-deletes Records-linked walk-ins and **unpaid** Goko Website bookings when the user has `canDeleteBooking` (not OTA; paid website bookings must cancel/refund first). Active occupancy-affecting changes trigger the existing PMS refresh path; closed historical bed assignments remain protected.

Dashboard check-ins linked to a booking use the same Beds assignment flow as walk-ins. Booking-bed assignments remain reservation/inventory context and are displayed as planned room/bed details for offline, walk-in, and online guests; they are not displayed as physical occupancy. The Beds page shows that context while assigning, and checkout cards show it separately from room payment status. Each check-in is targeted by ID, so group members can be assigned independently. Double-bed physical slots are independent. Booking cancellation and physical checkout affect only their own ledger.

Calendar POSTs use `fetchWithRetry("/api/admin/bookings", …)` — not `useAdminApi`.

---

## Other admin helpers

| File | Role |
|------|------|
| `useAdminApi.ts` | **Only** `POST /api/admin/checkins` |
| `types.ts` | `parseBedRow`, `CHECKIN_COLUMNS`, `hasPermission` |
| `PwaInstallBanner.tsx` | registers `/sw.js` even on iOS Safari tabs; notification dialog is the only Install app entry (Safari Share → Add to Home Screen on iPhone); Enable gated to Home Screen app; public pages do not link the PWA manifest |
| `SyncStatusBar.tsx` | Pi/CF badge |
| `FoodBillGenerator.tsx` | jsPDF guest/combined bills; left accent rail; coalesced items (no order IDs); branding + CGST/SGST + payment QR |
| `AdminBillSettings.tsx` | Management → Bill Settings |
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
# Internal native hold milestone (17 September 2026)

Accepted quotes can now be persisted/recovered internally against an owner-bound hold. There is still no guest quote-acceptance UI/API or payment confirmation; `/book` remains enquiry-only. See [implemented service and remaining UI gates](native-accepted-quotes.md).

Server quote/refund arithmetic is implemented internally, with no new UI, guest route or enabled payment flow. The existing `/book` enquiry page is unchanged. See [calculator workflows and remaining integrations](native-booking-quotes-and-refunds.md).

Internal hold-aware selection and original-request recovery have no UI or API exposure. The public `/book` page remains an enquiry entry point, not a room/payment checkout. Admin/calendar/Aiosell availability is not changed by the internal selector. See [new internal workflow](native-inventory-hold-foundation.md).

The [physical inventory hold primitive](native-inventory-hold-foundation.md) adds no page, public/admin API action or permission key. Creation is Cloudflare-only and default-disabled via `GOKO_NATIVE_HOLD_INTERNAL_ENABLED`; recovery/release require the original hashed owner token. No guest authorization, payment permission or production checkout is implemented by this primitive. Existing permission aliases and page gates are unchanged. Public exposure requires the remaining pool/quota, fulfilment, abuse-protection and Pi ownership release gates first.
# Guest booking hero update

Preview follow-up: `/book/preview` retains its environment gate/noindex and lookup-email/payment blocks, but Search now fetches actual connected-backend availability/rates/tax/limit through the shared API. No sample room/price data or fallback is retained. Backend binding/data availability is required.

Current search has dates only; guest-count selection is removed. Room price rows emphasize per-bed/night tariffs alongside whole-stay amounts. Management → Booking Settings → Booking & Policies adds maximum selected beds (1–100, default 4, whole double counts as one unit). When readiness passes, Review collects payment choice and opens Razorpay or confirms pay-at-property; confirmation is `/booking/[reference]`. Physical hold still caps at 4 bed IDs.

Homepage and `/book`: public Find a stay and My booking panel over the hero, configured-rate estimates, selection/review, and gated native checkout (test Razorpay) when readiness passes. Confirmation at `/booking/[reference]` uses `GuestBookingManage` with `guestAccessToken` in sessionStorage only: copy booking details + in-card WhatsApp for changes (site float hidden) + Cancel button (no self-serve amend). My booking OTP for a website booking mints a manage token and redirects to that page; non-website bookings still show a minimized snapshot only. It is not an admin permission bypass. `/book/preview` is noindex and returns 404 unless the local preview flag is enabled. No new administrator permission key. See [full guest workflows](guest-booking-ui.md).

Mobile booking: compact hero, equal tabs, dates-only search via shared `DateRangePicker` (one month on phones; two months only when the picker container/viewport budget fits them — narrow tablet/desktop modals stay single-month), and 48px targets on remaining native controls. Listings show eligible nightly/stay rates and Add/minus limited by saved maximum beds and stock; switching rates never duplicates beds. Safe-area summary becomes XL sidebar. Representative photos/unknown-category placeholders remain. Floats yield while the panel is visible; inline help remains. Permissions/payment blocking unchanged.
