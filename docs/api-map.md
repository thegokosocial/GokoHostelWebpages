# API map

**Git-safe.** Auth: send env `ADMIN_PASSWORD` (value in [secrets-and-access.md](secrets-and-access.md)). RBAC: [auth-rbac.md](auth-rbac.md). 42 `route.ts` files under `src/app/api/`.

Almost every admin route is `POST` + JSON `{ password, username?, action, ... }`. Unknown `action` → 400. Missing auth → 401. RBAC fail → 403.

---

## Public / guest

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/checkin` | POST multipart | none | Self check-in → Vision + Drive + D1; non-Indian nationality requires `idType=passport` |
| `/api/checkin/lookup` | GET `?phone=` | none | Returning guest prefill |
| `/api/validate-id` | POST multipart | none | Live ID/visa OCR |
| `/api/settings` | GET | none | Public flags (`image_validation`, etc.) |
| `/api/food/menu` | GET | none | Menu + kitchen hours + busy + WhatsApp flags |
| `/api/food/order` | POST JSON | none | Place order (idempotency, stock, tab) |
| `/api/food/lookup` | GET `?phone=` | none | Hostel vs walk-in |
| `/api/food/status` | GET | none | Order status / guest orders |
| `/api/food/bills` | GET `?phone=` | none | My bills |
| `/api/site` | GET `?page=events\|community` | none | CMS JSON, `s-maxage=60` |
| `/api/media/[...key]` | GET | none | R2 JPEG |
| `/api/review` | POST | token in JSON | `getReviewRequest`, `submitRating`, `submitFeedback` |
| `/api/form-c/[id]` | GET | token = `ADMIN_PASSWORD` | FRRO payload + photo |
| `/api/aiosell/reservations` | POST | `Authorization` or `x-api-key` = D1 `channel_config.webhookSecret` (raw or `Bearer …`) | Inbound `book` / `modify` / `cancel` |
| `/api/failover-config` | GET | **none** (service worker) | `{ failoverEnabled, piLocalUrl, runtime }` from settings; 30s cache. **Not** a toggle — toggle is `/api/sync` `toggleFailover`. |

---

## Staff (password)

| Route | Auth | Purpose |
|-------|------|---------|
| `/api/food/kitchen` | `authenticateKitchen` | Queue, status, mods, busy, menu |
| `/api/admin/checkins` | `authenticateUser` + per-action map | God route (records, beds, dashboard, users, audit, backup, settings, legacy bookings, rates scrape); foreign record add/update requires passport and visa |
| `/api/admin/bookings` | per-action map | Calendar PMS |
| `/api/admin/inventory` | `canManageInventory` | Grid, blocks, rates, channels |
| `/api/admin/food` | per-action map | Menu viewing, category/item CRUD, availability, stock, and food settings |
| `/api/admin/food-orders` | per-action map | Tabs, pay, void, combined bill, cleanup |
| `/api/admin/expenses` | per-action map | Expenses, ledger, reconcile, food revenue |
| `/api/admin/splits` | per-action map, 403 on Pi | Staff/volunteer IOUs + Goko Accounts bridge |
| `/api/admin/account-settings` | `canManageAccountSettings` or legacy `canManageAccounts` or admin | Accounts, vendors, employees, salary |
| `/api/admin/website` | **admin role**, 403 on Pi | CMS JSON |
| `/api/admin/website/upload` | admin, 403 on Pi, 503 if no R2 | CMS JPEG |
| `/api/admin/channel-manager` | **admin role** | Aiosell config, room/rate maps, daily rates, sync logs |
| `/api/admin/reviews` | admin or `canViewReviews` | Ask-review list, WhatsApp, analytics, settings |
| `/api/admin/qr-history` | user auth | `list` / `save` / `delete` |
| `/api/admin/quick-links` | `canViewQuickLinks`; mutations admin-only | Sections and link/QR cards: `list`, `saveSection`, `deleteSection`, `saveItem`, `deleteItem`, `reorder` |
| `/api/admin/upload` | **env** admin or manager only | Drive upload for records |
| `/api/admin/import` | **env** admin or manager only | Check-in XLSX |
| `/api/admin/bulk-import-accounts` | `authenticateUser` | Expense/income XLSX |
| `/api/bookings/sync` | **env** admin or manager | Gmail OTA parse |
| `/api/sync` | `ADMIN_PASSWORD` or `SYNC_SECRET` | Pi ↔ CF + failover + deploy/shutdown Pi |
| `/api/push` | varies | Web push subscribe / send |
| `/api/auth/google/start` | admin password query/gate | OAuth start |
| `/api/auth/google/callback` | Google | Stores refresh token |
| `/api/aiosell/push-inventory` | user auth | Manual inventory push |
| `/api/aiosell/push-rates` | user auth | Manual rates |
| `/api/aiosell/push-noshow` | user auth | Manual Booking.com no-show (`bookingId` only; sends `hotelId`, `bookingId`, `partner: "booking.com"`) |
| `/api/aiosell/push-inventory-restrictions` | user auth | Restrictions |
| `/api/aiosell/fetch` | user auth | Pull from Aiosell. `type=reservation` also ingest-creates missing Goko bookings (`ingested: { imported, skipped, refs }`). Skips existing refs (including cancelled), `action: "cancel"` snapshots of unknown refs, and snapshots whose `hotelCode` ≠ config. |

---

## `/api/admin/checkins` actions

`auth` (returns role+permissions, no extra perm). `changeMyPassword` is **not** in `ACTION_PERMISSIONS` → `actionAllowed(undefined)` = allowed for any authenticated user.

`list`, `add`, `addPast`, `update`, `delete`, `verifyCheckin`, `getFormCData`, `reExtractFormC`, `updateFormCData`, `getDashboard` (includes `unpaidStays`: all in-house `checked_in` with `stayDueAtHotel` > 0, plus `checked_out` with due whose `checkoutDate` is within the last 14 IST days; today-checkout food tabs use the bed's exact `checkinId` when available and retain contact/name matching only for legacy beds), `markVibeMatched`, `getBeds`, `assignBed`, `unassignBed`, `changeBed`, `checkoutBed`, `checkoutGuest`, `getPendingFoodTab` (`checkinId` and/or `contact` → `{ checkinId, pendingTab, pendingOrders, orderIds }`; same perms as checkout), `undoCheckout`, `markClean`, `getBedHistory`, `deleteBedHistory`, `initDorms`, `removeDorm`, `removeBed`, `getSetting`, `setSetting`, `getStats`, `healthCheck`, `getBookings`, `getUpcomingBookings`, `addBooking`, `updateBookingStatus`, `deleteBooking`, `getUsers`, `createUser`, `updateUser`, `deleteUser`, `getAuditLog`, `getSystemLogs` (`page` / `pageSize` / `level` / `source` / `download`; last 30 days; returns `{ logs, total, page, pageSize, sources }`; Download menu JSON/PDF is client-side), `runBackup`, `getLatestRateScrape`, `getRateScrapeStatus`, `startRateScrape`, `updateRateScrapeResults`, `backfillManagerPermissions`.

---

## Other action lists (exact)

Dashboard check-ins linked to online bookings use the physical `assignBed` flow after self-check-in. Online `assignBeds` writes only `booking_bed_assignments`; physical `assignBed` writes only `beds`. The ledgers do not block or overwrite one another, so a physical guest may take a slot planned online and can later be moved to another physical slot. The Beds UI shows booking room/person context as informational. Physical assignment targets `checkinId`, and the server atomically claims an available physical bed; stale or concurrent claims return a refreshable conflict. Online-online conflicts, booking capacity, and double-slot rules remain enforced within the booking ledger. Physical bed-blocking still excludes physically occupied beds.

The bookings dashboard also uses `getAllBookings` (`canViewBookings`) for its date-scoped All Bookings table. It returns paginated rows across all booking statuses, supports guest/reference/contact search, and refreshes independently; `getCalendarData` continues to exclude cancelled rows for the calendar.

Manual/offline/walk-in bookings can use `editReservation` to update guest name, contact, email, dates, persons, nightly rate, amount received, special requests, and room/bed assignments. Amount received is the final collected amount: increases record the difference through the payment method and online receipt flow; decreases require either an explicit correction or a cash/online/split refund, with online receipt reversal. The amount may be corrected to ₹0, and the booking becomes payment-pending when no amount remains. Date and bed changes are intentionally separate saves so each availability check and assignment mutation is atomic. Active date/bed changes refresh PMS occupancy for the old and new nights; guest-detail and local pricing changes do not require an occupancy push. Existing status, discounts, and tax rules are preserved or recalculated by the server.

**Bookings:** `getCalendarData`, `getDetail`, `search`, `getUnassigned`, `checkAvailability`, `getAvailableBeds`, `getBookingHistory`, `createBooking`, `assignBeds`, `checkIn`, `collectStayPayment`, `checkOut`, `getPendingFoodTab` (by `bookingId` contact → self-checkin food tab; `canCheckOut` **or** `canAddBooking`), `modifyCheckin`, `modifyCheckout`, `editReservation`, `moveRoom`, `assignGuest`, `cancelBooking`, `markNoShow`, `hold`, `unassign`, `rollbackCheckIn`, `rollbackCheckOut`. `checkIn` with `collectPayment` requires `paymentMethod` cash/online/split (`mergeStayCollect`) when hotel-due > 0. Prepaid check-in (`prepaidCheckInWrite`) copies `amountPaid = amountTotal` as online and keeps `paymentStatus` prepaid; a cash `collectPayment` payload is ignored because due is 0. `rollbackCheckIn` of that recording clears amountPaid. `collectStayPayment` is the same write for Dashboard Mark Paid / detail Collect (`canCheckIn` **or** `canAddBooking`; stay must be `checked_in`/`checked_out` with `stayDueAtHotel` > 0). Full `cancelBooking` of `checked_in` accepts `refundAmount` (same rupee integers as `amountPaid`, cap `stayRefundCap(amountPaid)`) + `refundMethod`/`refundCash`; does not reduce `amountPaid`. Occupied nights are `[checkin, checkout)` via `stayCheckout` / `occupiedNights` (missing checkout = one night). `checkOut` shortens assignments (same-day: exclusive checkout = check-in). Closed stays 409 on date/bed edits. `markNoShow` matches `booking.com` / `booking_com`. `assignGuest` does not overwrite a non-numeric `cmBookingId`. Dashboard Unassigned is `getUnassigned` (not calendar-range); each row is enriched with `requestedRoomCodes` / `requestedDormIds` / `requestedDormNames` / `requestedBedCount` / `requestedNeedLabels` / `requestedNeeds` (one bed per person, mixed 2+1 → `[{dormId:8,count:2},{dormId:9,count:1}]`). Off-window rows are labelled in the panel. Assign of an off-window stay jumps the calendar (`rangeCoveringStay`). Occupancy push (`pushIfOtaChanged`) is skipped for `source === "channel_manager"` except `markNoShow`; webhook `cancel` still `triggerInventoryPush`. Webhook `book` / occupancy-mismatch `modify` auto-assigns online beds (`inventory_pool=online`, retry on conflict); staff Unassigned assign stores the picker chip pool (`offline` leftover stays offline). `assignBeds` count+dorm-match only when `currentAssigned === 0` and `requestedBedCount > 0`; mapped requested-dorm picks must match `requestedNeeds`; any bed outside `requestedDormIds` is overflow and skips dorm-match (mixed 2 Exec + 1 other-dorm → 200). Already-assigned stays cannot exceed one per person (`currentAssigned + bedIds.length > requestedBedCount` → 400). `getCalendarData` joins assignment booking ids that the date filter dropped. `assignBeds` is retry-safe (already-ours). Dashboard retries JSON 500 except `createBooking`. Reject on Unassigned is Goko-only `cancelBooking` (admin/manager only; staff 403 even with `canDeleteBooking`) — it does not cancel the OTA. `getAvailableBeds` also returns `taxRate` from setting `booking_tax_rate` (default 5; **0 is 0%**). Walk-in `createBooking` accepts `discountPercent` / `discountAmount` / `discountReason` (ignored when `platform` is `booking_engine`); tax is read from the setting, not the client. Channel Manager `getConfig` / `saveConfig` include `bookingTaxRate` (`0` writes `"0"`).

`retryNoShow` retries only a failed Booking.com no-show sync. `markNoShow` is allowed on or after check-in, releases availability, and sends the Aiosell no-show only when the booking has a Booking.com CM id. Staff cancellation is Goko-only but pushes the locally released availability.

**Inventory:** `getInventoryGrid`, `getChannels`, `upsertChannel`, `deleteChannel`, `getBedTypeConfigs`, `upsertBedTypeConfig`, `getActiveBlocks`, `getBedsFreeToBlock`, `blockBeds`, `unblockBeds`, `updateInventoryOverride`, `bulkSetAvailability` (`dormIds[]`, inclusive dates, `dayFilter`, `mode=set|clear`, absolute `onlineRemaining`; default overrides only; `preview:true` returns read-only current/after online, offline, blocked, and booked/held values per selected room plus combined totals), `getChannelRates`, `updateChannelRate`, `updateRate`, `bulkSetRates` (`ratePlanIds[]`; singular `ratePlanId` still accepted; `channelId` writes `channel_rates` and skips `triggerRatePush`), `bulkAdjustRates`, `bulkSetRestrictions` (D1 preserves other flags; Aiosell auto-push is `restrictionPatch` of the one `restrictionType` only). All inventory writes require `canManageInventory`.

**Food admin (admin only):** `getCategories`, `addCategory`, `updateCategory`, `deleteCategory`, `getMenuItems`, `getMenuItemsByCategory`, `addMenuItem`, `updateMenuItem`, `deleteMenuItem`, `toggleItemAvailability`, `bulkToggleAvailability`, `addStock`, `getLowStockItems`, `getFoodSettings`, `updateFoodSettings`.

**Food orders:** `listOrders`, `getOrderDetails`, `getOrderModifications`, `getActiveGuests`, `getGuestsWithTabs`, `getGuestTab`, `getGuestAllOrders`, `getWalkinOrders`, `getCombinedBill`, `getMenu`, `updateOrderStatus`, `placeOrderForGuest`, `voidItem`, `updateItemQuantity`, `reassignOrder`, `markOrderPaid`, `updatePaymentDetails`, `applyDiscount`, `removeDiscount`, `cleanupOldOrders`. Online/split payments accept `onlineAccountId` and `receiptId`; their online portion creates an automatic bank receipt for reconciliation.

**Kitchen:** `listOrders`, `updateStatus`, `toggleItemAvailability`, `rejectItem`, `updateItemQuantity`, `addItemToOrder`, `toggleBusy`, `getMenuItems`, `getOrderModifications`.

**Expenses:** `addExpense`, `listExpenses`, `getMyExpenses`, `updateExpense`, `deleteExpense`, `getFoodRevenue`, `getRoomRevenue`, `getDailyLedger`, `addDailyIncome`, `deleteDailyIncome`, `getReconciliation`, `saveReconciliation`, `undoReconciliation`, `adjustOpeningBalance`. `getRoomRevenue` is `canViewFoodBills`; rows by `checkinDate` in range + occupied-for-revenue.

**Splits (403 on Pi, 503 if tables missing):** `listMembers`, `addMember`, `updateMember`, `deactivateMember`, `listGroups`, `addGroup`, `updateGroup`, `setGroupMembers`, `deleteGroup`, `listLoginUsers`, `listActivity`, `addExpense`, `updateExpense`, `deleteExpense`, `getBalances`, `addSettlement`, `deleteSettlement`, `payGokoReimbursement`, `listAccounts`. UI `fetch("/api/admin/splits")` only. Goko-as-payer add/update, `payGokoReimbursement`, and `listAccounts` also require `canAddExpense` (inline AND). `deleteSettlement` refuses `hostelExpenseId`. Never `paySalary`.

**Account settings:** `list/add/update/delete` × Accounts, Vendors, Employees; `paySalary`.

Booking creation also exposes `getRoomReceiptAccounts` (`canAddBooking` or `canCheckIn`) for active receiving-account display data. Walk-in `createBooking` accepts optional `advanceAmount`, `advancePaymentMethod` (`cash` or `online`), and `advanceOnlineAccountId`; the server recomputes the total, records the advance as paid, creates a room receipt for online advances, and rejects advances for engine bookings. Manual `editReservation` can correct the final amount received or adjust it with a recorded payment/refund; reservation edits cannot lower the booking total below the final amount received.

**Website:** `getAll`, `saveEventsCopy`, `saveCommunityCopy`, `addEvent`, `updateEvent`, `deleteEvent`, `addSpace`, `updateSpace`, `deleteSpace`, `discardMedia`.

**Channel manager (admin):** `getConfig`, `saveConfig` (webhook secret **required** to set `isActive`), `getRoomMappings`, `saveRoomMapping`, `deleteRoomMapping`, `getRatePlans`, `saveRatePlan`, `deleteRatePlan`, `getDailyRates`, `saveDailyRates`, `getSyncLogs` (filters: `direction`, `type` prefix e.g. `inventory` matches `inventory (auto)`, `status`, `since` floored at 30 days; `page` 1-based, `pageSize` default 50 cap 100, or `limit` as pageSize; `download: true` raises cap to 2000). Returns `{ logs, total, page, pageSize }`. Management Logs Download menu turns that payload into **JSON** or a client-side **PDF** (`logExport.ts`).

**Reviews admin:** `listAskReview`, `sendWhatsApp`, `listResponses`, `getAnalytics`, `getSettings`, `updateSettings`, `editReviewRequest`, `resetReviewRequest`.

**Sync:** `heartbeat` (GET-ish via POST), `status`, `sync`, `pull`, `push`, `getConflicts`, `resolveConflict`, `resolveAll`, `getSyncLog`, `setPrimary`, `toggleAutoSync`, `backfillSyncIds`, `toggleFailover`, `getFailoverStatus`, `setPiLocalUrl`, `resetAndReseed`, `shutdownPi`, `deployUpdate`, `restartCloudflared`.

**Aiosell webhook payload.action:** `book` (no inventory push), `modify` (no push), `cancel` (unassign beds **then** `triggerInventoryPush`). Each webhook POST is a `channel_sync_log` row `direction=pull` `type=reservation` (Management → Logs → PMS). Outbound Aiosell HTTP is logged in the same table via `aiosellFetch`.

---

## Example

```bash
# Password from secrets-and-access.md (ADMIN_PASSWORD)
curl -s https://www.gokohostel.com/api/admin/checkins \
  -H 'content-type: application/json' \
  -d "{\"password\":\"$ADMIN_PASSWORD\",\"action\":\"getDashboard\"}"
```
