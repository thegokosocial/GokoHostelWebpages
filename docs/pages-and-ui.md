# Pages and admin UI

Staff booking templates, review requests, and Admin Food Bills use [staff WhatsApp messaging](whatsapp-messaging.md). Each user selects Ask every time, Business, or regular/default WhatsApp in Management → My Preferences on that device. Android retains explicit links for both apps and a recoverable draft even when an automatic attempt fails. Review counters count preparation attempts, not launches. Public/guest WhatsApp links retain existing behavior.

The admin header notification-settings dialog supports enable/current-device test/disable with busy states and recoverable errors. Management → My Preferences shows the categories granted to that user and provides whole-category and individual event controls for the current browser/PWA. Test success reports push-service acceptance; users confirm display on their device. See [Push notifications](push-notifications.md) for recipient filtering, mobile rendering, and Chrome-owned notices.

User-initiated async writes and submissions may use the shared `ActionProgressProvider` (`src/components/ui/ActionProgressProvider.tsx`). It is local to the current browser tab, blocks duplicate/conflicting interaction while the operation is active, shows a centered labelled spinner only after a short delay, and does not cover background polling or passive reads. Existing inline states remain where they provide row-, form-, or batch-specific context.

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
| `/admin` | PMS SPA | direct username/password form creates an HttpOnly session; authenticated API calls use that session (legacy password fields remain only for compatibility); phone/tablet section navigation is a scroll-contained modal drawer with a blurred glass surface (X, section choice, or blank drawer area closes it); Management tab dropdown options layer above their dismiss surface but remain below global navigation; long task, attendance, and payroll dialogs scroll within the viewport; public order-history sheets use dynamic viewport sizing |

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
| `foodOrders` | `AdminFoodOrders` | `/api/admin/food-orders` + kitchen (including per-stage bulk advance controls). Order Summary drawer: Print / Bill / Order More; Order More opens Place Order with a compact selected-guest row, while Change guest restores the full selector. Walk-ins are grouped by normalized phone + guest name (not phone alone), hostel tabs by `checkinId`, and cafe tables by table session; the newest spelling is displayed. Bill = in-drawer `GuestFoodBillCard` + Pay/Discount/WhatsApp (`createBillShareLink`); walk-in share links are identity-scoped, and ambiguous public phone lookup requires choosing a name before order data loads. Payment correction/revert and item editing are available from the order view, not inside Bill. The Bill view lists each order’s item names and quantities and excludes fully paid lines. Order Summary shows Unpaid groups first and Fully Paid groups second; mixed-group Bills include only unpaid order items, while fully paid groups remain clickable with their existing Bill/Print/Order More actions. All unpaid selectors and totals derive from net due, so stale payment-status rows remain visible. Each drawer order shows a green Paid or red Unpaid badge beside its workflow status. Payment History reads its selected date range without loading line items or modification badges. An empty or unreachable Kitchen does not imply Served; only the kitchen workflow can advance an order to Served. | `canViewFoodOrders` |
| `expenditure` | `AdminExpenditure` | `/api/admin/expenses` | `canViewAccounts` |
| `splits` | `AdminSplits` | `/api/admin/splits` | `canViewSplits` — **omitted on Pi** |
| `reviews` | `AdminReviews` | `/api/admin/reviews` | `canViewReviews` |
| `management` | `AdminManagement` | mixed | `canViewManagement` |

`AdminBookings.tsx` is leftover Gmail-list UI. Live Bookings is the calendar dashboard.

Accounts reconciliation is additionally action-scoped: `canReconcileCash` controls the canonical Cash card, `canReconcileOnline` controls every configured online-account card, and either permission shows the Reconcile tab. Each card saves independently; undo is Admin-only.

Accounts includes Platform Receivables under `canViewAccounts`, with OTA deductions, direct website Razorpay payments, booking details, and multi-entry payout allocation. Its client-side platform dropdown and inclusive check-in date range filter the already-loaded rows; changing filters clears hidden selections while retaining visible ones. Mobile receivable cards toggle from any non-interactive area and use a green selected state. The selected summary totals every displayed money category and entered allocation amount; unknown Razorpay fee/net values remain visibly Pending instead of being treated as zero. Recording/allocating a payout and refreshing Razorpay gateway fees require `canSettlePlatformPayments`; manual OTA adjustments and manual website fee/tax entry (null fields only) require `canAdjustPlatformReceivables`. There is no UI control for `recognizeMissing` (ops/API only). Website and OTA row checkboxes share settlement compatibility: website rows are selectable when no payout is chosen or the chosen payout is `razorpay-website`. Website fee cells stay Pending until Razorpay evidence or a null-only manual save fills both fee and tax; provider refresh overwrites manual when Razorpay returns values. Account Activity requires both `canViewAccounts` and `canViewExpenses`, includes all account history with date filters, pagination, and the entry creator, and masks account numbers. Combined food payments appear once per payment save with the first order plus the remaining count (Order Summary / Combined Bill / Dashboard multi-order Pay share one `operation_id`; separate per-order Mark Paid saves stay separate). Cash activity includes manual income/expenses, prospective ordinary food/room cash, and dated OTA cash; refunds remain separate and bookkeeping corrections are netted into the original displayed operation.

Expense and Income Records use inclusive start/end accounting-date filters (default: first of previous month through today), with compact date controls and record cards on phones. Expense details show account, method, and vendor; full edits remain subject to split and reconciliation guards. Platform Receivables and Account Activity switch to stacked entries on narrow screens while retaining wide tables on desktop.

Accounts expense records, Food Revenue guest breakdowns, and Room Revenue stay breakdowns scroll horizontally within their tables on narrow screens. Their column headers stay with the table instead of covering rows during vertical page scrolling.

Menu deletion removes items/categories from active admin and guest-menu lists using existing soft-deletion fields. Category deletion archives its children too. Historical food-order references and menu photos are retained; no order history is deleted.

---

## Management tabs (`AdminManagement.tsx`)

Bulk availability saves its local override and mapped dirty retry rows before calling PMS. The modal stays in progress until Aiosell accepts the push, then shows the successful PMS confirmation; a failed or timed-out push leaves the local change saved and exposes a Retry PMS sync action. The Worker’s protected five-minute retry remains a server-side safety net for dirty inventory rows.

Most `adminOnly: true`. Management → My Preferences is the self-service exception available to every authenticated user; users without existing Management access see only that tab, while existing manager compatibility and all tab-specific gates remain unchanged. On phone view, the section selector is bounded and scrollable beneath the global navigation drawer; long To Do task forms/details and attendance date-range dialogs are bounded to the dynamic viewport and scroll internally. Active To Do tasks open for managers in one combined editor with status, shared note, files, and lifecycle actions; Save, Cancel, and Close return directly to the queue. View-only and archived-task details remain read-only. Management dropdown options remain clickable above their local dismiss layer. Audit and Logs are separately grantable view tabs; To Do is visible with `canViewTasks` or `canManageTasks`. Website hidden when `NEXT_PUBLIC_GOKO_RUNTIME === "pi"`.

Existing section selectors within Management use a shared wrapping style based on Account Settings; their page-specific state, route IDs, permission gates, and selection side effects remain unchanged. Food Settings groups the existing Menu, general food settings, and Bill Settings tabs. Each child retains its existing permission gate and `tab` ID; only the Management navigation is grouped.

| `tab` | UI | Permissions | Notes |
|-------|-----|-------------|-------|
| `preferences` | `ManagementPreferences` | any authenticated admin user | device-local WhatsApp app preference; no permission key |
| `dorms` | `AdminSetup` | admin only | init/remove dorms/beds |
| `users` | `ManagementUsers` | admin only | permission checkboxes |
| `backup` | `ManagementBackup` | admin only | |
| `audit` | `ManagementAudit` | `canViewAudit` | Audit Logs includes Room/general, inventory, booking, attendance, and food audit views. Every view has search and From/To date filters, and server reads are clamped to the global audit-retention window. Entries retain raw values while the UI presents friendly action names, resolved room/rate-plan labels, readable dates, counts, and PMS results where available. Inventory mutations are excluded from Room/general and shown in their own responsive Records/Table view with expandable records, wrapped full-text targets/details, preserved columns, and horizontal scrolling. Food order history is preserved as operational data and has no separate destructive cleanup control. Retention controls remain admin-only. |
| `logs` | `ManagementLogs` | `canViewLogs` | PMS + system read views; log-level configuration remains admin-only. Import `pmsLogSummary` not `pmsLog`. |
| `health` | `ManagementHealth` | admin only | |
| `history` | `AdminBedHistory` | management access | visible to non-admin |
| `rates` | `AdminCheckRates` | management access | competitor scrape; visible |
| `menu` | `AdminMenuManagement` | `canViewMenu`; actions: `canManageMenuCategories`, `canManageMenuItems`, `canToggleMenuAvailability`, `canManageInventory` | Management → Food Settings → Menu; `/api/admin/food` per-action map; Menu Items can be searched live by English/Kannada item or category name; selected items may use price-on-request with an indicative range |
| `website` | `AdminWebsite` | admin only | CMS; Cloudflare only |
| `foodSettings` | `AdminFoodSettings` | `canManageFoodSettings` | Management → Food Settings → General; `/api/admin/food` kitchen/tax/hours |
| `billSettings` | `AdminBillSettings` | `canManageFoodSettings` | Management → Food Settings → Bill Settings; bill branding, UPI, payment QR (`food_bill_*` keys); R2 folder `bills` |
| `bulkUpload` | `AdminBulkImport` | admin only | check-in XLSX |
| `qrGenerator` | `qr-generator/` | `canUseQRGenerator` | |
| `accountSettings` | `AccountSettings` | `canManageAccountSettings` | Employees can be deactivated; inactive employees can be removed from the roster while compensation, payroll, and attendance history is retained. |
| `attendance` | `ManagementAttendance` | `canManageAttendance` | staff attendance, leave policy, calendar editing, and payroll summaries for roles granted the permission; attendance history is also available in Management → Audit → Attendance to users with `canViewAudit` |
| `tasks` | `ManagementTasks` | `canViewTasks` or `canManageTasks` | shared task queue; title-only tasks may remain unassigned until later; assigned users update their own tasks; task managers create, assign/reassign/unassign, select followers, archive, reopen, and record linked purchase expenses; assignment and first-completion notifications respect category/device preferences |
| `serverSync` | `ServerSync` | admin only | `/api/sync` |
| `channelManager` | `ChannelManager` | admin only | Aiosell config |
| `bookingSettings` | `BookingSettings` | admin only; Cloudflare only | Revision-protected draft policies, credential-presence metadata, Payments & Readiness gateway configuration plus authenticated Razorpay ₹1 test checkout/ledger/recovery when gateway mode is test; invalid/conflicting drafts block editing with reload |
| `razorpayPayments` | `RazorpayPayments` | admin only; Cloudflare only | Razorpay payment records grouped under Room and Food tabs; Room contains the existing native website checkout ledger with server-side search, IST date-range filtering, and 25-entry pagination, while Food is a placeholder until food payments are added |
| `analytics` | `AdminAnalytics` | `canViewAnalytics` | existing managers retain compatibility access |
| `quickLinks` | `QuickLinks` | `canViewQuickLinks` | mobile-friendly sections of links and QR/image cards; admins edit |

The public guest page is `/quick-links`. It displays active sections and cards from the Links & QRs Management tab. Uploaded QR images are the primary scan-first content; when a card has a URL but no uploaded image, the page generates and displays a QR code automatically. QR codes scale to the available phone width, and guests do not need to tap anything. The admin editor keeps upload/preview failures visible and prevents saving a failed upload as an empty QR card. The supplied Self Check-In QR and Food Order QR assets are seeded only when those existing cards have no saved image, so later administrator uploads are preserved.

Admin and Kitchen login now use server sessions. Passwords are entered only on the login form, are not remembered in browser storage, and are not included in subsequent API requests. Users may choose “Remember me for 15 days”; this persists only a revocable server-side session. Sessions expire and can be revoked with logout. Admin Food Orders → Active Orders reuses the admin session; the standalone `/kitchen` screen uses the kitchen session.

---

## Booking dashboard files

Management → Booking Settings → Payments & Readiness shows dynamic readiness blockers from `evaluateNativeCheckoutReadiness` (migrations 0059–0062, env flags, `/book` destination, Razorpay credentials + webhook secret for the selected Test/Live mode). Flip `gatewayEnvironment` and Save to switch public checkout. **Razorpay payments → Room** (`WebsitePaymentsLedger`) lists recent native checkout attempts (test + live) with search, an IST date-range selector, 25 entries per page, and Previous/Next pagination; it shows outcome, Goko booking ID, Razorpay order/payment IDs — admin-only via `listWebsiteAttempts`. **Razorpay payments → Food** is reserved as a placeholder for future food payment records and will have its own filters and pagination when wired. The admin Razorpay ₹1 preview block (0057/0058, `RAZORPAY_TEST_PREVIEW_ENABLED`) remains separate when mode is test — all-methods runbook, failure hints, webhook inbox. **Email Templates** edits confirmation/updated/cancelled email copy (confirmation sent on website create). **Text Templates** stores SMS drafts only (not sent). See [Razorpay integration](integrations-razorpay.md) and [guest booking UI](guest-booking-ui.md).

`src/components/admin/booking-dashboard/`

| File | Role |
|------|------|
| `index.tsx` | Calendar shell; Calendar, operational Table, and date-scoped All Bookings views |
| `BookingCalendarGrid.tsx` | Bars by dorm/night |
| `BookingDetailPanel.tsx` | Check-in/out (food-tab warn), Collect, OTA postpaid advance/refund/correction history, cancel/no-show with refund; website Razorpay IDs + orphan refund |
| `CreateBookingModal.tsx` | Walk-in / engine; stay total for selected units is the calendar sum of nightly rates (`dormStayTotals` from `getAvailableBeds`); bed chips show `₹A/night` or `₹A–B/night` when nights differ. Walk-in bookings include an optional advance-payment section between Special Requests and Discount. It records cash or online advance, selects an active online receiving account, and previews the remaining balance. |
| `UnassignedBookings.tsx` | OTA leftover chips, Reject |
| `BookingSearchBar.tsx` / `DateRangeSelector.tsx` / `BookingMobileDayView.tsx` / `BookingTableView.tsx` / `BookingTile.tsx` / `PlatformBadge.tsx` | chrome; All Bookings keeps the same row-click/detail-panel behavior, exposes every booking status, wraps its filters on narrow screens, and keeps the table header aligned at the top of its horizontal scroll container. Website (`platform=Website` / `booking_engine`) tiles show the Goko `/logo.png` badge |
| `CheckInPopup.tsx` | Collected → `RecordPaymentModal`; Later = check-in unpaid |
| `ConfirmDialog.tsx` | Overlay is `flex items-center justify-center` — **not** `left-1/2 -translate-x-1/2` (that combination with `modalVariants` `y` slides the dialog off a phone) |
| `utils.ts` / `types.ts` | date math, types |

`BookingDetailPanel.tsx` exposes **Edit Booking** for **manual** and **website** reservations when the user has `canAddBooking` (not channel_manager/OTA). The editor supports guest details, dates (with derived nights), persons, nightly rate, special requests, and add/remove room units in **one save** using the same OTA/walk-in/block chip picker as New Booking. Availability for the edited date range is always shown; bed picks are pruned (not wiped) when a date tweak makes a unit unavailable. Capacity is checked on the **final** bed set (kept − remove + add) using assigned-slot `capacity` / `physicalBedIds` from `getDetail` (a kept full DOUBLE counts as 2, not 1 after UI dedupe) plus add-unit capacities — so date-only edits with a double + single for 3 guests are not falsely blocked. Stay-shape changes **recalculate payment totals** (nightly × nights × physical beds, implying nightly from the prior before-tax amount when stored rate is ₹0) and leave website `amountPaid` unchanged so Due / Collect remaining rises. A money strip previews Total / Due after save. **Amount received** is editable only for manual stays. The panel **History** list (`getBookingHistory`) reloads after every successful mutation (including `editReservation` via `EditBookingModal`), so each `booking_history` insert appears as its own row — matching Management Audit Trail. Website bookings show a **Website / Razorpay** section (Order ID, Payment ID(s), gateway env, dues, checkout id — copy buttons) from `rawData.websiteCheckout` for Razorpay dashboard cross-check; cancelled orphan captures show a banner and **Refund orphan capture** (`refundWebsiteOrphan`, `canDeleteBooking`). **Delete booking** hard-deletes Records-linked walk-ins and **unpaid** Goko Website bookings when the user has `canDeleteBooking` (not OTA; paid website bookings must cancel/refund first). Active occupancy-affecting changes trigger the existing PMS refresh path; closed historical bed assignments remain protected.

Eligible OTA postpaid bookings also show a narrow **Record payment** action for explicit pay-at-property INR bookings. It accepts exact paise amounts and cash/online/split tender, writes an append-only payment event and online receipt when needed, and refreshes the due and event history. Payment permission does not grant booking edits, check-in, cancellation, or refunds. Cancellation/no-show offers an actual refund action for Goko-collected advances; later refunds remain under `canDeleteBooking`. History shows one journal row per OTA money event (`Payment` / `Refund` / `Correction`); **Correction** rows show net Paid before → after (e.g. `₹1.00 → ₹0.00`, including refund reversals that raise Paid). **Revert mistaken payment** (`canCorrectBookingPayments`) opens the shared `RecordPaymentModal` in correction mode (amount `0` = full remaining reverse, reason required, disabled-state hints). Cancelled/no-show unrefunded advances are shown as unresolved. Existing stay revenue stays check-in-date based; Accounts and Analytics separately report the payments by payment date.

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

Mobile booking: compact hero, equal tabs, dates-only search via shared `DateRangePicker` (one month on phones; two months only when the picker container/viewport budget fits them — narrow tablet/desktop modals stay single-month). At tablet/desktop widths the calendar uses compact auto-width month columns, smaller gaps, and 28px day buttons; mobile retains the larger touch-friendly grid. Listings show eligible nightly/stay rates and Add/minus limited by saved maximum beds and stock; switching rates never duplicates beds. Safe-area summary becomes XL sidebar. Representative photos/unknown-category placeholders remain. Floats yield while the panel is visible; inline help remains. Permissions/payment blocking unchanged.

Guest Contact supports a single pencil-driven edit mode. PMS-origin values are read-only; staff with `canManageBookingContacts` can add, edit, label, and delete custom phone/email rows, up to five of each, then Save or Cancel the complete batch. Each phone has its own WhatsApp action and each email has a mailto action. Contact changes are available for all booking statuses and appear in booking History and the Management Audit Trail.
